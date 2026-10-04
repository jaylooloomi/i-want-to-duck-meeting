/**
 * `openmeeting <command>` implementations (spec 5.15). bin/openmeeting.js only forwards argv.
 *
 * Machine-readable output is `KEY=VALUE` lines on stdout (MEETING_ID=, MEETING_DIR=, STATE=,
 * RESULT=, TRANSCRIPT=, UTTERANCES=, ERROR=, ...); everything else is short zh-TW text for
 * humans. Heavy modules (Playwright, the session) are imported lazily so the polling commands
 * start fast.
 * @module cli
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { getConfig } from './config.js';
import { parseMeetUrl } from './url.js';
import {
  createMeetingDir, isProcessAlive, listMeetings, newMeetingId, readStatus, resolveMeeting, writeStatus,
} from './status.js';
import { TranscriptStore, renderTranscriptMd } from './transcript/store.js';
import { runTranscribe, setupStt, sttAvailable, sttPython } from './stt.js';

const TERMINAL = ['done', 'failed'];
const LOGIN_URL = 'https://accounts.google.com/';
const WAIT_POLL_MS = 2000;
const LEAVE_TIMEOUT_S = 30;
/** A 'starting' status with no worker pid this old is considered dead. */
const ORPHAN_STARTING_MS = 60_000;
/**
 * The worker refreshes status.json `heartbeatAt` every 15 s. A heartbeat this old means the
 * worker is gone even if its pid is "alive" (Windows reuses pids quickly after a hard kill,
 * logoff or reboot).
 */
export const HEARTBEAT_STALE_MS = 3 * 60_000;
/**
 * `wait` must also have seen the heartbeat unchanged for this long itself before calling the
 * worker dead: after the PC wakes from sleep the heartbeat is old for a few seconds, until the
 * (equally suspended) worker refreshes it. Env override OPENMEETING_HEARTBEAT_CONFIRM_MS (tests).
 */
const HEARTBEAT_CONFIRM_MS = 60_000;
/** `join` exit code when another meeting is still being recorded. */
const EXIT_ALREADY_RECORDING = 5;

/** Flags that take a value (`--name X` or `--name=X`). */
const VALUE_FLAGS = new Set(['name', 'lang', 'timeout-min', 'model', 'threads', 'poll-ms', 'timeout-sec']);
/** Boolean flags. */
const BOOL_FLAGS = new Set(['foreground', 'help']);

const STATE_TEXT = {
  starting: '準備啟動機器人…',
  launching: '正在啟動機器人的 Chrome…',
  joining: '正在加入會議…',
  waiting_admission: '正在等待主持人允許加入（請在 Meet 裡按「允許」；若出現「潛在風險」提示，請用 ⋮ → 允許 (Admit)）…',
  in_call: '機器人已進入會議，正在記錄字幕。',
  leaving: '正在離開會議並整理逐字稿…',
  transcribing: '沒有擷取到字幕，正在用 Whisper 轉錄錄音（可能需要數分鐘）…',
  done: '會議記錄完成。',
  failed: '機器人未能完成記錄。',
};

const ERROR_TEXT = {
  signin_required: '需要登入 Google：請執行 login，由你自己在視窗中登入機器人專用帳號',
  not_found: '找不到這場會議（連結錯誤或已過期）',
  blocked: 'Google 不讓機器人加入（訪客常被擋；可先 login 再試）',
  denied: '加入請求被拒絕（請主持人用 ⋮ → 允許）',
  lobby_timeout: '等待太久，沒有人允許機器人加入',
  chrome_not_found: '找不到 Google Chrome（安裝 Chrome 或設定 CHROME_PATH）',
  chrome_launch_failed: 'Chrome 無法啟動（機器人的設定檔可能正被另一個視窗使用）',
  join_failed: '加入流程失敗（Meet 介面可能改版，請看 bot.log 與 screens/）',
  crashed: '背景程式意外結束（請看 bot.log、worker.out）',
};

const END_REASON_TEXT = {
  meeting_ended: '會議結束',
  removed: '被移出會議',
  alone: '其他人都離開了',
  no_one_joined: '一直沒有其他人加入',
  max_duration: '達到最長記錄時間',
  user_stop: '依要求離開',
  signal: '程式被中止',
  page_closed: '機器人視窗被關閉',
};

