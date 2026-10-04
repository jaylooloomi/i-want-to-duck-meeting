import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../../src/log.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = path.resolve(HERE, '..', '.tmp', 'core', `log-${process.pid}-${Date.now()}`);

let seq = 0;
function freshDir() {
  const d = path.join(TMP_ROOT, `l-${++seq}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
/** @param {string} dir */
function readLines(dir) {
  const p = path.join(dir, 'bot.log');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

before(() => fs.mkdirSync(TMP_ROOT, { recursive: true }));
after(() => fs.rmSync(TMP_ROOT, { recursive: true, force: true }));

const ISO = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z';

test('writes "<ISO> <LEVEL> [prefix] message <JSON extra>" to <dir>/bot.log', () => {
  const dir = freshDir();
  const log = createLogger({ dir, echo: false, prefix: 'bot' });
  log.info('hello', { a: 1, s: '會議' });
  log.warn('careful');
  const lines = readLines(dir);
  assert.equal(lines.length, 2);
  assert.match(lines[0], new RegExp(`^${ISO} INFO \\[bot\\] hello \\{"a":1,"s":"會議"\\}$`));
  assert.match(lines[1], new RegExp(`^${ISO} WARN \\[bot\\] careful$`));
});

test('the ISO timestamp is the current time', () => {
  const dir = freshDir();
  const t0 = Date.now();
  createLogger({ dir, echo: false }).info('x');
  const ts = Date.parse(readLines(dir)[0].split(' ')[0]);
  assert.ok(ts >= t0 - 5 && ts <= Date.now() + 5);
});

test('no brackets when prefix is empty', () => {
  const dir = freshDir();
  createLogger({ dir, echo: false }).error('boom');
  assert.match(readLines(dir)[0], new RegExp(`^${ISO} ERROR boom$`));
});

test('appends across logger instances (does not truncate)', () => {
  const dir = freshDir();
  createLogger({ dir, echo: false }).info('one');
  createLogger({ dir, echo: false }).info('two');
  assert.deepEqual(
    readLines(dir).map((l) => l.split(' ').slice(2).join(' ')),
    ['one', 'two'],
  );
});

test('level filtering: default info drops debug', () => {
  const dir = freshDir();
  const log = createLogger({ dir, echo: false });
  log.debug('d');
  log.info('i');
  log.warn('w');
  log.error('e');
  assert.deepEqual(
    readLines(dir).map((l) => l.split(' ')[1]),
    ['INFO', 'WARN', 'ERROR'],
  );
});

test('level filtering: debug keeps all, warn keeps warn+error, unknown level falls back to info', () => {
  const d1 = freshDir();
  const all = createLogger({ dir: d1, echo: false, level: 'debug' });
  all.debug('d');
  all.info('i');
  assert.deepEqual(readLines(d1).map((l) => l.split(' ')[1]), ['DEBUG', 'INFO']);

  const d2 = freshDir();
  const warn = createLogger({ dir: d2, echo: false, level: 'warn' });
  warn.info('i');
  warn.warn('w');
  warn.error('e');
  assert.deepEqual(readLines(d2).map((l) => l.split(' ')[1]), ['WARN', 'ERROR']);

  const d3 = freshDir();
  const odd = createLogger({ dir: d3, echo: false, level: 'chatty' });
  odd.debug('d');
  odd.info('i');
  assert.deepEqual(readLines(d3).map((l) => l.split(' ')[1]), ['INFO']);
});

test('echo: true writes the same line to stderr; echo: false does not', (t) => {
  const dir = freshDir();
  const writes = [];
  t.mock.method(process.stderr, 'write', (chunk) => {
    writes.push(String(chunk));
    return true;
  });
  createLogger({ dir, echo: true, prefix: 'p' }).info('to both', { k: true });
  createLogger({ dir, echo: false, prefix: 'p' }).info('file only');
  const lines = readLines(dir);
  assert.equal(writes.length, 1);
  assert.equal(writes[0], `${lines[0]}\n`);
  assert.equal(lines.length, 2);
});

test('echo defaults to true', (t) => {
  const writes = [];
  t.mock.method(process.stderr, 'write', (chunk) => {
    writes.push(String(chunk));
    return true;
  });
  createLogger().info('default echo');
  assert.equal(writes.length, 1);
  assert.match(writes[0], / INFO default echo\n$/);
});

test('dir = null writes nothing to disk and does not throw', (t) => {
  t.mock.method(process.stderr, 'write', () => true);
  const log = createLogger({ dir: null });
  assert.doesNotThrow(() => log.info('x', { y: 1 }));
});

test('creates a missing log dir', () => {
  const dir = path.join(freshDir(), 'sub', 'dir');
  createLogger({ dir, echo: false }).info('made');
  assert.equal(readLines(dir).length, 1);
});

test('never throws when the dir vanished', () => {
  const dir = freshDir();
  const log = createLogger({ dir, echo: false });
  log.info('before');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.doesNotThrow(() => {
    log.debug('a');
    log.info('b', { c: 1 });
    log.warn('c');
    log.error('d');
  });
});

test('never throws when stderr write fails', (t) => {
  t.mock.method(process.stderr, 'write', () => {
    throw new Error('EPIPE');
  });
  assert.doesNotThrow(() => createLogger({ echo: true }).error('x'));
});

test('child(prefix) shares dir/level/echo and nests the prefix', () => {
  const dir = freshDir();
  const root = createLogger({ dir, echo: false, level: 'warn', prefix: 'session' });
  const child = root.child('join');
  child.info('dropped by level');
  child.warn('kept');
  root.child('').warn('same prefix');
  createLogger({ dir, echo: false }).child('solo').error('x');
  const lines = readLines(dir);
  assert.equal(lines.length, 3);
  assert.match(lines[0], new RegExp(`^${ISO} WARN \\[session:join\\] kept$`));
  assert.match(lines[1], new RegExp(`^${ISO} WARN \\[session\\] same prefix$`));
  assert.match(lines[2], new RegExp(`^${ISO} ERROR \\[solo\\] x$`));
});

test('extra: Errors are serialized with name/message/stack; circular values do not throw', () => {
  const dir = freshDir();
  const log = createLogger({ dir, echo: false });
  const err = Object.assign(new Error('bad thing'), { code: 'E_BAD' });
  log.error('failed', err);
  log.error('nested', { err });
  const circ = { a: 1 };
  circ.self = circ;
  assert.doesNotThrow(() => log.info('circ', circ));
  log.info('bigint', { n: 10n });
  const lines = readLines(dir);
  assert.equal(lines.length, 4);
  const extra0 = JSON.parse(lines[0].slice(lines[0].indexOf('{')));
  assert.equal(extra0.message, 'bad thing');
  assert.equal(extra0.name, 'Error');
  assert.equal(extra0.code, 'E_BAD');
  assert.match(extra0.stack, /bad thing/);
  const extra1 = JSON.parse(lines[1].slice(lines[1].indexOf('{')));
  assert.equal(extra1.err.message, 'bad thing');
  assert.match(lines[2], / INFO circ /);
  assert.match(lines[3], /\{"n":"10"\}$/);
});

test('extra undefined/null is omitted; non-string messages are stringified', () => {
  const dir = freshDir();
  const log = createLogger({ dir, echo: false });
  log.info('no extra', undefined);
  log.info('null extra', null);
  log.info(/** @type {any} */ (42));
  log.info(/** @type {any} */ (new Error('as message')));
  const lines = readLines(dir);
  assert.match(lines[0], / INFO no extra$/);
  assert.match(lines[1], / INFO null extra$/);
  assert.match(lines[2], / INFO 42$/);
  assert.match(lines[3], / INFO Error: as message/);
});

test('each log call produces exactly one line (newlines in messages are escaped)', () => {
  const dir = freshDir();
  createLogger({ dir, echo: false }).info('line1\nline2\r\nline3');
  const lines = readLines(dir);
  assert.equal(lines.length, 1);
  assert.match(lines[0], / INFO line1\\nline2\\r\\nline3$/);
});
