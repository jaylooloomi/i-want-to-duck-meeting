/**
 * Transcript persistence: append finalized utterances to `transcript.jsonl` and render
 * `transcript.md` (Traditional Chinese labels, local times).
 * @module transcript/store
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { joinText } from '../captions/assembler.js';

/**
 * One line of transcript.jsonl.
 * @typedef {object} TranscriptRecord
 * @property {string} t0       ISO start time
 * @property {string} t1       ISO end time
 * @property {string} speaker
 * @property {string} text
 * @property {string} source   'captions' (or e.g. 'whisper')
 */

/**
 * Accepted utterance shapes: assembler `{ speaker, text, startMs, endMs }` or a stored
 * record `{ t0, t1, speaker, text }` (times as ISO string, Date or epoch ms).
 * @typedef {{ speaker?: string, text?: string, startMs?: number|string|Date, endMs?: number|string|Date,
 *   t0?: number|string|Date, t1?: number|string|Date, source?: string }} UtteranceLike
 */

const MERGE_GAP_MS = 30_000;
const EMPTY_MESSAGE = '（沒有擷取到任何字幕）';
const UNKNOWN_SPEAKER = '（未知）';

/**
 * @param {unknown} v
 * @returns {number|null} epoch ms or null
 */
function toMs(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Date.parse(String(v));
  return Number.isNaN(n) ? null : n;
}

/** @param {unknown} v @param {number} [fallback] */
function toIso(v, fallback = Date.now()) {
  return new Date(toMs(v) ?? fallback).toISOString();
}

export class TranscriptStore {
  /**
   * Opens (and reloads, if present) `<dir>/transcript.jsonl`.
   * @param {string} dir meeting directory (created if missing)
   * @param {{ code?: string, startedAt?: string|number|Date }} [meta]
   */
  constructor(dir, { code = '', startedAt = new Date(), sourceLabel = 'Google Meet 即時字幕' } = {}) {
    this.dir = dir;
    this.code = code;
    this.sourceLabel = sourceLabel;
    this.startedAt = toIso(startedAt);
    this.jsonlPath = join(dir, 'transcript.jsonl');
    this.mdPath = join(dir, 'transcript.md');
    mkdirSync(dir, { recursive: true });
    /** @type {TranscriptRecord[]} */
    this._records = [];
    /** @type {string[]} */
    this._speakers = [];
    for (const rec of readJsonl(this.jsonlPath)) this._remember(rec);
  }

  /**
   * Append one utterance as a JSON line `{ t0, t1, speaker, text, source: 'captions' }`.
   * Utterances with empty text are ignored.
   * @param {UtteranceLike} utterance
   * @returns {TranscriptRecord|null} the stored record
   */
  append(utterance) {
    const text = String(utterance?.text ?? '').trim();
    if (!text) return null;
    const startMs = toMs(utterance.t0 ?? utterance.startMs) ?? Date.now();
    /** @type {TranscriptRecord} */
    const rec = {
      t0: toIso(startMs),
      t1: toIso(utterance.t1 ?? utterance.endMs, startMs),
      speaker: String(utterance.speaker ?? ''),
      text,
      source: utterance.source || 'captions',
    };
    appendFileSync(this.jsonlPath, `${JSON.stringify(rec)}\n`, 'utf8');
    this._remember(rec);
    return rec;
  }

  /** Number of stored utterances. */
  replaceAll(records) {
    this._records = []; this._speakers = [];
    for (const rec of records) this._remember({...rec});
    const tmp = this.jsonlPath + '.tmp';
    writeFileSync(tmp, this._records.map(r=>JSON.stringify(r)+'\n').join(''), 'utf8');
    renameSync(tmp, this.jsonlPath);
  }

  get count() {
    return this._records.length;
  }

  /** Unique non-empty speakers in first-seen order (a copy). */
  get speakers() {
    return [...this._speakers];
  }

  /** Stored records (copies), in append order. */
  get utterances() {
    return this._records.map((r) => ({ ...r }));
  }

  /**
   * Render transcript.md from all stored utterances and write it next to the jsonl.
   * @param {{ endedAt?: string|number|Date|null, captionLang?: string, extraNote?: string, timeZone?: string }} [opts]
   *   timeZone: IANA zone for displayed times (default: the process' local zone)
   * @returns {string} the markdown
   */
  renderMarkdown({ endedAt = null, captionLang, extraNote, timeZone } = {}) {
    const md = renderTranscriptMd({
      code: this.code,
      sourceLabel: this.sourceLabel,
      startedAt: this.startedAt,
      endedAt,
      utterances: this._records,
      captionLang,
      extraNote,
      timeZone,
    });
    const tmp = `${this.mdPath}.tmp`;
    writeFileSync(tmp, md, 'utf8');
    renameSync(tmp, this.mdPath);
    return md;
  }

  /** @param {TranscriptRecord} rec */
  _remember(rec) {
    this._records.push(rec);
    if (rec.speaker && !this._speakers.includes(rec.speaker)) this._speakers.push(rec.speaker);
  }
}

/**
 * Read transcript.jsonl records, skipping blank or corrupt lines.
 * @param {string} path
 * @returns {TranscriptRecord[]}
 */
