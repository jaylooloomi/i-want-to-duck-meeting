import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {selectDevices,saveAudioSettings,readAudioSettings,audioHealth,parseTeamsUrl} from '../../src/audio-settings.js';
import {main} from '../../src/cli.js';
import {writeStatus,readStatus} from '../../src/status.js';
const mic={id:20,name:'Built in mic',channels:2,sampleRate:44100};
const usb={id:21,name:'USB',channels:1,sampleRate:48000};
const out={id:23,name:'Speakers [Loopback]',channels:2,sampleRate:48000};
const devices={inputs:[mic,usb,{...out,virtual:true}],outputs:[out],defaultInput:20,defaultOutput:23};
function home(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'openmeeting-auto-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('new users use the actual Windows default, not an arbitrary USB or virtual input',()=>{
  const selected=selectDevices(devices);assert.equal(selected.input.id,20);assert.equal(selected.output.id,23);assert.equal(selected.teamsDeviceDetected,false);
  assert.throws(()=>selectDevices(devices,{}, {input:23}));
});
test('confirmed devices survive index changes; unplugged or ambiguous devices fall back to defaults',(t)=>{
  const dir=home(t);saveAudioSettings(dir,usb,out);const saved=readAudioSettings(dir);
  const changed={...devices,inputs:[mic,{...usb,id:99}]};assert.equal(selectDevices(changed,saved).input.id,99);
  assert.equal(selectDevices({...devices,inputs:[mic]},saved).input.id,20);
  assert.equal(selectDevices({...devices,inputs:[mic,usb,{...usb,id:22}]},saved).input.id,20);
  assert.equal(selectDevices(devices,saved,{input:20}).input.id,20);
  for(const content of ['null','[]','{"invalid":']){
    fs.writeFileSync(path.join(dir,'audio-settings.json'),content);
    assert.equal(selectDevices(devices,readAudioSettings(dir)).input.id,20);
  }
});
test('missing physical/default device requires a decision rather than silently capturing another input',()=>{
  assert.throws(()=>selectDevices({...devices,defaultInput:999}));
  assert.throws(()=>selectDevices({...devices,defaultOutput:999}));
});
test('health distinguishes observation, silence and signal without claiming speech success',()=>{
  assert.deepEqual(audioHealth({tracks:{mic:{audioSeconds:2},system:{audioSeconds:20,audioPeak:0}}}),{mic:'checking',system:'no_signal'});
  assert.equal(audioHealth({tracks:{mic:{audioSeconds:20,audioPeak:3}}}).mic,'signal_only');
});
test('Teams URL keeps its join secret and rejects spoofed domains, non-HTTPS and unrelated pages',()=>{
  const valid='https://teams.live.com/meet/12345?p=secret&x=two';assert.equal(parseTeamsUrl(valid),valid);
  assert.ok(parseTeamsUrl('https://teams.microsoft.com/l/meetup-join/encoded?context=test'));
  assert.equal(parseTeamsUrl('https://teams.microsoft.com/meet/455275640170525?p=9SE7nZO224G7lDLNWI'),'https://teams.microsoft.com/meet/455275640170525?p=9SE7nZO224G7lDLNWI');
  assert.equal(parseTeamsUrl('https://teams.cloud.microsoft/meet/455275640170525?p=9SE7nZO224G7lDLNWI'),'https://teams.cloud.microsoft/meet/455275640170525?p=9SE7nZO224G7lDLNWI');
  for(const url of ['http://teams.live.com/meet/123','https://teams.live.com.evil/meet/123','https://teams.live.com/','https://user@teams.live.com/meet/123','https://teams.live.com:444/meet/123'])assert.equal(parseTeamsUrl(url),null);
});
test('Teams CLI routes to background worker, preserves URL and confirms only usable completed captures',async(t)=>{
  const dir=home(t);const logs=[];let meeting;
  const io={env:{OPENMEETING_HOME:dir},out:s=>logs.push(s),err:s=>logs.push(s),audioReady:async()=>true,spawnWorker:async(o)=>{
    meeting=o;writeStatus(o.dir,{pid:process.pid,state:'in_call',heartbeatAt:new Date().toISOString()});return process.pid;
  }};
  const url='https://teams.live.com/meet/12345?p=keep';
  assert.equal(await main(['join',url,'--no-open','--input','20'],io),0,logs.join('\n'));
  assert.equal(meeting.url,url);assert.equal(readStatus(meeting.dir).source,'teams');assert.equal(readStatus(meeting.dir).audioOverrides.input,20);
  fs.writeFileSync(path.join(meeting.dir,'transcript.jsonl'),JSON.stringify({source:'teams-mic',text:'本機測試',speaker:'講者 A',t0:new Date().toISOString(),t1:new Date().toISOString()})+'\n');
  logs.length=0;
  assert.equal(await main(['transcript',meeting.id],io),0);
  assert.ok(logs.some(line=>line.includes('Teams 原生字幕與 Paraformer 備援')));
  assert.equal(readStatus(meeting.dir).teamsBrowserEnabled,false);
  assert.ok(!logs.some(line=>line.includes('Google Meet 即時字幕')));
  assert.equal(await main(['join',url,'--no-open'],io),5,'duplicate recording rejected');
  assert.equal(await main(['audio-confirm',meeting.id],io),1);
  writeStatus(meeting.dir,{state:'done',captureDevices:{mic,system:out},stats:{tracks:{mic:{audioPeak:10},system:{audioPeak:20}}}});
  fs.writeFileSync(path.join(meeting.dir,'transcript.jsonl'),JSON.stringify({source:'teams-mic',text:'local'})+'\n');
  assert.equal(await main(['audio-confirm',meeting.id],io),1,'one-sided text must not become remembered success');
  fs.writeFileSync(path.join(meeting.dir,'transcript-paraformer.jsonl'),JSON.stringify({source:'teams-system',text:'remote'})+'\n');
  assert.equal(await main(['audio-confirm',meeting.id],io),0);
  assert.equal(readAudioSettings(dir).input.name,mic.name);
});
