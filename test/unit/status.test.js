import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  newMeetingId,
  createMeetingDir,
  writeStatus,
  readStatus,
  resolveMeeting,
  listMeetings,
  isProcessAlive,
} from '../../src/status.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = path.resolve(HERE, '..', '.tmp', 'core', `status-${process.pid}-${Date.now()}`);
const STATUS_MODULE = pathToFileURL(path.resolve(HERE, '..', '..', 'src', 'status.js')).href;

let seq = 0;
/** @returns {string} a fresh empty directory */
function freshDir(name = 'd') {
  const d = path.join(TMP_ROOT, `${name}-${++seq}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

before(() => fs.mkdirSync(TMP_ROOT, { recursive: true }));
after(() => fs.rmSync(TMP_ROOT, { recursive: true, force: true }));

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ---------------------------------------------------------------- newMeetingId

test('newMeetingId formats local time YYYYMMDD-HHmmss-<code>', () => {
  assert.equal(newMeetingId('abc-defg-hij', new Date(2026, 9, 4, 22, 15, 30)), '20261004-221530-abc-defg-hij');
});

test('newMeetingId zero-pads every field', () => {
  assert.equal(newMeetingId('abc-defg-hij', new Date(2026, 0, 2, 3, 4, 5)), '20260102-030405-abc-defg-hij');
});

test('newMeetingId defaults to now', () => {
  assert.match(newMeetingId('abc-defg-hij'), /^\d{8}-\d{6}-abc-defg-hij$/);
});

test('newMeetingId keeps the id filesystem-safe', () => {
  assert.equal(newMeetingId('ABC/../x y', new Date(2026, 0, 2, 3, 4, 5)), '20260102-030405-abcxy');
  assert.equal(newMeetingId('', new Date(2026, 0, 2, 3, 4, 5)), '20260102-030405-meeting');
});

// ------------------------------------------------------------ createMeetingDir

test('createMeetingDir creates dir + screens/ (mkdir -p) and returns an absolute path', () => {
  const meetingsDir = path.join(freshDir('m'), 'nested', 'meetings');
  const dir = createMeetingDir(meetingsDir, '20261004-221530-abc-defg-hij');
  assert.ok(path.isAbsolute(dir));
  assert.equal(dir, path.resolve(meetingsDir, '20261004-221530-abc-defg-hij'));
  assert.ok(fs.statSync(dir).isDirectory());
  assert.ok(fs.statSync(path.join(dir, 'screens')).isDirectory());
  // idempotent
  assert.equal(createMeetingDir(meetingsDir, '20261004-221530-abc-defg-hij'), dir);
});

// ------------------------------------------------------- readStatus/writeStatus

test('readStatus returns null when status.json is missing', () => {
  assert.equal(readStatus(freshDir()), null);
  assert.equal(readStatus(path.join(TMP_ROOT, 'does-not-exist')), null);
});

test('readStatus returns null for a corrupt status.json', () => {
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, 'status.json'), '{ not json');
  assert.equal(readStatus(dir), null);
});

test('writeStatus creates status.json, sets updatedAt and returns the merged status', () => {
  const dir = freshDir();
  const s = writeStatus(dir, { id: 'x', state: 'starting', pid: 42 });
  assert.equal(s.id, 'x');
  assert.equal(s.state, 'starting');
  assert.equal(s.pid, 42);
  assert.match(s.updatedAt, ISO_RE);
  assert.deepEqual(readStatus(dir), s);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8')), s);
});

test('writeStatus merges into the existing status (patch semantics)', () => {
  const dir = freshDir();
  writeStatus(dir, { id: 'x', state: 'starting', joinedAt: null, error: null });
  const s = writeStatus(dir, { state: 'in_call', joinedAt: '2026-10-04T14:00:00.000Z' });
  assert.equal(s.id, 'x');
  assert.equal(s.state, 'in_call');
  assert.equal(s.joinedAt, '2026-10-04T14:00:00.000Z');
  assert.equal(s.error, null);
});

test('writeStatus merges nested stats shallowly', () => {
  const dir = freshDir();
  writeStatus(dir, {
    state: 'in_call',
    stats: { utterances: 0, speakers: [], audioSeconds: 0, captionLang: 'unknown', captionsOn: false },
  });
  writeStatus(dir, { stats: { utterances: 3, speakers: ['王小明', 'Arthur'] } });
  const s = writeStatus(dir, { stats: { audioSeconds: 12.5, captionsOn: true } });
  assert.deepEqual(s.stats, {
    utterances: 3,
    speakers: ['王小明', 'Arthur'],
    audioSeconds: 12.5,
    captionLang: 'unknown',
    captionsOn: true,
  });
  assert.equal(s.state, 'in_call');
});

test('writeStatus: undefined values do not erase fields, null clears them', () => {
  const dir = freshDir();
  writeStatus(dir, { state: 'failed', error: { code: 'denied', message: 'x' }, endReason: 'alone' });
  const s = writeStatus(dir, { error: null, endReason: undefined });
  assert.equal(s.error, null);
  assert.equal(s.endReason, 'alone');
});

test('writeStatus refreshes updatedAt on every write', async () => {
  const dir = freshDir();
  const a = writeStatus(dir, { n: 1 });
  await new Promise((r) => setTimeout(r, 5));
  const b = writeStatus(dir, { n: 2 });
  assert.ok(Date.parse(b.updatedAt) > Date.parse(a.updatedAt));
});

test('writeStatus writes non-ASCII text as UTF-8', () => {
  const dir = freshDir();
  writeStatus(dir, { displayName: 'Arthur 的會議記錄' });
  assert.match(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'), /Arthur 的會議記錄/);
});

test('writeStatus leaves no temp files behind', () => {
  const dir = freshDir();
  for (let i = 0; i < 20; i++) writeStatus(dir, { n: i });
  assert.deepEqual(fs.readdirSync(dir), ['status.json']);
});

test('writeStatus retries rename on EPERM/EBUSY (Windows) and then succeeds', (t) => {
  const dir = freshDir();
  const real = fs.renameSync;
  let calls = 0;
  t.mock.method(fs, 'renameSync', (from, to) => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    if (calls === 2) throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
    return real(from, to);
  });
  const s = writeStatus(dir, { state: 'in_call' });
  assert.equal(calls, 3);
  assert.equal(s.state, 'in_call');
  assert.equal(readStatus(dir).state, 'in_call');
  assert.deepEqual(fs.readdirSync(dir), ['status.json']);
});

test('writeStatus gives up after 5 retries, throws and removes its temp file', (t) => {
  const dir = freshDir();
  writeStatus(dir, { state: 'starting' });
  const rename = t.mock.method(fs, 'renameSync', () => {
    throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
  });
  assert.throws(() => writeStatus(dir, { state: 'in_call' }), { code: 'EPERM' });
  assert.equal(rename.mock.callCount(), 6); // 1 attempt + 5 retries
  rename.mock.restore();
  assert.deepEqual(fs.readdirSync(dir), ['status.json']);
  assert.equal(readStatus(dir).state, 'starting'); // old content intact
});

test('writeStatus: a briefly locked status.json is retried, never merged into an empty status', (t) => {
  const dir = freshDir();
  writeStatus(dir, { id: 'm1', pid: 1234, state: 'in_call', stats: { utterances: 3 } });
  const file = path.join(dir, 'status.json');
  const real = fs.readFileSync;
  let locked = 4;
  t.mock.method(fs, 'readFileSync', (p, ...rest) => {
    if (p === file && locked-- > 0) throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
    return real(p, ...rest);
  });
  const s = writeStatus(dir, { stats: { utterances: 4 } });
  assert.equal(s.id, 'm1');
  assert.equal(s.pid, 1234);
  assert.equal(s.state, 'in_call');
  assert.equal(s.stats.utterances, 4);
});

test('writeStatus: a status.json that stays unreadable is left untouched and the error is thrown', (t) => {
  const dir = freshDir();
  writeStatus(dir, { id: 'm1', pid: 1234, state: 'in_call' });
  const file = path.join(dir, 'status.json');
  const real = fs.readFileSync;
  const read = t.mock.method(fs, 'readFileSync', (p, ...rest) => {
    if (p === file) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    return real(p, ...rest);
  });
  assert.throws(() => writeStatus(dir, { stats: { utterances: 1 } }), { code: 'EPERM' });
  read.mock.restore();
  assert.deepEqual(readStatus(dir).id, 'm1');
  assert.equal(readStatus(dir).pid, 1234);
  assert.deepEqual(fs.readdirSync(dir), ['status.json']);
});

test('writeStatus: a corrupt status.json is replaced (so it can heal)', () => {
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, 'status.json'), '');
  const s = writeStatus(dir, { state: 'failed' });
  assert.equal(s.state, 'failed');
  assert.equal(readStatus(dir).state, 'failed');
});

test('writeStatus does not retry other rename errors', (t) => {
  const dir = freshDir();
  const rename = t.mock.method(fs, 'renameSync', () => {
    throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
  });
  assert.throws(() => writeStatus(dir, { state: 'x' }), { code: 'ENOSPC' });
  assert.equal(rename.mock.callCount(), 1);
  rename.mock.restore();
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('concurrent reader never observes a partial or missing status.json', async () => {
  const dir = freshDir('atomic');
  writeStatus(dir, { n: -1, pad: 'x'.repeat(20000) });
  const flag = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(
    `
    const { workerData } = require('node:worker_threads');
    import(workerData.mod).then(({ writeStatus }) => {
      try {
        for (let i = 0; i < 150; i++) writeStatus(workerData.dir, { n: i, pad: 'y'.repeat(20000 + i) });
        Atomics.store(workerData.flag, 0, 1);
      } catch (e) {
        Atomics.store(workerData.flag, 0, 2);
        throw e;
      }
    });
    `,
    { eval: true, workerData: { mod: STATUS_MODULE, dir, flag } },
  );
  const errored = new Promise((_, reject) => worker.once('error', reject));
  let reads = 0;
  let last = -1;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (Atomics.load(flag, 0) === 0) {
    const s = readStatus(dir);
    assert.ok(s, 'readStatus returned null during a concurrent write');
    assert.equal(typeof s.n, 'number');
    assert.ok(s.n >= last, 'status went backwards');
    last = s.n;
    reads++;
    Atomics.wait(sleeper, 0, 0, 15); // poll ~15 ms (real pollers use seconds)
  }
  await Promise.race([new Promise((r) => worker.once('exit', r)), errored]);
  assert.equal(Atomics.load(flag, 0), 1, 'writer thread failed');
  assert.ok(reads > 0);
  assert.equal(readStatus(dir).n, 149);
  assert.deepEqual(fs.readdirSync(dir), ['status.json']);
});

// ------------------------------------------------- resolveMeeting/listMeetings

/** Builds a meetings dir with three meetings, a stray file and a dot-dir. */
function makeMeetings() {
  const meetingsDir = freshDir('meetings');
  const ids = ['20261004-100000-aaa-bbbb-ccc', '20261004-120000-ddd-eeee-fff', '20261003-235959-ggg-hhhh-iii'];
  for (const id of ids) createMeetingDir(meetingsDir, id);
  writeStatus(path.join(meetingsDir, ids[0]), { id: ids[0], state: 'done' });
  writeStatus(path.join(meetingsDir, ids[1]), { id: ids[1], state: 'in_call' });
  // ids[2] has no status.json
  fs.writeFileSync(path.join(meetingsDir, 'zzz-notes.txt'), 'not a meeting');
  fs.mkdirSync(path.join(meetingsDir, '.zzz-hidden'));
  return { meetingsDir, ids };
}

test("resolveMeeting 'latest' returns the newest dir by name", () => {
  const { meetingsDir, ids } = makeMeetings();
  assert.deepEqual(resolveMeeting(meetingsDir, 'latest'), { id: ids[1], dir: path.join(meetingsDir, ids[1]) });
  assert.deepEqual(resolveMeeting(meetingsDir, 'LATEST'), { id: ids[1], dir: path.join(meetingsDir, ids[1]) });
});

test('resolveMeeting with no id behaves like latest', () => {
  const { meetingsDir, ids } = makeMeetings();
  assert.equal(resolveMeeting(meetingsDir, undefined)?.id, ids[1]);
  assert.equal(resolveMeeting(meetingsDir, '')?.id, ids[1]);
});

test('resolveMeeting by exact id and by unique prefix', () => {
  const { meetingsDir, ids } = makeMeetings();
  assert.deepEqual(resolveMeeting(meetingsDir, ids[0]), { id: ids[0], dir: path.join(meetingsDir, ids[0]) });
  assert.deepEqual(resolveMeeting(meetingsDir, '20261003'), { id: ids[2], dir: path.join(meetingsDir, ids[2]) });
  assert.equal(resolveMeeting(meetingsDir, '20261004-12')?.id, ids[1]);
  assert.equal(resolveMeeting(meetingsDir, `  ${ids[0]}  `)?.id, ids[0]);
});

test('resolveMeeting returns null for ambiguous prefixes and unknown ids', () => {
  const { meetingsDir } = makeMeetings();
  assert.equal(resolveMeeting(meetingsDir, '20261004'), null);
  assert.equal(resolveMeeting(meetingsDir, 'nope'), null);
  assert.equal(resolveMeeting(meetingsDir, 'zzz-notes.txt'), null); // files are not meetings
  assert.equal(resolveMeeting(meetingsDir, '..'), null);
  assert.equal(resolveMeeting(meetingsDir, '.zzz-hidden'), null);
});

test('resolveMeeting prefers an exact id over a longer id sharing the prefix', () => {
  const meetingsDir = freshDir('meetings');
  createMeetingDir(meetingsDir, 'm1');
  createMeetingDir(meetingsDir, 'm1-extra');
  assert.equal(resolveMeeting(meetingsDir, 'm1')?.id, 'm1');
});

test('resolveMeeting returns null when the meetings dir is missing or empty', () => {
  assert.equal(resolveMeeting(path.join(TMP_ROOT, 'nope'), 'latest'), null);
  assert.equal(resolveMeeting(freshDir('empty'), 'latest'), null);
});

test('resolveMeeting returns absolute dirs even for a relative meetingsDir', () => {
  const { meetingsDir, ids } = makeMeetings();
  const rel = path.relative(process.cwd(), meetingsDir);
  const r = resolveMeeting(rel, 'latest');
  assert.equal(r?.id, ids[1]);
  assert.ok(path.isAbsolute(r.dir));
});

test('listMeetings returns newest first with status (null when missing)', () => {
  const { meetingsDir, ids } = makeMeetings();
  const list = listMeetings(meetingsDir);
  assert.deepEqual(
    list.map((m) => m.id),
    [ids[1], ids[0], ids[2]],
  );
  assert.equal(list[0].dir, path.join(meetingsDir, ids[1]));
  assert.equal(list[0].status.state, 'in_call');
  assert.equal(list[1].status.state, 'done');
  assert.equal(list[2].status, null);
});

test('listMeetings returns [] when the meetings dir is missing', () => {
  assert.deepEqual(listMeetings(path.join(TMP_ROOT, 'missing')), []);
});

// ---------------------------------------------------------------- isProcessAlive

test('isProcessAlive: current process is alive', () => {
  assert.equal(isProcessAlive(process.pid), true);
});

test('isProcessAlive: an exited child process is dead', () => {
  const r = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  assert.equal(r.status, 0);
  assert.equal(isProcessAlive(r.pid), false);
});

test('isProcessAlive: invalid pids are not alive', () => {
  for (const pid of [0, -1, 1.5, NaN, null, undefined, '123', Infinity]) {
    assert.equal(isProcessAlive(/** @type {any} */ (pid)), false, `pid ${String(pid)}`);
  }
});

test('isProcessAlive: EPERM means alive, ESRCH means dead, kill(pid, 0) is used', (t) => {
  const kill = t.mock.method(process, 'kill', (pid, sig) => {
    assert.equal(sig, 0);
    if (pid === 111) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    if (pid === 222) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    return true;
  });
  assert.equal(isProcessAlive(111), true);
  assert.equal(isProcessAlive(222), false);
  assert.equal(isProcessAlive(333), true);
  assert.equal(kill.mock.callCount(), 3);
});

