// CLI argument parsing and command behaviour/exit codes against fake meeting dirs (no Chrome).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  main, parseArgs, loginArgs, reconcileStatus,
  psQuote, quoteWinArg, buildWorkerCommandLine, buildWmiLaunchScript, encodePowerShell, buildWorkerEnv,
  parseWmiCreateOutput, parseWmiError, runPowerShell, chooseLauncher, launchWorker, waitForWorkerStart, WORKER_ENV_FILE,
} from '../../src/cli.js';
import { chromeArgs } from '../../src/chrome.js';
import { readStatus, writeStatus } from '../../src/status.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = path.join(REPO, 'test', '.tmp', 'cli-unit');
let n = 0;

before(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
});
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

/** A fresh OPENMEETING_HOME. */
function newHome() {
  n += 1;
  const home = path.join(ROOT, `home-${n}`);
  fs.mkdirSync(path.join(home, 'meetings'), { recursive: true });
  return home;
}

/** Run the CLI in-process, capturing output. */
async function run(argv, { home, env = {}, spawnWorker } = {}) {
  const out = [];
  const err = [];
  const code = await main(argv, {
    env: { OPENMEETING_HOME: home, ...env },
    out: (l) => out.push(String(l)),
    err: (l) => err.push(String(l)),
    spawnWorker: spawnWorker || (() => { throw new Error('spawnWorker must not be called'); }),
  });
  return { code, out, err, text: out.join('\n'), errText: err.join('\n') };
}

/** `KEY=VALUE` lines → object (first occurrence wins). */
function kv(lines) {
  const o = {};
  for (const l of lines) {
    const m = /^([A-Z_]+)=(.*)$/.exec(l);
    if (m && !(m[1] in o)) o[m[1]] = m[2];
  }
  return o;
}

/** Create a meeting dir with a status (and optional transcript lines). */
function fakeMeeting(home, id, status, utterances = []) {
  const dir = path.join(home, 'meetings', id);
  fs.mkdirSync(path.join(dir, 'screens'), { recursive: true });
  writeStatus(dir, {
    id, code: 'abc-defg-hij', url: 'https://meet.google.com/abc-defg-hij?hl=en', displayName: 'Bot',
    pid: null, startedAt: '2026-10-04T14:00:00.000Z', joinedAt: null, endedAt: null, endReason: null, error: null,
    stats: { utterances: utterances.length, speakers: [], audioSeconds: 0, captionLang: 'cmn-Hant-TW', captionsOn: true },
    ...status,
  });
  if (utterances.length) {
    const lines = utterances.map(([speaker, text], i) => JSON.stringify({
      t0: new Date(Date.parse('2026-10-04T14:00:10.000Z') + i * 5000).toISOString(),
      t1: new Date(Date.parse('2026-10-04T14:00:12.000Z') + i * 5000).toISOString(),
      speaker, text, source: 'captions',
    }));
    fs.writeFileSync(path.join(dir, 'transcript.jsonl'), `${lines.join('\n')}\n`);
  }
  return dir;
}

/** pid of a process that has already exited. */
function deadPid() {
  return spawnSync(process.execPath, ['-e', '0']).pid;
}

// --- parseArgs ---------------------------------------------------------------------------------

test('parseArgs: command, positionals, value and boolean flags', () => {
  assert.deepEqual(parseArgs(['join', 'https://meet.google.com/abc-defg-hij', '--name', 'My Bot', '--lang=en-US', '--foreground']), {
    command: 'join', positionals: ['https://meet.google.com/abc-defg-hij'], flags: { name: 'My Bot', lang: 'en-US', foreground: true }, unknown: [],
  });
  assert.deepEqual(parseArgs(['wait', 'latest', '--timeout-min', '110']).flags, { 'timeout-min': '110' });
  assert.deepEqual(parseArgs(['transcribe', 'x', '--model=small']).flags, { model: 'small' });
  assert.equal(parseArgs(['WAIT']).command, 'wait');
  assert.deepEqual(parseArgs([]), { command: null, positionals: [], flags: {}, unknown: [] });
});

test('parseArgs: unknown flags are collected, a value flag without value is unknown', () => {
  const r = parseArgs(['status', '--bogus', 'latest', '--name']);
  assert.deepEqual(r.positionals, ['latest']);
  assert.deepEqual(r.unknown, ['--bogus', '--name']);
  assert.equal(parseArgs(['-h']).flags.help, true);
});

// --- help / unknown ------------------------------------------------------------------------------

test('parseArgs: a missing value does not consume the next option', () => {
  const r = parseArgs(['join', 'abc-defg-hij', '--name', '--foreground']);
  assert.equal(r.flags.foreground, true);
  assert.equal(r.flags.name, undefined);
  assert.deepEqual(r.unknown, ['--name']);
});

test('join: missing option values fail before starting a worker', async () => {
  const home = newHome();
  const r = await run(['join', 'abc-defg-hij', '--name', '--foreground'], { home });
  assert.equal(r.code, 1);
  assert.equal(kv(r.out).ERROR, 'invalid_arguments');
  assert.deepEqual(fs.readdirSync(path.join(home, 'meetings')), []);
});

test('join: a launcher without a valid pid fails instead of reporting success', async () => {
  for (const pid of [undefined, null, 0, -1, NaN]) {
    const home = newHome();
    const r = await run(['join', 'abc-defg-hij'], { home, spawnWorker: () => ({ pid, launcher: 'spawn' }) });
    assert.equal(r.code, 1);
    assert.equal(kv(r.out).ERROR, 'crashed');
    assert.equal(kv(r.out).MEETING_ID, undefined);
    const [id] = fs.readdirSync(path.join(home, 'meetings'));
    assert.equal(readStatus(path.join(home, 'meetings', id)).state, 'failed');
  }
});

test('wait: successful Whisper fallback counts as a transcript; empty or corrupt output does not', async () => {
  for (const segments of [[{ start: 0, end: 1, text: '備援內容' }], [], [{ text: '  ' }], null]) {
    const home = newHome();
    const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'done' });
    fs.writeFileSync(path.join(dir, 'transcript-whisper.md'), '# 備援逐字稿\n');
    fs.writeFileSync(path.join(dir, 'transcript-whisper.json'), segments === null ? '{' : JSON.stringify({ segments }));
    const r = await run(['wait', 'latest'], { home });
    const valid = segments?.some((s) => s.text.trim());
    assert.equal(r.code, valid ? 0 : 2);
    assert.equal(kv(r.out).UTTERANCES, '0');
    if (valid) {
      assert.equal(kv(r.out).WHISPER_SEGMENTS, '1');
      assert.doesNotMatch(r.text, /但沒有擷取到任何字幕/);
    }
  }
});

