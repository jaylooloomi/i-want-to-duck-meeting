import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateMeetingEvidence as check} from '../../src/verification.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createWavHeader} from '../../src/audio/wav-writer.js';
const evidence={markers:['Google Meet','1357'],captionText:'Google Meet 確認代碼 1357',recordingText:'google meet，1357',audioSeconds:25,audioPeak:2000,environment:'google-live',joined:true,inputType:'synthetic',captureRoute:'local-injected'};

test('real platform captions plus local injection cannot count as remote recording',()=>{
  const result=check(evidence);
  assert.equal(result.level,'local-content-matched');
  assert.equal(result.remoteContentMatched,false);assert.equal(result.humanSpeakerVerified,false);
});
test('mock cannot become remote even when its declared route says remote',()=>{
  assert.equal(check({...evidence,environment:'mock',captureRoute:'remote-received'}).level,'mock-content-matched');
});
test('signal or captions alone cannot prove recorded sentence',()=>{
  for(const patch of [{recordingText:''},{captionText:''},{audioPeak:0},{audioSeconds:0},{markers:[]},{markers:['']}])
    assert.equal(check({...evidence,...patch}).level,'incomplete');
});
test('confirmation digits cannot match the middle of a longer number',()=>{
  assert.equal(check({...evidence,recordingText:'Google Meet 913570'}).recordingMatch,false);
});

test('digit boundaries also apply inside a complete expected sentence',()=>{
  const markers=['確認代碼是1357'];
  for(const text of ['確認代碼是13579','確認代碼是91357']) {
    const result=check({...evidence,markers,captionText:text,recordingText:text});
    assert.equal(result.captionsMatch,false);assert.equal(result.recordingMatch,false);
  }
  const result=check({...evidence,markers,captionText:'確認代碼是１３５７。',recordingText:'確認代碼是1357'});
  assert.equal(result.captionsMatch,true);assert.equal(result.recordingMatch,true);
});

test('partial report explains each marker using unchanged observed text',()=>{
  const captionText='Google Map，確認代碼1357';
  const result=check({...evidence,captionText});
  assert.equal(result.level,'incomplete');
  assert.deepEqual(result.markerResults,[
    {marker:'Google Meet',captionsMatch:false,recordingMatch:true},
    {marker:'1357',captionsMatch:true,recordingMatch:true},
  ]);
  assert.deepEqual(result.observedText,{captions:captionText,recording:evidence.recordingText});
  assert.deepEqual(check({...evidence,markers:[]}).markerResults,[]);
});
test('remote requires explicit live source and membership; human labels are not authentication',()=>{
  assert.equal(check({...evidence,captureRoute:'remote-received'}).remoteContentMatched,true);
  assert.equal(check({...evidence,captureRoute:'remote-received',joined:false}).remoteContentMatched,false);
  assert.equal(check({...evidence,captureRoute:'remote-received',inputType:'human'}).humanSpeakerVerified,false);
});

test('offline CLI reads artifacts but rejects ASR from a different WAV',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'om-evidence-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const wav=Buffer.concat([createWavHeader({dataBytes:4}),Buffer.from([0,4,0,4])]);
  const audioSha256=createHash('sha256').update(wav).digest('hex');
  fs.writeFileSync(path.join(dir,'audio.wav'),wav);
  fs.writeFileSync(path.join(dir,'captions.json'),JSON.stringify([{text:'Google Meet 1357'}]));
  const spec={...evidence,wavFile:'audio.wav',captionFile:'captions.json',audioTranscriptFile:'asr.json'};
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(spec));
  const run=()=>spawnSync(process.execPath,['scripts/verify-meeting-evidence.js','--manifest',path.join(dir,'manifest.json')],{encoding:'utf8',windowsHide:true});
  fs.writeFileSync(path.join(dir,'asr.json'),JSON.stringify({decodedText:'Google Meet 1357',audioSha256}));
  const good=run();assert.equal(good.status,0,good.stderr);assert.equal(JSON.parse(good.stdout).remoteContentMatched,false);
  fs.writeFileSync(path.join(dir,'asr.json'),JSON.stringify({decodedText:'Google Meet 1357',audioSha256:'different-audio'}));
  assert.equal(run().status,1);
});
