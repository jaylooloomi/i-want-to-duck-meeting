import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CaptionAssembler, joinText, mergeVisible } from '../../src/captions/assembler.js';

/** @param {string|number} id @param {string} speaker @param {string} text */
const B = (id, speaker, text) => ({ id, speaker, text });

describe('joinText', () => {
  test('no space between CJK and Latin, single space between two Latin words', () => {
    assert.equal(joinText('我先', 'review'), '我先review');
    assert.equal(joinText('review', '一下'), 'review一下');
    assert.equal(joinText('hello', 'world'), 'hello world');
    assert.equal(joinText('大家好', '今天'), '大家好今天');
    assert.equal(joinText('版本', '2'), '版本2');
    assert.equal(joinText('v2', '3'), 'v2 3');
  });

  test('CJK punctuation never gets a space', () => {
    assert.equal(joinText('OK。', 'next'), 'OK。next');
    assert.equal(joinText('好的，', 'OK'), '好的，OK');
  });

  test('Latin sentence punctuation followed by a word gets a space; nothing before punctuation', () => {
    assert.equal(joinText('hello,', 'world'), 'hello, world');
    assert.equal(joinText('done.', 'Next'), 'done. Next');
    assert.equal(joinText('hello', '.'), 'hello.');
  });

  test('empty sides and existing whitespace', () => {
    assert.equal(joinText('', 'abc'), 'abc');
    assert.equal(joinText('abc', ''), 'abc');
    assert.equal(joinText('', ''), '');
    assert.equal(joinText('hello ', 'world'), 'hello world');
    assert.equal(joinText('hello', ' world'), 'hello world');
  });
});

describe('mergeVisible', () => {
  test('unchanged text keeps acc', () => {
    assert.equal(mergeVisible('前面。大家好', '大家好', '大家好'), '前面。大家好');
  });

  test('first text is appended with joinText', () => {
    assert.equal(mergeVisible('', '', '大家好'), '大家好');
    assert.equal(mergeVisible('hello', '', 'world'), 'hello world');
  });

  test('extension in place', () => {
    assert.equal(mergeVisible('前面的話。今天我們', '今天我們', '今天我們來討論'), '前面的話。今天我們來討論');
  });

  test('mid-sentence revision replaces the visible part in place', () => {
    const last = '今天我們來討論新版本的上限時間';
    const next = '今天我們來討論新版本的上線時間';
    assert.equal(mergeVisible(last, last, next), next);
    assert.equal(mergeVisible('開場。' + last, last, next), '開場。' + next);
  });

  test('rolled window: start dropped, tail extended', () => {
    const acc = '一二三四五六七八九十甲乙丙丁';
    assert.equal(mergeVisible(acc, acc, '五六七八九十甲乙丙丁戊己'), acc + '戊己');
  });

  test('rolled window that only shrinks keeps acc', () => {
    const acc = '一二三四五六七八九十甲乙丙丁';
    assert.equal(mergeVisible(acc, acc, '五六七八九十甲乙丙丁'), acc);
  });

  test('rolled window with a revision after the first 12 chars (anchor search)', () => {
    const last = '一二三四五六七八九十甲乙丙丁戊己庚辛';
    const next = '三四五六七八九十甲乙丙丁戊X庚辛壬';
    assert.equal(mergeVisible('開頭' + last, last, next), '開頭一二' + next);
  });

  test('unrelated text is appended with joinText', () => {
    assert.equal(mergeVisible('大家好', '大家好', '下一個議題'), '大家好下一個議題');
    assert.equal(mergeVisible('hello there', 'hello there', 'general kenobi'), 'hello there general kenobi');
  });

  test('empty next keeps acc', () => {
    assert.equal(mergeVisible('大家好', '大家好', ''), '大家好');
  });

  test('comma inserted after the first word is an in-place revision, not new text', () => {
    assert.equal(mergeVisible('好那我們開始', '好那我們開始', '好，那我們開始吧'), '好，那我們開始吧');
    assert.equal(mergeVisible('好的我們開始', '好的我們開始', '好的，我們開始吧'), '好的，我們開始吧');
    assert.equal(mergeVisible('大家好今天我們開會', '大家好今天我們開會', '大家好，今天我們開會了'), '大家好，今天我們開會了');
    const last = '今天天氣很好我們來開會吧';
    assert.equal(mergeVisible('開場。' + last, last, '今天，天氣很好我們來開會吧大家'), '開場。今天，天氣很好我們來開會吧大家');
  });

  test('corrected first character / first word is an in-place revision', () => {
    assert.equal(mergeVisible('在來看', '在來看', '再來看一下'), '再來看一下');
    assert.equal(mergeVisible('前面。在來看', '在來看', '再來看一下'), '前面。再來看一下');
    assert.equal(mergeVisible('他', '他', '大家'), '大家');
  });

  test('capitalisation and punctuation changes in English are in-place revisions', () => {
    assert.equal(mergeVisible('so what we need is', 'so what we need is', 'So, what we need is a plan'), 'So, what we need is a plan');
  });

  test('punctuation-only next text is still appended (not a replacement)', () => {
    assert.equal(mergeVisible('大家好', '大家好', '。'), '大家好。');
  });
});