test('wait: corrupt or empty transcript records do not count as captured utterances', async () => {
  const home = newHome();
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'done' });
  fs.writeFileSync(path.join(dir, 'transcript.jsonl'), '{"text":"unfinished\n{}\n{"text":"  "}\nnull\n');
  const empty = await run(['wait', 'latest'], { home });
  assert.equal(empty.code, 2);
  assert.equal(kv(empty.out).UTTERANCES, '0');
  fs.appendFileSync(path.join(dir, 'transcript.jsonl'), '{"text":"有效發言"}\n');
  const valid = await run(['wait', 'latest'], { home });
  assert.equal(valid.code, 0);
  assert.equal(kv(valid.out).UTTERANCES, '1');
});

test('help prints usage (exit 0); unknown command exits 1; no command exits 1', async () => {
  const home = newHome();
  const h = await run(['help'], { home });
  assert.equal(h.code, 0);
  assert.match(h.text, /join <連結>/);
  assert.equal((await run(['--help'], { home })).code, 0);
  const u = await run(['frobnicate'], { home });
  assert.equal(u.code, 1);
  assert.match(u.errText, /未知的指令/);
  assert.equal((await run([], { home })).code, 1);
});

// --- join ----------------------------------------------------------------------------------------

test('join: not a Meet link → exit 1, ERROR=not_a_meet_url, nothing created', async () => {
  const home = newHome();
  for (const argv of [['join', 'not-a-link'], ['join'], ['join', 'https://zoom.us/j/123']]) {
    const r = await run(argv, { home });
    assert.equal(r.code, 1, argv.join(' '));
    assert.equal(kv(r.out).ERROR, 'not_a_meet_url');
  }
  assert.deepEqual(fs.readdirSync(path.join(home, 'meetings')), []);
});

test('join: creates the meeting dir + status, spawns the worker, prints MEETING_ID/MEETING_DIR', async () => {
  const home = newHome();
  const calls = [];
  const r = await run(['join', 'meet.google.com/ABC-DEFG-HIJ?pli=1', '--name', 'Arthur Bot', '--lang', 'en-US'], {
    home,
    spawnWorker: (o) => {
      calls.push(o);
      return 424242;
    },
  });
  assert.equal(r.code, 0, r.errText);
  const o = kv(r.out);
  assert.match(o.MEETING_ID, /^\d{8}-\d{6}-abc-defg-hij$/);
  assert.equal(o.MEETING_DIR, path.join(home, 'meetings', o.MEETING_ID));
  assert.equal(o.LIVE_URL, `http://127.0.0.1:8791/?id=${encodeURIComponent(o.MEETING_ID)}`);
  assert.equal(o.DISPLAY_NAME, 'Arthur Bot');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dir, o.MEETING_DIR);
  assert.equal(calls[0].url, 'https://meet.google.com/abc-defg-hij?hl=en');
  assert.equal(calls[0].captionLang, 'en-US');
  assert.equal(calls[0].displayName, 'Arthur Bot');
  const st = readStatus(o.MEETING_DIR);
  assert.equal(st.state, 'starting');
  assert.equal(st.pid, 424242);
  assert.equal(st.code, 'abc-defg-hij');
  assert.equal(st.displayName, 'Arthur Bot');
  assert.ok(fs.existsSync(path.join(o.MEETING_DIR, 'screens')));
  assert.match(r.text, /允許/);
});

test('join: default display name from config; same code twice in a second gets unique ids', async () => {
  const home = newHome();
  const pid = deadPid();
  const spawnWorker = () => pid;
  const a = kv((await run(['join', 'abc-defg-hij'], { home, spawnWorker })).out);
  const b = kv((await run(['join', 'abc-defg-hij'], { home, spawnWorker })).out);
  assert.equal(a.DISPLAY_NAME, 'Arthur Wang');
  assert.notEqual(a.MEETING_ID, b.MEETING_ID);
});

test('join: mock-server URLs need OPENMEETING_ALLOW_ANY_HOST=1', async () => {
  const home = newHome();
  const url = 'http://127.0.0.1:5555/abc-defg-hij?scenario=happy';
  assert.equal((await run(['join', url], { home })).code, 1);
  const calls = [];
  const r = await run(['join', url], { home, env: { OPENMEETING_ALLOW_ANY_HOST: '1' }, spawnWorker: (o) => { calls.push(o); return 7; } });
  assert.equal(r.code, 0);
  assert.equal(calls[0].url, 'http://127.0.0.1:5555/abc-defg-hij?scenario=happy&hl=en');
});

test('join: a worker that cannot be spawned → status failed/crashed, exit 1', async () => {
  const home = newHome();
  const r = await run(['join', 'abc-defg-hij'], { home, spawnWorker: () => { throw new Error('boom'); } });
  assert.equal(r.code, 1);
  const [id] = fs.readdirSync(path.join(home, 'meetings'));
  const st = readStatus(path.join(home, 'meetings', id));
  assert.equal(st.state, 'failed');
  assert.equal(st.error.code, 'crashed');
});

test('join: a WMI launch is verified — LAUNCHER=wmi once the worker writes its own pid', async () => {
  const home = newHome();
  const r = await run(['join', 'abc-defg-hij'], {
    home,
    spawnWorker: (o) => {
      // the "worker" reports in a little later, as the real one does
      setTimeout(() => writeStatus(o.dir, { pid: process.pid, heartbeatAt: new Date().toISOString() }), 150);
      return { pid: process.pid, launcher: 'wmi' };
    },
  });
  assert.equal(r.code, 0, r.errText);
  const o = kv(r.out);
  assert.equal(o.LAUNCHER, 'wmi');
  assert.match(o.MEETING_ID, /^\d{8}-\d{6}-abc-defg-hij$/);
  assert.ok(o.MEETING_DIR);
  assert.equal(o.DISPLAY_NAME, 'Arthur Wang');
  assert.match(r.text, /允許/);
  assert.equal(readStatus(o.MEETING_DIR).pid, process.pid);
});

test('join: a WMI-created worker that exits without reporting in → failed/crashed, exit 1', async () => {
  const home = newHome();
  const pid = deadPid();
  const t0 = Date.now();
  const r = await run(['join', 'abc-defg-hij'], { home, spawnWorker: () => ({ pid, launcher: 'wmi' }) });
  assert.equal(r.code, 1, r.text);
  assert.ok(Date.now() - t0 < 5000, 'a dead process is noticed without waiting the full 15 s');
  assert.equal(kv(r.out).ERROR, 'crashed');
  assert.equal(kv(r.out).MEETING_ID, undefined, 'the bot did not start');
  const [id] = fs.readdirSync(path.join(home, 'meetings'));
  const st = readStatus(path.join(home, 'meetings', id));
  assert.equal(st.state, 'failed');
  assert.equal(st.error.code, 'crashed');
  assert.match(st.error.message, /WMI/);
  assert.match(st.error.message, new RegExp(`pid ${pid}`));
  assert.match(r.errText, /worker\.out/);
});

