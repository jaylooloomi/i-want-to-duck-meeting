import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureLeaseExpired } from '../../src/microphone.js';

test('Teams startup is not treated as a disconnected client before both devices are ready', () => {
  assert.equal(captureLeaseExpired({ ready:true, mode:'teams', clientReady:false, lastClient:0 }, 200000), false);
});
test('Teams survives minute-long background tab timer throttling and stops a truly abandoned session', () => {
  const session = { ready:true, mode:'teams', clientReady:true, lastClient:1000 };
  assert.equal(captureLeaseExpired(session, 61000), false);
  assert.equal(captureLeaseExpired(session, 121000), false);
  assert.equal(captureLeaseExpired(session, 181001), true);
});
test('browser microphone disconnects still stop promptly, and draining recordings are not stopped twice', () => {
  assert.equal(captureLeaseExpired({ ready:true, mode:'microphone', lastAudio:1000 }, 16001), true);
  assert.equal(captureLeaseExpired({ ready:true, mode:'teams', clientReady:true, lastClient:0, stopping:true }, 999999), false);
});
