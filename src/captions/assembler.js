/**
 * Pure caption assembler: turns successive snapshots of Meet's caption region (the blocks the
 * caption observer reports) into finalized utterances.
 *
 * Meet keeps revising the newest block's text, rolls the visible text of long monologues (drops
 * the start, keeps ~2-3 lines), occasionally re-renders a block as a new element continuing the
 * same text, and replaces the whole region when captions are toggled or the language changes.
 * The assembler reconstructs the full text per block ({@link mergeVisible}), re-matches
 * re-rendered rows, and decides when a block is done.
 * @module captions/assembler
 */

/**
 * @typedef {object} CaptionBlock
 * @property {string|number} id       stable per DOM element (observer's data-om-id)
 * @property {string} [speaker]
 * @property {string} [text]          currently visible caption text of the block
 */

/**
 * @typedef {object} Utterance
 * @property {string} speaker
 * @property {string} text
 * @property {number} startMs   first time the block (or its continuation) was seen
 * @property {number} endMs     last time its text changed
 */

// Han, kana, Hangul, Bopomofo, CJK symbols/punctuation and full-width forms.
const CJK_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}　-〿＀-￯]/u;
const ALNUM_RE = /[\p{L}\p{N}]/u;
const LATIN_PUNCT_RE = /[,.!?;:]/;
const DUPLICATE_WINDOW_MS = 10_000;

/** @param {string} ch */
const isWordChar = (ch) => ch !== '' && ALNUM_RE.test(ch) && !CJK_RE.test(ch);

/** @param {string} s */
const firstChar = (s) => (s ? String.fromCodePoint(/** @type {number} */ (s.codePointAt(0))) : '');

/** @param {string} s */
const lastChar = (s) => (s ? Array.from(s.slice(-2)).pop() || '' : '');

/** @param {string} a @param {string} b */
function commonPrefixLen(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/** @param {unknown} s */
const clean = (s) => (s === null || s === undefined ? '' : String(s).replace(/\s+/g, ' ').trim());

// Punctuation, symbols and whitespace: ignored when deciding whether two versions of a caption
// are the same sentence (Meet's recogniser keeps inserting commas, capitalising, ...).
const IGNORABLE_RE = /[\s\p{P}\p{S}]/gu;
const WORD_RE = /[\p{L}\p{N}]/u;
/** Longest text the edit-distance comparison is run on (visible caption text is far shorter). */
const MAX_ALIGN_LEN = 600;

/** Comparison form of a caption: no punctuation / whitespace, lower case. @param {string} s */
const comparable = (s) => s.replace(IGNORABLE_RE, '').toLowerCase();

/** Edit distance still counted as "the same text, revised". @param {number} len */
const reviseTolerance = (len) => Math.max(2, Math.floor(len / 4));

/**
 * Smallest edit distance between `a` and a prefix of `b`, and the length of that prefix (the
 * longest one on ties). Only prefixes up to `a.length + maxDist` long are considered (longer
 * ones are more than `maxDist` edits away anyway).
 * @param {string} a
 * @param {string} b
 * @param {number} maxDist
 * @returns {{ dist: number, end: number }}
 */
function prefixAlign(a, b, maxDist) {
  const m = a.length;
  const n = Math.min(b.length, m + maxDist);
  let prev = new Uint32Array(n + 1);
  let cur = new Uint32Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const sub = prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1);
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, sub);
    }
    [prev, cur] = [cur, prev];
  }
  let dist = Infinity;
  let end = 0;
  for (let j = 0; j <= n; j++) {
    if (prev[j] <= dist) {
      dist = prev[j];
      end = j;
    }
  }
  return { dist, end };
}

/**
 * Is `next` the same caption as `last`, revised in place (first word corrected, comma
 * inserted, capitalised, ...) rather than new text? Compared without punctuation/whitespace:
 * one is a prefix of the other, or they share a common prefix (rule 3's threshold), or `last`
 * is within a few edits of the start of `next`.
 * @param {string} last
 * @param {string} next
 */
function isRevision(last, next) {
  const a = comparable(last);
  const b = comparable(next);
  if (!b) return false; // only punctuation became visible: let rule 6 append it
  if (!a) return true; // the old text was only punctuation
  if (b.startsWith(a) || a.startsWith(b)) return true;
  if (commonPrefixLen(a, b) >= Math.min(8, 0.5 * Math.min(a.length, b.length))) return true;
  if (a.length > MAX_ALIGN_LEN) return false;
  const tol = reviseTolerance(a.length);
  return prefixAlign(a, b, tol).dist <= tol;
}