test('join: a WMI-created worker that never reports in within the start timeout → failed/crashed, exit 1', async () => {
  const home = newHome();
  const r = await run(['join', 'abc-defg-hij'], {
    home,
    env: { OPENMEETING_WORKER_START_TIMEOUT_MS: '400' },
    spawnWorker: () => ({ pid: process.pid, launcher: 'wmi' }), // alive, but never writes status
  });
  assert.equal(r.code, 1, r.text);
  const [id] = fs.readdirSync(path.join(home, 'meetings'));
  const st = readStatus(path.join(home, 'meetings', id));
  assert.equal(st.state, 'failed');
  assert.equal(st.error.code, 'crashed');
  assert.match(st.error.message, /did not report in/);
});

test('join: a spawn fallback prints LAUNCHER=spawn-fallback, the reason on stderr, records the pid', async () => {
  const home = newHome();
  const r = await run(['join', 'abc-defg-hij'], {
    home,
    spawnWorker: () => ({ pid: 4242, launcher: 'spawn-fallback', reason: 'Win32_Process.Create returned 8 (unknown failure)' }),
  });
  assert.equal(r.code, 0, r.errText);
  const o = kv(r.out);
  assert.equal(o.LAUNCHER, 'spawn-fallback');
  assert.ok(o.MEETING_ID && o.MEETING_DIR && o.DISPLAY_NAME);
  assert.match(r.errText, /returned 8/);
  assert.equal(readStatus(o.MEETING_DIR).pid, 4242);
});

test('join: refused (exit 5, ERROR=already_recording) while another meeting is being recorded', async () => {
  const home = newHome();
  const id = '20261004-220000-abc-defg-hij';
  fakeMeeting(home, id, { state: 'in_call', pid: process.pid, heartbeatAt: new Date().toISOString() });
  const r = await run(['join', 'xyz-abcd-efg'], { home });
  assert.equal(r.code, 5);
  const o = kv(r.out);
  assert.equal(o.ERROR, 'already_recording');
  assert.equal(o.ACTIVE_MEETING_ID, id);
  assert.equal(o.ACTIVE_MEETING_DIR, path.join(home, 'meetings', id));
  assert.equal(o.MEETING_ID, undefined);
  assert.deepEqual(fs.readdirSync(path.join(home, 'meetings')), [id], 'no new meeting dir');
  assert.match(r.errText, /leave/);
});

test('join: a stale heartbeat (pid reused) or a dead pid does not block a new join', async () => {
  const home = newHome();
  fakeMeeting(home, '20261004-210000-aaa-aaaa-aaa', {
    state: 'in_call', pid: process.pid, heartbeatAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  });
  const deadDir = fakeMeeting(home, '20261004-200000-bbb-bbbb-bbb', { state: 'in_call', pid: deadPid() });
  const pid = deadPid();
  const r = await run(['join', 'xyz-abcd-efg'], { home, spawnWorker: () => pid });
  assert.equal(r.code, 0, r.text + r.errText);
  assert.equal(readStatus(deadDir).error.code, 'crashed', 'the dead one was reconciled');
});

// --- wait ----------------------------------------------------------------------------------------

test('wait: done with utterances → exit 0 and the result block', async () => {
  const home = newHome();
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'done', endReason: 'meeting_ended', endedAt: '2026-10-04T14:30:00.000Z' },
    [['王小明', '大家好'], ['Arthur', '好的']]);
  fs.writeFileSync(path.join(dir, 'transcript.md'), '# 會議逐字稿 — abc-defg-hij\n');
  const r = await run(['wait', 'latest', '--poll-ms', '20'], { home });
  assert.equal(r.code, 0);
  const o = kv(r.out);
  assert.equal(o.STATE, 'done');
  assert.equal(o.RESULT, 'done');
  assert.equal(o.UTTERANCES, '2');
  assert.equal(o.TRANSCRIPT, path.join(dir, 'transcript.md'));
  assert.equal(o.ERROR, '');
  assert.equal(o.END_REASON, 'meeting_ended');
  assert.equal(o.MEETING_DIR, dir);
});

test('wait: done without utterances → exit 2', async () => {
  const home = newHome();
  fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'done', endReason: 'alone' });
  const r = await run(['wait', '20261004-220000-abc-defg-hij', '--poll-ms', '20'], { home });
  assert.equal(r.code, 2);
  assert.equal(kv(r.out).UTTERANCES, '0');
  assert.match(r.text, /沒有擷取到任何字幕/);
});

test('wait: failed → exit 3 with ERROR=<code>', async () => {
  const home = newHome();
  fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'failed', error: { code: 'denied', message: 'Meet says: denied' } });
  const r = await run(['wait', 'latest', '--poll-ms', '20'], { home });
  assert.equal(r.code, 3);
  assert.equal(kv(r.out).RESULT, 'failed');
  assert.equal(kv(r.out).ERROR, 'denied');
});

test('wait: follows state changes until terminal', async () => {
  const home = newHome();
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'joining', pid: process.pid });
  setTimeout(() => writeStatus(dir, { state: 'in_call' }), 80);
  setTimeout(() => {
    fs.writeFileSync(path.join(dir, 'transcript.jsonl'), `${JSON.stringify({ t0: '2026-10-04T14:00:00.000Z', t1: '2026-10-04T14:00:01.000Z', speaker: 'A', text: 'hi', source: 'captions' })}\n`);
    writeStatus(dir, { state: 'done', endReason: 'user_stop' });
  }, 200);
  const r = await run(['wait', 'latest', '--poll-ms', '20'], { home });
  assert.equal(r.code, 0);
  const states = r.out.filter((l) => l.startsWith('STATE=')).map((l) => l.slice(6));
  assert.deepEqual(states, ['joining', 'in_call', 'done']);
});

test('wait: timeout → exit 4, RESULT=timeout', async () => {
  const home = newHome();
  fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'in_call', pid: process.pid });
  const r = await run(['wait', 'latest', '--timeout-min', '0.002', '--poll-ms', '20'], { home });
  assert.equal(r.code, 4);
  assert.equal(kv(r.out).RESULT, 'timeout');
});

