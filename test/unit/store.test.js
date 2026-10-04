// Rendering uses local time. Pin the process timezone so expectations are deterministic
// (Node re-reads TZ when process.env.TZ is assigned). renderTranscriptMd also accepts an
// explicit `timeZone` option, tested separately below.
process.env.TZ = 'Asia/Taipei';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TranscriptStore, renderTranscriptMd } from '../../src/transcript/store.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '.tmp', 'store');
let n = 0;
const freshDir = () => join(ROOT, `case-${process.pid}-${Date.now()}-${n++}`);
const ms = (iso) => Date.parse(iso);

before(() => mkdirSync(ROOT, { recursive: true }));
after(() => rmSync(ROOT, { recursive: true, force: true }));

describe('TranscriptStore', () => {
  test('append writes one JSON line per utterance with the spec shape', () => {
    const dir = freshDir();
    const store = new TranscriptStore(dir, { code: 'abc-defg-hij', startedAt: '2026-10-04T14:15:00.000Z' });
    store.append({ speaker: '王小明', text: '大家好', startMs: ms('2026-10-04T14:15:30.000Z'), endMs: ms('2026-10-04T14:15:33.500Z') });
    store.append({ speaker: 'Arthur', text: 'OK', startMs: ms('2026-10-04T14:15:40.000Z'), endMs: ms('2026-10-04T14:15:41.000Z') });
    const raw = readFileSync(join(dir, 'transcript.jsonl'), 'utf8');
    assert.equal(
      raw,
      '{"t0":"2026-10-04T14:15:30.000Z","t1":"2026-10-04T14:15:33.500Z","speaker":"王小明","text":"大家好","source":"captions"}\n' +
        '{"t0":"2026-10-04T14:15:40.000Z","t1":"2026-10-04T14:15:41.000Z","speaker":"Arthur","text":"OK","source":"captions"}\n',
    );
    assert.equal(store.count, 2);
  });

  test('speakers are unique in first-seen order; count tracks appends', () => {
    const store = new TranscriptStore(freshDir(), { code: 'x', startedAt: '2026-10-04T14:00:00.000Z' });
    const t = ms('2026-10-04T14:00:00.000Z');
    for (const [i, s] of ['王小明', 'Arthur', '王小明', 'Lisa', 'Arthur'].entries()) {
      store.append({ speaker: s, text: `第${i}句`, startMs: t + i * 1000, endMs: t + i * 1000 + 500 });
    }
    assert.equal(store.count, 5);
    assert.deepEqual(store.speakers, ['王小明', 'Arthur', 'Lisa']);
    store.speakers.push('mutated');
    assert.deepEqual(store.speakers, ['王小明', 'Arthur', 'Lisa'], 'speakers returns a copy');
  });

  test('renderMarkdown writes transcript.md and returns the same text', () => {
    const dir = freshDir();
    const store = new TranscriptStore(dir, { code: 'abc-defg-hij', startedAt: '2026-10-04T14:15:00.000Z' });
    store.append({ speaker: '王小明', text: '大家好', startMs: ms('2026-10-04T14:15:30.000Z'), endMs: ms('2026-10-04T14:15:32.000Z') });
    const md = store.renderMarkdown({ endedAt: '2026-10-04T14:20:00.000Z', captionLang: 'cmn-Hant-TW', extraNote: '字幕可能有誤' });
    assert.equal(readFileSync(join(dir, 'transcript.md'), 'utf8'), md);
    assert.equal(
      md,
      [
        '# 會議逐字稿 — abc-defg-hij',
        '',
        '- 時間：2026-10-04 22:15 – 22:20（5 分鐘）',
        '- 發言者：王小明',
        '- 來源：Google Meet 即時字幕（cmn-Hant-TW）',
        '- 備註：字幕可能有誤',
        '',
        '**[22:15:30] 王小明：** 大家好',
        '',
      ].join('\n'),
    );
  });

  test('an empty store renders the header plus the empty message', () => {
    const dir = freshDir();
    const store = new TranscriptStore(dir, { code: 'abc-defg-hij', startedAt: '2026-10-04T14:15:00.000Z' });
    const md = store.renderMarkdown({ endedAt: '2026-10-04T14:16:00.000Z', captionLang: 'unknown' });
    assert.ok(existsSync(join(dir, 'transcript.md')));
    assert.equal(
      md,
      [
        '# 會議逐字稿 — abc-defg-hij',
        '',
        '- 時間：2026-10-04 22:15 – 22:16（1 分鐘）',
        '- 發言者：（無）',
        '- 來源：Google Meet 即時字幕（unknown）',
        '',
        '（沒有擷取到任何字幕）',
        '',
      ].join('\n'),
    );
  });

  test('a new store on an existing dir reloads transcript.jsonl (render from jsonl)', () => {
    const dir = freshDir();
    const a = new TranscriptStore(dir, { code: 'abc-defg-hij', startedAt: '2026-10-04T14:15:00.000Z' });
    a.append({ speaker: '王小明', text: '大家好', startMs: ms('2026-10-04T14:15:30.000Z'), endMs: ms('2026-10-04T14:15:31.000Z') });
    a.append({ speaker: 'Arthur', text: '嗨', startMs: ms('2026-10-04T14:15:40.000Z'), endMs: ms('2026-10-04T14:15:41.000Z') });
    // a corrupt trailing line (e.g. crash mid-write) is ignored
    writeFileSync(join(dir, 'transcript.jsonl'), readFileSync(join(dir, 'transcript.jsonl'), 'utf8') + '{"t0":"2026-1', 'utf8');
    const b = new TranscriptStore(dir, { code: 'abc-defg-hij', startedAt: '2026-10-04T14:15:00.000Z' });
    assert.equal(b.count, 2);
    assert.deepEqual(b.speakers, ['王小明', 'Arthur']);
    assert.match(b.renderMarkdown({ endedAt: '2026-10-04T14:30:00.000Z', captionLang: 'cmn-Hant-TW' }), /\*\*\[22:15:40\] Arthur：\*\* 嗨/);
  });

  test('append ignores utterances with empty text', () => {
    const dir = freshDir();
    const store = new TranscriptStore(dir, { code: 'x', startedAt: '2026-10-04T14:00:00.000Z' });
    store.append({ speaker: 'A', text: '   ', startMs: 0, endMs: 0 });
    assert.equal(store.count, 0);
    assert.equal(existsSync(join(dir, 'transcript.jsonl')) ? readFileSync(join(dir, 'transcript.jsonl'), 'utf8') : '', '');
  });
});

