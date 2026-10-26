import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {compareTranscripts, renderCrosscheck, writeCrosscheck} from '../../src/transcript/crosscheck.js';

const segment = (text, start = 0) => ({text, start, end: start + 1});
test('crosscheck finds wording despite punctuation without claiming truth or speaker alignment', () => {
  const r = compareTranscripts([{text: '測試，Google Meet 1357。', speaker: 'A'}], [segment('測試 Google Meet，1357')]);
  assert.equal(r.review[0].status, 'wording-present-in-captions');
  assert.deepEqual(r.sharedNumbers, ['1357']);
  assert.equal(r.timingAligned, false); assert.equal(r.speakerAttributionVerified, false);
  assert.equal(r.review[0].speaker, undefined);
});
test('crosscheck exposes omissions and conflicting names rather than correcting by guess', () => {
  const r = compareTranscripts([{text: 'Google Map 13570'}], [segment('Google Meet 1357')]);
  assert.equal(r.review[0].status, 'needs-review');
  assert.deepEqual(r.sharedNumbers, []);
  assert.deepEqual(r.captionOnlyNumbers, ['13570']); assert.deepEqual(r.recordingOnlyNumbers, ['1357']);
  assert.match(renderCrosscheck(r), /Google Map 13570/); assert.match(renderCrosscheck(r), /Google Meet 1357/);
});
test('crosscheck cannot join unrelated captions into fabricated agreement or use non-caption sources', () => {
  const r = compareTranscripts([{text:'測試'}, {text:'1357'}, {text:'測試1357',source:'paraformer'}], [segment('測試1357')]);
  assert.equal(r.review[0].status, 'needs-review'); assert.equal(r.captions.length, 2);
});
test('crosscheck handles absent sources and empty text honestly', () => {
  const r = compareTranscripts([], [segment('')]);
  assert.deepEqual(r.availability, {captions:false,recording:false}); assert.deepEqual(r.review, []);
  assert.match(renderCrosscheck(r), /沒有可核對的原生字幕/);
});
test('crosscheck rejects invalid contracts and negative or reversed times', () => {
  for (const x of [null, {}, [null], [{text:1}], [{text:'a',start:2,end:1}], [{text:'a',start:-1,end:1}]]) {
    assert.throws(() => compareTranscripts([],x), /invalid_transcript/);
  }
  assert.throws(()=>compareTranscripts([],[segment('later',5),segment('earlier',1)]),/recording order/);
  assert.throws(()=>compareTranscripts([],[],{terms:'name'}),/invalid_terms/);
});
test('crosscheck writes separate artifacts, preserves original bytes and supports repeated execution', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'meeting-crosscheck-'));
  try {
    assert.throws(() => writeCrosscheck(dir), /recording_transcript_missing/);
    const cc = '{"text":"1357","source":"captions"}\n'; const audio = JSON.stringify({segments:[segment('1357')]});
    fs.writeFileSync(path.join(dir,'transcript.jsonl'),cc); fs.writeFileSync(path.join(dir,'transcript-whisper.json'),audio);
    const a = writeCrosscheck(dir), b = writeCrosscheck(dir);
    assert.deepEqual(a.report,b.report); assert.match(fs.readFileSync(a.mdPath,'utf8'), /1357/);
    assert.equal(fs.readFileSync(path.join(dir,'transcript.jsonl'),'utf8'),cc);
    assert.equal(fs.readFileSync(path.join(dir,'transcript-whisper.json'),'utf8'),audio);
    fs.writeFileSync(path.join(dir,'transcript.jsonl'),'{broken');
    assert.throws(() => writeCrosscheck(dir), SyntaxError);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