test('wait: a dead worker pid → status failed/crashed, exit 3', async () => {
  const home = newHome();
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'in_call', pid: deadPid() });
  const r = await run(['wait', 'latest', '--poll-ms', '20'], { home });
  assert.equal(r.code, 3);
  assert.equal(kv(r.out).ERROR, 'crashed');
  const st = readStatus(dir);
  assert.equal(st.state, 'failed');
  assert.equal(st.error.code, 'crashed');
  assert.ok(st.endedAt);
});

test('wait: a heartbeat that stopped (pid reused by another process) → failed/crashed, exit 3', async () => {
  const home = newHome();
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', {
    state: 'in_call', pid: process.pid, heartbeatAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  });
  const r = await run(['wait', 'latest', '--poll-ms', '20', '--timeout-min', '0.05'], { home, env: { OPENMEETING_HEARTBEAT_CONFIRM_MS: '60' } });
  assert.equal(r.code, 3, r.text);
  assert.equal(kv(r.out).ERROR, 'crashed');
  assert.match(readStatus(dir).error.message, /heartbeat/);
});

test('wait: unknown meeting → exit 1', async () => {
  const home = newHome();
  assert.equal((await run(['wait', 'latest'], { home })).code, 1);
  fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'done' });
  assert.equal((await run(['wait', 'nope'], { home })).code, 1);
});

test('reconcileStatus: orphaned "starting" with no pid for > 60 s → crashed; recent one untouched', () => {
  const home = newHome();
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'starting', pid: null });
  const fresh = readStatus(dir);
  assert.equal(reconcileStatus(dir, fresh).state, 'starting');
  const old = { ...fresh, updatedAt: new Date(Date.now() - 120_000).toISOString() };
  assert.equal(reconcileStatus(dir, old).error.code, 'crashed');
});

test('reconcileStatus: a stale heartbeat counts only after the caller watched it unchanged long enough', () => {
  const home = newHome();
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', {
    state: 'in_call', pid: process.pid, heartbeatAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  });
  const st = readStatus(dir);
  assert.equal(reconcileStatus(dir, st).state, 'in_call', 'one-shot callers rely on the pid only');
  assert.equal(reconcileStatus(dir, st, { heartbeatSilentForMs: 5_000 }).state, 'in_call', 'just woke from sleep?');
  const fresh = { ...st, heartbeatAt: new Date().toISOString() };
  assert.equal(reconcileStatus(dir, fresh, { heartbeatSilentForMs: 120_000 }).state, 'in_call');
  const r = reconcileStatus(dir, st, { heartbeatSilentForMs: 61_000 });
  assert.equal(r.state, 'failed');
  assert.equal(r.error.code, 'crashed');
});

// --- status / list -------------------------------------------------------------------------------

test('status: prints status JSON (with dir); unknown → exit 1', async () => {
  const home = newHome();
  assert.equal((await run(['status'], { home })).code, 1);
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'done', endReason: 'meeting_ended' });
  const r = await run(['status', 'latest'], { home });
  assert.equal(r.code, 0);
  const st = JSON.parse(r.text);
  assert.equal(st.state, 'done');
  assert.equal(st.displayName, 'Bot');
  assert.equal(st.dir, dir);
  assert.equal((await run(['status', '20261004-220000'], { home })).code, 0, 'unique prefix');
});

test('list: newest first with state and utterance count', async () => {
  const home = newHome();
  assert.match((await run(['list'], { home })).text, /還沒有任何會議記錄/);
  fakeMeeting(home, '20261004-200000-aaa-bbbb-ccc', { state: 'done' }, [['A', 'x']]);
  fakeMeeting(home, '20261004-210000-abc-defg-hij', { state: 'failed', error: { code: 'denied', message: '' } });
  const r = await run(['list'], { home });
  assert.equal(r.code, 0);
  const rows = r.out.slice(1).map((l) => l.split(/\s+/));
  assert.deepEqual(rows, [['20261004-210000-abc-defg-hij', 'failed', '0'], ['20261004-200000-aaa-bbbb-ccc', 'done', '1']]);
});

// --- transcript ----------------------------------------------------------------------------------

test('transcript: prints transcript.md of a finished meeting', async () => {
  const home = newHome();
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'done' }, [['A', 'x']]);
  fs.writeFileSync(path.join(dir, 'transcript.md'), '# 會議逐字稿 — abc-defg-hij\n\nhello\n');
  const r = await run(['transcript', 'latest'], { home });
  assert.equal(r.code, 0);
  assert.equal(r.text, '# 會議逐字稿 — abc-defg-hij\n\nhello');
});

test('transcript: renders (and writes) transcript.md from jsonl when missing', async () => {
  const home = newHome();
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'done', endedAt: '2026-10-04T14:30:00.000Z' },
    [['王小明', '大家好'], ['Arthur', '好的']]);
  const r = await run(['transcript'], { home });
  assert.equal(r.code, 0);
  assert.match(r.text, /^# 會議逐字稿 — abc-defg-hij/);
  assert.match(r.text, /王小明：\*\* 大家好/);
  assert.ok(fs.existsSync(path.join(dir, 'transcript.md')));
});

test('transcript: live view of a meeting in progress (does not write transcript.md)', async () => {
  const home = newHome();
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'in_call', pid: process.pid }, [['王小明', '進行中的內容']]);
  const r = await run(['transcript', 'latest'], { home });
  assert.equal(r.code, 0);
  assert.match(r.text, /進行中的內容/);
  assert.match(r.text, /會議記錄進行中/);
  assert.equal(fs.existsSync(path.join(dir, 'transcript.md')), false);
  assert.equal((await run(['transcript', 'nope'], { home })).code, 1);
});

// --- leave ---------------------------------------------------------------------------------------

test('leave: finished meeting → exit 0 without a STOP file', async () => {
  const home = newHome();
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'done' });
  const r = await run(['leave', 'latest'], { home });
  assert.equal(r.code, 0);
  assert.equal(fs.existsSync(path.join(dir, 'STOP')), false);
});

test('leave: writes STOP and waits for the worker to finish', async () => {
  const home = newHome();
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'in_call', pid: process.pid });
  // a fake worker: reacts to the STOP file like the real session does
  const timer = setInterval(() => {
    if (fs.existsSync(path.join(dir, 'STOP'))) {
      clearInterval(timer);
      setTimeout(() => writeStatus(dir, { state: 'done', endReason: 'user_stop' }), 100);
    }
  }, 20);
  const r = await run(['leave', 'latest', '--poll-ms', '20'], { home });
  clearInterval(timer);
  assert.equal(r.code, 0);
  const o = kv(r.out);
  assert.equal(o.STOP_REQUESTED, '1');
  assert.equal(o.RESULT, 'done');
  assert.equal(o.END_REASON, 'user_stop');
});