describe('renderTranscriptMd', () => {
  const base = { code: 'abc-defg-hij', startedAt: '2026-10-04T14:15:00.000Z', endedAt: '2026-10-04T15:02:00.000Z', captionLang: 'cmn-Hant-TW' };

  test('renders header and merges same-speaker utterances less than 30 s apart', () => {
    const md = renderTranscriptMd({
      ...base,
      utterances: [
        { t0: '2026-10-04T14:15:30.000Z', t1: '2026-10-04T14:15:40.000Z', speaker: '王小明', text: '大家好，今天討論新版本', source: 'captions' },
        { t0: '2026-10-04T14:15:50.000Z', t1: '2026-10-04T14:15:55.000Z', speaker: '王小明', text: '先看上線時間', source: 'captions' },
        { t0: '2026-10-04T14:16:02.000Z', t1: '2026-10-04T14:16:04.000Z', speaker: 'Arthur', text: 'OK', source: 'captions' },
        { t0: '2026-10-04T14:16:10.000Z', t1: '2026-10-04T14:16:12.000Z', speaker: 'Arthur', text: 'sounds good', source: 'captions' },
        // exactly 30 s after the previous end → new paragraph
        { t0: '2026-10-04T14:16:42.000Z', t1: '2026-10-04T14:16:45.000Z', speaker: 'Arthur', text: '還有一件事', source: 'captions' },
        { t0: '2026-10-04T14:16:50.000Z', t1: '2026-10-04T14:16:51.000Z', speaker: '王小明', text: '請說', source: 'captions' },
      ],
    });
    assert.equal(
      md,
      [
        '# 會議逐字稿 — abc-defg-hij',
        '',
        '- 時間：2026-10-04 22:15 – 23:02（47 分鐘）',
        '- 發言者：王小明、Arthur',
        '- 來源：Google Meet 即時字幕（cmn-Hant-TW）',
        '',
        '**[22:15:30] 王小明：** 大家好，今天討論新版本先看上線時間',
        '',
        '**[22:16:02] Arthur：** OK sounds good',
        '',
        '**[22:16:42] Arthur：** 還有一件事',
        '',
        '**[22:16:50] 王小明：** 請說',
        '',
      ].join('\n'),
    );
  });

  test('a different speaker in between prevents merging', () => {
    const md = renderTranscriptMd({
      ...base,
      utterances: [
        { t0: '2026-10-04T14:15:30.000Z', t1: '2026-10-04T14:15:31.000Z', speaker: 'A', text: '一' },
        { t0: '2026-10-04T14:15:32.000Z', t1: '2026-10-04T14:15:33.000Z', speaker: 'B', text: '二' },
        { t0: '2026-10-04T14:15:34.000Z', t1: '2026-10-04T14:15:35.000Z', speaker: 'A', text: '三' },
      ],
    });
    assert.match(md, /\*\*\[22:15:30\] A：\*\* 一\n\n\*\*\[22:15:32\] B：\*\* 二\n\n\*\*\[22:15:34\] A：\*\* 三\n$/);
  });

  test('accepts assembler utterances (startMs/endMs) and an explicit timeZone', () => {
    const md = renderTranscriptMd({
      ...base,
      timeZone: 'UTC',
      utterances: [{ speaker: 'Arthur', text: 'hello', startMs: ms('2026-10-04T14:15:30.000Z'), endMs: ms('2026-10-04T14:15:31.000Z') }],
    });
    assert.match(md, /- 時間：2026-10-04 14:15 – 15:02（47 分鐘）/);
    assert.match(md, /\*\*\[14:15:30\] Arthur：\*\* hello/);
  });

  test('empty transcript renders header plus the empty message', () => {
    const md = renderTranscriptMd({ ...base, utterances: [] });
    assert.equal(
      md,
      [
        '# 會議逐字稿 — abc-defg-hij',
        '',
        '- 時間：2026-10-04 22:15 – 23:02（47 分鐘）',
        '- 發言者：（無）',
        '- 來源：Google Meet 即時字幕（cmn-Hant-TW）',
        '',
        '（沒有擷取到任何字幕）',
        '',
      ].join('\n'),
    );
  });

  test('meeting crossing midnight shows the end date; missing endedAt falls back to the last utterance', () => {
    const crossing = renderTranscriptMd({ ...base, startedAt: '2026-10-04T15:50:00.000Z', endedAt: '2026-10-04T16:20:00.000Z', utterances: [] });
    assert.match(crossing, /- 時間：2026-10-04 23:50 – 2026-10-05 00:20（30 分鐘）/);
    const open = renderTranscriptMd({
      ...base,
      endedAt: null,
      utterances: [{ t0: '2026-10-04T14:15:30.000Z', t1: '2026-10-04T14:25:00.000Z', speaker: 'A', text: '一' }],
    });
    assert.match(open, /- 時間：2026-10-04 22:15 – 22:25（10 分鐘）/);
  });

  test('utterances are rendered in chronological order and unknown speakers get a label', () => {
    const md = renderTranscriptMd({
      ...base,
      utterances: [
        { t0: '2026-10-04T14:20:00.000Z', t1: '2026-10-04T14:20:01.000Z', speaker: 'B', text: '後' },
        { t0: '2026-10-04T14:19:00.000Z', t1: '2026-10-04T14:19:01.000Z', speaker: '', text: '先' },
      ],
    });
    assert.match(md, /- 發言者：B\n/);
    assert.match(md, /\*\*\[22:19:00\] （未知）：\*\* 先\n\n\*\*\[22:20:00\] B：\*\* 後\n$/);
  });
});
