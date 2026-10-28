/**
 * Detached worker process entry: `node src/worker.js --dir <meetingDir> [--env-file F]
 * [--url U] [--code C] [--id I] [--name N] [--lang L]`. Anything not given on the command line
 * is read from `<dir>/status.json` (written by `openmeeting join`). Runs one session, then
 * exits (0 = done, 1 = failed). The real log is bot.log; stdout/stderr go to `<dir>/worker.out`.
 *
 * Two ways in (see cli.js launchWorker):
 * - detached spawn: the environment is inherited and stdio is already `<dir>/worker.out`;
 * - WMI (Windows default): the process gets a fresh user environment and no stdio, so join
 *   passes `--env-file=<dir>/worker-env.json` (loaded into process.env before anything reads
 *   it) and, when started with `--env-file`, the worker appends its own stdout/stderr to
 *   `<dir>/worker.out`.
 * @module worker
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { getConfig } from './config.js';
import { readStatus, writeStatus } from './status.js';
import { createLogger } from './log.js';

/** Terminal status states (same as session.js TERMINAL_STATES; session.js is imported lazily). */
const TERMINAL_STATES = Object.freeze(['done', 'failed']);

/**
 * Environment variables `join` hands to a WMI-launched worker through the env file: every
 * OPENMEETING_* variable plus CHROME_PATH and TZ (case-insensitive, as Windows env names are).
 */
export const WORKER_ENV_KEY = /^(?:OPENMEETING_.*|CHROME_PATH|TZ)$/i;

/**
 * Parse worker arguments (`--key value` pairs).
 * @param {string[]} argv
 * @returns {{ dir?: string, url?: string, code?: string, id?: string, name?: string, lang?: string, 'env-file'?: string }}
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
 * Load an env file written by `join` (a JSON object of name → string) into `env`, so the
 * worker sees exactly the parent's values: every managed variable ({@link WORKER_ENV_KEY})
 * already in `env` is removed first (the fresh user environment may have its own), then the
 * file's managed string entries are set. Anything else in the file is ignored.
 * @param {string} file
 * @param {Record<string, string|undefined>} env mutated (process.env in the real worker)
 * @throws when the file is missing or not a JSON object
 */
export function applyEnvFile(file, env) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read the env file ${file}: ${e && /** @type {any} */ (e).message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`the env file ${file} is not a JSON object`);
  for (const key of Object.keys(env)) {
    if (WORKER_ENV_KEY.test(key)) delete env[key];
  }
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && WORKER_ENV_KEY.test(key)) env[key] = value;
  }
}

/**
 * Append everything written to process.stdout / process.stderr (console.* included) to `file`,
 * synchronously, instead of the original streams (a WMI-created process has no stdio).
 * @param {string} file
 * @returns {() => void} restores the original writers and closes the file
 */
export function redirectStdio(file) {
  const fd = fs.openSync(file, 'a');
  const saved = { out: process.stdout.write, err: process.stderr.write };
  const writer = function write(/** @type {any} */ chunk, /** @type {any} */ encoding, /** @type {any} */ cb) {
    if (typeof encoding === 'function') {
      cb = encoding;
      encoding = undefined;
    }
    try {
      fs.writeSync(fd, typeof chunk === 'string' ? Buffer.from(chunk, encoding || 'utf8') : chunk);
    } catch {
      /* never let logging kill the worker */
    }
    if (typeof cb === 'function') process.nextTick(cb);
    return true;
  };
  process.stdout.write = /** @type {any} */ (writer);
  process.stderr.write = /** @type {any} */ (writer);
  return () => {
    process.stdout.write = saved.out;
    process.stderr.write = saved.err;
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
  };
}

/** @param {unknown} err */
const errText = (err) => String((err && /** @type {any} */ (err).stack) || err);

/**
 * Worker main. Never throws; returns the process exit code.
 * @param {string[]} argv
 * @param {Record<string, string|undefined>} [env] receives the `--env-file` entries
 * @param {{ crashHandlers?: boolean, captureStdio?: boolean }} [opts] crashHandlers: install
 *   process-wide uncaughtException / unhandledRejection handlers; captureStdio: with
 *   `--env-file`, redirect stdout/stderr to `<dir>/worker.out` (the real worker process does
 *   both; tests don't)
 * @returns {Promise<number>}
 */