test('leave: gives up after --timeout-sec but still exits 0', async () => {
  const home = newHome();
  fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'transcribing', pid: process.pid });
  const r = await run(['leave', 'latest', '--timeout-sec', '0.2', '--poll-ms', '20'], { home });
  assert.equal(r.code, 0);
  assert.equal(kv(r.out).STATE, 'transcribing');
  assert.match(r.text, /還在收尾/);
});

test('leave: unknown meeting → exit 1', async () => {
  assert.equal((await run(['leave'], { home: newHome() })).code, 1);
});

// --- login / doctor / stt ------------------------------------------------------------------------

test('loginArgs: bot profile at accounts.google.com, no remote debugging / headless / mute', () => {
  const args = loginArgs({ profileDir: 'D:\\x\\chrome-profile', chromeArgs });
  assert.ok(args.includes('--user-data-dir=D:\\x\\chrome-profile'));
  assert.ok(args.includes('--lang=en-US'));
  assert.equal(args.at(-1), 'https://accounts.google.com/');
  assert.ok(!args.some((a) => a.startsWith('--remote-debugging')), 'no CDP port');
  assert.ok(!args.some((a) => a.startsWith('--headless') || a === '--mute-audio' || a === '--enable-automation'));
});

test('doctor: exit 1 when Chrome is missing, 0 when found', async () => {
  const home = newHome();
  const missing = await run(['doctor'], { home, env: { CHROME_PATH: path.join(home, 'nope.exe'), ProgramFiles: home, 'ProgramFiles(x86)': home, LOCALAPPDATA: home } });
  assert.equal(missing.code, 1);
  assert.equal(kv(missing.out).DOCTOR, 'fail');
  assert.match(missing.text, /Google Chrome\s+FAIL/);
  const found = await run(['doctor'], { home, env: { CHROME_PATH: process.execPath } });
  assert.equal(found.code, 0, found.text);
  assert.equal(kv(found.out).DOCTOR, 'ok');
  assert.match(found.text, /Node\.js\s+OK/);
  assert.match(found.text, /語音辨識/);
  assert.match(found.text, process.platform === 'win32' ? /背景啟動方式\s+INFO\s+WMI/ : /背景啟動方式\s+INFO\s+spawn/);
  const spawnMode = await run(['doctor'], { home, env: { CHROME_PATH: process.execPath, OPENMEETING_LAUNCHER: 'spawn' } });
  assert.match(spawnMode.text, /背景啟動方式\s+INFO\s+spawn/);
});

test('transcribe: missing audio.wav or STT env → exit 1', async () => {
  const home = newHome();
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'done' });
  const noWav = await run(['transcribe', 'latest'], { home });
  assert.equal(noWav.code, 1);
  assert.match(noWav.errText, /沒有錄音檔/);
  fs.writeFileSync(path.join(dir, 'audio.wav'), Buffer.alloc(44));
  const noStt = await run(['transcribe', 'latest'], { home });
  assert.equal(noStt.code, 1);
  assert.match(noStt.errText, /setup-stt/);
  assert.equal((await run(['transcribe', 'nope'], { home })).code, 1);
});

// --- worker entry --------------------------------------------------------------------------------

test('worker: parseWorkerArgs handles --k=v and --k v', async () => {
  const { parseWorkerArgs } = await import('../../src/worker.js');
  assert.deepEqual(parseWorkerArgs(['--dir=D:/m/x y', '--name', 'A 的 Bot', '--lang=en-US', '--url=http://h/abc-defg-hij?a=1&hl=en']), {
    dir: 'D:/m/x y', name: 'A 的 Bot', lang: 'en-US', url: 'http://h/abc-defg-hij?a=1&hl=en',
  });
});

test('worker: no --dir → exit 2; dir without status.json → failed/crashed, exit 1', async () => {
  const { workerMain } = await import('../../src/worker.js');
  const home = newHome();
  const saved = process.stderr.write;
  process.stderr.write = () => true;
  try {
    assert.equal(await workerMain([], { OPENMEETING_HOME: home }), 2);
  } finally {
    process.stderr.write = saved;
  }
  const dir = path.join(home, 'meetings', '20261004-220000-abc-defg-hij');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(await workerMain([`--dir=${dir}`], { OPENMEETING_HOME: home }), 1);
  const st = readStatus(dir);
  assert.equal(st.state, 'failed');
  assert.equal(st.error.code, 'crashed');
  assert.match(fs.readFileSync(path.join(dir, 'bot.log'), 'utf8'), /no meeting url/);
});

test('worker: parseWorkerArgs reads --env-file', async () => {
  const { parseWorkerArgs } = await import('../../src/worker.js');
  assert.deepEqual(parseWorkerArgs(['--dir=D:\\m\\a b', '--env-file=D:\\m\\a b\\worker-env.json', '--lang=en-US']), {
    dir: 'D:\\m\\a b', 'env-file': 'D:\\m\\a b\\worker-env.json', lang: 'en-US',
  });
});

test('worker: applyEnvFile mirrors the parent: managed keys replaced, others untouched, unmanaged keys ignored', async () => {
  const { applyEnvFile } = await import('../../src/worker.js');
  const home = newHome();
  const file = path.join(home, 'worker-env.json');
  fs.writeFileSync(file, JSON.stringify({
    OPENMEETING_HOME: 'D:\\新 home\\it\'s', CHROME_PATH: 'C:\\c.exe', NODE_OPTIONS: '--require evil', OPENMEETING_NUM: 5,
  }));
  const env = { OPENMEETING_STALE: 'x', openmeeting_home: 'old', PATH: 'p', TZ: 'UTC' };
  applyEnvFile(file, env);
  assert.deepEqual(env, { PATH: 'p', OPENMEETING_HOME: 'D:\\新 home\\it\'s', CHROME_PATH: 'C:\\c.exe' });
  fs.writeFileSync(file, '[1, 2]');
  assert.throws(() => applyEnvFile(file, {}), /env file/);
});

test('worker: redirectStdio appends stdout/stderr/console output to a file and restores', async () => {
  const { redirectStdio } = await import('../../src/worker.js');
  const home = newHome();
  const file = path.join(home, 'worker.out');
  fs.writeFileSync(file, 'before\n');
  const savedOut = process.stdout.write;
  const savedErr = process.stderr.write;
  const restore = redirectStdio(file);
  try {
    process.stdout.write('out-line 中文\n');
    process.stderr.write(Buffer.from('err-line\n'));
    console.error('console-line');
  } finally {
    restore();
  }
  assert.equal(process.stdout.write, savedOut);
  assert.equal(process.stderr.write, savedErr);
  assert.equal(fs.readFileSync(file, 'utf8'), 'before\nout-line 中文\nerr-line\nconsole-line\n');
});

