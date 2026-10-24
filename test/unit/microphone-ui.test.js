import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startLiveServer } from '../../src/live-server.js';
import { writeStatus } from '../../src/status.js';

test('browser microphone sends ordered PCM and stops tracks; API rejects cross-origin writes', { timeout:30000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openmeeting-mic-ui-'));
  let browser, server;
  t.after(async () => {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    fs.rmSync(root, { recursive:true, force:true });
  });
  const packets = []; let stopped = false;
  const id = '20261024-160000-local-microphone';
  const microphone = {
    async start() {
      fs.mkdirSync(path.join(root, id));
      writeStatus(path.join(root, id), { id, state:'in_call', source:'microphone' });
      return { id, token:'test-token' };
    },
    audio(token, sequence, audio) {
      assert.equal(token, 'test-token'); assert.equal(sequence, packets.length);
      assert.equal(audio.length % 2, 0); packets.push(audio);
    },
    stop(token) {
      assert.equal(token, 'test-token'); stopped = true;
      writeStatus(path.join(root, id), { state:'done' }); return { id, state:'leaving' };
    },
  };
  const result = await startLiveServer({ meetingsDir:root, port:0, microphone });
  server = result.server; const { url } = result;
  const malicious = await fetch(url + '/api/microphone/start', { method:'POST', headers:{ Origin:'https://example.com', 'Content-Type':'application/json' }, body:'{}' });
  assert.equal(malicious.status, 403);
  const noOrigin = await fetch(url + '/api/microphone/start', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:'{}' });
  assert.equal(noOrigin.status, 403);
  browser = await chromium.launch({ channel:'chrome', headless:true, args:['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.getByRole('button', { name:'開始收音', exact:true }).click();
  await page.waitForFunction(() => /正在本機收音|無法開始收音/.test(document.getElementById('mic-status').textContent), { timeout:10000 });
  assert.match(await page.locator('#mic-status').textContent(), /正在本機收音/);
  await page.waitForTimeout(1100);
  assert.ok(packets.length >= 2, 'AudioWorklet emitted audio, not just UI state');
  await page.getByRole('button', { name:'結束記錄', exact:true }).click();
  await page.waitForFunction(() => document.getElementById('mic-status').textContent.includes('已停止收音'));
  assert.ok(stopped);
  const count = packets.length;
  await page.waitForTimeout(400);
  assert.equal(packets.length, count, 'capture stopped');
  assert.ok(packets.at(-1).length <= 8000, 'last partial packet delivered');
  assert.deepEqual(errors, []);
});