const USAGE = `openmeeting — Google Meet 靜音記錄機器人

用法：openmeeting <指令> [參數]

  join <連結> [--name 名稱] [--lang 代碼] [--foreground]   加入會議（背景執行），印出 MEETING_ID= / MEETING_DIR=（已有會議在記錄時結束碼 5）
  wait <id|latest> [--timeout-min N]                      等到會議結束（結束碼 0 有逐字稿／2 沒字幕／3 失敗／4 逾時）
  status [id|latest]                                      印出 status.json
  list                                                    列出所有會議（新到舊）
  leave [id|latest]                                       要求機器人離開（最多等 30 秒）
  transcript [id|latest]                                  印出逐字稿（進行中也可以）
  login                                                   開啟機器人的 Chrome 讓你自己登入 Google
  doctor                                                  檢查環境
  setup-stt                                               安裝離線語音辨識（uv + Python 3.12 + faster-whisper）
  transcribe <id|latest> [--model M]                      用 Whisper 轉錄 audio.wav`;

/**
 * @typedef {object} Io
 * @property {Record<string, string|undefined>} [env]
 * @property {(line: string) => void} [out]   stdout line writer
 * @property {(line: string) => void} [err]   stderr line writer
 * @property {(o: WorkerSpawn) => number|undefined} [spawnWorker] starts the detached worker, returns its pid
 */

/**
 * @typedef {object} WorkerSpawn
 * @property {string} dir @property {string} url @property {string} code @property {string} id
 * @property {string} displayName @property {string} captionLang
 * @property {Record<string, string|undefined>} env @property {ReturnType<typeof getConfig>} config
 */

/**
 * Parse argv into a command, positionals and flags. Unknown `--flags` are collected in
 * `unknown` (and ignored by the commands).
 * @param {string[]} argv
 * @returns {{ command: string|null, positionals: string[], flags: Record<string, string|boolean>, unknown: string[] }}
 */