describe('CaptionAssembler', () => {
  test('growth of one block yields one utterance', () => {
    const a = new CaptionAssembler();
    assert.deepEqual(a.update([B(1, '王小明', '大家')], 0), []);
    assert.deepEqual(a.update([B(1, '王小明', '大家好')], 300), []);
    assert.deepEqual(a.update([B(1, '王小明', '大家好，今天')], 600), []);
    assert.deepEqual(a.tick(100_000), [], 'a lone unchanged block is not finalized by time alone');
    assert.deepEqual(a.flush(100_500), [{ speaker: '王小明', text: '大家好，今天', startMs: 0, endMs: 600 }]);
  });

  test('mid-sentence revision yields one utterance with the revised text', () => {
    const a = new CaptionAssembler();
    a.update([B(1, '王小明', '今天我們')], 0);
    a.update([B(1, '王小明', '今天我們來討論新版本的上限')], 200);
    a.update([B(1, '王小明', '今天我們來討論新版本的上限時間')], 400);
    a.update([B(1, '王小明', '今天我們來討論新版本的上線時間')], 600);
    assert.deepEqual(a.flush(1000), [
      { speaker: '王小明', text: '今天我們來討論新版本的上線時間', startMs: 0, endMs: 600 },
    ]);
  });

  test('rolling window of a long CJK monologue reconstructs the full text without duplication', () => {
    const full =
      '各位同事大家好今天我們要討論的是下一季的產品規劃首先是新版本的上線時間預計在十一月中旬' +
      '然後是客戶回饋的整理我們收到了很多關於效能的意見接下來請工程團隊報告目前的進度以及遇到的困難' +
      '最後我們再來決定下一次會議的時間謝謝大家';
    const LINE = 12;
    const a = new CaptionAssembler();
    let t = 0;
    let rolled = false;
    let wrongFrames = 0;
    for (let frame = 0, end = 2; end < full.length + 3; frame++, end += 3) {
      const e = Math.min(end, full.length);
      const start = Math.max(0, (Math.ceil(e / LINE) - 3) * LINE); // keep at most 3 lines visible
      if (start > 0) rolled = true;
      let visible = full.slice(start, e);
      // Every 4th frame Meet shows a wrong last character that is corrected in the next frame.
      if (frame % 4 === 1 && e < full.length) {
        visible = visible.slice(0, -1) + '某';
        wrongFrames++;
      }
      assert.deepEqual(a.update([B(7, '王小明', visible)], t), []);
      t += 250;
    }
    assert.ok(wrongFrames > 5);
    assert.ok(rolled, 'the scenario must actually roll the window');
    const out = a.flush(t);
    assert.equal(out.length, 1);
    assert.equal(out[0].text, full);
    assert.equal(out[0].speaker, '王小明');
  });

  test('rolling window of a long English monologue reconstructs the full text', () => {
    const words = ('so the plan for next quarter is to ship the new release in november and then ' +
      'collect customer feedback about performance before we decide the next steps for the team').split(' ');
    const a = new CaptionAssembler();
    let t = 0;
    for (let n = 1; n <= words.length; n++) {
      const startWord = Math.max(0, (Math.ceil(n / 6) - 3) * 6); // lines of 6 words, 3 lines visible
      a.update([B('x', 'Arthur', words.slice(startWord, n).join(' '))], t);
      t += 300;
    }
    const out = a.flush(t);
    assert.equal(out.length, 1);
    assert.equal(out[0].text, words.join(' '));
  });

  test('speaker change creates separate utterances in order', () => {
    const a = new CaptionAssembler();
    a.update([B(1, '王小明', '大家好')], 0);
    a.update([B(1, '王小明', '大家好，開始吧'), B(2, 'Arthur', '好的')], 500);
    a.update([B(1, '王小明', '大家好，開始吧'), B(2, 'Arthur', '好的，我先review一下')], 1000);
    assert.deepEqual(a.flush(2000), [
      { speaker: '王小明', text: '大家好，開始吧', startMs: 0, endMs: 500 },
      { speaker: 'Arthur', text: '好的，我先review一下', startMs: 500, endMs: 1000 },
    ]);
  });

  test('re-rendered block (new id, same speaker, continuation) merges into the same utterance', () => {
    const a = new CaptionAssembler();
    a.update([B(1, '王小明', '大家好，今天我們來討論新版本的上線時間')], 0);
    // Meet replaced the element; the new one starts inside the old text and continues it.
    assert.deepEqual(a.update([B(2, '王小明', '今天我們來討論新版本的上線時間，預計下週三')], 400), []);
    assert.deepEqual(a.update([B(2, '王小明', '今天我們來討論新版本的上線時間，預計下週三上線')], 800), []);
    assert.deepEqual(a.tick(5000), [], 'the old id must not linger as a gone block');
    assert.deepEqual(a.flush(6000), [
      { speaker: '王小明', text: '大家好，今天我們來討論新版本的上線時間，預計下週三上線', startMs: 0, endMs: 800 },
    ]);
  });

  test('re-rendered block starting with the 12-char tail merges (spec rule)', () => {
    const a = new CaptionAssembler();
    const first = 'we should talk about the release date for the new version';
    a.update([B(1, 'Arthur', first)], 0);
    a.update([B(2, 'Arthur', first.slice(-12) + ' next week')], 300);
    assert.deepEqual(a.flush(1000), [
      { speaker: 'Arthur', text: first + ' next week', startMs: 0, endMs: 300 },
    ]);
  });

  test('re-rendered block with identical text does not duplicate', () => {
    const a = new CaptionAssembler();
    a.update([B(1, '王小明', '大家好，今天我們來討論')], 0);
    a.update([B(9, '王小明', '大家好，今天我們來討論')], 300);
    assert.deepEqual(a.flush(1000), [
      { speaker: '王小明', text: '大家好，今天我們來討論', startMs: 0, endMs: 0 },
    ]);
  });

  test('re-render after the old block was already finalized emits only the continuation', () => {
    const a = new CaptionAssembler();
    const first = '大家好，今天我們來討論新版本的上線時間';
    a.update([B(1, '王小明', first)], 0);
    a.update([], 100);
    assert.deepEqual(a.tick(1600), [{ speaker: '王小明', text: first, startMs: 0, endMs: 0 }]);
    a.update([B(2, '王小明', first.slice(-12) + '，預計下週三上線')], 3000);
    assert.deepEqual(a.flush(4000), [{ speaker: '王小明', text: '，預計下週三上線', startMs: 3000, endMs: 3000 }]);
  });

  test('no re-match for a different speaker or after rematchMs', () => {
    const a = new CaptionAssembler({ rematchMs: 10_000 });
    const text = '大家好，今天我們來討論新版本';
    a.update([B(1, '王小明', text)], 0);
    a.update([B(2, 'Arthur', text + '的時間')], 300); // different speaker
    const out = a.flush(1000);
    assert.equal(out.length, 2);

    const b = new CaptionAssembler({ rematchMs: 10_000 });
    b.update([B(1, '王小明', text)], 0);
    b.update([], 100);
    assert.equal(b.tick(2000).length, 1);
    b.update([B(2, '王小明', text + '的時間')], 20_000); // too late to be the same row
    assert.deepEqual(b.flush(21_000), [{ speaker: '王小明', text: text + '的時間', startMs: 20_000, endMs: 20_000 }]);
  });

  test('a short new row that is only a tiny prefix of the old row is not re-matched', () => {
    const a = new CaptionAssembler();
    a.update([B(1, '王小明', '好的，我們開始')], 0);
    a.update([B(2, '王小明', '好')], 300);
    a.update([B(2, '王小明', '好，那我們先看第二點')], 600);
    assert.deepEqual(a.flush(1000).map((u) => u.text), ['好的，我們開始', '好，那我們先看第二點']);
  });

  test('a short finalized row is only re-matched by identical text', () => {
    const a = new CaptionAssembler();
    a.update([B(1, 'A', '嗯')], 0);
    a.update([], 100);
    assert.equal(a.tick(2000).length, 1);
    a.update([B(2, 'A', '嗯，我覺得可以')], 3000);
    assert.deepEqual(a.flush(4000).map((u) => u.text), ['嗯，我覺得可以']);
  });

  test('block disappearing finalizes after goneSettleMs', () => {
    const a = new CaptionAssembler({ goneSettleMs: 1500 });
    a.update([B(1, 'A', '你好')], 0);
    assert.deepEqual(a.update([], 1000), []);
    assert.deepEqual(a.tick(2499), []);
    assert.deepEqual(a.tick(2500), [{ speaker: 'A', text: '你好', startMs: 0, endMs: 0 }]);
    assert.deepEqual(a.tick(9000), []);
    assert.deepEqual(a.flush(9500), []);
  });

  test('a block that reappears before goneSettleMs is not finalized', () => {
    const a = new CaptionAssembler({ goneSettleMs: 1500 });
    a.update([B(1, 'A', '你好')], 0);
    a.update([], 500);
    a.update([B(1, 'A', '你好嗎')], 1000);
    assert.deepEqual(a.tick(3000), []);
    assert.deepEqual(a.flush(3500), [{ speaker: 'A', text: '你好嗎', startMs: 0, endMs: 1000 }]);
  });

  test('unchanged block plus a newer block finalizes after finalizeMs, without duplicates later', () => {
    const a = new CaptionAssembler({ finalizeMs: 4000 });
    a.update([B(1, 'A', '第一句話')], 0);
    a.update([B(1, 'A', '第一句話'), B(2, 'B', '第二')], 1000);
    assert.deepEqual(a.tick(3999), []);
    assert.deepEqual(a.tick(4000), [{ speaker: 'A', text: '第一句話', startMs: 0, endMs: 0 }]);
    assert.deepEqual(a.update([B(1, 'A', '第一句話'), B(2, 'B', '第二句')], 4500), []);
    assert.deepEqual(a.flush(5000), [{ speaker: 'B', text: '第二句', startMs: 1000, endMs: 4500 }]);
  });

  test('a finalized block that keeps growing emits only the new part', () => {
    const a = new CaptionAssembler({ finalizeMs: 4000 });
    a.update([B(1, 'A', '第一句話')], 0);
    a.update([B(1, 'A', '第一句話'), B(2, 'B', '嗯')], 1000);
    assert.equal(a.tick(4000).length, 1);
    a.update([B(1, 'A', '第一句話還沒講完'), B(2, 'B', '嗯')], 5000);
    // Utterances finalized together come out in chronological (startMs) order.
    assert.deepEqual(a.flush(6000), [
      { speaker: 'B', text: '嗯', startMs: 1000, endMs: 1000 },
      { speaker: 'A', text: '還沒講完', startMs: 5000, endMs: 5000 },
    ]);
  });

  test('early-position revisions of a young block do not duplicate the sentence', () => {
    const a = new CaptionAssembler();
    a.update([B(1, 'A', '在來看')], 0);
    a.update([B(1, 'A', '再來看一下')], 300);
    a.update([B(1, 'A', '再來看一下預算')], 600);
    assert.deepEqual(a.flush(1000).map((u) => u.text), ['再來看一下預算']);

    const b = new CaptionAssembler();
    for (const [t, text] of [[0, '好的我們'], [300, '好的我們開始'], [600, '好的，我們開始吧'], [900, '好的，我們開始吧。今天']]) {
      b.update([B(1, 'A', text)], t);
    }
    assert.deepEqual(b.flush(1200).map((u) => u.text), ['好的，我們開始吧。今天']);
  });

  test('a finalized block revised in place (still visible) emits no garbage fragment', () => {
    const a = new CaptionAssembler({ finalizeMs: 4000 });
    a.update([B('A', 'A', '我們明天開會')], 0);
    a.update([B('A', 'A', '我們明天開會'), B('B', 'B', '好')], 1000);
    assert.deepEqual(a.tick(5100).map((u) => u.text), ['我們明天開會']);
    a.update([B('A', 'A', '我們明天再開會'), B('B', 'B', '好')], 5200);
    assert.deepEqual(a.flush(6000).map((u) => [u.speaker, u.text]), [['B', '好']]);
  });

  test('a finalized block that only gains punctuation emits nothing more', () => {
    const a = new CaptionAssembler({ finalizeMs: 4000 });
    a.update([B(1, 'A', '我們明天開會')], 0);
    a.update([B(1, 'A', '我們明天開會'), B(2, 'B', '好')], 1000);
    assert.equal(a.tick(5000).length, 1);
    a.update([B(1, 'A', '我們明天開會。'), B(2, 'B', '好')], 5200);
    assert.deepEqual(a.flush(6000).map((u) => u.text), ['好']);
  });

  test('a finalized block revised in place and then extended emits only the extension', () => {
    const a = new CaptionAssembler({ finalizeMs: 4000 });
    a.update([B(1, 'A', '我們明天開會')], 0);
    a.update([B(1, 'A', '我們明天開會'), B(2, 'B', '好')], 1000);
    assert.equal(a.tick(5000).length, 1);
    a.update([B(1, 'A', '我們明天再開會，地點在三樓會議室'), B(2, 'B', '好')], 5200);
    assert.deepEqual(a.flush(6000).map((u) => u.text), ['好', '，地點在三樓會議室']);
  });

  test('flush finalizes all active blocks; a second flush returns nothing', () => {
    const a = new CaptionAssembler();
    a.update([B(1, 'A', '一'), B(2, 'B', '二'), B(3, 'C', '三')], 0);
    assert.deepEqual(a.flush(100).map((u) => u.speaker), ['A', 'B', 'C']);
    assert.deepEqual(a.flush(200), []);
    assert.deepEqual(a.update([B(1, 'A', '一'), B(2, 'B', '二'), B(3, 'C', '三')], 300), []);
    assert.deepEqual(a.flush(400), []);
  });

  test('exact consecutive duplicates (same speaker + text within 10 s) are dropped', () => {
    const a = new CaptionAssembler({ rematchMs: 0 });
    a.update([B(1, 'A', '好的')], 0);
    a.update([], 100);
    assert.equal(a.tick(2000).length, 1);
    a.update([B(2, 'A', '好的')], 3000);
    a.update([], 3100);
    assert.deepEqual(a.tick(5000), [], 'duplicate within 10 s is dropped');
    a.update([B(3, 'A', '好的')], 30_000);
    assert.deepEqual(a.flush(31_000).map((u) => u.text), ['好的'], 'same text much later is kept');
  });

  test('two identical rows visible at once produce one utterance', () => {
    const a = new CaptionAssembler();
    a.update([B(1, 'A', '大家好'), B(2, 'A', '大家好')], 0);
    assert.deepEqual(a.flush(500), [{ speaker: 'A', text: '大家好', startMs: 0, endMs: 0 }]);
  });

  test('update(null) behaves like an empty snapshot', () => {
    const a = new CaptionAssembler({ goneSettleMs: 1500 });
    assert.deepEqual(a.update(null, 0), []);
    a.update([B(1, 'A', '你好')], 100);
    assert.deepEqual(a.update(null, 200), []);
    assert.deepEqual(a.update(null, 1700), [{ speaker: 'A', text: '你好', startMs: 100, endMs: 100 }]);
  });

  test('blocks with empty text are ignored and empty utterances are never emitted', () => {
    const a = new CaptionAssembler();
    assert.deepEqual(a.update([B(1, 'A', ''), B(2, 'B', '   ')], 0), []);
    assert.deepEqual(a.flush(100), []);
  });

  test('numeric and string ids are interchangeable', () => {
    const a = new CaptionAssembler();
    a.update([B(5, 'A', '大家好')], 0);
    a.update([B('5', 'A', '大家好啊')], 200);
    assert.deepEqual(a.flush(300), [{ speaker: 'A', text: '大家好啊', startMs: 0, endMs: 200 }]);
  });

  test('utterances returned are copies (mutating them does not affect the assembler)', () => {
    const a = new CaptionAssembler({ rematchMs: 0 });
    a.update([B(1, 'A', '好的')], 0);
    const [u] = a.flush(10);
    u.text = 'changed';
    a.update([B(2, 'A', '好的')], 20);
    assert.deepEqual(a.flush(30), [], 'duplicate detection uses the original text');
  });
});