/**
 * Concatenate two caption fragments. A single space is inserted only between two non-CJK
 * word characters (letters/digits), or after Latin sentence punctuation (`,.!?;:`) followed by a
 * non-CJK word character. CJK text is joined without spaces.
 *
 *     joinText('我先', 'review')  === '我先review'
 *     joinText('review', '一下')  === 'review一下'
 *     joinText('hello', 'world')  === 'hello world'
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
export function joinText(a, b) {
  const left = a ?? '';
  const right = b ?? '';
  if (!left) return right;
  if (!right) return left;
  const l = lastChar(left);
  const r = firstChar(right);
  if (isWordChar(r) && (isWordChar(l) || LATIN_PUNCT_RE.test(l))) return `${left} ${right}`;
  return left + right;
}

/**
 * Merge the newly visible text of a block into its accumulated text.
 * Invariant: `acc` ends with `last` (the previously visible text); the result ends with `next`.
 *
 * 1. `next === last` (or `next` empty) → `acc`.
 * 2. `last === ''` → `joinText(acc, next)`.
 * 3. common prefix of last/next ≥ min(8, 0.5·min(len)) → revision/extension in place.
 * 4. rolled window: largest k in [6, 400] with `last.endsWith(next.slice(0, k))` → `acc + next.slice(k)`.
 * 5. `j = last.indexOf(next.slice(0, 12))` (head of at least 6 chars), j ≥ 0 → re-anchor at j.
 * 5b. (deviation from spec 5.11) `next` is `last` revised near its start — compared without
 *    punctuation/whitespace/case: a prefix either way, a common prefix as in rule 3, or within
 *    max(2, |last|/4) edits of the start of `next` → in place, like rule 3. Without it a
 *    corrected first character or a comma after the first word ('好那我們開始' →
 *    '好，那我們開始吧') fell through to rule 6 and the sentence was transcribed twice.
 * 6. otherwise → `joinText(acc, next)`.
 * @param {string} acc
 * @param {string} last
 * @param {string} next
 * @returns {string}
 */
export function mergeVisible(acc, last, next) {
  const A = acc ?? '';
  const L = last ?? '';
  const N = next ?? '';
  if (N === L || N === '') return A;
  if (L === '') return joinText(A, N);
  const before = A.slice(0, Math.max(0, A.length - L.length));
  const cp = commonPrefixLen(L, N);
  if (cp >= Math.min(8, 0.5 * Math.min(L.length, N.length))) return before + N;
  for (let k = Math.min(400, L.length, N.length); k >= 6; k--) {
    if (L.endsWith(N.slice(0, k))) return A + N.slice(k);
  }
  const head = N.slice(0, 12);
  if (head.length >= 6) {
    const j = L.indexOf(head);
    if (j >= 0) return before + L.slice(0, j) + N;
  }
  if (isRevision(L, N)) return before + N;
  return joinText(A, N);
}

/**
 * Does `next` (text of a newly appeared element) look like a re-render continuing `last`?
 * Spec rules: starts with the tail (last 12 chars) of `last`, or equals a prefix of it.
 * Extended: same text / extension, or starts anywhere inside `last` (≥ 6-char anchor).
 * A prefix must be substantial (≥ max(6, half of `last`)), so a short new utterance that
 * happens to start like the previous one ("好" vs "好的，我們開始") is not swallowed.
 * @param {string} last
 * @param {string} next
 */
function continues(last, next) {
  if (!last || !next) return false;
  if (next.startsWith(last)) return true;
  const tail = last.slice(-12).trimStart();
  if (tail && next.startsWith(tail)) return true;
  const head = next.slice(0, 12);
  if (head.length < 6) return false;
  const j = last.indexOf(head);
  if (j < 0) return false;
  if (j > 0 || next.length >= last.length) return true;
  return next.length >= Math.min(last.length, Math.max(6, Math.ceil(last.length / 2)));
}

/**
 * Remove the part of `acc` that was already emitted (for a block that changed after it had
 * been finalized, or a re-render of an already finalized block).
 *
 * When Meet revised the already emitted text in place (a character inserted, punctuation
 * added), the emitted text is aligned against the start of `acc` with a small edit distance
 * and only what lies beyond it is kept. A remainder without any letter/digit (an added '。')
 * is not new speech and yields ''.
 * @param {string} acc
 * @param {string} emitted
 */