test('worker: --env-file is loaded before the config is built; the worker records its pid early', async () => {
  const { workerMain } = await import('../../src/worker.js');
  const home = newHome();
  const dir = path.join(home, 'meetings', '20261004-220000-abc-defg-hij');
  fs.mkdirSync(dir, { recursive: true });
  writeStatus(dir, { id: '20261004-220000-abc-defg-hij', state: 'starting', pid: null }); // no url/code → fails after start
  const envFile = path.join(dir, 'worker-env.json');
  fs.writeFileSync(envFile, JSON.stringify({ OPENMEETING_HOME: home }));
  const env = {};
  assert.equal(await workerMain([`--dir=${dir}`, `--env-file=${envFile}`], env), 1);
  assert.equal(env.OPENMEETING_HOME, home);
  const st = readStatus(dir);
  assert.equal(st.pid, process.pid, 'the worker wrote its own pid before running the session');
  assert.equal(st.state, 'failed');
  assert.equal(st.error.code, 'crashed');
  assert.match(fs.readFileSync(path.join(dir, 'bot.log'), 'utf8'), /no meeting url/);
});

test('worker: an unreadable --env-file → failed/crashed, exit 1 (never runs with the wrong environment)', async () => {
  const { workerMain } = await import('../../src/worker.js');
  const home = newHome();
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', { state: 'starting' });
  assert.equal(await workerMain([`--dir=${dir}`, `--env-file=${path.join(dir, 'missing.json')}`], {}), 1);
  const st = readStatus(dir);
  assert.equal(st.state, 'failed');
  assert.equal(st.error.code, 'crashed');
  assert.match(st.error.message, /env file/);
});

test('worker: a meeting already marked failed (join gave up on it) is not started', async () => {
  const { workerMain } = await import('../../src/worker.js');
  const home = newHome();
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', {
    state: 'failed', error: { code: 'crashed', message: 'the bot process did not report in' },
  });
  const before = readStatus(dir);
  assert.equal(await workerMain([`--dir=${dir}`], { OPENMEETING_HOME: home }), 1);
  assert.deepEqual(readStatus(dir), before, 'status untouched');
  assert.match(fs.readFileSync(path.join(dir, 'bot.log'), 'utf8'), /not starting/);
});

test('worker: a late WMI-launched worker (--env-file) exits when join already fell back to a spawn', async () => {
  const { workerMain } = await import('../../src/worker.js');
  const home = newHome();
  // (a closed local port and headless, so a worker that wrongly starts never reaches the network)
  const dir = fakeMeeting(home, '20261004-220000-abc-defg-hij', {
    state: 'starting', url: 'http://127.0.0.1:9/abc-defg-hij?hl=en', launcher: 'spawn-fallback', launcherError: 'PowerShell did not finish within 30 s',
  });
  const envFile = path.join(dir, 'worker-env.json');
  fs.writeFileSync(envFile, JSON.stringify({ OPENMEETING_HOME: home, OPENMEETING_HEADLESS: '1', OPENMEETING_LOBBY_TIMEOUT_MS: '1000' }));
  const before = readStatus(dir);
  assert.equal(await workerMain([`--dir=${dir}`, `--env-file=${envFile}`], {}), 1);
  assert.deepEqual(readStatus(dir), before, 'status untouched: the spawned worker owns the meeting');
  assert.match(fs.readFileSync(path.join(dir, 'bot.log'), 'utf8'), /fell back/);
});

// --- WMI launcher builders -----------------------------------------------------------------------

const WEIRD_DIR = 'D:\\會議 資料\\Arthur\'s\\meetings\\20261005-100000-abc-defg-hij';

test('psQuote: PowerShell single-quoted literal, quote characters doubled (incl. curly ones)', () => {
  assert.equal(psQuote('C:\\a b\\x'), '\'C:\\a b\\x\'');
  assert.equal(psQuote('it\'s'), '\'it\'\'s\'');
  assert.equal(psQuote('會議 \u2018x\u2019'), '\'會議 \u2018\u2018x\u2019\u2019\'');
  assert.equal(psQuote('$env:X `n "q"'), '\'$env:X `n "q"\'');
});

test('quoteWinArg: MSVCRT quoting (spaces, trailing backslash, embedded quotes)', () => {
  assert.equal(quoteWinArg('abc'), '"abc"');
  assert.equal(quoteWinArg('a b'), '"a b"');
  assert.equal(quoteWinArg('C:\\x\\'), '"C:\\x\\\\"');
  assert.equal(quoteWinArg('say "hi"'), '"say \\"hi\\""');
  assert.equal(quoteWinArg('a\\"b'), '"a\\\\\\"b"');
  assert.equal(quoteWinArg('C:\\a\\b c'), '"C:\\a\\b c"');
  assert.equal(quoteWinArg(''), '""');
});

test('quoteWinArg: node parses the quoted arguments back exactly', { skip: process.platform !== 'win32' }, () => {
  const home = newHome();
  const script = path.join(home, 'argv.cjs');
  fs.writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  const args = ['plain', 'a b', 'C:\\x\\', 'say "hi"', 'a\\"b', WEIRD_DIR, `--dir=${WEIRD_DIR}`, ''];
  const line = [quoteWinArg(script), ...args.map((a) => quoteWinArg(a)), `--dir=${quoteWinArg(WEIRD_DIR)}`];
  const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${quoteWinArg(process.execPath)} ${line.join(' ')}"`], { windowsVerbatimArguments: true, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [...args, `--dir=${WEIRD_DIR}`]);
});

test('buildWorkerCommandLine: quoted node + worker.js + --dir/--env-file/--lang', () => {
  const line = buildWorkerCommandLine({
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    workerPath: 'D:\\git\\open meeting\\src\\worker.js',
    dir: WEIRD_DIR,
    envFile: `${WEIRD_DIR}\\worker-env.json`,
    captionLang: 'cmn-Hant-TW',
  });
  assert.equal(line, '"C:\\Program Files\\nodejs\\node.exe" "D:\\git\\open meeting\\src\\worker.js"'
    + ` --dir="${WEIRD_DIR}" --env-file="${WEIRD_DIR}\\worker-env.json" --lang="cmn-Hant-TW"`);
});

