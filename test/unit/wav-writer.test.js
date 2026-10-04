import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { WavWriter, createWavHeader } from '../../src/audio/wav-writer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = path.join(ROOT, 'test', '.tmp', 'audio', 'wav-writer');

let n = 0;
const tmpFile = () => path.join(TMP, `t${process.pid}-${++n}.wav`);

before(() => fs.mkdirSync(TMP, { recursive: true }));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

/** Parse a canonical 44-byte-header PCM WAV file. */
function parseWav(buf) {
  assert.ok(buf.length >= 44, `file too short: ${buf.length}`);
  return {
    riff: buf.toString('ascii', 0, 4),
    riffSize: buf.readUInt32LE(4),
    wave: buf.toString('ascii', 8, 12),
    fmt: buf.toString('ascii', 12, 16),
    fmtSize: buf.readUInt32LE(16),
    audioFormat: buf.readUInt16LE(20),
    channels: buf.readUInt16LE(22),
    sampleRate: buf.readUInt32LE(24),
    byteRate: buf.readUInt32LE(28),
    blockAlign: buf.readUInt16LE(32),
    bitsPerSample: buf.readUInt16LE(34),
    dataTag: buf.toString('ascii', 36, 40),
    dataSize: buf.readUInt32LE(40),
    data: buf.subarray(44),
  };
}

/** Int16LE buffer from an array of sample values. */
function pcm(samples) {
  const b = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => b.writeInt16LE(s, i * 2));
  return b;
}

test('empty file after close has a valid 44-byte 16 kHz mono PCM16 header', async () => {
  const file = tmpFile();
  const w = new WavWriter(file);
  await w.close();
  const buf = fs.readFileSync(file);
  assert.equal(buf.length, 44);
  const h = parseWav(buf);
  assert.equal(h.riff, 'RIFF');
  assert.equal(h.riffSize, 36);
  assert.equal(h.wave, 'WAVE');
  assert.equal(h.fmt, 'fmt ');
  assert.equal(h.fmtSize, 16);
  assert.equal(h.audioFormat, 1);
  assert.equal(h.channels, 1);
  assert.equal(h.sampleRate, 16000);
  assert.equal(h.byteRate, 32000);
  assert.equal(h.blockAlign, 2);
  assert.equal(h.bitsPerSample, 16);
  assert.equal(h.dataTag, 'data');
  assert.equal(h.dataSize, 0);
  assert.equal(w.seconds, 0);
  assert.equal(w.peak, 0);
});

test('header is written immediately on construction (file valid before any write)', async () => {
  const file = tmpFile();
  const w = new WavWriter(file);
  const h = parseWav(fs.readFileSync(file));
  assert.equal(h.riff, 'RIFF');
  assert.equal(h.dataTag, 'data');
  assert.equal(h.dataSize, 0);
  await w.close();
});

test('writes samples; sizes, seconds and peak are correct after close', async () => {
  const file = tmpFile();
  const w = new WavWriter(file);
  const a = pcm([0, 100, -200, 300]);
  const b = pcm([1234, -32768, 32767, 5]);
  w.write(a);
  w.write(b);
  assert.equal(w.seconds, 8 / 16000);
  assert.equal(w.peak, 32767); // |-32768| clamps to 32767
  await w.close();

  const h = parseWav(fs.readFileSync(file));
  assert.equal(h.dataSize, 16);
  assert.equal(h.riffSize, 36 + 16);
  assert.deepEqual(h.data, Buffer.concat([a, b]));
});

test('peak tracks max |sample| without clamping when below full scale', async () => {
  const w = new WavWriter(tmpFile());
  w.write(pcm([10, -5000, 4999]));
  assert.equal(w.peak, 5000);
  w.write(pcm([100]));
  assert.equal(w.peak, 5000);
  await w.close();
});

test('seconds reflects one full second of audio', async () => {
  const file = tmpFile();
  const w = new WavWriter(file);
  w.write(Buffer.alloc(32000)); // 16000 samples
  assert.equal(w.seconds, 1);
  await w.close();
  const h = parseWav(fs.readFileSync(file));
  assert.equal(h.dataSize, 32000);
  assert.equal(fs.statSync(file).size, 44 + 32000);
});