function stripEmitted(acc, emitted) {
  if (!emitted) return acc;
  let rest;
  if (acc.startsWith(emitted)) {
    rest = acc.slice(emitted.length);
  } else {
    const tol = reviseTolerance(emitted.length);
    const aligned = emitted.length <= MAX_ALIGN_LEN ? prefixAlign(emitted, acc, tol) : { dist: Infinity, end: 0 };
    if (aligned.dist <= tol) {
      rest = acc.slice(aligned.end);
    } else if (commonPrefixLen(acc, emitted) >= Math.min(8, 0.5 * Math.min(acc.length, emitted.length))) {
      // heavily revised tail: keep only what goes beyond the emitted length
      rest = acc.length > emitted.length ? acc.slice(emitted.length) : '';
    } else {
      return acc;
    }
  }
  return WORD_RE.test(rest) ? rest : '';
}

/**
 * @typedef {object} Entry
 * @property {string} key
 * @property {string} speaker
 * @property {string} acc
 * @property {string} last
 * @property {number} startMs
 * @property {number} lastChangeMs
 * @property {number|null} goneSinceMs
 * @property {number} lastSeenMs
 * @property {number} seq
 * @property {string|null} emittedPrefix
 */

/**
 * @typedef {object} DoneRecord
 * @property {string} key
 * @property {string} speaker
 * @property {string} last
 * @property {number} seq
 * @property {number} lastSeenMs
 * @property {boolean} consumed
 */

export class CaptionAssembler {
  /**
   * @param {{ finalizeMs?: number, goneSettleMs?: number, rematchMs?: number }} [opts]
   *   finalizeMs: unchanged this long while a newer block exists → finalize;
   *   goneSettleMs: absent from snapshots this long → finalize;
   *   rematchMs: window in which a new element can continue a recent block of the same speaker.
   */
  constructor({ finalizeMs = 4000, goneSettleMs = 1500, rematchMs = 10000 } = {}) {
    this.finalizeMs = finalizeMs;
    this.goneSettleMs = goneSettleMs;
    this.rematchMs = rematchMs;
    /** @type {Map<string, Entry>} active (not yet finalized) blocks by element id */
    this._active = new Map();
    /** @type {Map<string, DoneRecord>} finalized blocks, kept to ignore/continue them */
    this._done = new Map();
    this._seq = 0;
    /** @type {Utterance|null} */
    this._lastEmitted = null;
  }

  /**
   * Feed one caption snapshot. `null` (region missing) behaves like an empty snapshot.
   * @param {CaptionBlock[]|null|undefined} blocks
   * @param {number} [now]
   * @returns {Utterance[]} utterances finalized by this call
   */
  update(blocks, now = Date.now()) {
    /** @type {Map<string, { key: string, speaker: string, text: string }>} */
    const present = new Map();
    (Array.isArray(blocks) ? blocks : []).forEach((b, i) => {
      if (!b || typeof b !== 'object') return;
      const text = clean(b.text);
      if (!text) return;
      const key = b.id === undefined || b.id === null ? `#${i}` : String(b.id);
      if (!present.has(key)) present.set(key, { key, speaker: clean(b.speaker), text });
    });

    for (const e of this._active.values()) {
      if (!present.has(e.key) && e.goneSinceMs === null) e.goneSinceMs = now;
    }
    for (const r of this._done.values()) {
      if (present.has(r.key)) r.lastSeenMs = now;
    }

    for (const blk of present.values()) {
      const active = this._active.get(blk.key);
      if (active) {
        this._apply(active, blk, now);
        continue;
      }
      const done = this._done.get(blk.key);
      if (done) {
        if (blk.text !== done.last) this._apply(this._resurrect(done, blk.key, now), blk, now);
        continue;
      }
      const match = this._findRematch(blk, present, now);
      if (match && 'acc' in match) {
        this._active.delete(match.key);
        match.key = blk.key;
        this._active.set(blk.key, match);
        this._apply(match, blk, now);
      } else if (match) {
        this._apply(this._resurrect(match, blk.key, now), blk, now);
      } else {
        /** @type {Entry} */
        const e = {
          key: blk.key,
          speaker: blk.speaker,
          acc: '',
          last: '',
          startMs: now,
          lastChangeMs: now,
          goneSinceMs: null,
          lastSeenMs: now,
          seq: ++this._seq,
          emittedPrefix: null,
        };
        this._active.set(blk.key, e);
        this._apply(e, blk, now);
      }
    }
    return this.tick(now);
  }

