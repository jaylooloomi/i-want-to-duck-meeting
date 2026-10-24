import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateMeetingEvidence as check} from '../../src/verification.js';
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
test('remote requires explicit live source and membership; human labels are not authentication',()=>{
  assert.equal(check({...evidence,captureRoute:'remote-received'}).remoteContentMatched,true);
  assert.equal(check({...evidence,captureRoute:'remote-received',joined:false}).remoteContentMatched,false);
  assert.equal(check({...evidence,captureRoute:'remote-received',inputType:'human'}).humanSpeakerVerified,false);
});