test('odd byte lengths are carried to the next write', async () => {
  const file = tmpFile();
  const w = new WavWriter(file);
  const all = pcm([1, -2, 3000, -4000, 5, 32767, -32768, 7]);
  // split at odd offsets: 3 + 6 + 5 + 2 = 16
  w.write(all.subarray(0, 3));
  assert.equal(w.seconds, 1 / 16000); // only the complete sample counts
  w.write(all.subarray(3, 9));
  w.write(all.subarray(9, 14));
  w.write(all.subarray(14, 16));
  assert.equal(w.seconds, 8 / 16000);
  assert.equal(w.peak, 32767);
  await w.close();
  const h = parseWav(fs.readFileSync(file));
  assert.equal(h.dataSize, 16);
  assert.deepEqual(h.data, all);
});

test('a dangling odd byte at close is dropped (data stays sample-aligned)', async () => {
  const file = tmpFile();
  const w = new WavWriter(file);
  w.write(Buffer.from([0x01, 0x00, 0x02]));
  await w.close();
  const h = parseWav(fs.readFileSync(file));
  assert.equal(h.dataSize, 2);
  assert.deepEqual(h.data, Buffer.from([0x01, 0x00]));
  assert.equal(fs.statSync(file).size, 46);
});

test('accepts Uint8Array and empty buffers', async () => {
  const file = tmpFile();
  const w = new WavWriter(file);
  w.write(Buffer.alloc(0));
  w.write(new Uint8Array([0x10, 0x27])); // 10000
  assert.equal(w.peak, 10000);
  await w.close();
  assert.equal(parseWav(fs.readFileSync(file)).dataSize, 2);
});

test('header is patched periodically so a file read mid-recording is valid', async () => {
  const file = tmpFile();
  const w = new WavWriter(file, { headerPatchMs: 30 });
  w.write(pcm(new Array(1000).fill(1000)));
  await sleep(120);
  let h = parseWav(fs.readFileSync(file));
  assert.equal(h.dataSize, 2000, 'data size patched while still open');
  assert.equal(h.riffSize, 36 + 2000);
  assert.equal(h.data.length, 2000);

  w.write(pcm(new Array(500).fill(-1000)));
  await sleep(120);
  h = parseWav(fs.readFileSync(file));
  assert.equal(h.dataSize, 3000);
  assert.equal(h.riffSize, 36 + 3000);
  await w.close();
});

test('default header patch interval is 30 s and the timer does not keep the process alive', async () => {
  const w = new WavWriter(tmpFile());
  assert.equal(w.headerPatchMs, 30_000);
  assert.equal(w._timer.hasRef(), false);
  await w.close();
});

test('close() is idempotent and write() after close is ignored', async () => {
  const file = tmpFile();
  const w = new WavWriter(file);
  w.write(pcm([1, 2]));
  await w.close();
  await w.close();
  w.write(pcm([3, 4]));
  assert.equal(w.seconds, 2 / 16000);
  const h = parseWav(fs.readFileSync(file));
  assert.equal(h.dataSize, 4);
  assert.equal(fs.statSync(file).size, 48);
});

test('respects sampleRate and channels options', async () => {
  const file = tmpFile();
  const w = new WavWriter(file, { sampleRate: 48000, channels: 2 });
  w.write(Buffer.alloc(48000 * 2 * 2)); // 1 s stereo
  assert.equal(w.seconds, 1);
  await w.close();
  const h = parseWav(fs.readFileSync(file));
  assert.equal(h.channels, 2);
  assert.equal(h.sampleRate, 48000);
  assert.equal(h.byteRate, 48000 * 4);
  assert.equal(h.blockAlign, 4);
  assert.equal(h.dataSize, 48000 * 4);
});

test('createWavHeader builds the canonical header', () => {
  const h = parseWav(createWavHeader({ dataBytes: 10 }));
  assert.equal(h.riffSize, 46);
  assert.equal(h.sampleRate, 16000);
  assert.equal(h.channels, 1);
  assert.equal(h.dataSize, 10);
});

test('constructor throws when the target directory does not exist', () => {
  assert.throws(() => new WavWriter(path.join(TMP, 'no', 'such', 'dir', 'a.wav')));
});