export async function workerMain(argv, env = process.env, { crashHandlers = false, captureStdio = false } = {}) {
  const args = parseWorkerArgs(argv);
  if (!args.dir) {
    process.stderr.write('usage: node src/worker.js --dir <meetingDir> [--env-file <file>]\n');
    return 2;
  }
  const dir = path.resolve(args.dir);
  const envFile = args['env-file'] ? path.resolve(args['env-file']) : '';
  let captured = false;
  if (envFile && captureStdio) {
    try {
      redirectStdio(path.join(dir, 'worker.out'));
      captured = true;
      process.stderr.write(`${new Date().toISOString()} [worker] pid ${process.pid} started (env file ${envFile})\n`);
    } catch {
      /* keep the original (empty) stdio */
    }
  }

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

  // The environment must be complete before anything reads it (config, logger level, session).
  let envError = null;
  if (envFile) {
    try {
      applyEnvFile(envFile, env);
    } catch (err) {
      envError = err;
    }
  }
  const config = getConfig(env);
  const status = readStatus(dir) || {};
  const log = createLogger({ dir, echo: false, level: env.OPENMEETING_DEBUG === '1' ? 'debug' : 'info', prefix: 'worker' });

  if (envError) {
    // never run with the wrong environment (it decides the Chrome profile and the meetings dir)
    log.error('worker: env file unusable; not starting', envError);
    if (captured) process.stderr.write(`${new Date().toISOString()} [worker] ${errText(envError)}\n`);
    markCrashed(envError);
    return 1;
  }

  if (crashHandlers) {
    // A stray rejection (e.g. from a Playwright event after the page closed) must not end the meeting.
    process.on('unhandledRejection', (err) => log.warn('unhandled promise rejection (ignored)', err));
    process.on('uncaughtException', (err) => {
      log.error('uncaught exception; the worker stops', err);
      process.stderr.write(`${new Date().toISOString()} [worker] uncaught exception: ${errText(err)}\n`);
      markCrashed(err);
      process.exit(1);
    });
  }

  if (TERMINAL_STATES.includes(status.state)) {
    // `join` gave up waiting for this worker (or the meeting already ended): do not start late.
    log.warn(`meeting is already ${status.state}; not starting`, { error: status.error || null });
    return 1;
  }
  if (envFile && status.launcher === 'spawn-fallback') {
    // a WMI launch that join gave up on (e.g. PowerShell timed out) and replaced with a detached
    // spawn: that worker owns the meeting, a second one would only fight it for the profile
    log.warn('join already fell back to a detached spawn for this meeting; this late WMI-launched worker exits');
    return 1;
  }
  if (Object.keys(status).length) {
    // Report in right away (before the heavy imports): `join` waits for this after a WMI launch.
    try {
      writeStatus(dir, { pid: process.pid, heartbeatAt: new Date().toISOString() });
    } catch (err) {
      log.warn(`status write failed: ${err && /** @type {any} */ (err).message}`);
    }
  }
  log.info(`worker pid ${process.pid} started`, { envFile: envFile || null, node: process.execPath });

  const url = args.url || status.url;
  const code = args.code || status.code;
  const id = args.id || status.id || path.basename(dir);
  if (!url || !code) {
    const msg = `worker: no meeting url/code (status.json missing or incomplete in ${dir})`;
    log.error(msg);
    markCrashed(new Error(msg));
    return 1;
  }
  let liveServer = null;
  if (!config.headless && env.OPENMEETING_LIVE_PANEL !== '0') {
    const port = Number(env.OPENMEETING_LIVE_PORT) || 8791;
    let baseUrl = `http://127.0.0.1:${port}`;
    try {
      const { startLiveServer } = await import('./live-server.js');
      liveServer = await startLiveServer({ meetingsDir: config.meetingsDir, port });
      baseUrl = liveServer.url;
    } catch {
      /* EADDRINUSE: reuse existing live server on port */
    }
    const liveUrl = `${baseUrl}/?id=${encodeURIComponent(id)}${status.source === 'teams' ? '&source=teams' : ''}`;
    try { writeStatus(dir, { liveUrl }); } catch { /* ignore */ }
    if (env.OPENMEETING_NO_BROWSER !== '1' && status.teamsBrowserEnabled !== false) {
      try {
        if (process.platform === 'win32') {
          spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', liveUrl], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        }
      } catch { /* ignore */ }
    }
  }
  try {
    if (status.source === 'teams') {
      const { runTeamsRecording } = await import('./teams-recording.js');
      const final = await runTeamsRecording({config,dir,id,url,status});
      return final?.state === 'done' ? 0 : 1;
    }
    const { runSession } = await import('./session.js');
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
    process.stderr.write(`${new Date().toISOString()} [worker] session threw: ${errText(err)}\n`);
    markCrashed(err);
    return 1;
  } finally {
    try { await liveServer?.shutdown(); } catch { /* ignore */ }
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  workerMain(process.argv.slice(2), process.env, { crashHandlers: true, captureStdio: true }).then((code) => {
    // Playwright / timers may keep handles open; the session is over, so exit explicitly.
    setTimeout(() => process.exit(code), 100).unref();
    process.exitCode = code;
  });
}
