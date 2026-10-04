// The real CLI (bin/openmeeting.js) end to end: `join` spawns the detached worker, which runs
// real headless Chrome against the mock Meet; `wait` / `leave` / `status` / `list` /
// `transcript` are separate processes, exactly as Claude Code runs them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMockMeet } from '../mock-meet/server.js';
import { readStatus, isProcessAlive, listMeetings } from '../../src/status.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO, 'bin', 'openmeeting.js');
const ROOT = path.join(REPO, 'test', '.tmp', 'integ-cli');
const HOME = path.join(ROOT, 'home');
const CODE = 'abc-defg-hij';
const ENV = {
  ...process.env,
  OPENMEETING_HOME: HOME,
  OPENMEETING_HEADLESS: '1',
  OPENMEETING_ALLOW_ANY_HOST: '1',
  OPENMEETING_POLL_MS: '300',
  OPENMEETING_BLOCKED_BACKOFF_MS: '100',
  OPENMEETING_NAME: 'CLI 測試 Bot',
};
/** Speech starts when the bot sets the caption language; the meeting is short. */
const QUICK = { lobbyMs: 300, captionStepMs: 0.3, endAfterMs: 300 };

/** @type {Awaited<ReturnType<typeof startMockMeet>>} */
let mock;

before(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(HOME, { recursive: true });
  mock = await startMockMeet();
});

after(async () => {
  // never leave a worker (and its Chrome) behind
  for (const m of listMeetings(path.join(HOME, 'meetings'))) {
    const pid = m.status && m.status.pid;
    if (typeof pid === 'number' && isProcessAlive(pid) && pid !== process.pid) {
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
  await mock?.close();
  if (process.env.OPENMEETING_KEEP_TMP !== '1') fs.rmSync(ROOT, { recursive: true, force: true });
});

/**
 * Run the CLI as a child process.
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {Promise<{ code: number|null, stdout: string, stderr: string, kv: Record<string, string> }>}
 */
function cli(args, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: ENV, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`openmeeting ${args.join(' ')} timed out\n${stdout}\n${stderr}`));
    }, timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      /** @type {Record<string, string>} */
      const kv = {};
      for (const line of stdout.split(/\r?\n/)) {
        const m = /^([A-Z_]+)=(.*)$/.exec(line);
        if (m && !(m[1] in kv)) kv[m[1]] = m[2];
      }
      resolve({ code, stdout, stderr, kv });
    });
  });
}

/** Poll until `pred(status)` holds. */
async function waitForStatus(dir, pred, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const s = readStatus(dir);
    if (s && pred(s)) return s;
    if (Date.now() > end) throw new Error(`status condition not met; last: ${JSON.stringify(s)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

test('join (detached worker) → wait exits 0 with RESULT=done', { timeout: 180_000 }, async () => {
  const join = await cli(['join', mock.urlFor(CODE, { scenario: 'happy', ...QUICK })], 30_000);
  assert.equal(join.code, 0, join.stderr);
  const id = join.kv.MEETING_ID;
  const dir = join.kv.MEETING_DIR;
  assert.match(id, /^\d{8}-\d{6}-abc-defg-hij$/);
  assert.equal(join.kv.DISPLAY_NAME, 'CLI 測試 Bot');
  const st = readStatus(dir);
  assert.equal(typeof st.pid, 'number', 'worker pid recorded');

  const wait = await cli(['wait', id, '--poll-ms', '500'], 150_000);
  assert.equal(wait.code, 0, `${wait.stdout}\n${wait.stderr}`);
  assert.equal(wait.kv.RESULT, 'done');
  assert.equal(wait.kv.END_REASON, 'meeting_ended');
  assert.ok(Number(wait.kv.UTTERANCES) >= 1);
  assert.equal(wait.kv.TRANSCRIPT, path.join(dir, 'transcript.md'));
  assert.equal(wait.kv.ERROR, '');
  const states = wait.stdout.split(/\r?\n/).filter((l) => l.startsWith('STATE=')).map((l) => l.slice(6));
  assert.equal(states.at(-1), 'done');
  assert.ok(fs.existsSync(path.join(dir, 'worker.out')), 'worker stdio goes to worker.out');
  assert.ok(fs.existsSync(path.join(dir, 'bot.log')));

  // the worker process exits by itself
  await waitForStatus(dir, (s) => !isProcessAlive(s.pid), 15_000);

  const status = await cli(['status', 'latest']);
  assert.equal(status.code, 0);
  const json = JSON.parse(status.stdout);
  assert.equal(json.id, id);
  assert.equal(json.state, 'done');
  assert.equal(json.displayName, 'CLI 測試 Bot');

  const list = await cli(['list']);
  assert.equal(list.code, 0);
  assert.match(list.stdout, new RegExp(`${id}\\s+done\\s+\\d+`));

  const transcript = await cli(['transcript', 'latest']);
  assert.equal(transcript.code, 0);
  assert.match(transcript.stdout, /^# 會議逐字稿 — abc-defg-hij/);
});

test('join (meeting never ends) → leave latest → done/user_stop, wait exits 0', { timeout: 180_000 }, async () => {
  const join = await cli(['join', mock.urlFor(CODE, { scenario: 'happy', ...QUICK, endAfterMs: 600_000 })], 30_000);
  assert.equal(join.code, 0, join.stderr);
  const dir = join.kv.MEETING_DIR;
  // in the call, and the scripted speech (about 4 s) has been captioned
  await waitForStatus(dir, (s) => s.state === 'in_call', 90_000);
  await new Promise((r) => setTimeout(r, 7000));

  const leave = await cli(['leave', 'latest'], 60_000);
  assert.equal(leave.code, 0, `${leave.stdout}\n${leave.stderr}`);
  assert.equal(leave.kv.STOP_REQUESTED, '1');
  assert.equal(leave.kv.RESULT, 'done');
  const st = readStatus(dir);
  assert.equal(st.state, 'done');
  assert.equal(st.endReason, 'user_stop');

  const wait = await cli(['wait', 'latest', '--poll-ms', '200'], 30_000);
  assert.equal(wait.code, 0, wait.stdout);
  assert.equal(wait.kv.RESULT, 'done');
  assert.ok(Number(wait.kv.UTTERANCES) >= 1);
});

test('join not-a-link exits 1', async () => {
  const r = await cli(['join', 'not-a-link'], 30_000);
  assert.equal(r.code, 1);
  assert.equal(r.kv.ERROR, 'not_a_meet_url');
  assert.match(r.stderr, /不是有效的 Google Meet 連結/);
});
