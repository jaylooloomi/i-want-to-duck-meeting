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
  let resolvePackets; const receivedPackets=new Promise(resolve=>{resolvePackets=resolve;});
  const id = '20261024-160000-local-microphone';
  const microphone = {
    async start() {
      fs.mkdirSync(path.join(root, id));
      writeStatus(path.join(root, id), { id, state:'in_call', source:'microphone' });
      return { id, token:'test-token' };
    },
    audio(token, sequence, audio) {
      assert.equal(token, 'test-token'); assert.equal(sequence, packets.length);
      assert.equal(audio.length % 2, 0); packets.push(audio); if(packets.length>=2)resolvePackets();
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
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/favicon.ico',route=>route.fulfill({status:204}));
  await page.addInitScript(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{const stream=await original(...args);globalThis.qaCaptureTracks=stream.getTracks();return stream;};});
  await page.goto(url);
  await page.getByRole('button',{name:'＋ 新增記錄',exact:true}).click();
  await page.getByRole('button', { name:'開始收音', exact:true }).click();
  await page.getByText('● 正在本機收音 · 依聲音區分講者 A、B · 請告知與會者正在記錄',{exact:true}).waitFor();
  await receivedPackets;
  assert.ok(packets.length>=2,'AudioWorklet emitted actual PCM');
  await page.getByRole('button', { name:'結束記錄', exact:true }).click();
  await page.getByText('記錄已保存',{exact:true}).waitFor();
  assert.ok(stopped);
  assert.deepEqual(await page.evaluate(()=>globalThis.qaCaptureTracks.map(track=>track.readyState)),['ended']);
  assert.ok(packets.at(-1).length <= 8000, 'last partial packet delivered');
  assert.deepEqual(errors, []);
});
