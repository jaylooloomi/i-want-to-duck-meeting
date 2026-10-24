import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MicrophoneService } from '../../src/microphone.js';
import { readLiveMeeting } from '../../src/live-server.js';

test('an interrupted recognizer preserves failed status, an error and a closed WAV', {
  skip:!process.env.OPENMEETING_MIC_TEST_PCM, timeout:100000,
}, async (t) => {
  const meetingsDir = path.resolve('test/.tmp/microphone-interrupted/meetings');
  const service = new MicrophoneService({ meetingsDir, home:path.resolve('.'), repoRoot:path.resolve('.') });
  const { id, token } = await service.start();
  const session = service.current;
  t.after(async () => { if (service.current) { service.stop(token); await session.finished; } });
  service.audio(token, 0, Buffer.alloc(8000));
  session.child.kill();
  await session.finished;
  const { status } = readLiveMeeting(meetingsDir, id);
  assert.equal(status.state, 'failed');
  assert.equal(status.error.code, 'local_stt_failed');
  assert.ok(status.error.message);
  assert.equal(service.current, null);
  const wav = fs.readFileSync(path.join(session.dir, 'audio.wav'));
  assert.equal(wav.readUInt32LE(40), 8000, 'received PCM remains playable after interruption');
});

// Opt in with a local PCM16LE mono/16k multi-speaker speech fixture. Never downloads audio.
test('local microphone PCM reaches real VAD, speaker embeddings, Whisper and the live viewer', {
  skip:!process.env.OPENMEETING_MIC_TEST_PCM, timeout:180000,
}, async () => {
  const meetingsDir = path.resolve('test/.tmp/microphone-validation/meetings');
  const service = new MicrophoneService({ meetingsDir, home:path.resolve('.'), repoRoot:path.resolve('.') });
  const audio = fs.readFileSync(process.env.OPENMEETING_MIC_TEST_PCM);
  const { id, token } = await service.start();
  const session = service.current;
  try {
    assert.throws(() => service.audio('wrong', 0, Buffer.alloc(8000)));
    assert.throws(() => service.audio(token, 1, Buffer.alloc(8000)));
    let sequence = 0;
    for (let offset = 0; offset < audio.length; offset += 8000) {
      service.audio(token, sequence++, audio.subarray(offset, offset + 8000));
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
    service.stop(token);
    await session.finished;
    const data = readLiveMeeting(meetingsDir, id);
    assert.equal(data.status.state, 'done', JSON.stringify(data.status.error));
    assert.ok(data.records.length >= 2, 'recognized speech from the audio');
    const speakers = new Set(data.records.map((r) => r.speaker).filter((s) => s !== '講者未確認'));
    assert.ok(speakers.size >= 2, `separated multiple speakers: ${[...speakers]}`);
    assert.ok(speakers.has('講者 A'));
    // A confirmed voice may occur in music/no-speech that Whisper declines to transcribe.
    // Check diarization independently from whether that voice produced recognizable text.
    const events = fs.readFileSync(path.join(session.dir, 'worker.out'), 'utf8').split(/\r?\n/).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    const assigned = new Set(events.filter((e) => e.type === 'speaker-turn').map((e) => e.speaker));
    assert.ok(assigned.has('講者 B'), 'recognizer assigned the second voice');
    assert.ok(assigned.has('講者未確認'), 'insufficient evidence stays unconfirmed');
    if (process.env.OPENMEETING_MIC_TEST_EXPECTED_SPEAKERS) {
      assert.equal([...assigned].filter((s) => s !== '講者未確認').length,
        Number(process.env.OPENMEETING_MIC_TEST_EXPECTED_SPEAKERS), 'confirmed identities in the public fixture');
    }
    assert.deepEqual(data.pending, []);
    assert.equal(data.status.source, 'microphone');
    assert.ok(data.records.every((r) => r.source === 'local-audio'));
    const wav = fs.readFileSync(path.join(session.dir, 'audio.wav'));
    assert.equal(wav.readUInt32LE(40), audio.length, 'all PCM including final packet saved');
    console.log(JSON.stringify({ records:data.records.length, speakers:[...speakers], stats:data.status.stats }));
  } finally {
    if (service.current && !session.stopping) service.stop(token);
  }
});
