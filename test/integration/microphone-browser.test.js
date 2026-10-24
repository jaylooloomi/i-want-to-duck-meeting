import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { startLiveServer } from '../../src/live-server.js';
import { MicrophoneService } from '../../src/microphone.js';
import { readLiveMeeting } from '../../src/live-server.js';
import { sttPython } from '../../src/stt.js';

// A real Chromium audio graph and real offline models, not a stubbed transcription API.
test('two people remain stable through the browser microphone, gain/noise changes and a short turn', {
  skip:!process.env.OPENMEETING_MIC_BROWSER_WAV, timeout:180000,
}, async (t) => {
  const fixture = path.resolve(process.env.OPENMEETING_MIC_BROWSER_WAV);
  const plan = JSON.parse(fs.readFileSync(fixture.replace(/\.wav$/, '.json'), 'utf8'));
  const meetingsDir = path.resolve('test/.tmp/microphone-browser/meetings');
  const output = path.resolve('test/.tmp/microphone-browser'); fs.mkdirSync(output, { recursive:true });
  const microphone = new MicrophoneService({ meetingsDir, home:path.resolve('.'), repoRoot:path.resolve('.') });
  const running = await startLiveServer({ meetingsDir, port:0, microphone });
  let browser;
  t.after(async () => { await browser?.close(); await running.shutdown(); });
  browser = await chromium.launch({ channel:'chrome', headless:true, args:[
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${fixture}%noloop`,
  ] });
  const page = await browser.newPage({ viewport:{ width:1100, height:850 } });
  const errors = [], external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') route.continue();
    else { external.push(url.origin); route.abort(); }
  });
  await page.goto(running.url);
  const started = Date.now();
  await page.getByRole('button', { name:'開始收音', exact:true }).click();
  await page.waitForFunction(() => /正在本機收音|無法開始收音/.test(document.getElementById('mic-status').textContent), null, { timeout:90000 });
  assert.match(await page.locator('#mic-status').textContent(), /正在本機收音/);
  const session = microphone.current;
  assert.ok(session);
  // Evidence must become visible during recording, rather than only at stop/finalization.
  await page.waitForFunction(() => document.querySelectorAll('.utterance:not(.pending)').length >= 1, null, { timeout:30000 });
  assert.equal(session.stopping, false);
  const firstTextAfterSeconds = (Date.now() - started) / 1000;
  const remaining = (plan.duration + 2) * 1000 - (Date.now() - started);
  if (remaining > 0) await page.waitForTimeout(remaining);
  await page.getByRole('button', { name:'結束記錄', exact:true }).click();
  await session.finished;
  const data = readLiveMeeting(meetingsDir, session.id);
  assert.equal(data.status.state, 'done', JSON.stringify(data.status.error));
  assert.ok(data.records.length >= 5, 'actual Chinese text from multiple turns');
  const speakerTurns = fs.readFileSync(path.join(session.dir, 'worker.out'), 'utf8').split(/\r?\n/).flatMap((line) => {
    try { const event = JSON.parse(line); return event.type === 'speaker-turn' ? [event] : []; } catch { return []; }
  });
  const metadata = { audioStart:session.audioStart, fixture, firstTextAfterSeconds, sessionId:session.id, speakerTurns,
    capturedWav:path.join(session.dir, 'audio.wav'), records:data.records, status:data.status };
  fs.writeFileSync(path.join(output, 'capture.json'), JSON.stringify(metadata, null, 2));
  await page.waitForFunction(() => document.getElementById('state').textContent === '已結束', null, { timeout:10000 });
  assert.ok((await page.locator('#transcript').textContent()).includes('講者 A'));
  assert.ok((await page.locator('#transcript').textContent()).includes('講者 B'));
  assert.deepEqual(errors, []);
  assert.deepEqual(external, [], 'all page requests stayed on localhost');
  assert.deepEqual(data.pending, []);
  await page.screenshot({ path:path.join(output, 'result.png'), fullPage:true });
  const verification = spawnSync(sttPython({ home:path.resolve('.') }), [
    '-X', 'utf8', 'stt/verify_speaker_capture.py', path.join(output, 'capture.json'),
  ], { encoding:'utf8', timeout:10000, windowsHide:true });
  assert.equal(verification.status, 0, verification.stdout + verification.stderr);
  console.log(JSON.stringify({ sessionId:session.id, firstTextAfterSeconds, records:data.records.length,
    speakers:data.status.stats.speakers, audioSeconds:data.status.stats.audioSeconds }));
});