export function parseArgs(argv) {
  /** @type {string[]} */
  const positionals = [];
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  /** @type {string[]} */
  const unknown = [];
  let command = null;
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '-h') {
      flags.help = true;
      continue;
    }
    const m = /^--([a-z][a-z0-9-]*)(?:=([\s\S]*))?$/i.exec(a);
    if (m) {
      const name = m[1].toLowerCase();
      if (VALUE_FLAGS.has(name)) {
        if (m[2] !== undefined) flags[name] = m[2];
        else if (i + 1 < argv.length) flags[name] = String(argv[++i]);
        else unknown.push(a);
      } else if (BOOL_FLAGS.has(name)) {
        flags[name] = true;
      } else {
        unknown.push(a);
      }
      continue;
    }
    if (command === null) command = a.toLowerCase();
    else positionals.push(a);
  }
  return { command, positionals, flags, unknown };
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** @param {unknown} v @param {number} fallback */
function num(v, fallback) {
  if (v === undefined || v === null || v === true || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Terminal display width (CJK / full-width characters take two columns). @param {string} s */
function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  return w;
}

/** Pad to a display width. @param {string} s @param {number} width */
function padDisplay(s, width) {
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

/** Fresh stats object for a new status.json. */
function emptyStats() {
  return { utterances: 0, speakers: [], audioSeconds: 0, captionLang: 'unknown', captionsOn: false };
}

/**
 * Age of the worker's heartbeat in ms, or null when the status has none.
 * @param {Record<string, any>|null} status
 * @param {number} [now]
 */
function heartbeatAgeMs(status, now = Date.now()) {
  const t = Date.parse((status && status.heartbeatAt) || '');
  return Number.isFinite(t) ? now - t : null;
}

/**
 * If the worker died without writing a terminal state, mark the meeting failed/crashed.
 * Dead = its pid is gone; or (only when the caller has watched the heartbeat itself, see
 * `heartbeatSilentForMs`) its heartbeat is older than {@link HEARTBEAT_STALE_MS} and did not
 * change for `confirmMs` of the caller's own observation (pid reused by another process).
 * @param {string} dir
 * @param {Record<string, any>|null} status
 * @param {{ heartbeatSilentForMs?: number, confirmMs?: number }} [opts]
 *   heartbeatSilentForMs: how long the caller has seen the same `heartbeatAt` value
 * @returns {Record<string, any>|null}
 */
export function reconcileStatus(dir, status, { heartbeatSilentForMs, confirmMs = HEARTBEAT_CONFIRM_MS } = {}) {
  if (!status || TERMINAL.includes(status.state)) return status;
  const pid = status.pid;
  let dead = false;
  let why = '';
  const hbAge = heartbeatAgeMs(status);
  if (typeof pid === 'number' && pid > 0) {
    dead = !isProcessAlive(pid);
    why = `the bot process (pid ${pid}) is no longer running`;
    if (!dead && hbAge !== null && hbAge > HEARTBEAT_STALE_MS
      && typeof heartbeatSilentForMs === 'number' && heartbeatSilentForMs >= confirmMs) {
      dead = true;
      why = `no heartbeat from the bot process (pid ${pid}) for ${Math.round(hbAge / 60_000)} min (it is gone; the pid now belongs to another process or the worker hung)`;
    }
  } else if (status.state === 'starting') {
    const age = Date.now() - Date.parse(status.updatedAt || status.startedAt || '');
    dead = Number.isFinite(age) && age > ORPHAN_STARTING_MS;
    why = 'the bot process never started';
  }
  if (!dead) return status;
  const again = readStatus(dir); // it may have finished between our read and the pid check
  if (again && TERMINAL.includes(again.state)) return again;
  try {
    return writeStatus(dir, {
      state: 'failed', endedAt: new Date().toISOString(), error: { code: 'crashed', message: why },
    });
  } catch {
    return status;
  }
}

/** Number of utterances: transcript.jsonl lines when present, else stats.utterances. */
function countUtterances(dir, status) {
  const file = path.join(dir, 'transcript.jsonl');
  try {
    const n = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).length;
    return n;
  } catch {
    const s = status && status.stats && status.stats.utterances;
    return typeof s === 'number' ? s : 0;
  }
}

/**
 * Print the terminal result block and return the `wait` exit code (0 / 2 / 3).
 * @param {(line: string) => void} out
 * @param {string} dir
 * @param {Record<string, any>} status
 * @returns {number}
 */
function printResult(out, dir, status) {
  const transcript = path.join(dir, 'transcript.md');
  const whisper = path.join(dir, 'transcript-whisper.md');
  const n = countUtterances(dir, status);
  const errCode = (status.error && status.error.code) || '';
  out(`RESULT=${status.state}`);
  out(`END_REASON=${status.endReason || ''}`);
  out(`TRANSCRIPT=${fs.existsSync(transcript) ? transcript : ''}`);
  out(`UTTERANCES=${n}`);
  out(`ERROR=${errCode}`);
  if (fs.existsSync(whisper)) out(`TRANSCRIPT_WHISPER=${whisper}`);
  out(`MEETING_DIR=${dir}`);
  if (status.state === 'failed') {
    const msg = status.error && status.error.message ? `（${String(status.error.message).split('\n')[0]}）` : '';
    out(`失敗：${ERROR_TEXT[errCode] || errCode || '未知錯誤'}${msg}`);
    return 3;
  }
  const reason = END_REASON_TEXT[status.endReason] || status.endReason || '';
  if (n > 0) {
    const speakers = (status.stats && Array.isArray(status.stats.speakers)) ? status.stats.speakers : [];
    out(`記錄完成（${reason}）：${n} 段發言${speakers.length ? `，發言者：${speakers.join('、')}` : ''}。逐字稿：${transcript}`);
    return 0;
  }
  out(`會議已結束（${reason}），但沒有擷取到任何字幕。`);
  return 2;
}

/**
 * Default worker launcher: `node src/worker.js --dir <dir> ...`, detached, hidden, stdio →
 * `<dir>/worker.out`, unref'd.
 * @param {WorkerSpawn} o
 * @returns {number|undefined} pid
 */
export function spawnWorker({ dir, url, code, id, displayName, captionLang, env, config }) {
  const workerPath = path.join(config.repoRoot, 'src', 'worker.js');
  const fd = fs.openSync(path.join(dir, 'worker.out'), 'a');
  try {
    const child = spawn(process.execPath, [
      workerPath, `--dir=${dir}`, `--url=${url}`, `--code=${code}`, `--id=${id}`, `--name=${displayName}`, `--lang=${captionLang}`,
    ], { detached: true, stdio: ['ignore', fd, fd], windowsHide: true, env: /** @type {any} */ (env) });
    child.on('error', () => {});
    child.unref();
    return child.pid;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Chrome command line for `login`: the bot profile at accounts.google.com, NO remote
 * debugging port (nothing automates this window), not headless, audio not muted.
 * @param {{ profileDir: string, chromeArgs: (o: any) => string[] }} o
 * @returns {string[]}
 */
export function loginArgs({ profileDir, chromeArgs }) {
  return [
    ...chromeArgs({ profileDir, port: 0, headless: false, muteAudio: false })
      .filter((a) => !a.startsWith('--remote-debugging-port')),
    LOGIN_URL,
  ];
}

/** win32: a running Chrome holds `<profile>\lockfile` open, so opening it fails with EBUSY. */
function profileInUse(profileDir) {
  if (process.platform !== 'win32') return false;
  let fd;
  try {
    fd = fs.openSync(path.join(profileDir, 'lockfile'), 'r+');
    return false;
  } catch (e) {
    return /** @type {any} */ (e).code === 'EBUSY';
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Hint whether the bot profile has a Google account signed in (never returns the address). */
function signedInHint(profileDir) {
  try {
    const prefs = JSON.parse(fs.readFileSync(path.join(profileDir, 'Default', 'Preferences'), 'utf8'));
    const accounts = Array.isArray(prefs.account_info) ? prefs.account_info.length : 0;
    return accounts > 0 ? accounts : 0;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// commands

/**
 * @typedef {object} Ctx
 * @property {Record<string, string|undefined>} env
 * @property {(line: string) => void} out
 * @property {(line: string) => void} err
 * @property {ReturnType<typeof getConfig>} config
 * @property {(o: WorkerSpawn) => number|undefined} spawnWorker
 */

/** @param {Ctx} ctx @param {string|undefined} which */
function findMeeting(ctx, which) {
  const m = resolveMeeting(ctx.config.meetingsDir, which || 'latest');
  if (!m) ctx.err(`找不到會議：${which || 'latest'}（會議資料夾：${ctx.config.meetingsDir}）`);
  return m;
}

/** @param {Ctx} ctx @param {string[]} pos @param {Record<string, any>} flags */
async function cmdJoin(ctx, pos, flags) {
  const { out, err, config } = ctx;
  const input = pos.join(' ').trim();
  if (!input) {
    err('用法：openmeeting join <Google Meet 連結> [--name 名稱] [--lang 代碼] [--foreground]');
    out('ERROR=not_a_meet_url');
    return 1;
  }
  let parsed;
  try {
    parsed = parseMeetUrl(input, { allowAnyHost: config.allowAnyHost });
  } catch {
    err(`這不是有效的 Google Meet 連結：${input}`);
    err('請貼上像 https://meet.google.com/abc-defg-hij 這樣的連結或會議代碼。');
    out('ERROR=not_a_meet_url');
    return 1;
  }
  const displayName = typeof flags.name === 'string' && flags.name.trim() ? flags.name.trim() : config.displayName;
  const captionLang = typeof flags.lang === 'string' && flags.lang.trim() ? flags.lang.trim() : config.captionLang;

  // One bot profile = one meeting at a time: a second worker could only fail (profile locked)
  // and would become `latest`, hiding the real recording from `leave latest` / `transcript latest`.
  const active = listMeetings(config.meetingsDir).find((m) => {
    const st = reconcileStatus(m.dir, m.status);
    if (!st || TERMINAL.includes(st.state)) return false;
    const hbAge = heartbeatAgeMs(st);
    if (hbAge !== null && hbAge > HEARTBEAT_STALE_MS) return false; // worker gone, pid reused
    return typeof st.pid === 'number' ? isProcessAlive(st.pid) : st.state === 'starting';
  });
  if (active) {
    err(`會議 ${active.id} 仍在記錄中；同一時間只能記錄一場會議。要改記錄這場，請先執行 leave ${active.id} 再重試。`);
    out('ERROR=already_recording');
    out(`ACTIVE_MEETING_ID=${active.id}`);
    out(`ACTIVE_MEETING_DIR=${active.dir}`);
    return EXIT_ALREADY_RECORDING;
  }

  const base = newMeetingId(parsed.code);
  let id = base;
  for (let i = 2; fs.existsSync(path.join(config.meetingsDir, id)); i++) id = `${base}-${i}`;
  const dir = createMeetingDir(config.meetingsDir, id);
  writeStatus(dir, {
    id, code: parsed.code, url: parsed.url, displayName, pid: null, state: 'starting',
    startedAt: new Date().toISOString(), joinedAt: null, endedAt: null, endReason: null, error: null, stats: emptyStats(),
  });

  if (flags.foreground) {
    out(`MEETING_ID=${id}`);
    out(`MEETING_DIR=${dir}`);
    out(`DISPLAY_NAME=${displayName}`);
    out('前景模式：機器人在這個視窗執行，按 Ctrl+C 讓它離開會議。');
    const { runSession } = await import('./session.js');
    const final = await runSession({
      url: parsed.url, code: parsed.code, id, dir, displayName, captionLang, config, foreground: true,
    });
    return printResult(out, dir, final);
  }

  let pid;
  try {
    pid = ctx.spawnWorker({ dir, url: parsed.url, code: parsed.code, id, displayName, captionLang, env: ctx.env, config });
  } catch (e) {
    writeStatus(dir, { state: 'failed', endedAt: new Date().toISOString(), error: { code: 'crashed', message: `could not start the worker: ${e && /** @type {any} */ (e).message}` } });
    err(`無法啟動背景機器人：${e && /** @type {any} */ (e).message}`);
    return 1;
  }
  const now = readStatus(dir);
  if (typeof pid === 'number' && now && now.state === 'starting' && !now.pid) writeStatus(dir, { pid });

  out(`MEETING_ID=${id}`);
  out(`MEETING_DIR=${dir}`);
  out(`DISPLAY_NAME=${displayName}`);
  out(`機器人「${displayName}」正在另一個 Chrome 視窗加入會議 ${parsed.code}。`);
  out('請在 Meet 裡允許它加入（若出現「潛在風險」的加入請求，請按 ⋮ → 允許 (Admit)，不要按「拒絕」），並告知與會者會議正在被記錄。');
  out(`等待會議結束：openmeeting wait ${id}`);
  return 0;
}

/** @param {Ctx} ctx @param {string[]} pos @param {Record<string, any>} flags */
async function cmdWait(ctx, pos, flags) {
  const { out } = ctx;
  const m = findMeeting(ctx, pos[0]);
  if (!m) return 1;
  const pollMs = num(flags['poll-ms'], WAIT_POLL_MS) || WAIT_POLL_MS;
  const timeoutMs = flags['timeout-min'] !== undefined ? num(flags['timeout-min'], Infinity) * 60_000 : Infinity;
  const start = Date.now();
  out(`MEETING_ID=${m.id}`);
  out(`MEETING_DIR=${m.dir}`);
  let last = null;
  const confirmMs = num(ctx.env.OPENMEETING_HEARTBEAT_CONFIRM_MS, HEARTBEAT_CONFIRM_MS);
  /** The heartbeat value last seen and since when (our own clock). */
  let hb = { value: /** @type {unknown} */ (undefined), since: Date.now() };
  for (;;) {
    const raw = readStatus(m.dir);
    if (raw && raw.heartbeatAt !== hb.value) hb = { value: raw.heartbeatAt, since: Date.now() };
    const st = reconcileStatus(m.dir, raw, { heartbeatSilentForMs: Date.now() - hb.since, confirmMs });
    if (st && st.state !== last) {
      last = st.state;
      out(`STATE=${st.state}`);
      out(STATE_TEXT[st.state] || st.state);
    }
    if (st && TERMINAL.includes(st.state)) return printResult(out, m.dir, st);
    const left = start + timeoutMs - Date.now();
    if (left <= 0) {
      out('RESULT=timeout');
      out(`STATE=${last || 'unknown'}`);
      out(`UTTERANCES=${countUtterances(m.dir, st)}`);
      out(`MEETING_DIR=${m.dir}`);
      out('等待時間到了，但會議還在進行中。請再執行一次 wait。');
      return 4;
    }
    await sleep(Math.min(pollMs, left));
  }
}

/** @param {Ctx} ctx @param {string[]} pos */
async function cmdStatus(ctx, pos) {
  const m = findMeeting(ctx, pos[0]);
  if (!m) return 1;
  const st = reconcileStatus(m.dir, readStatus(m.dir));
  if (!st) {
    ctx.err(`讀不到 status.json：${m.dir}`);
    return 1;
  }
  ctx.out(JSON.stringify({ ...st, dir: m.dir }, null, 2));
  return 0;
}

/** @param {Ctx} ctx */
async function cmdList(ctx) {
  const items = listMeetings(ctx.config.meetingsDir);
  if (items.length === 0) {
    ctx.out('（還沒有任何會議記錄）');
    return 0;
  }
  const rows = items.map((m) => {
    const st = reconcileStatus(m.dir, m.status);
    return [m.id, st ? String(st.state) : '?', String(countUtterances(m.dir, st))];
  });
  const head = ['ID', 'STATE', 'UTTERANCES'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r) => r.map((c, i) => (i < r.length - 1 ? c.padEnd(w[i]) : c)).join('  ');
  ctx.out(fmt(head));
  for (const r of rows) ctx.out(fmt(r));
  return 0;
}

/** @param {Ctx} ctx @param {string[]} pos @param {Record<string, any>} flags */
async function cmdLeave(ctx, pos, flags) {
  const { out } = ctx;
  const m = findMeeting(ctx, pos[0]);
  if (!m) return 1;
  let st = reconcileStatus(m.dir, readStatus(m.dir));
  out(`MEETING_ID=${m.id}`);
  if (st && TERMINAL.includes(st.state)) {
    out(`STATE=${st.state}`);
    out('這場會議的記錄已經結束了。');
    printResult(out, m.dir, st);
    return 0;
  }
  fs.writeFileSync(path.join(m.dir, 'STOP'), `${new Date().toISOString()}\n`);
  out('STOP_REQUESTED=1');
  out('已要求機器人離開會議，正在等它整理逐字稿…');
  const pollMs = num(flags['poll-ms'], 500) || 500;
  const deadline = Date.now() + num(flags['timeout-sec'], LEAVE_TIMEOUT_S) * 1000;
  for (;;) {
    st = reconcileStatus(m.dir, readStatus(m.dir));
    if (st && TERMINAL.includes(st.state)) {
      out(`STATE=${st.state}`);
      printResult(out, m.dir, st);
      return 0;
    }
    if (Date.now() >= deadline) {
      out(`STATE=${st ? st.state : 'unknown'}`);
      out('機器人還在收尾（例如正在轉錄錄音），稍後可用 status 或 wait 查看結果。');
      return 0;
    }
    await sleep(pollMs);
  }
}

/** @param {Ctx} ctx @param {string[]} pos */
async function cmdTranscript(ctx, pos) {
  const m = findMeeting(ctx, pos[0]);
  if (!m) return 1;
  const st = readStatus(m.dir) || {};
  const md = path.join(m.dir, 'transcript.md');
  const terminal = TERMINAL.includes(st.state);
  if (terminal && fs.existsSync(md)) {
    ctx.out(fs.readFileSync(md, 'utf8').replace(/\s+$/, ''));
    return 0;
  }
  try {
    const store = new TranscriptStore(m.dir, { code: st.code || '', startedAt: st.startedAt || undefined });
    const captionLang = (st.stats && st.stats.captionLang) || undefined;
    const text = terminal
      ? store.renderMarkdown({ endedAt: st.endedAt || null, captionLang })
      : renderTranscriptMd({
        code: st.code || '', startedAt: st.startedAt || null, endedAt: null, utterances: store.utterances, captionLang,
        extraNote: `會議記錄進行中（${st.state || '未知狀態'}），以下是目前為止的內容`,
      });
    ctx.out(text.replace(/\s+$/, ''));
    return 0;
  } catch (e) {
    ctx.err(`無法產生逐字稿：${e && /** @type {any} */ (e).message}`);
    return 1;
  }
}

/** @param {Ctx} ctx */
async function cmdLogin(ctx) {
  const { out, err, config, env } = ctx;
  const { findChrome, chromeArgs } = await import('./chrome.js');
  let exe;
  try {
    exe = findChrome(env);
  } catch {
    err('找不到 Google Chrome。請先安裝 Chrome，或設定環境變數 CHROME_PATH 指向 chrome.exe。');
    return 1;
  }
  fs.mkdirSync(config.profileDir, { recursive: true });
  if (profileInUse(config.profileDir)) {
    err('機器人的 Chrome 設定檔正在使用中（可能有會議正在記錄，或 login 視窗已經開著）。請先關閉那個視窗或等會議結束。');
    return 1;
  }
  out('即將開啟機器人專用的 Chrome 視窗（獨立設定檔，不會碰到你平常的 Chrome）：');
  out('  1. 建議使用另外申請、專門給機器人用的免費 Google 帳號，不要用你的主要帳號。');
  out('  2. 在視窗中自己輸入帳號密碼登入（openmeeting 和 Claude 都不會經手密碼）。');
  out('  3. 建議到 https://myaccount.google.com/language 把該帳號的語言設成 English (United States)，讓 Meet 介面文字穩定。');
  out('  4. 完成後直接關閉這個 Chrome 視窗，這個指令就會結束。');
  out(`PROFILE_DIR=${config.profileDir}`);
  const child = spawn(exe, loginArgs({ profileDir: config.profileDir, chromeArgs }), { stdio: 'ignore', windowsHide: false });
  const code = await new Promise((resolve) => {
    child.once('error', (e) => {
      err(`無法啟動 Chrome：${e.message}`);
      resolve(-1);
    });
    child.once('exit', (c) => resolve(c ?? 0));
  });
  if (code === -1) return 1;
  out('LOGIN_DONE=1');
  out('登入視窗已關閉。之後機器人會用這個設定檔加入會議（可執行 doctor 檢查）。');
  return 0;
}

/** @param {Ctx} ctx */
async function cmdDoctor(ctx) {
  const { out, config, env } = ctx;
  /** @type {[string, 'OK'|'WARN'|'FAIL'|'INFO', string][]} */
  const rows = [];
  let fatal = false;

  const major = Number(process.versions.node.split('.')[0]);
  rows.push(['Node.js', major >= 22 ? 'OK' : 'FAIL', `${process.version}${major >= 22 ? '' : '（需要 22 以上）'}`]);
  if (major < 22) fatal = true;

  const { findChrome } = await import('./chrome.js');
  try {
    const exe = findChrome(env);
    rows.push(['Google Chrome', 'OK', exe]);
  } catch {
    rows.push(['Google Chrome', 'FAIL', '找不到 chrome.exe（安裝 Chrome 或設定 CHROME_PATH）']);
    fatal = true;
  }

  const profileExists = fs.existsSync(config.profileDir);
  rows.push(['機器人設定檔', profileExists ? 'OK' : 'INFO', `${config.profileDir}${profileExists ? '' : '（尚未建立，第一次加入會議時會自動建立）'}`]);
  if (profileExists && profileInUse(config.profileDir)) rows.push(['設定檔使用中', 'WARN', '有 Chrome 正在使用機器人設定檔（會議記錄中或 login 視窗開著）']);
  const signed = profileExists ? signedInHint(config.profileDir) : null;
  rows.push(['Google 登入', signed ? 'OK' : 'WARN',
    signed ? `偵測到已登入的帳號（${signed} 個）` : '未偵測到登入（可用訪客身分加入，但較容易被擋；建議執行 login）']);

  const meetings = listMeetings(config.meetingsDir);
  rows.push(['會議資料夾', 'INFO', `${config.meetingsDir}（${meetings.length} 場）`]);

  const stt = sttAvailable(config);
  rows.push(['語音辨識 (選用)', stt ? 'OK' : 'INFO', stt ? sttPython(config) : '未安裝（需要時執行 setup-stt）']);
  if (!stt) {
    const uv = spawnSync('uv', ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    rows.push(['uv (選用)', uv.status === 0 ? 'OK' : 'INFO', uv.status === 0 ? String(uv.stdout).trim() : '找不到 uv（setup-stt 需要：https://docs.astral.sh/uv/）']);
  }

  const w0 = Math.max(...rows.map((r) => displayWidth(r[0])));
  for (const [label, state, detail] of rows) out(`${padDisplay(label, w0 + 2)}${state.padEnd(6)}${detail}`);
  out(fatal ? 'DOCTOR=fail' : 'DOCTOR=ok');
  return fatal ? 1 : 0;
}

/** @param {Ctx} ctx */
async function cmdSetupStt(ctx) {
  const { out, err, config } = ctx;
  out('正在建立離線語音辨識環境（uv + Python 3.12 + faster-whisper），需要網路下載套件…');
  try {
    await setupStt(config, { log: (line) => out(String(line)) });
    out(`STT_PYTHON=${sttPython(config)}`);
    out('語音辨識環境已就緒。第一次轉錄時會再下載約 1.6 GB 的模型。');
    return 0;
  } catch (e) {
    const msg = String((e && /** @type {any} */ (e).message) || e);
    if (msg === 'uv_not_found') {
      err('找不到 uv。請先安裝 uv（https://docs.astral.sh/uv/），例如在 PowerShell 執行：');
      err('  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"');
    } else {
      err(`安裝失敗：${msg}`);
    }
    return 1;
  }
}

/** @param {Ctx} ctx @param {string[]} pos @param {Record<string, any>} flags */
async function cmdTranscribe(ctx, pos, flags) {
  const { out, err, config } = ctx;
  const m = findMeeting(ctx, pos[0]);
  if (!m) return 1;
  const wavPath = path.join(m.dir, 'audio.wav');
  if (!fs.existsSync(wavPath)) {
    err(`這場會議沒有錄音檔：${wavPath}`);
    return 1;
  }
  if (!sttAvailable(config)) {
    err('尚未安裝離線語音辨識環境，請先執行 setup-stt。');
    return 1;
  }
  out(`開始轉錄 ${wavPath}（用 CPU，可能需要數分鐘；第一次會下載約 1.6 GB 模型）…`);
  try {
    const r = await runTranscribe({
      config,
      wavPath,
      outDir: m.dir,
      model: typeof flags.model === 'string' && flags.model ? flags.model : undefined,
      threads: flags.threads !== undefined ? num(flags.threads, 14) || undefined : undefined,
      log: (line) => out(String(line)),
    });
    out(`SEGMENTS=${r.segments}`);
    out(`TRANSCRIPT_WHISPER=${r.mdPath}`);
    out(`TRANSCRIPT_WHISPER_JSON=${r.jsonPath}`);
    out(`轉錄完成：${r.segments} 段。`);
    return 0;
  } catch (e) {
    const msg = String((e && /** @type {any} */ (e).message) || e);
    err(msg === 'stt_not_installed' ? '尚未安裝離線語音辨識環境，請先執行 setup-stt。' : `轉錄失敗：${msg}`);
    return 1;
  }
}

/**
 * Run a CLI command. Never throws; resolves to the process exit code.
 * @param {string[]} argv arguments after `openmeeting`
 * @param {Io} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, io = {}) {
  const env = io.env || process.env;
  const out = io.out || ((line) => process.stdout.write(`${line}\n`));
  const err = io.err || ((line) => process.stderr.write(`${line}\n`));
  const { command, positionals, flags, unknown } = parseArgs(argv);
  if (!command || command === 'help' || (flags.help && !command)) {
    out(USAGE);
    return command || flags.help ? 0 : 1;
  }
  if (flags.help) {
    out(USAGE);
    return 0;
  }
  if (unknown.length) err(`忽略未知參數：${unknown.join(' ')}`);
  /** @type {Ctx} */
  const ctx = { env, out, err, config: getConfig(env), spawnWorker: io.spawnWorker || spawnWorker };
  try {
    switch (command) {
      case 'join': return await cmdJoin(ctx, positionals, flags);
      case 'wait': return await cmdWait(ctx, positionals, flags);
      case 'status': return await cmdStatus(ctx, positionals);
      case 'list': return await cmdList(ctx);
      case 'leave': return await cmdLeave(ctx, positionals, flags);
      case 'transcript': return await cmdTranscript(ctx, positionals);
      case 'login': return await cmdLogin(ctx);
      case 'doctor': return await cmdDoctor(ctx);
      case 'setup-stt': return await cmdSetupStt(ctx);
      case 'transcribe': return await cmdTranscribe(ctx, positionals, flags);
      default:
        err(`未知的指令：${command}`);
        out(USAGE);
        return 1;
    }
  } catch (e) {
    err(`錯誤：${(e && /** @type {any} */ (e).stack) || e}`);
    return 1;
  }
}
