import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

// Uses the installed local models and real Windows default audio devices.
// Does not join an external meeting or play a substitute recording.
test('Teams link starts a real detached worker without a browser lease and stops at its duration limit',{
  skip:process.env.OPENMEETING_TEAMS_AUTO_TEST !== '1',timeout:60000,
},async()=>{
  const root=fileURLToPath(new URL('../..',import.meta.url));
  const cli=path.join(root,'bin/openmeeting.js');
  const env={...process.env,OPENMEETING_HOME:root,OPENMEETING_MAX_DURATION_MS:'3000'};
  const {stdout}=await promisify(execFile)(process.execPath,[cli,'join','https://teams.live.com/meet/123456789','--no-open'],{env,windowsHide:true,timeout:30000});
  assert.match(stdout,/SOURCE=teams/);assert.doesNotMatch(stdout,/請在 Meet/);
  const id=stdout.match(/^MEETING_ID=(.+)$/m)?.[1]?.trim();assert.ok(id);
  const dir=path.join(root,'meetings',id);let status;
  const deadline=Date.now()+25000;
  while(Date.now()<deadline){
    status=JSON.parse(fs.readFileSync(path.join(dir,'status.json'),'utf8'));
    if(['done','failed'].includes(status.state))break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(status.state !== 'done'){
    fs.writeFileSync(path.join(dir,'STOP'),'test cleanup');
    assert.fail(JSON.stringify(status));
  }
  assert.equal(status.endReason,'max_duration');assert.equal(status.error,null);
  assert.ok(status.heartbeatAt);assert.ok(status.stats.tracks.mic.audioSeconds>0);assert.ok(status.stats.tracks.system.audioSeconds>0);
  assert.equal(status.deviceSelection.teamsDeviceDetected,false);
  for(const name of ['audio.wav','audio-microphone.wav','audio-system.wav']){
    const wav=fs.readFileSync(path.join(dir,name));assert.equal(wav.readUInt32LE(40),wav.length-44);
  }
  const second=await promisify(execFile)(process.execPath,[cli,'join','https://teams.live.com/meet/123456789','--no-open'],{env:{...env,OPENMEETING_MAX_DURATION_MS:'60000'},windowsHide:true,timeout:30000});
  const secondId=second.stdout.match(/^MEETING_ID=(.+)$/m)?.[1]?.trim();assert.ok(secondId);
  await promisify(execFile)(process.execPath,[cli,'leave',secondId],{env,windowsHide:true,timeout:35000});
  const stopped=JSON.parse(fs.readFileSync(path.join(root,'meetings',secondId,'status.json'),'utf8'));
  assert.equal(stopped.state,'done');assert.equal(stopped.error,null);assert.equal(stopped.endReason,'user_stop');
});