test('buildWmiLaunchScript: Win32_Process.Create with breakaway + hidden, literals escaped', () => {
  const commandLine = `"C:\\n\\node.exe" "D:\\r\\src\\worker.js" --dir="${WEIRD_DIR}"`;
  const script = buildWmiLaunchScript({ commandLine, cwd: 'D:\\git\\open meeting' });
  const lines = script.split(/\r?\n/);
  assert.ok(lines.includes('$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{CreateFlags=[uint32]16777216; ShowWindow=[uint16]0}'), script);
  assert.ok(lines.includes('$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{'
    + `CommandLine='"C:\\n\\node.exe" "D:\\r\\src\\worker.js" --dir="D:\\會議 資料\\Arthur''s\\meetings\\20261005-100000-abc-defg-hij"'; `
    + 'CurrentDirectory=\'D:\\git\\open meeting\'; ProcessStartupInformation=$si}'), script);
  assert.ok(lines.includes('Write-Output ("RC=" + $r.ReturnValue + " PID=" + $r.ProcessId)'), script);
  assert.ok(lines.includes('$ErrorActionPreference = \'Stop\''));
  // errors come back on stdout as base64 UTF-8 (stderr is CLIXML in the OEM code page)
  assert.ok(lines.includes('try {') && lines.includes('} catch {'), script);
  assert.ok(lines.some((l) => l.startsWith('Write-Output ("ERR=" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(')), script);
});

test('parseWmiError: the base64 UTF-8 error text printed by the script\'s catch block', () => {
  const b64 = Buffer.from('存取被拒。 Access denied', 'utf8').toString('base64');
  assert.equal(parseWmiError(`ERR=${b64}\r\n`), '存取被拒。 Access denied');
  assert.equal(parseWmiError('RC=0 PID=1\r\n'), null);
  assert.equal(parseWmiError('ERR=\r\n'), null);
  assert.equal(parseWmiError(undefined), null);
});

test('buildWmiLaunchScript: a PowerShell error reaches us readable, also on a non-English Windows', { skip: process.platform !== 'win32', timeout: 60_000 }, async () => {
  // a class that does not exist makes Invoke-CimMethod throw (localized message, e.g. zh-TW)
  const script = buildWmiLaunchScript({ commandLine: '"C:\\x\\node.exe"', cwd: 'C:\\' })
    .replace('-ClassName Win32_Process -MethodName', '-ClassName Win32_NoSuchClassOm -MethodName');
  const r = await runPowerShell(script, { timeoutMs: 45_000 });
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.code, 1, `${r.stdout}\n${r.stderr}`);
  assert.equal(parseWmiCreateOutput(r.stdout), null);
  const message = parseWmiError(r.stdout);
  assert.ok(message, `ERR= line in stdout: ${r.stdout}`);
  assert.ok(!message.includes('\uFFFD'), `no mojibake: ${message}`);
});

test('encodePowerShell: base64 of the UTF-16LE script (CJK safe)', () => {
  const script = 'Write-Output \'會議 it\'\'s\'';
  const b64 = encodePowerShell(script);
  assert.match(b64, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(Buffer.from(b64, 'base64').toString('utf16le'), script);
});

test('buildWorkerEnv: OPENMEETING_* (any case) + CHROME_PATH + TZ when set; nothing else', () => {
  assert.deepEqual(buildWorkerEnv({
    OPENMEETING_HOME: 'D:\\h', openmeeting_debug: '1', OPENMEETING_EMPTY: '', OPENMEETING_U: undefined,
    CHROME_PATH: 'C:\\c.exe', TZ: 'Asia/Taipei', PATH: 'x', OPENMEETINGX: 'no', USERPROFILE: 'C:\\u',
  }), { OPENMEETING_HOME: 'D:\\h', openmeeting_debug: '1', OPENMEETING_EMPTY: '', CHROME_PATH: 'C:\\c.exe', TZ: 'Asia/Taipei' });
  assert.deepEqual(buildWorkerEnv({ PATH: 'x' }), {});
});

test('parseWmiCreateOutput: RC and PID from the PowerShell output', () => {
  assert.deepEqual(parseWmiCreateOutput('RC=0 PID=1234\r\n'), { rc: 0, pid: 1234 });
  assert.deepEqual(parseWmiCreateOutput('noise\r\nRC=9 PID=\r\n'), { rc: 9, pid: null });
  assert.equal(parseWmiCreateOutput('RC= PID='), null);
  assert.equal(parseWmiCreateOutput(''), null);
  assert.equal(parseWmiCreateOutput(undefined), null);
});

test('chooseLauncher: WMI on Windows unless OPENMEETING_LAUNCHER=spawn; spawn elsewhere', () => {
  assert.equal(chooseLauncher('win32', {}), 'wmi');
  assert.equal(chooseLauncher('win32', { OPENMEETING_LAUNCHER: 'spawn' }), 'spawn');
  assert.equal(chooseLauncher('win32', { OPENMEETING_LAUNCHER: 'SPAWN' }), 'spawn');
  assert.equal(chooseLauncher('win32', { OPENMEETING_LAUNCHER: 'wmi' }), 'wmi');
  assert.equal(chooseLauncher('linux', {}), 'spawn');
  assert.equal(chooseLauncher('darwin', { OPENMEETING_LAUNCHER: 'wmi' }), 'spawn');
});

/** A meeting dir in state 'starting' + the WorkerSpawn object join passes to the launcher. */
function launchFixture(env = {}) {
  const home = newHome();
  const id = '20261005-100000-abc-defg-hij';
  const dir = fakeMeeting(home, id, { state: 'starting' });
  return {
    dir,
    home,
    o: {
      dir, url: 'https://meet.google.com/abc-defg-hij?hl=en', code: 'abc-defg-hij', id, displayName: 'Bot', captionLang: 'cmn-Hant-TW',
      env: { OPENMEETING_HOME: home, OPENMEETING_HEADLESS: '1', CHROME_PATH: 'C:\\c.exe', PATH: 'x', ...env },
      config: { repoRoot: 'D:\\git\\open meeting' },
    },
  };
}

const mustNotSpawn = () => { throw new Error('spawnDetached must not be called'); };

test('launchWorker: WMI success → { pid, launcher: wmi }, env file written, status.launcher = wmi', async () => {
  const { dir, o, home } = launchFixture();
  const calls = [];
  const r = await launchWorker(o, {
    platform: 'win32',
    nodePath: 'C:\\n\\node.exe',
    runPowerShell: async (script, opts) => { calls.push({ script, opts }); return { code: 0, stdout: 'RC=0 PID=4321\r\n', stderr: '' }; },
    spawnDetached: mustNotSpawn,
  });
  assert.equal(r.pid, 4321);
  assert.equal(r.launcher, 'wmi');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.timeoutMs, 30_000);
  const expectedLine = buildWorkerCommandLine({
    nodePath: 'C:\\n\\node.exe', workerPath: path.join('D:\\git\\open meeting', 'src', 'worker.js'),
    dir, envFile: path.join(dir, WORKER_ENV_FILE), captionLang: 'cmn-Hant-TW',
  });
  assert.ok(calls[0].script.includes(`CommandLine=${psQuote(expectedLine)}`), calls[0].script);
  assert.ok(calls[0].script.includes(`CurrentDirectory=${psQuote('D:\\git\\open meeting')}`));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, WORKER_ENV_FILE), 'utf8')), {
    OPENMEETING_HOME: home, OPENMEETING_HEADLESS: '1', CHROME_PATH: 'C:\\c.exe',
  });
  assert.equal(readStatus(dir).launcher, 'wmi');
  assert.match(fs.readFileSync(path.join(dir, 'worker.out'), 'utf8'), /WMI/);
});

