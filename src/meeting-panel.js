import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readStatus,writeStatus} from './status.js';
import {installMeetingPanel} from './page/meeting-panel.js';

export function panelState(dir, options={}) {
  const status=readStatus(dir) || {}, stats=status.stats || {};
  const read=file=>{try{return fs.readFileSync(path.join(dir,file),'utf8');}catch{return '';}};
  const records=read('transcript.jsonl').trim().split(/\r?\n/).filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  let pending=[];try{pending=JSON.parse(read('live.json')).pending || [];}catch{}
  const state=status.source==='teams' && !['done','failed','leaving'].includes(status.state) ? status.teamsBrowser?.state || 'starting' : status.state || 'starting';
  return {state,recording:status.state==='in_call' && (status.recordingControl?.enabled ?? true),canPause:!!options.canPause,
    ending:!!status.recordingControl?.ending,audioSeconds:stats.audioSeconds,audioPeak:stats.audioPeak,captionsOn:stats.captionsOn,
    rows:[...records,...(Array.isArray(pending)?pending.map(row=>({...row,pending:true})):[])].slice(-120),error:status.error?.message || ''};
}

export async function attachMeetingPanel(page,{dir,origins,onAction=async()=>{},canPause=false}) {
  const binding='__omPanel_'+randomUUID().replaceAll('-','');let active=true;
  await page.exposeBinding(binding,async(source,payload)=>{
    if(!active || source.page!==page || source.frame!==page.mainFrame() || !origins.includes(new URL(source.frame.url()).origin))throw new Error('panel_origin_rejected');
    const action=payload?.action;if(!['state','start','pause','stop'].includes(action))throw new Error('panel_invalid_action');
    if(action!=='state')await onAction(action);
    return panelState(dir,{canPause});
  });
  await page.addInitScript(installMeetingPanel,{binding,origins});
  if(origins.includes(new URL(page.url()).origin))await page.evaluate(installMeetingPanel,{binding,origins});
  return {dispose:()=>{active=false;}};
}

export function requestPanelStop(dir) {
  const status=readStatus(dir);
  if(!status || ['done','failed'].includes(status.state))throw new Error('meeting_already_finished');
  writeStatus(dir,{recordingControl:{...status.recordingControl,ending:true},panelFinishRequested:true});
  fs.writeFileSync(path.join(dir,'STOP'),new Date().toISOString());
}
