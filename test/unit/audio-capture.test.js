// Real headless Chrome tests for src/page/audio-capture.js.
// Playwright's headless launch adds --mute-audio, which is exactly the production condition:
// nothing is audible, yet the capture must still receive real samples.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

import { installAudioCapture, installAudioOutputCapture, installTrackMirror } from '../../src/page/audio-capture.js';
import { WavWriter } from '../../src/audio/wav-writer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, '..', 'fixtures', 'audio');
const TMP = path.resolve(HERE, '..', '.tmp', 'audio', 'capture');
const RATE = 16000;
const T = { timeout: 60_000 };
const NAV = { waitUntil: 'domcontentloaded' };

let server;
let base;
let browser;

before(async () => {
  server = http.createServer((req, res) => {
    const name = path.basename(new URL(req.url, 'http://x').pathname);
    const file = path.join(FIXTURES, name);
    if (!name.endsWith('.html') || !fs.existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    const headers = { 'content-type': 'text/html; charset=utf-8' };
    if (new URL(req.url, 'http://x').searchParams.get('csp') === '1') {
      // Meet-like: no blob: scripts (blocks the worklet module) + Trusted Types enforced
      headers['content-security-policy'] =
        "script-src 'self' 'unsafe-inline'; require-trusted-types-for 'script'; trusted-types 'none'";
    }
    res.writeHead(200, headers);
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      // let the in-page loopback connect without mDNS host-candidate resolution
      '--disable-features=WebRtcHideLocalIpsWithMdns',
    ],
  });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  fs.rmSync(TMP, { recursive: true, force: true });
});

/** New isolated context + page with __omAudio / __omAudioStatus collectors. */
async function openPage({ mirror = false, outputs = false, init = null } = {}) {
  const context = await browser.newContext();
  if (mirror) await context.addInitScript(installTrackMirror);
  if (outputs) await context.addInitScript(installAudioOutputCapture);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const chunks = [];
  const statuses = [], observers = new Set();
  const notify = () => { for (const check of [...observers]) check(); };
  const waitForCapture = predicate => new Promise(resolve => { const check=()=>{if(predicate(chunks,statuses)){observers.delete(check);resolve();}};observers.add(check);check(); });
  await page.exposeFunction('__omAudio', (b64) => { chunks.push({ at: Date.now(), b64 }); notify(); });
  await page.exposeFunction('__omAudioStatus', (s) => { statuses.push(s); notify(); });
  return { context, page, chunks, statuses, waitForCapture };
}

