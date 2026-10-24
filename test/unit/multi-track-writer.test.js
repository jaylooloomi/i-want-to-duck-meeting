import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MultiTrackWriter } from '../../src/audio/multi-track-writer.js';

test('two tracks preserve source audio, align overlapping samples, and retain the final partial packet', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmeeting-mix-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const writer = new MultiTrackWriter(dir);
  const pcm = (values) => { const b = Buffer.alloc(values.length * 2); values.forEach((v, i) => b.writeInt16LE(v, i * 2)); return b; };
  writer.write('mic', pcm([20000, -20000, 30000]), 0);
  writer.write('system', pcm([20000, -20000]), 1);
  writer.write('mic', pcm([1000]), 3);
  writer.close(); writer.close();
  const mixed = fs.readFileSync(path.join(dir, 'audio.wav'));
  assert.equal(mixed.readUInt32LE(40), 8);
  assert.deepEqual([0,1,2,3].map((i) => mixed.readInt16LE(44 + i * 2)), [10000, 0, 5000, 500]);
  assert.equal(writer.seconds, 4 / 16000);
  assert.equal(writer.tracks.mic.seconds, 4 / 16000);
  assert.equal(writer.tracks.system.seconds, 2 / 16000);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'audio-microphone.wav')).subarray(44), pcm([20000, -20000, 30000, 1000]));
  assert.deepEqual(fs.readFileSync(path.join(dir, 'audio-system.wav')).subarray(44), pcm([20000, -20000]));
});
