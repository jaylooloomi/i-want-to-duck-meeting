// Real Whisper fallback: zh-TW TTS sentence → stt/transcribe.py → Traditional Chinese transcript.
// Needs `openmeeting setup-stt` (the .venv-stt interpreter) and Windows System.Speech (Hanhan voice).
// First run downloads the model (~1.6 GB for large-v3-turbo) into <home>/models.
// Pick a smaller model with OPENMEETING_STT_TEST_MODEL (e.g. small) for a quicker run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTranscribe, sttAvailable } from '../../src/stt.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = path.join(REPO, 'test', '.tmp', 'stt', 'integration');
const TTS_SCRIPT = path.join(REPO, 'scripts', 'make-tts-wav.ps1');
const SENTENCE = '大家好，今天我們討論新版本的上線時間，請大家在星期五之前完成測試。';
const KEYWORDS = ['上線', '星期五', '測試', '大家好'];
const MODEL = process.env.OPENMEETING_STT_TEST_MODEL || 'large-v3-turbo';

// Same home as getConfig() defaults (repo root) unless OPENMEETING_HOME is set; built inline so this
// test does not depend on src/config.js.
const home = process.env.OPENMEETING_HOME ? path.resolve(process.env.OPENMEETING_HOME) : REPO;
const config = { home, sttVenv: path.join(home, '.venv-stt') };

/**
 * Runs scripts/make-tts-wav.ps1 through Windows PowerShell and returns its KEY=VALUE output.
 * @returns {{ status: number|null, kv: Record<string,string>, stderr: string }}
 */
function makeTtsWav(text, out) {
  const r = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', TTS_SCRIPT,
    '-Text', text, '-Out', out,
  ], { encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  const kv = {};
  for (const line of (r.stdout || '').split(/\r?\n/)) {
    const m = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
    if (m) kv[m[1]] = m[2];
  }
  return { status: r.status, kv, stderr: r.stderr || String(r.error || '') };
}

const skipReason = process.platform !== 'win32'
  ? 'needs Windows System.Speech for the TTS fixture'
  : !sttAvailable(config)
    ? `STT venv not installed (${config.sttVenv}); run: openmeeting setup-stt`
    : null;

test('make-tts-wav.ps1 + runTranscribe: zh-TW speech comes back as Traditional Chinese', { timeout: 10 * 60_000 }, async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const wavPath = path.join(TMP, 'tts-zh-tw.wav');

  const tts = makeTtsWav(SENTENCE, wavPath);
  assert.equal(tts.status, 0, `make-tts-wav.ps1 failed: ${tts.stderr}`);
  assert.equal(Buffer.from(tts.kv.TEXT_B64 || '', 'base64').toString('utf8'), SENTENCE, 'Chinese text reached System.Speech intact');
  const header = fs.readFileSync(wavPath).subarray(0, 44);
  assert.equal(header.toString('ascii', 0, 4), 'RIFF');
  assert.equal(header.toString('ascii', 8, 12), 'WAVE');
  assert.equal(header.readUInt16LE(22), 1, 'mono');
  assert.equal(header.readUInt32LE(24), 16000, '16 kHz');
  assert.equal(header.readUInt16LE(34), 16, '16-bit');
  assert.ok(Number(tts.kv.SECONDS) > 3, `speech is long enough (${tts.kv.SECONDS}s)`);

  const logs = [];
  const t0 = Date.now();
  const res = await runTranscribe({ config, wavPath, outDir: TMP, model: MODEL, log: (m) => logs.push(m) });
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);

  assert.ok(res.segments >= 1, `at least one segment (logs:\n${logs.slice(-20).join('\n')})`);
  assert.equal(res.mdPath, path.join(TMP, 'transcript-whisper.md'));
  assert.equal(res.jsonPath, path.join(TMP, 'transcript-whisper.json'));

  const doc = JSON.parse(fs.readFileSync(res.jsonPath, 'utf8'));
  assert.equal(doc.model, MODEL);
  assert.equal(doc.segments.length, res.segments);
  for (const s of doc.segments) {
    assert.equal(typeof s.start, 'number');
    assert.equal(typeof s.end, 'number');
    assert.ok(s.end >= s.start);
    assert.equal(typeof s.text, 'string');
  }
  const text = doc.segments.map((s) => s.text).join('');

  const md = fs.readFileSync(res.mdPath, 'utf8');
  assert.ok(md.startsWith('# 逐字稿（Whisper 備援）'), md);
  assert.match(md, /^\[\d{2,}:\d{2}\] \S/m);

  const hits = KEYWORDS.filter((k) => text.includes(k));
  t.diagnostic(`model=${MODEL} wall=${seconds}s segments=${res.segments} hits=${hits.join(',')} text=${text}`);
  assert.ok(hits.length >= 2, `expected ≥2 of ${KEYWORDS.join('/')} in: ${text}`);
  assert.ok(!text.includes('测试'), `no Simplified 测试 in: ${text}`);
  assert.ok(!md.includes('测试'));
});
