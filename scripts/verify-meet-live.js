#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {getConfig} from '../src/config.js';
import {sttPython} from '../src/stt.js';
import {runLiveHost,parseLiveHostArgs,SYNTHETIC_TEXT} from './verify-meet-live-host.js';
import {receiveLiveTest} from './meet-test-receiver.js';

const runFile=promisify(execFile);
export function liveTestOutcome(host,receiver,evidence) {
  if(host.state!=='completed_host_only' || receiver?.state!=='completed')return 'failed';
  return evidence?.remoteContentMatched===true?'completed_synthetic_remote':'partial';
}

export async function verifyLiveMeet(options) {
  const config=getConfig();let receiver,evidence;
  const host=await runLiveHost({...options,config},{onHostReady:async info=>{
    receiver=await receiveLiveTest({...info,seconds:options.seconds});
    if(receiver.state!=='completed')return;
    const wav=path.join(info.dir,'remote.wav');
    await runFile(sttPython(config),[path.join(config.repoRoot,'stt','verify_audio.py'),'--audio',wav,
      '--model-dir',path.join(config.home,'models'),'--out',path.join(info.dir,'recording-asr.json')],
    {windowsHide:true,timeout:120000,env:{...process.env,PYTHONUTF8:'1',HF_HUB_OFFLINE:'1'},maxBuffer:1000000});
    const manifest={environment:'google-live',inputType:'synthetic',captureRoute:'remote-received',joined:receiver.joined,
      markers:[SYNTHETIC_TEXT.replace('一三五七','1357')],captionFile:'receiver-captions.json',
      audioTranscriptFile:'recording-asr.json',wavFile:'remote.wav'};
    const manifestFile=path.join(info.dir,'evidence-manifest.json');
    fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
    let output;
    try {output=await runFile(process.execPath,[path.join(config.repoRoot,'scripts','verify-meeting-evidence.js'),'--manifest',manifestFile],{windowsHide:true});}
    catch(error){if(error.code!==2 || !error.stdout)throw error;output=error;}
    evidence=JSON.parse(output.stdout);
    fs.writeFileSync(path.join(info.dir,'evidence-result.json'),JSON.stringify(evidence,null,2)+'\n');
  }});
  const result={state:liveTestOutcome(host,receiver,evidence),testScope:'same-account-synthetic-two-page',
    humanSpeakerVerified:false,host,receiver,evidence};
  fs.writeFileSync(path.join(host.dir,'verification.json'),JSON.stringify(result,null,2)+'\n');
  return result;
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {const result=await verifyLiveMeet(parseLiveHostArgs(process.argv.slice(2)));console.log(JSON.stringify(result,null,2));
    process.exitCode=result.state==='completed_synthetic_remote'?0:result.state==='partial'?2:1;
  } catch(error){console.error(error.message);process.exitCode=1;}
}