/** Decode collected base64 chunks into one Int16Array. */
function decode(chunks) {
  const bufs = chunks.map((c) => {
    assert.equal(typeof c.b64, 'string');
    const b = Buffer.from(c.b64, 'base64');
    assert.ok(b.length > 0, 'chunk is non-empty');
    assert.equal(b.length % 2, 0, 'chunk holds whole Int16 samples');
    return b;
  });
  const all = Buffer.concat(bufs);
  const out = new Int16Array(all.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = all.readInt16LE(i * 2);
  return out;
}

function peakOf(samples) {
  let p = 0;
  for (const s of samples) p = Math.max(p, Math.abs(s));
  return p;
}

/** Frequency estimate from positive-going zero crossings over the last `seconds`. */
function freqOf(samples, seconds = 1) {
  const n = Math.min(samples.length, RATE * seconds);
  const s = samples.subarray(samples.length - n);
  let crossings = 0;
  for (let i = 1; i < s.length; i++) if (s[i - 1] < 0 && s[i] >= 0) crossings++;
  return crossings / (n / RATE);
}

test('captures a 440 Hz <audio srcObject> tone as 16 kHz Int16 base64 chunks (worklet mode)', T, async () => {
  // record every connection made to an AudioDestinationNode, to prove nothing is audible
  const init = () => {
    window.__destConns = [];
    const orig = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest, ...rest) {
      if (dest instanceof AudioDestinationNode) window.__destConns.push(this);
      return orig.call(this, dest, ...rest);
    };
  };
  const { context, page, chunks, statuses, waitForCapture } = await openPage({ init });
  try {
    await page.goto(`${base}/tone.html`, NAV);
    await page.evaluate(() => window.fixtureReady);
    const res = await page.evaluate(installAudioCapture, { sampleRate: RATE, flushMs: 1000 });
    assert.equal(res.mode, 'worklet');
    assert.equal(res.sampleRate, RATE);
    await waitForCapture((chunks,statuses)=>chunks.length>=2&&decode(chunks).length>=2*RATE&&statuses.some(s=>s.tracks===1));

    const samples = decode(chunks);
    assert.ok(chunks.length >= 2, `expected >= 2 flushes, got ${chunks.length}`);
    assert.ok(samples.length >= 2 * RATE, `expected >= 2 s of audio, got ${samples.length / RATE} s`);
    const peak = peakOf(samples);
    assert.ok(peak > 1000, `peak ${peak} should be > 1000`);
    assert.ok(peak < 20000, `peak ${peak}: a 0.5-gain tone must not be summed twice`);
    const f = freqOf(samples);
    assert.ok(Math.abs(f - 440) < 25, `tone frequency ${f} Hz should be ~440 Hz (correct sample rate)`);

    const st = statuses.find((s) => s.tracks === 1);
    assert.ok(st, `expected a status with tracks: 1, got ${JSON.stringify(statuses)}`);
    assert.equal(st.contextState, 'running');
    assert.equal(st.mode, 'worklet');

    const dest = await page.evaluate(() =>
      window.__destConns.map((n) => ({ type: n.constructor.name, gain: n.gain ? n.gain.value : null })));
    assert.ok(dest.length >= 1, 'the processor is pulled through a sink');
    for (const d of dest) assert.deepEqual(d, { type: 'GainNode', gain: 0 }, 'only a zero-gain sink may reach ctx.destination');

    // what session.js does with each __omAudio chunk: decode base64 -> WavWriter.write
    fs.mkdirSync(TMP, { recursive: true });
    const wavPath = path.join(TMP, `capture-${process.pid}.wav`);
    const w = new WavWriter(wavPath);
    for (const c of chunks) w.write(Buffer.from(c.b64, 'base64'));
    assert.equal(w.seconds, samples.length / RATE);
    assert.equal(w.peak, peak);
    await w.close();
    const wav = fs.readFileSync(wavPath);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt32LE(24), RATE);
    assert.equal(wav.readUInt32LE(40), samples.length * 2);
    assert.equal(wav.length, 44 + samples.length * 2);
  } finally {
    await context.close();
  }
});

test('resamples to 16 kHz when Chrome refuses AudioContext({ sampleRate })', T, async () => {
  const init = () => {
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(o) {
        if (o && o.sampleRate) throw new DOMException('rate not supported', 'NotSupportedError');
        super(o);
      }
    };
  };
  const { context, page, chunks } = await openPage({ init });
  try {
    await page.goto(`${base}/tone.html`, NAV);
    await page.evaluate(() => window.fixtureReady);
    const res = await page.evaluate(installAudioCapture, { sampleRate: RATE, flushMs: 1000 });
    assert.equal(res.sampleRate, RATE);
    assert.notEqual(res.contextSampleRate, RATE, 'context runs at the device rate');
    await sleep(3300);
    await page.evaluate(() => window.__omAudioCapture.flush());
    const samples = decode(chunks);
    const seconds = samples.length / RATE;
    assert.ok(seconds >= 2 && seconds <= 4, `expected ~3 s at 16 kHz, got ${seconds} s`);
    const peak = peakOf(samples);
    assert.ok(peak > 1000 && peak < 20000, `peak ${peak}`);
    const f = freqOf(samples);
    assert.ok(Math.abs(f - 440) < 25, `tone frequency ${f} Hz should be ~440 Hz after resampling`);
  } finally {
    await context.close();
  }
});

