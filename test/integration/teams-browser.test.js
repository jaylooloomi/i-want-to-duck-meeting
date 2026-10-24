import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { MicrophoneService } from '../../src/microphone.js';
import { startLiveServer, readLiveMeeting } from '../../src/live-server.js';
import { sttPython } from '../../src/stt.js';

test('Teams browser controls capture two actual WASAPI lanes with stable local/remote speakers', {
  skip:process.env.OPENMEETING_TEAMS_NATIVE_TEST !== '1', timeout:180000,
}, async (t) => {
  const output = path.resolve('test/.tmp/teams-validation'); fs.mkdirSync(output, { recursive:true });
  const meetingsDir = path.join(output, 'meetings');
  const microphone = new MicrophoneService({ meetingsDir, home:path.resolve('.'), repoRoot:path.resolve('.') });
  const running = await startLiveServer({ meetingsDir, port:0, microphone });
  let browser, player;
  t.after(async () => { player?.kill(); await browser?.close(); await running.shutdown(); });
  browser = await chromium.launch({ channel:'chrome', headless:true });
  const page = await browser.newPage({ viewport:{ width:1200, height:900 } });
  const errors = [], external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1') route.continue();
    else { external.push(route.request().url()); route.abort(); }
  });
  await page.goto(running.url);
  await page.locator('#audio-mode').selectOption('teams');
  await page.waitForFunction(() => document.querySelectorAll('#teams-input option').length > 0, null, { timeout:10000 });
  await page.locator('#teams-input').selectOption(process.env.OPENMEETING_TEAMS_MIC || '25');
  await page.locator('#teams-output').selectOption(process.env.OPENMEETING_TEAMS_LOOPBACK || '24');
  await page.getByRole('button', { name:'開始收音', exact:true }).click();
  await page.waitForFunction(() => /Teams 雙路收音中|無法開始收音/.test(document.getElementById('mic-status').textContent), null, { timeout:90000 });
  assert.match(await page.locator('#mic-status').textContent(), /Teams 雙路收音中/);
  const session = microphone.current;
  assert.ok(session);
  const fixtureDir = path.resolve(process.env.OPENMEETING_TEAMS_FIXTURE_DIR || 'test/.tmp/teams-fixture');
  const playbackStartedAt = Date.now();
  player = spawn(sttPython({ home:path.resolve('.') }), [
    'stt/play_dual_fixture.py', '--mic-audio', path.join(fixtureDir, 'teams-mic.wav'),
    '--mic-output', process.env.OPENMEETING_TEAMS_MIC_PLAYBACK || '19',
    '--system-audio', path.join(fixtureDir, 'teams-system.wav'),
    '--system-output', process.env.OPENMEETING_TEAMS_REMOTE_PLAYBACK || '18',
  ], { windowsHide:true, stdio:['ignore','pipe','pipe'] });
  let playbackError = ''; player.stderr.on('data', (data) => playbackError += data);
  await new Promise((resolve, reject) => { player.on('error', reject); player.on('close', (code) => code === 0 ? resolve() : reject(new Error(playbackError))); });
  await page.getByRole('button', { name:'結束記錄', exact:true }).click();
  await session.finished;
  const data = readLiveMeeting(meetingsDir, session.id);
  fs.writeFileSync(path.join(output, 'capture.json'), JSON.stringify({ ...data, audioStart:session.audioStart,
    dir:session.dir, mode:'controlled-WASAPI-input-plus-WASAPI-loopback', fixtureDir }, null, 2));
  assert.equal(data.status.state, 'done', JSON.stringify(data.status.error));
  assert.ok(data.status.stats.tracks.mic.audioPeak > 0, 'local input has a nonzero signal');
  assert.ok(data.status.stats.tracks.system.audioPeak > 0, 'actual WASAPI render loopback has a nonzero signal');
  assert.ok(data.records.some((r) => r.source === 'teams-mic' && r.text && r.speaker === '講者 A'), 'actual local input speech was transcribed');
  assert.ok(data.records.some((r) => r.source === 'teams-system' && r.text && r.speaker === '講者 B'), 'actual remote playback was transcribed');
  assert.ok(data.records.filter((r) => r.source === 'teams-mic').every((r) => r.speaker === '講者 A'));
  assert.ok(data.records.filter((r) => r.source === 'teams-system').every((r) => ['講者 B', '講者未確認'].includes(r.speaker)));
  const localText = data.records.filter((r) => r.source === 'teams-mic').map((r) => r.text).join('');
  const remoteText = data.records.filter((r) => r.source === 'teams-system').map((r) => r.text).join('');
  assert.ok(localText.includes('測試') && localText.includes('播放'), 'local text matches the known local speech content');
  assert.ok(remoteText.includes('第四次') && remoteText.includes('演講'), 'remote text matches the known remote speech content');
  assert.ok(data.records.filter((r) => r.source === 'teams-mic').length >= 3, 'repeated local turns preserved');
  // Initial short evidence may legitimately stay unknown. Verify each actual
  // remote turn, rather than requiring an unstable number of confirmed ASR chunks.
  const plan = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'plan.json'), 'utf8'));
  const remoteTurns = [...plan.turns.filter((turn) => turn.person === 'person-2'), plan.overlap];
  for (const turn of remoteTurns) {
    assert.ok(data.records.some((r) => {
      const midpoint = (Date.parse(r.t0) + Date.parse(r.t1)) / 2;
      const seconds = (midpoint - playbackStartedAt) / 1000;
      return r.source === 'teams-system' && seconds >= turn.start - 2 && seconds <= turn.end + 2;
    }), `remote speech preserved during ${turn.start}–${turn.end}s`);
  }
  assert.ok(data.records.some((r) => r.source === 'teams-system' && r.speaker === '講者 B'
    && (Date.parse(r.t0) - playbackStartedAt) / 1000 >= plan.overlap.start - 2), 'final remote interruption retains the confirmed identity');
  const overlaps = data.records.some((local) => local.source === 'teams-mic' && data.records.some((remote) => remote.source === 'teams-system'
    && Math.min(Date.parse(local.t1), Date.parse(remote.t1)) - Math.max(Date.parse(local.t0), Date.parse(remote.t0)) > 1000));
  assert.ok(overlaps, 'both speakers were transcribed during deliberate dual-lane overlap');
  assert.ok(data.status.stats.audioSeconds < data.status.stats.tracks.mic.audioSeconds + data.status.stats.tracks.system.audioSeconds - 10, 'two simultaneous tracks are not concatenated in time');
  assert.deepEqual(data.pending, []);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await page.waitForFunction(() => document.getElementById('state').textContent === '已結束');
  await page.screenshot({ path:path.join(output, 'result.png'), fullPage:true });
  console.log(JSON.stringify({ id:session.id, stats:data.status.stats, records:data.records.map((r) => ({ speaker:r.speaker, source:r.source, text:r.text })) }));
});
