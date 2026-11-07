import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readStatus,writeStatus} from './status.js';
import {writeMinutes} from './transcript/minutes.js';
import {installMeetingPanel} from './page/meeting-panel.js';

export function panelState(dir, options={}) {
  const status=readStatus(dir) || {}, stats=status.stats || {};
  const read = file => {
    let fd;
    try {
      fd = fs.openSync(path.join(dir, file), 'r');
      const size = fs.fstatSync(fd).size;
      const offset = file === 'transcript.jsonl' ? Math.max(0, size - 512 * 1024) : 0;
      if (file === 'live.json' && size > 512 * 1024) return '';
      const tail = Buffer.alloc(size - offset);
      const length = fs.readSync(fd, tail, 0, tail.length, offset);
      const content = tail.toString('utf8', 0, length);
      return offset ? content.slice(content.indexOf('\n') + 1) : content;
    } catch { return ''; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  };
  const records=read('transcript.jsonl').trim().split(/\r?\n/).filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  let pending=[];try{pending=JSON.parse(read('live.json')).pending || [];}catch{}
  const state=status.source==='teams' && !['done','failed','leaving'].includes(status.state) ? status.teamsBrowser?.state || 'starting' : status.state || 'starting';
  return {state,recording:status.state==='in_call' && (status.recordingControl?.enabled ?? true),canPause:!!options.canPause,
    ending:fs.existsSync(path.join(dir,'STOP')),audioSeconds:stats.audioSeconds,audioPeak:stats.audioPeak,captionsOn:stats.captionsOn,
    rows:[...records,...(Array.isArray(pending)?pending.map(row=>({...row,pending:true})):[])].slice(-120),error:status.error?.message || ''};
}

export async function attachMeetingPanel(page,{dir,origins,onAction=async()=>{},canPause=false}) {
  const suffix = randomUUID().replaceAll('-', '');
  const binding = '__omPanel_' + suffix;
  const worldName = 'duck-meeting-panel-' + suffix;
  const cdp = await page.context().newCDPSession(page);
  const contexts = new Map();
  let active = true;
  let mainFrame;
  const dispose = () => {
    active = false;
    contexts.clear();
    void cdp.detach().catch(() => {});
  };
  cdp.on('Page.frameNavigated', ({frame}) => {
    if (!frame.parentId) mainFrame = frame.id;
  });
  cdp.on('Runtime.executionContextCreated', ({context}) => {
    if (context.name === worldName) contexts.set(context.id, context);
  });
  cdp.on('Runtime.executionContextDestroyed', ({executionContextId}) => contexts.delete(executionContextId));
  cdp.on('Runtime.executionContextsCleared', () => contexts.clear());
  cdp.on('Runtime.bindingCalled', async event => {
    if (!active || event.name !== binding) return;
    const context = contexts.get(event.executionContextId);
    if (!context || context.auxData?.frameId !== mainFrame || !origins.includes(new URL(page.url()).origin)) return;
    let request;
    let result;
    try {
      request = JSON.parse(event.payload);
      if (!['state','start','pause','stop'].includes(request.action)) throw new Error('panel_invalid_action');
      if (request.action !== 'state') await onAction(request.action);
      result = {state:panelState(dir, {canPause})};
    } catch (error) {
      result = {error:error.message};
    }
    if (!active || !request || contexts.get(event.executionContextId) !== context) return;
    const expression = `globalThis.__omPanelReply?.(${JSON.stringify(request.id)}, ${JSON.stringify(result)})`;
    // Unique context ID avoids sending a response to a newly navigated document.
    const scope = context.uniqueId ? {uniqueContextId:context.uniqueId} : {contextId:context.id};
    await cdp.send('Runtime.evaluate', {expression, ...scope}).catch(() => {});
  });
  try {
    await cdp.send('Page.enable');
    const {frameTree} = await cdp.send('Page.getFrameTree');
    mainFrame = frameTree.frame.id;
    await cdp.send('Runtime.enable');
    await cdp.send('Runtime.addBinding', {name:binding, executionContextName:worldName});
    const options = {binding, origins, openShadow:origins.every(origin => /^http:\/\/(127\.0\.0\.1|localhost):/.test(origin))};
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source:`(${installMeetingPanel.toString()})(${JSON.stringify(options)})`,
      worldName, runImmediately:true,
    });
    return {dispose};
  } catch (error) {
    dispose();
    throw error;
  }
}

export function requestPanelStop(dir) {
  const status=readStatus(dir);
  if(!status || ['done','failed','leaving','transcribing'].includes(status.state))throw new Error('meeting_already_finished');
  try {
    fs.writeFileSync(path.join(dir,'STOP'),'meeting-panel\n',{flag:'wx'});
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

/** Prepare optional local material after the normal recorder has closed its files. */
export function finishPanelReview(dir, log) {
  try {
    if (fs.readFileSync(path.join(dir, 'STOP'), 'utf8') !== 'meeting-panel\n') return;
  } catch (error) {
    if (error.code !== 'ENOENT') log?.warn(`panel stop marker unavailable: ${error.message}`);
    return;
  }
  try {
    const {mdPath} = writeMinutes(dir, undefined, {allowMissingRecording:true, extractDraft:true});
    writeStatus(dir, {panelReview:{state:'draft_ready', file:path.basename(mdPath)}});
  } catch (error) {
    // A review failure must not change the recording outcome or Agent handoff.
    log?.warn(`panel review draft unavailable: ${error.message}`);
    try { writeStatus(dir, {panelReview:{state:'failed', error:error.message}}); } catch { /* preserve terminal status */ }
  }
}