  /**
   * Time-based finalization (call periodically even without new snapshots).
   * @param {number} [now]
   * @returns {Utterance[]}
   */
  tick(now = Date.now()) {
    /** @type {Utterance[]} */
    const out = [];
    for (const e of this._sortedActive()) {
      const gone = e.goneSinceMs !== null && now - e.goneSinceMs >= this.goneSettleMs;
      const stale = now - e.lastChangeMs >= this.finalizeMs && e.seq < this._seq;
      if (gone || stale) this._finalize(e, out);
    }
    this._prune(now);
    return sortUtterances(out);
  }

  /**
   * Finalize every active block (end of meeting).
   * @param {number} [now]
   * @returns {Utterance[]}
   */
  flush(now = Date.now()) {
    /** @type {Utterance[]} */
    const out = [];
    for (const e of this._sortedActive()) this._finalize(e, out);
    this._prune(now);
    return sortUtterances(out);
  }

  /** @returns {Entry[]} */
  _sortedActive() {
    return [...this._active.values()].sort((a, b) => a.seq - b.seq);
  }

  /**
   * @param {Entry} e
   * @param {{ speaker: string, text: string }} blk
   * @param {number} now
   */
  _apply(e, blk, now) {
    e.goneSinceMs = null;
    e.lastSeenMs = now;
    if (!e.speaker && blk.speaker) e.speaker = blk.speaker;
    if (blk.text !== e.last) {
      e.acc = mergeVisible(e.acc, e.last, blk.text);
      e.last = blk.text;
      e.lastChangeMs = now;
    }
  }

  /**
   * Continue a finalized block: only text beyond what was already emitted will be emitted.
   * @param {DoneRecord} rec
   * @param {string} key
   * @param {number} now
   * @returns {Entry}
   */
  _resurrect(rec, key, now) {
    if (rec.key === key) this._done.delete(key);
    else rec.consumed = true;
    /** @type {Entry} */
    const e = {
      key,
      speaker: rec.speaker,
      acc: rec.last,
      last: rec.last,
      startMs: now,
      lastChangeMs: now,
      goneSinceMs: null,
      lastSeenMs: now,
      seq: rec.seq,
      emittedPrefix: rec.last,
    };
    this._active.set(key, e);
    return e;
  }

  /**
   * Find a recently seen, currently absent block of the same speaker that the new element
   * continues (Meet re-rendered the row). Most recently seen wins.
   * @param {{ key: string, speaker: string, text: string }} blk
   * @param {Map<string, unknown>} present
   * @param {number} now
   * @returns {Entry|DoneRecord|null}
   */
  _findRematch(blk, present, now) {
    /** @type {Entry|DoneRecord|null} */
    let best = null;
    /** @param {Entry|DoneRecord} c */
    const consider = (c) => {
      if (present.has(c.key) || c.speaker !== blk.speaker) return;
      if (now - c.lastSeenMs > this.rematchMs) return;
      if (!continues(c.last, blk.text)) return;
      if (!best || c.lastSeenMs > best.lastSeenMs || (c.lastSeenMs === best.lastSeenMs && c.seq > best.seq)) best = c;
    };
    for (const e of this._active.values()) consider(e);
    for (const r of this._done.values()) {
      // A short finalized row ("嗯", "好的") is continued only by an identical re-render;
      // otherwise a new utterance starting the same way would lose its first word.
      if (!r.consumed && (r.last.length >= 6 || r.last === blk.text)) consider(r);
    }
    return best;
  }

  /**
   * @param {Entry} e
   * @param {Utterance[]} out
   */
  _finalize(e, out) {
    this._active.delete(e.key);
    this._done.set(e.key, {
      key: e.key,
      speaker: e.speaker,
      last: e.last,
      seq: e.seq,
      lastSeenMs: e.lastSeenMs,
      consumed: false,
    });
    const text = clean(e.emittedPrefix !== null ? stripEmitted(e.acc, e.emittedPrefix) : e.acc);
    if (!text) return;
    /** @type {Utterance} */
    const u = { speaker: e.speaker, text, startMs: e.startMs, endMs: Math.max(e.startMs, e.lastChangeMs) };
    const prev = this._lastEmitted;
    if (prev && prev.speaker === u.speaker && prev.text === u.text && u.startMs - prev.endMs <= DUPLICATE_WINDOW_MS) return;
    this._lastEmitted = u;
    out.push({ ...u });
  }

  /** Forget finalized blocks that have been absent for a long time. @param {number} now */
  _prune(now) {
    const keepMs = Math.max(this.rematchMs, 60_000);
    for (const [key, r] of this._done) if (now - r.lastSeenMs > keepMs) this._done.delete(key);
  }
}

/** @param {Utterance[]} list */
function sortUtterances(list) {
  return list.length > 1 ? list.sort((a, b) => a.startMs - b.startMs) : list;
}
