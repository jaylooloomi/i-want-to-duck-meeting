import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runTeamsRecording} from '../../src/teams-recording.js';
import {writeStatus,readStatus} from '../../src/status.js';

test('managed worker selects devices, owns duration, preserves session identity and releases signal handlers',async(t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'openmeeting-teams-worker-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const config={home:dir,repoRoot:dir,meetingsDir:dir,maxDurationMs:20};const id='test-session';
  writeStatus(dir,{id,state:'starting',source:'teams'});
  const before=process.listenerCount('SIGTERM');let finish,options,reason;
  const service={current:null,async start(input){options=input;this.current={stopping:false,finished:new Promise(r=>finish=r)};return {token:'local-test'};},stop(token,value){assert.equal(token,'local-test');reason=value;this.current.stopping=true;writeStatus(dir,{state:'done'});finish();}};
  const device={id:1,name:'mic',channels:1,sampleRate:16000};
  const final=await runTeamsRecording({config,dir,id,url:'https://teams.live.com/meet/123',status:{}},{service,list:async()=>({inputs:[device],outputs:[{...device,id:2,name:'speaker'}],defaultInput:1,defaultOutput:2})});
  assert.equal(options.managed,true);assert.equal(options.meetingId,id);assert.equal(options.meetingDir,dir);
  assert.equal(reason,'max_duration');assert.equal(final.state,'done');assert.equal(readStatus(dir).deviceSelection.teamsDeviceDetected,false);
  assert.equal(process.listenerCount('SIGTERM'),before);
});