test('falls back to ScriptProcessorNode when audioWorklet.addModule fails (CSP / Trusted Types)', T, async () => {
  const init = () => {
    AudioWorklet.prototype.addModule = function () {
      return Promise.reject(new DOMException('blocked by CSP', 'SecurityError'));
    };
  };
  const { context, page, chunks, statuses } = await openPage({ init });
  try {
    await page.goto(`${base}/tone.html`, NAV);
    await page.evaluate(() => window.fixtureReady);
    const res = await page.evaluate(installAudioCapture, { sampleRate: RATE, flushMs: 1000 });
    assert.equal(res.mode, 'scriptprocessor');
    await sleep(3300);
    const samples = decode(chunks);
    assert.ok(samples.length >= 2 * RATE, `expected >= 2 s of audio, got ${samples.length / RATE} s`);
    assert.ok(peakOf(samples) > 1000, `peak ${peakOf(samples)} should be > 1000`);
    const f = freqOf(samples);
    assert.ok(Math.abs(f - 440) < 25, `tone frequency ${f} Hz should be ~440 Hz`);
    assert.ok(statuses.some((s) => s.mode === 'scriptprocessor' && s.tracks === 1));
  } finally {
    await context.close();
  }
});

test('decoded WebAudio output is recorded without media elements, without feedback, and stops on disconnect', T, async () => {
  const { context, page, chunks } = await openPage({ outputs: true });
  try {
    await context.addInitScript(installAudioOutputCapture); // idempotent
    await page.goto(`${base}/output.html`, NAV);
    await page.evaluate(() => window.outputReady);
    assert.equal(await page.locator('audio,video').count(), 0);
    const res = await page.evaluate(installAudioCapture, { sampleRate: RATE, flushMs: 250, scanMs: 100 });
    assert.equal(res.tracks, 1);
    await sleep(1800);
    const samples = decode(chunks);
    const peak = peakOf(samples);
    assert.ok(peak > 10000 && peak < 15000, `single output peak ${peak}, no duplicate mixing`);
    assert.ok(Math.abs(freqOf(samples) - 440) < 25);
    assert.equal(await page.evaluate(() => window.__omAudioOutputCapture.outputs.size), 1, 'capture sink is never tapped');
    await page.evaluate(() => window.outputFixture.gain.disconnect(window.outputFixture.ctx.destination));
    await sleep(600);
    chunks.length = 0;
    await sleep(800);
    assert.equal(peakOf(decode(chunks)), 0, 'disconnected output must no longer be recorded');
  } finally {
    await context.close();
  }
});

test('RTCPeerConnection loopback: track mirror exposes the remote track and capture records it', T, async () => {
  const { context, page, chunks } = await openPage({ mirror: true });
  try {
    await page.goto(`${base}/loopback.html`, NAV);
    // install capture BEFORE the remote track exists: the periodic scan must pick it up
    const res = await page.evaluate(installAudioCapture, { sampleRate: RATE, flushMs: 500 });
    assert.equal(res.tracks, 0);
    const r = await page.evaluate(() => window.startLoopback());

    // the wrapper is transparent to the page
    assert.equal(r.mirrorInstalled, true);
    assert.equal(r.name, 'RTCPeerConnection');
    assert.equal(r.length, 0);
    assert.equal(r.hasGenerateCertificate, true);
    assert.equal(r.certOk, true);
    assert.equal(r.callWithoutNewThrew, true);
    assert.equal(r.subclassOk, true);
    assert.equal(r.instanceofOk, true);
    assert.equal(r.protoOk, true);
    assert.equal(r.constructorOk, true);
    assert.equal(r.ontrackCalls, 1, "page's own ontrack still fires");
    assert.equal(r.listenerCalls, 1, "page's own track listener still fires");
    assert.equal(r.remoteTrackKind, 'audio');

    const mirrors = await page.evaluate(() =>
      [...document.querySelectorAll('audio[data-om-mirror]')].map((el) => ({
        trackIds: el.srcObject.getTracks().map((t) => t.id),
        display: el.style.display,
        autoplay: el.autoplay,
        muted: el.muted,
        connected: el.isConnected,
      })));
    assert.equal(mirrors.length, 1, 'exactly one mirror per remote audio track');
    assert.deepEqual(mirrors[0], {
      trackIds: [r.remoteTrackId], display: 'none', autoplay: true, muted: false, connected: true,
    });

    // discovery happens on the next 3 s scan; then audio flows
    const deadline = Date.now() + 8000;
    let samples = new Int16Array(0);
    while (Date.now() < deadline) {
      await sleep(500);
      samples = decode(chunks);
      if (samples.length >= RATE * 1.5 && peakOf(samples) > 1000) break;
    }
    assert.ok(samples.length >= RATE, `expected >= 1 s from the remote track, got ${samples.length / RATE} s`);
    assert.ok(peakOf(samples) > 1000, `remote track peak ${peakOf(samples)} should be > 1000`);
    const st = await page.evaluate(() => window.__omAudioCapture.status());
    assert.equal(st.tracks, 1);
  } finally {
    await context.close();
  }
});

