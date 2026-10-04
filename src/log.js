// Tiny logger: one line per call → <dir>/bot.log (append) and/or stderr. Never throws.
import fs from 'node:fs';
import path from 'node:path';

const LEVELS = /** @type {const} */ (['debug', 'info', 'warn', 'error']);

/**
 * @typedef {object} Logger
 * @property {(msg: unknown, extra?: unknown) => void} debug
 * @property {(msg: unknown, extra?: unknown) => void} info
 * @property {(msg: unknown, extra?: unknown) => void} warn
 * @property {(msg: unknown, extra?: unknown) => void} error
 * @property {(prefix: string) => Logger} child  same sink/level, prefix nested as `parent:child`
 */

/** JSON replacer: Errors → plain objects, BigInt → string. */
function replacer(_key, value) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, ...value, stack: value.stack };
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/** @param {unknown} extra */
function formatExtra(extra) {
  try {
    const json = JSON.stringify(extra, replacer);
    return json === undefined ? String(extra) : json;
  } catch {
    try {
      return JSON.stringify(String(extra));
    } catch {
      return '"[unserializable]"';
    }
  }
}

/** @param {unknown} msg */
function formatMessage(msg) {
  let s;
  if (typeof msg === 'string') s = msg;
  else if (msg instanceof Error) s = msg.stack || `${msg.name}: ${msg.message}`;
  else {
    try {
      s = String(msg);
    } catch {
      s = '[unprintable]';
    }
  }
  return s.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

/**
 * Creates a logger. Each line: `<ISO> <LEVEL> [prefix] message <JSON extra>` (brackets omitted
 * when prefix is empty, extra omitted when undefined/null). Appended with fs.appendFileSync to
 * `<dir>/bot.log` when `dir` is set (dir created on construction if possible), echoed to stderr
 * when `echo`. Messages below `level` are dropped. Logging never throws.
 * @param {{ dir?: string|null, echo?: boolean, level?: 'debug'|'info'|'warn'|'error', prefix?: string }} [opts]
 * @returns {Logger}
 */
export function createLogger({ dir = null, echo = true, level = 'info', prefix = '' } = {}) {
  const file = dir ? path.join(dir, 'bot.log') : null;
  if (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore: logging must never throw */
    }
  }
  const min = LEVELS.includes(/** @type {any} */ (level)) ? LEVELS.indexOf(/** @type {any} */ (level)) : 1;
  return build(file, echo, min, prefix || '');
}

/**
 * @param {string|null} file
 * @param {boolean} echo
 * @param {number} min
 * @param {string} prefix
 * @returns {Logger}
 */
function build(file, echo, min, prefix) {
  /** @param {number} lvl @param {unknown} msg @param {unknown} extra */
  function emit(lvl, msg, extra) {
    if (lvl < min) return;
    let line;
    try {
      line = `${new Date().toISOString()} ${LEVELS[lvl].toUpperCase()}${prefix ? ` [${prefix}]` : ''} ${formatMessage(msg)}`;
      if (extra !== undefined && extra !== null) line += ` ${formatExtra(extra)}`;
      line += '\n';
    } catch {
      return;
    }
    if (file) {
      try {
        fs.appendFileSync(file, line, 'utf8');
      } catch {
        /* dir vanished / disk issue: ignore */
      }
    }
    if (echo) {
      try {
        process.stderr.write(line);
      } catch {
        /* ignore */
      }
    }
  }
  return {
    debug: (msg, extra) => emit(0, msg, extra),
    info: (msg, extra) => emit(1, msg, extra),
    warn: (msg, extra) => emit(2, msg, extra),
    error: (msg, extra) => emit(3, msg, extra),
    child: (childPrefix) =>
      build(file, echo, min, [prefix, childPrefix].filter(Boolean).join(':')),
  };
}
