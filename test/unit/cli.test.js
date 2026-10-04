// CLI argument parsing and command behaviour/exit codes against fake meeting dirs (no Chrome).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, parseArgs, loginArgs, reconcileStatus } from '../../src/cli.js';
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
  assert.equal(a.DISPLAY_NAME, 'Arthur 的會議記錄');
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