test('under a Meet-like CSP + Trusted Types page: mirror works, capture falls back and records', T, async () => {
  const { context, page, chunks } = await openPage({ mirror: true });
  const violations = [];
  page.on('console', (m) => { if (/trusted|content security/i.test(m.text())) violations.push(m.text()); });
  try {
    await page.goto(`${base}/loopback.html?csp=1`, NAV);
    const res = await page.evaluate(installAudioCapture, { sampleRate: RATE, flushMs: 500 });
    assert.equal(res.mode, 'scriptprocessor', 'blob: worklet module is blocked by CSP');
    const { lastError } = await page.evaluate(() => window.__omAudioCapture.status());
    assert.match(String(lastError), /abort|load|security|refused|csp|module/i, `fallback reason: ${lastError}`);
    const r = await page.evaluate(() => window.startLoopback());
    assert.equal(r.mirrorInstalled, true);
    assert.equal(r.ontrackCalls, 1);
    const deadline = Date.now() + 8000;
    let samples = new Int16Array(0);
    while (Date.now() < deadline) {
      await sleep(500);
      samples = decode(chunks);
      if (samples.length >= RATE && peakOf(samples) > 1000) break;
    }
    assert.ok(samples.length >= RATE, `expected >= 1 s, got ${samples.length / RATE} s`);
    assert.ok(peakOf(samples) > 1000, `peak ${peakOf(samples)}`);
    // the only expected CSP report is the blocked worklet module, never a Trusted Types sink
    for (const v of violations) assert.doesNotMatch(v, /TrustedHTML|TrustedScript\b|TrustedScriptURL/, v);
  } finally {
    await context.close();
  }
});

test('control: without the mirror the loopback track is invisible to the element scan', T, async () => {
  const { context, page, chunks } = await openPage({ mirror: false });
  try {
    await page.goto(`${base}/loopback.html`, NAV);
    await page.evaluate(installAudioCapture, { sampleRate: RATE, flushMs: 500 });
    const r = await page.evaluate(() => window.startLoopback());
    assert.equal(r.mirrorInstalled, false);
    assert.equal(r.constructorOk, true);
    await sleep(3500); // one full scan period
    const st = await page.evaluate(() => window.__omAudioCapture.status());
    assert.equal(st.tracks, 0);
    assert.equal(chunks.length, 0);
    assert.equal(await page.evaluate(() => document.querySelectorAll('audio').length), 0);
  } finally {
    await context.close();
  }
});

test('track mirror is idempotent and ignores video tracks', T, async () => {
  const { context, page } = await openPage({ mirror: true });
  try {
    await context.addInitScript(installTrackMirror); // a second install must be a no-op
    await page.goto(`${base}/loopback.html`, NAV);
    const r = await page.evaluate(() => window.startLoopback());
    assert.equal(r.ontrackCalls, 1);
    const n = await page.evaluate(() => document.querySelectorAll('audio[data-om-mirror]').length);
    assert.equal(n, 1);
    // a video track arriving later is not mirrored
    const n2 = await page.evaluate(async () => {
      const { pc1, pc2 } = window.loopback;
      const canvas = document.createElement('canvas');
      const vtrack = canvas.captureStream(5).getVideoTracks()[0];
      const got = new Promise((resolve) => pc2.addEventListener('track', resolve, { once: true }));
      pc1.addTrack(vtrack);
      const offer = await pc1.createOffer();
      await pc1.setLocalDescription(offer);
      await pc2.setRemoteDescription(offer);
      const answer = await pc2.createAnswer();
      await pc2.setLocalDescription(answer);
      await pc1.setRemoteDescription(answer);
      const ev = await got;
      return { kind: ev.track.kind, mirrors: document.querySelectorAll('audio[data-om-mirror]').length };
    });
    assert.deepEqual(n2, { kind: 'video', mirrors: 1 });
  } finally {
    await context.close();
  }
});

