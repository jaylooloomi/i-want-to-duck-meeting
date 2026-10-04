// Meeting directories + status.json (atomic read-merge-write) + locating meetings.
// NOTE: uses the default `fs` object (not named imports) so tests can mock fs.renameSync.
import fs from 'node:fs';
import path from 'node:path';

const STATUS_FILE = 'status.json';
const RENAME_RETRIES = 5;
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));

/** Synchronous sleep (status writes are sync by contract). @param {number} ms */
function sleepSync(ms) {
  Atomics.wait(SLEEP_CELL, 0, 0, ms);
}

/** @param {number} n */
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Meeting id `YYYYMMDD-HHmmss-<code>` in local time. The code is reduced to `[a-z0-9-]`
 * (so the id is always a safe directory name); an empty code becomes `meeting`.
 * @param {string} code
 * @param {Date} [now=new Date()]
 * @returns {string}
 */
export function newMeetingId(code, now = new Date()) {
  const safe = String(code ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'meeting';
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `${date}-${time}-${safe}`;
}

/**
 * Creates `<meetingsDir>/<id>/` and its `screens/` subdir (mkdir -p; idempotent).
 * @param {string} meetingsDir
 * @param {string} id
 * @returns {string} absolute meeting dir
 */
export function createMeetingDir(meetingsDir, id) {
  const dir = path.resolve(meetingsDir, id);
  fs.mkdirSync(path.join(dir, 'screens'), { recursive: true });
  return dir;
}

/**
 * Reads `<dir>/status.json`. Retries briefly on transient Windows sharing errors.
 * @param {string} dir
 * @returns {Record<string, any>|null} null when missing or unreadable/corrupt
 */
export function readStatus(dir) {
  const file = path.join(dir, STATUS_FILE);
  for (let attempt = 0; ; attempt++) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return null;
      if (attempt >= 3) return null;
      sleepSync(10 * (attempt + 1));
    }
  }
}

/** How long writeStatus keeps retrying a status.json that exists but cannot be read. */
const READ_FOR_WRITE_RETRIES = 12;

/**
 * The current status for a read-merge-write. Unlike {@link readStatus}, only a MISSING file
 * counts as empty: a file that is briefly locked (EBUSY/EPERM/EACCES on Windows) is retried
 * for about a second and then the error is thrown, so a transient failure can never replace
 * status.json with a status that lost its id/pid/state. A file that stays unparsable (corrupt,
 * e.g. truncated by a power loss) is treated as empty after a few retries, so it can heal.
 * @param {string} dir
 * @returns {Record<string, any>}
 */
function readStatusForWrite(dir) {
  const file = path.join(dir, STATUS_FILE);
  for (let attempt = 0; ; attempt++) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return {};
      if (attempt >= READ_FOR_WRITE_RETRIES) throw err;
      sleepSync(Math.min(150, 15 * (attempt + 1)));
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      if (isPlainObject(parsed)) return parsed;
    } catch {
      /* unparsable: retried below */
    }
    if (attempt >= 3) return {};
    sleepSync(10 * (attempt + 1));
  }
}

/**
 * Read-merge-write `<dir>/status.json` atomically: writes a temp file in the same dir and
 * renames it over status.json (rename retried up to 5x on EPERM/EBUSY/EACCES — Windows
 * readers can briefly lock the target). Top-level keys are replaced (undefined values are
 * ignored, null clears); `stats` is merged shallowly. Always sets `updatedAt`.
 * @param {string} dir meeting dir (created if missing)
 * @param {Record<string, any>} patch
 * @returns {Record<string, any>} the status as written
 * @throws the last rename error when all retries fail (the temp file is removed), or the read
 *   error when an existing status.json stays unreadable (it is then left untouched)
 */
export function writeStatus(dir, patch) {
  const current = readStatusForWrite(dir);
  /** @type {Record<string, any>} */
  const next = { ...current };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === undefined) continue;
    if (key === 'stats' && isPlainObject(value) && isPlainObject(current.stats)) {
      next.stats = { ...current.stats, ...dropUndefined(value) };
    } else {
      next[key] = value;
    }
  }
  next.updatedAt = new Date().toISOString();

  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, STATUS_FILE);
  const tmp = path.join(dir, `.${STATUS_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return next;
    } catch (err) {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code;
      if (attempt < RENAME_RETRIES && code && RETRYABLE.has(code)) {
        sleepSync(15 * (attempt + 1));
        continue;
      }
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
      throw err;
    }
  }
}

/** @param {unknown} v @returns {v is Record<string, any>} */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** @param {Record<string, any>} obj */
function dropUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/**
 * Meeting ids (subdirectory names, excluding dot-dirs) sorted newest first by name.
 * @param {string} meetingsDir
 * @returns {string[]}
 */
function meetingIds(meetingsDir) {
  let entries;
  try {
    entries = fs.readdirSync(meetingsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort()
    .reverse();
}

/**
 * Locates a meeting by exact id, unique id prefix, or `'latest'` (newest dir by name;
 * also used when `idOrLatest` is empty).
 * @param {string} meetingsDir
 * @param {string|undefined|null} idOrLatest
 * @returns {{ id: string, dir: string }|null} null when not found or the prefix is ambiguous
 */
export function resolveMeeting(meetingsDir, idOrLatest) {
  const ids = meetingIds(meetingsDir);
  if (ids.length === 0) return null;
  const wanted = String(idOrLatest ?? '').trim();
  const base = path.resolve(meetingsDir);
  /** @param {string} id */
  const hit = (id) => ({ id, dir: path.join(base, id) });
  if (!wanted || wanted.toLowerCase() === 'latest') return hit(ids[0]);
  if (ids.includes(wanted)) return hit(wanted);
  const matches = ids.filter((id) => id.startsWith(wanted));
  return matches.length === 1 ? hit(matches[0]) : null;
}

/**
 * All meetings, newest first (by dir name), each with its status (null if unreadable).
 * @param {string} meetingsDir
 * @returns {{ id: string, dir: string, status: Record<string, any>|null }[]}
 */
export function listMeetings(meetingsDir) {
  const base = path.resolve(meetingsDir);
  return meetingIds(meetingsDir).map((id) => {
    const dir = path.join(base, id);
    return { id, dir, status: readStatus(dir) };
  });
}

/**
 * Whether a process with this pid exists (`process.kill(pid, 0)`; EPERM counts as alive).
 * @param {number} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM';
  }
}
