#!/usr/bin/env node
// Explicit real-service test host. Never accepts pre-existing/private audio.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {getConfig} from '../src/config.js';
import {launchChrome,connectChrome} from '../src/chrome.js';

const runFile=promisify(execFile);
export const SYNTHETIC_TEXT='這是自動化會議測試。我正在使用 Google Meet。確認代碼是一三五七。';

export function parseLiveHostArgs(args) {
  const options={live:false,seconds:30};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--live')options.live=true;
    else if(args[i]==='--seconds')options.seconds=Number(args[++i]);
    else throw new Error('Only --live and --seconds are supported');
  }
  if(!options.live)throw new Error('Real Google Meet access requires explicit --live');
  if(!Number.isInteger(options.seconds) || options.seconds<10 || options.seconds>120)throw new Error('--seconds must be 10..120');
  return options;
}

async function generateFixture(wav,config) {
  if(process.platform!=='win32')throw new Error('Windows System.Speech is required');
  const powershell=path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  await runFile(powershell,['-NoProfile','-File',path.join(config.repoRoot,'scripts','make-tts-wav.ps1'),
    '-TextBase64',Buffer.from(SYNTHETIC_TEXT,'utf8').toString('base64'),'-Out',wav],{windowsHide:true,timeout:60000,maxBuffer:100000});
}

export async function runLiveHost(options, deps={}) {
  const config=options.config || getConfig();
  const dir=options.dir || path.join(config.repoRoot,'test','.tmp','live-meet-host-'+randomUUID());
  fs.mkdirSync(path.dirname(dir),{recursive:true});fs.mkdirSync(dir);
  const wav=path.join(dir,'synthetic.wav');
  const report={state:'starting',environment:'google-live',inputType:'synthetic',
    validationScope:'host-only',remoteContentMatched:false};
  const save=()=>fs.writeFileSync(path.join(dir,'host-result.json'),JSON.stringify(report,null,2)+'\n');
  let chrome,browser,stopped=false,timer;
  const schedule=deps.setTimeout || setTimeout,unschedule=deps.clearTimeout || clearTimeout;
  const stop=()=>{stopped=true;void browser?.close().catch(()=>{});};
  const deadline=ms=>{unschedule(timer);timer=schedule(stop,ms);};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {
    if(!options.live)throw new Error('Explicit --live required');
    await (deps.generate || generateFixture)(wav,config);
    report.fixtureSha256=createHash('sha256').update(fs.readFileSync(wav)).digest('hex');
    report.fixtureText=SYNTHETIC_TEXT;save();
    if(stopped)throw new Error('Test cancelled');
    chrome=await (deps.launch || launchChrome)({chromePath:config.chromePath || undefined,profileDir:config.profileDir,
      headless:false,muteAudio:false,extraArgs:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${wav}`]});
    if(stopped)throw new Error('Test cancelled');
    const connected=await (deps.connect || connectChrome)(chrome.cdpUrl);browser=connected.browser;
    if(stopped)throw new Error('Test cancelled');
    const {context}=connected;
    const page=await context.newPage();
    await context.grantPermissions(['microphone','camera'],{origin:'https://meet.google.com'});
    deadline(90000);
    await page.goto('https://meet.google.com/new?hl=en',{waitUntil:'domcontentloaded',timeout:45000});
    const readyUntil=Date.now()+20000;
    while(!stopped && Date.now()<readyUntil) {
      if(new URL(page.url()).hostname==='accounts.google.com')throw new Error('signin_required');
      if(await page.getByRole('button',{name:/^Leave call/i}).first().isVisible().catch(()=>false))break;
      await page.waitForTimeout(500);
    }
    if(stopped || !await page.getByRole('button',{name:/^Leave call/i}).first().isVisible())throw new Error('Host did not reach in-call state');
    const camera=page.getByRole('button',{name:/^Turn off camera/i}).first();
    if(await camera.isVisible())await camera.click({timeout:3000});
    const mic=page.getByRole('button',{name:/^Turn on microphone/i}).first();
    if(await mic.isVisible())await mic.click({timeout:3000}); // synthetic sender only
    report.state='host_ready';report.meetingUrl=page.url();save();
    console.log(`HOST_READY=${report.meetingUrl}`);
    if(deps.onHostReady) {
      // Join/preparation, capture, bounded offline decode and cleanup each need time.
      deadline((options.seconds+300)*1000);
      await deps.onHostReady({context,page,dir,url:report.meetingUrl,shouldStop:()=>stopped});
    } else {
      deadline(options.seconds*1000);
      const end=Date.now()+options.seconds*1000;
      while(!stopped && Date.now()<end && !fs.existsSync(path.join(dir,'STOP')))await page.waitForTimeout(500);
    }
    report.state=stopped?'cancelled':'completed_host_only';
  } catch(error) {report.state=stopped?'cancelled':'failed';report.error=error.message;}
  finally {
    unschedule(timer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
    await browser?.close().catch(()=>{});await chrome?.close().catch(()=>{});save();
  }
  return {dir,...report};
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result=await runLiveHost(parseLiveHostArgs(process.argv.slice(2)));console.log(JSON.stringify(result,null,2));
    if(result.state!=='completed_host_only')process.exitCode=1;
  } catch(error){console.error(error.message);process.exitCode=1;}
}