test('installAudioCapture is idempotent and de-duplicates a track shared by two elements', T, async () => {
  const { context, page, chunks } = await openPage();
  try {
    await page.goto(`${base}/tone.html?dup=1`, NAV);
    await page.evaluate(() => window.fixtureReady);
    const t0 = Date.now();
    const [a, b] = await Promise.all([
      page.evaluate(installAudioCapture, { sampleRate: RATE, flushMs: 1000 }),
      page.evaluate(installAudioCapture, { sampleRate: RATE, flushMs: 1000 }),
    ]);
    const c = await page.evaluate(installAudioCapture, { sampleRate: RATE, flushMs: 1000 });
    assert.deepEqual(a, b);
    assert.equal(c.mode, a.mode);
    assert.equal(a.tracks, 1, 'two elements share one track id -> one source');
    await sleep(3200);
    await page.evaluate(() => window.__omAudioCapture.flush());
    const elapsed = (Date.now() - t0) / 1000;

    const samples = decode(chunks);
    const seconds = samples.length / RATE;
    assert.ok(seconds >= 2, `expected >= 2 s, got ${seconds}`);
    assert.ok(seconds <= elapsed * 1.15 + 0.2, `${seconds} s captured in ${elapsed} s wall time: samples doubled?`);
    const peak = peakOf(samples);
    assert.ok(peak > 1000 && peak < 20000, `peak ${peak}: tone must be mixed exactly once`);

    const ctxCount = await page.evaluate(() => window.__omAudioCapture.status());
    assert.equal(ctxCount.tracks, 1);

    // an ended track is dropped on the next scan and no more samples are produced
    await page.evaluate(() => window.fixture.track.stop());
    await sleep(3300);
    const st = await page.evaluate(() => window.__omAudioCapture.status());
    assert.equal(st.tracks, 0);
    await page.evaluate(() => window.__omAudioCapture.flush());
    const before = chunks.length;
    await sleep(1500);
    assert.equal(chunks.length, before, 'no chunks without live tracks');
  } finally {
    await context.close();
  }
});

test('picks up media elements added after install, uses defaults when called without options', T, async () => {
  const { context, page, chunks, statuses, waitForCapture } = await openPage();
  try {
    await page.goto(`${base}/tone.html?manual=1`, NAV);
    const res = await page.evaluate(installAudioCapture); // session.js calls it with no argument
    assert.equal(res.sampleRate, 16000);
    assert.equal(res.tracks, 0);
    await page.evaluate(() => { window.releaseFixtureAudio(); return window.fixtureReady; });
    await waitForCapture((chunks,statuses)=>decode(chunks).length>=RATE&&statuses.length>=2&&statuses.some(s=>s.tracks===1));
    const samples = decode(chunks);
    assert.ok(samples.length >= RATE, `expected >= 1 s, got ${samples.length / RATE} s`);
    assert.ok(peakOf(samples) > 1000);
    assert.ok(statuses.length >= 2, 'status at start and every 5 s');
    assert.equal(statuses[0].tracks, 0);
    assert.ok(statuses.some((s) => s.tracks === 1));
  } finally {
    await context.close();
  }
});

test('stop() tears down timers and the AudioContext and allows a fresh install', T, async () => {
  const { context, page, chunks } = await openPage();
  try {
    await page.goto(`${base}/tone.html`, NAV);
    await page.evaluate(() => window.fixtureReady);
    await page.evaluate(installAudioCapture, { sampleRate: RATE, flushMs: 300 });
    await sleep(800);
    const r = await page.evaluate(async () => {
      const cap = window.__omAudioCapture;
      await cap.stop();
      return { gone: !('__omAudioCapture' in window), ctxState: cap.ctx.state };
    });
    assert.deepEqual(r, { gone: true, ctxState: 'closed' });
    const n = chunks.length;
    await sleep(800);
    assert.equal(chunks.length, n, 'no flushes after stop');
    const again = await page.evaluate(installAudioCapture, { sampleRate: RATE, flushMs: 300 });
    assert.equal(again.tracks, 1);
    await page.evaluate(() => window.__omAudioCapture.stop());
  } finally {
    await context.close();
  }
});
