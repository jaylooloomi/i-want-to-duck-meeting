/**
 * Detached worker process entry: `node src/worker.js --dir <meetingDir> [--url U] [--code C]
 * [--id I] [--name N] [--lang L]`. Anything not given on the command line is read from
 * `<dir>/status.json` (written by `openmeeting join`). Runs one session, then exits
 * (0 = done, 1 = failed). Its stdout/stderr go to `<dir>/worker.out`; the real log is bot.log.
 * @module worker
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getConfig } from './config.js';
import { readStatus, writeStatus } from './status.js';
import { createLogger } from './log.js';
import { runSession, TERMINAL_STATES } from './session.js';

/**
 * Parse worker arguments (`--key value` pairs).
 * @param {string[]} argv
 * @returns {{ dir?: string, url?: string, code?: string, id?: string, name?: string, lang?: string }}
 */
export function parseWorkerArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) continue;
    const value = m[2] !== undefined ? m[2] : argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : '';
    out[m[1]] = value;
  }
  return out;
}

/**
 * Worker main. Never throws; returns the process exit code.
 * @param {string[]} argv
 * @param {Record<string, string|undefined>} [env]
 * @param {{ crashHandlers?: boolean }} [opts] crashHandlers: install process-wide
 *   uncaughtException / unhandledRejection handlers (the real worker process does; tests don't)
 * @returns {Promise<number>}
 */
export async function workerMain(argv, env = process.env, { crashHandlers = false } = {}) {
  const args = parseWorkerArgs(argv);
  if (!args.dir) {
    process.stderr.write('usage: node src/worker.js --dir <meetingDir>\n');
    return 2;
  }
  const dir = path.resolve(args.dir);
  const config = getConfig(env);
  const status = readStatus(dir) || {};
  const log = createLogger({ dir, echo: false, level: env.OPENMEETING_DEBUG === '1' ? 'debug' : 'info', prefix: 'worker' });

  const markCrashed = (/** @type {unknown} */ err) => {
    try {
      const s = readStatus(dir);
      if (!s || !TERMINAL_STATES.includes(s.state)) {
        writeStatus(dir, {
          state: 'failed', endedAt: new Date().toISOString(),
          error: { code: 'crashed', message: String((err && /** @type {any} */ (err).message) || err) },
        });
      }
    } catch {
      /* ignore */
    }
  };
  if (crashHandlers) {
    // A stray rejection (e.g. from a Playwright event after the page closed) must not end the meeting.
    process.on('unhandledRejection', (err) => log.warn('unhandled promise rejection (ignored)', err));
    process.on('uncaughtException', (err) => {
      log.error('uncaught exception; the worker stops', err);
      markCrashed(err);
      process.exit(1);
    });
  }

  const url = args.url || status.url;
  const code = args.code || status.code;
  const id = args.id || status.id || path.basename(dir);
  if (!url || !code) {
    const msg = `worker: no meeting url/code (status.json missing or incomplete in ${dir})`;
    log.error(msg);
    markCrashed(new Error(msg));
    return 1;
  }
  try {
    const final = await runSession({
      url,
      code,
      id,
      dir,
      displayName: args.name || status.displayName || config.displayName,
      captionLang: args.lang || config.captionLang,
      config,
      log: log.child('session'),
      foreground: false,
    });
    return final && final.state === 'done' ? 0 : 1;
  } catch (err) {
    log.error('session threw', err);
    markCrashed(err);
    return 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  workerMain(process.argv.slice(2), process.env, { crashHandlers: true }).then((code) => {
    // Playwright / timers may keep handles open; the session is over, so exit explicitly.
    setTimeout(() => process.exit(code), 100).unref();
    process.exitCode = code;
  });
}
