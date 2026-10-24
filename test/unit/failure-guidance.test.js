import {test} from 'node:test';
import assert from 'node:assert/strict';
import {meetingFailureGuidance} from '../../src/meet/failure-guidance.js';

test('blocked is not diagnosed as anonymous or solved merely by repeated attempts',()=>{
  const info=meetingFailureGuidance('blocked');
  assert.equal(info.reasonConfirmed,false);
  assert.equal(info.retry,'after_conditions_change');
});
test('sign-in and admission failures require different changed conditions',()=>{
  assert.equal(meetingFailureGuidance('signin_required').retry,'after_login');
  assert.equal(meetingFailureGuidance('denied').retry,'after_host_approval');
  assert.equal(meetingFailureGuidance('lobby_timeout').retry,'after_host_available');
  assert.equal(meetingFailureGuidance('unknown'),null);
});