function readJsonl(path) {
  if (!existsSync(path)) return [];
  /** @type {TranscriptRecord[]} */
  const out = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r === 'object' && typeof r.text === 'string' && r.text.trim()) {
        out.push({
          t0: toIso(r.t0),
          t1: toIso(r.t1 ?? r.t0),
          speaker: String(r.speaker ?? ''),
          text: r.text,
          source: r.source || 'captions',
        });
      }
    } catch {
      // partial line from a crash mid-write: ignore
    }
  }
  return out;
}

/**
 * Local-time formatter (Intl, 24 h). `timeZone` undefined → process local zone (honours TZ).
 * @param {string|undefined} timeZone
 */
function makeClock(timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  /** @param {number} ms */
  const parts = (ms) => {
    /** @type {Record<string, string>} */
    const p = {};
    for (const { type, value } of dtf.formatToParts(new Date(ms))) p[type] = value;
    return p;
  };
  return {
    /** @param {number} ms @returns {string} YYYY-MM-DD */
    date: (ms) => {
      const p = parts(ms);
      return `${p.year}-${p.month}-${p.day}`;
    },
    /** @param {number} ms @returns {string} HH:mm */
    hm: (ms) => {
      const p = parts(ms);
      return `${p.hour}:${p.minute}`;
    },
    /** @param {number} ms @returns {string} HH:mm:ss */
    hms: (ms) => {
      const p = parts(ms);
      return `${p.hour}:${p.minute}:${p.second}`;
    },
  };
}

/**
 * Render transcript.md.
 *
 *     # 會議逐字稿 — abc-defg-hij
 *
 *     - 時間：2026-10-04 22:15 – 23:02（47 分鐘）
 *     - 發言者：王小明、Arthur
 *     - 來源：Google Meet 即時字幕（cmn-Hant-TW）
 *
 *     **[22:15:30] 王小明：** 大家好，今天討論…
 *
 * Utterances are shown in chronological order; consecutive utterances by the same speaker
 * whose gap (next start − previous end) is < 30 s are merged into one paragraph (first
 * timestamp, texts joined with joinText). An optional `extraNote` adds a `- 備註：` line.
 * With no utterances the header is followed by `（沒有擷取到任何字幕）`.
 * Times are local `HH:mm:ss` (or in `timeZone` when given).
 * @param {{ code?: string, startedAt?: string|number|Date|null, endedAt?: string|number|Date|null,
 *   utterances?: UtteranceLike[], captionLang?: string, extraNote?: string, timeZone?: string }} params
 * @returns {string}
 */
export function renderTranscriptMd({ code = '', startedAt = null, endedAt = null, utterances = [], captionLang, extraNote, timeZone, sourceLabel = 'Google Meet 即時字幕' } = {}) {
  const clock = makeClock(timeZone);
  const items = (Array.isArray(utterances) ? utterances : [])
    .map((u) => {
      const t0 = toMs(u?.t0 ?? u?.startMs);
      const t1 = toMs(u?.t1 ?? u?.endMs) ?? t0;
      return { t0, t1, speaker: String(u?.speaker ?? ''), text: String(u?.text ?? '').trim() };
    })
    .filter((u) => u.text && u.t0 !== null)
    .map((u) => ({ ...u, t0: /** @type {number} */ (u.t0), t1: /** @type {number} */ (u.t1) }))
    .sort((a, b) => a.t0 - b.t0);

  const start = toMs(startedAt) ?? (items.length ? items[0].t0 : null);
  const end = toMs(endedAt) ?? (items.length ? items.reduce((m, u) => Math.max(m, u.t1), -Infinity) : null);

  let when = '（未知）';
  if (start !== null) {
    when = `${clock.date(start)} ${clock.hm(start)}`;
    if (end !== null && end >= start) {
      const endText = clock.date(end) === clock.date(start) ? clock.hm(end) : `${clock.date(end)} ${clock.hm(end)}`;
      when += ` – ${endText}（${Math.round((end - start) / 60_000)} 分鐘）`;
    }
  }

  /** @type {string[]} */
  const speakers = [];
  for (const u of items) if (u.speaker && !speakers.includes(u.speaker)) speakers.push(u.speaker);

  const lines = [
    `# 會議逐字稿 — ${code}`,
    '',
    `- 時間：${when}`,
    `- 發言者：${speakers.length ? speakers.join('、') : '（無）'}`,
    `- 來源：${sourceLabel}（${captionLang || 'unknown'}）`,
  ];
  if (extraNote) lines.push(`- 備註：${extraNote}`);
  lines.push('');

  if (!items.length) {
    lines.push(EMPTY_MESSAGE);
    return `${lines.join('\n')}\n`;
  }

  /** @type {{ speaker: string, t0: number, lastEnd: number, text: string }[]} */
  const paragraphs = [];
  for (const u of items) {
    const p = paragraphs[paragraphs.length - 1];
    if (p && p.speaker === u.speaker && u.t0 - p.lastEnd < MERGE_GAP_MS) {
      p.text = joinText(p.text, u.text);
      p.lastEnd = Math.max(p.lastEnd, u.t1);
    } else {
      paragraphs.push({ speaker: u.speaker, t0: u.t0, lastEnd: u.t1, text: u.text });
    }
  }
  for (const p of paragraphs) {
    lines.push(`**[${clock.hms(p.t0)}] ${p.speaker || UNKNOWN_SPEAKER}：** ${p.text}`, '');
  }
  lines.pop();
  return `${lines.join('\n')}\n`;
}
