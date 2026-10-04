/**
 * Scripted caption timeline for the mock Meet page, plus the transcript a perfect caption
 * assembler must produce from it.
 *
 * Plain ESM with no imports: Node tests import it directly and the mock page loads the very
 * same file as `/static/timeline.js`.
 *
 * Step ops, applied by the page while captions are ON, `atMs` after speech starts (times are
 * multiplied by the `captionStepMs` query parameter):
 * - `'new'`      append a caption block for `speaker` showing `text`; like Meet, only the last
 *                {@link MAX_BLOCKS} blocks are kept (older block elements are removed);
 * - `'set'`      replace the visible text of the speaker's latest block;
 * - `'rerender'` replace the speaker's latest block ELEMENT with a fresh element (same speaker)
 *                showing `text` — Meet does this occasionally; the new text starts with the last
 *                12 characters of the old one and continues from there.
 * `text` is always exactly what the block shows (already windowed for rolling blocks).
 * `spans: true` renders the text as several `<span>`s instead of one text node.
 * @module mock-meet/timeline
 */

/** @typedef {{ atMs: number, op: 'new'|'set'|'rerender', speaker: string, text: string, spans?: boolean }} CaptionStep */
/** @typedef {{ speaker: string, text: string }} ExpectedUtterance */

/** A long block only shows (about) its last ROLL_WINDOW characters, like Meet's caption rows. */
export const ROLL_WINDOW = 40;
/** Meet trims old caption blocks; the mock keeps at most this many in the region. */
export const MAX_BLOCKS = 4;
/** How many trailing characters a re-rendered block repeats from the element it replaces. */
const RERENDER_TAIL = 12;

const WANG = '王小明';
const ARTHUR = 'Arthur';

const OPENING = '今天我們來討論新版本的上線時間，大家有什麼想法？';
const REPLY = '好的，我先 review 一下 PR，星期五前給你回覆。';
const MONOLOGUE =
  '關於上線時間，我建議分成三個階段進行。第一階段是內部測試，預計下週一開始，大概需要五個工作天。' +
  '第二階段是小規模公開測試，我們會先開放給百分之十的使用者，觀察錯誤率和效能指標。' +
  '第三階段才是全面上線，前提是前兩個階段都沒有重大問題。' +
  '另外，客服團隊也需要提前準備常見問題的說明文件，如果大家沒有其他意見，我們就照這個計畫走。';
const QUESTION = '了解，那測試環境什麼時候可以用？';
const ANSWER = '測試環境下週一就會準備好。';
const CLOSING = '太好了，那我們週五再同步一次。';

/**
 * Steps for one long block whose visible text grows by `chunk` characters per step and rolls
 * (shows only the last ROLL_WINDOW characters). The speaker pauses for `pauseMs` before step
 * `rerenderAt`, where the element is replaced (Meet re-renders a row when speech resumes); from
 * then on the window starts at the re-rendered element's first character. The pause keeps the
 * pre-rerender text on screen long enough for a throttled observer to see it, which the
 * assembler needs to recognise the new element as the same block.
 * @param {{ startMs: number, stepMs: number, pauseMs: number, speaker: string, full: string, chunk: number, rerenderAt: number }} o
 * @returns {CaptionStep[]}
 */
function rollingBlock({ startMs, stepMs, pauseMs, speaker, full, chunk, rerenderAt }) {
  /** @type {CaptionStep[]} */
  const steps = [];
  let windowStart = 0;
  let prevEnd = 0;
  for (let i = 0; prevEnd < full.length; i++) {
    const end = Math.min(prevEnd + chunk, full.length);
    /** @type {CaptionStep['op']} */
    let op = i === 0 ? 'new' : 'set';
    if (i === rerenderAt) {
      op = 'rerender';
      windowStart = prevEnd - RERENDER_TAIL;
    }
    const text = full.slice(Math.max(windowStart, end - ROLL_WINDOW), end);
    const atMs = startMs + i * stepMs + (i >= rerenderAt ? pauseMs : 0);
    /** @type {CaptionStep} */
    const step = { atMs, op, speaker, text };
    if (i % 4 === 2) step.spans = true;
    steps.push(step);
    prevEnd = end;
  }
  return steps;
}

/** @type {readonly CaptionStep[]} */
export const HAPPY_TIMELINE = Object.freeze([
  // 王小明 starts a sentence, the recognizer revises 上限 → 上線 while it grows
  { atMs: 0, op: 'new', speaker: WANG, text: '今天' },
  { atMs: 400, op: 'set', speaker: WANG, text: '今天我們來討論' },
  { atMs: 800, op: 'set', speaker: WANG, text: '今天我們來討論新版本的上限時間' },
  { atMs: 1300, op: 'set', speaker: WANG, text: OPENING, spans: true },
  // Arthur answers, code-switching between Mandarin and English
  { atMs: 1900, op: 'new', speaker: ARTHUR, text: '好的，' },
  { atMs: 2300, op: 'set', speaker: ARTHUR, text: '好的，我先 review 一下' },
  { atMs: 2800, op: 'set', speaker: ARTHUR, text: REPLY, spans: true },
  // a long monologue: the block rolls, and after a short pause its element is re-rendered
  ...rollingBlock({ startMs: 3400, stepMs: 300, pauseMs: 500, speaker: WANG, full: MONOLOGUE, chunk: 8, rerenderAt: 12 }),
  // short turns; each new block pushes the oldest one out of the region (max 4 blocks)
  { atMs: 10800, op: 'new', speaker: ARTHUR, text: '了解，' },
  { atMs: 11300, op: 'set', speaker: ARTHUR, text: QUESTION },
  { atMs: 11900, op: 'new', speaker: WANG, text: '測試環境' },
  { atMs: 12400, op: 'set', speaker: WANG, text: ANSWER },
  { atMs: 13000, op: 'new', speaker: ARTHUR, text: '太好了，' },
  { atMs: 13500, op: 'set', speaker: ARTHUR, text: CLOSING, spans: true },
].map((step) => Object.freeze(step)));

/** Time of the last step at captionStepMs=1 (the timeline is "done" right after it). */
export const HAPPY_DURATION_MS = HAPPY_TIMELINE[HAPPY_TIMELINE.length - 1].atMs;

/**
 * The transcript a perfect assembler produces from {@link HAPPY_TIMELINE}: one utterance per
 * logical caption block (a re-rendered element is the same block), in order of appearance.
 * @type {readonly ExpectedUtterance[]}
 */
export const HAPPY_EXPECTED = Object.freeze([
  { speaker: WANG, text: OPENING },
  { speaker: ARTHUR, text: REPLY },
  { speaker: WANG, text: MONOLOGUE },
  { speaker: ARTHUR, text: QUESTION },
  { speaker: WANG, text: ANSWER },
  { speaker: ARTHUR, text: CLOSING },
].map((u) => Object.freeze(u)));