test('launchWorker: Win32_Process.Create RC != 0 → detached spawn fallback with the reason', async () => {
  const { dir, o } = launchFixture();
  const spawned = [];
  const r = await launchWorker(o, {
    platform: 'win32',
    runPowerShell: async () => ({ code: 0, stdout: 'RC=8 PID=\r\n', stderr: '' }),
    spawnDetached: (x) => { spawned.push(x); return 999; },
  });
  assert.equal(r.launcher, 'spawn-fallback');
  assert.equal(r.pid, 999);
  assert.match(r.reason, /returned 8/);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0], o);
  const st = readStatus(dir);
  assert.equal(st.launcher, 'spawn-fallback');
  assert.match(st.launcherError, /returned 8/);
});

test('launchWorker: PowerShell timeout / error / non-zero exit / throw → fallback', async () => {
  const cases = [
    [{ code: null, stdout: '', stderr: '', error: 'PowerShell did not finish within 30 s' }, /30 s/],
    [{ code: 1, stdout: '', stderr: 'Invoke-CimMethod : Access denied\r\nAt line:1 char:1\r\n' }, /exit 1.*Access denied/],
    [{ code: 0, stdout: 'RC=0 PID=\r\n', stderr: '' }, /no process id/],
    [new Error('spawn powershell.exe ENOENT'), /ENOENT/],
    [{
      code: 1,
      stdout: '',
      stderr: '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T></TN></Obj>'
        + '<S S="Error">Invoke-CimMethod : Access is denied &amp; "no"_x000D__x000A_</S><S S="Error">At line:3 char:6_x000D__x000A_</S></Objs>',
    }, /exit 1 without a result: Invoke-CimMethod : Access is denied & "no" \| At line:3 char:6$/],
    // the script's catch block: readable (zh-TW) text from stdout wins over the garbled CLIXML stderr
    [{
      code: 1,
      stdout: `ERR=${Buffer.from('存取被拒。\r\n第二行', 'utf8').toString('base64')}\r\n`,
      stderr: '#< CLIXML\r\n<Objs><S S="Error">Invoke-CimMethod : ���_x000D__x000A_</S></Objs>',
    }, /exit 1 without a result: 存取被拒。 \| 第二行$/],
  ];
  for (const [result, reasonRe] of cases) {
    const { o } = launchFixture();
    const r = await launchWorker(o, {
      platform: 'win32',
      runPowerShell: async () => { if (result instanceof Error) throw result; return result; },
      spawnDetached: () => 77,
    });
    assert.equal(r.launcher, 'spawn-fallback', JSON.stringify(result));
    assert.equal(r.pid, 77);
    assert.match(r.reason, reasonRe);
  }
});

test('launchWorker: a timed-out PowerShell whose worker already reported in is not launched twice', async () => {
  const { dir, o } = launchFixture();
  const r = await launchWorker(o, {
    platform: 'win32',
    runPowerShell: async () => {
      writeStatus(dir, { pid: process.pid, heartbeatAt: new Date().toISOString() });
      return { code: null, stdout: '', stderr: '', error: 'PowerShell did not finish within 30 s' };
    },
    spawnDetached: mustNotSpawn,
  });
  assert.equal(r.launcher, 'wmi');
  assert.equal(r.pid, process.pid);
});

test('launchWorker: OPENMEETING_LAUNCHER=spawn or a non-Windows platform → detached spawn, no PowerShell', async () => {
  for (const [platform, env] of [['win32', { OPENMEETING_LAUNCHER: 'spawn' }], ['linux', {}]]) {
    const { dir, o } = launchFixture(env);
    const r = await launchWorker(o, {
      platform,
      runPowerShell: async () => { throw new Error('PowerShell must not run'); },
      spawnDetached: () => 55,
    });
    assert.deepEqual([r.launcher, r.pid], ['spawn', 55]);
    assert.equal(readStatus(dir).launcher, 'spawn');
    assert.equal(fs.existsSync(path.join(dir, WORKER_ENV_FILE)), false);
  }
});

test('waitForWorkerStart: a worker that failed fast but reported in counts as started; silence / exit do not', async () => {
  const { dir } = launchFixture();
  writeStatus(dir, { state: 'failed', error: { code: 'chrome_not_found', message: 'x' } });
  const r = await waitForWorkerStart(dir, deadPid(), { timeoutMs: 1000, pollMs: 20 });
  assert.equal(r.ok, true);
  const { dir: dir2 } = launchFixture();
  const never = await waitForWorkerStart(dir2, process.pid, { timeoutMs: 120, pollMs: 20 });
  assert.deepEqual([never.ok, never.exited], [false, false]);
  const dead = await waitForWorkerStart(dir2, deadPid(), { timeoutMs: 5000, pollMs: 20 });
  assert.deepEqual([dead.ok, dead.exited], [false, true]);
});


test('join reports dedicated profile account hints without claiming verified identity',async()=>{
  const home=newHome();fs.mkdirSync(path.join(home,'chrome-profile','Default'),{recursive:true});
  fs.writeFileSync(path.join(home,'chrome-profile','Default','Preferences'),JSON.stringify({account_info:[{email:'qa@example.invalid',full_name:'QA recorder'}]}));
  const result=await run(['join','https://meet.google.com/abc-defg-hij'],{home,spawnWorker:()=>process.pid});
  assert.equal(result.code,0);assert.deepEqual(JSON.parse(kv(result.out).GOOGLE_ACCOUNT_HINT),[{name:'QA recorder',email:'qa@example.invalid'}]);
  assert.match(result.text,/資料只是提示/);assert.match(result.text,/保持視窗開啟/);
});
