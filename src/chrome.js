// Find / launch the real installed Chrome with a dedicated profile and a CDP port,
// connect Playwright to it over CDP, and shut it down again (spec 5.4).
//
// Chrome is spawned directly (never via Playwright's launcher) so that none of
// Playwright's automation flags (--enable-automation etc.) end up on the command line.

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { chromium } from 'playwright-core';

const CHROME_REL = path.join('Google', 'Chrome', 'Application', 'chrome.exe');
const POLL_INTERVAL_MS = 250;
const LAUNCH_TIMEOUT_MS = 20_000;
// Enumerating a Windows process tree can exceed 1.5 s on a busy workstation.
// Allow taskkill to finish rather than terminating it while Chrome is still alive.
const GRACEFUL_CLOSE_MS = 2_000;
const KILL_WAIT_MS = 5_000;

/**
 * Error with a machine-readable `code` (one of the status.json error codes).
 * @param {string} code
 * @param {string} [detail] appended to the message as `<code>: <detail>`
 */
function codedError(code, detail) {
  const err = new Error(detail ? `${code}: ${detail}` : code);
  /** @type {any} */ (err).code = code;
  return err;
}

/** Windows env lookup: exact name first, then case-insensitive. */
function envGet(env, name) {
  if (env[name]) return env[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === lower && env[key]) return env[key];
  }
  return undefined;
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

/**
 * Locate chrome.exe: env CHROME_PATH (if it exists), then
 * %ProgramFiles%, %ProgramFiles(x86)%, %LOCALAPPDATA% \Google\Chrome\Application\chrome.exe.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string} absolute path
 * @throws {Error} message/code 'chrome_not_found'
 */
export function findChrome(env = process.env) {
  const candidates = [];
  const custom = envGet(env, 'CHROME_PATH');
  if (custom) candidates.push(custom);
  for (const base of ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA']) {
    const dir = envGet(env, base);
    if (dir) candidates.push(path.join(dir, CHROME_REL));
  }
  for (const c of candidates) {
    if (isFile(c)) return path.resolve(c);
  }
  throw codedError('chrome_not_found');
}

/**
 * Chrome command-line flags. Exactly the spec 5.4 set, plus `--mute-audio` / `--headless=new`.
 * Deliberately nothing automation-flavoured (no --enable-automation, UA overrides, fake media...).
 * @param {{ profileDir: string, port: number, headless?: boolean, muteAudio?: boolean, windowSize?: string }} opts
 * @returns {string[]}
 */
export function chromeArgs({ profileDir, port, headless = false, muteAudio = false, windowSize = '1280,800' }) {
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    '--lang=en-US',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    `--window-size=${windowSize}`,
  ];
  if (muteAudio) args.push('--mute-audio');
  if (headless) args.push('--headless=new');
  return args;
}

/** Ask the OS for a free TCP port on 127.0.0.1. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {net.AddressInfo} */ (srv.address());
      srv.close(() => resolve(port));
    });
  });
}

/** GET a JSON document; resolves null on any error / non-200 / timeout. */
function getJson(url, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(url, { agent: false, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Call a logger that may be a function or an object with info/warn/error. */
function say(log, level, msg) {
  if (!log) return;
  try {
    if (typeof log === 'function') log(msg);
    else if (typeof log[level] === 'function') log[level](msg);
    else if (typeof log.info === 'function') log.info(msg);
  } catch { /* logging must never break launch/close */ }
}

/**
 * win32: a running Chrome keeps `<profile>\lockfile` open for writing with share-read only,
 * so opening it read-write fails with EBUSY. Detecting that up front avoids spawning a Chrome
 * that would just hand its launch off to the running instance (which then opens an extra
 * window there). Elsewhere (or if unsure) returns false and the exit check in launchChrome
 * catches the hand-off instead.
 */
function profileLocked(userDataDir) {
  if (process.platform !== 'win32') return false;
  const lockfile = path.join(userDataDir, 'lockfile');
  let fd;
  try {
    fd = fs.openSync(lockfile, 'r+');
    return false;
  } catch (e) {
    return /** @type {any} */ (e).code === 'EBUSY';
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

function hasExited(proc) {
  return proc.exitCode !== null || proc.signalCode !== null;
}

/** Resolves true once `proc` has exited, false after `ms`. */
function waitForExit(proc, ms) {
  if (!proc.pid || hasExited(proc)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { proc.off('exit', onExit); resolve(false); }, ms);
    function onExit() { clearTimeout(timer); resolve(true); }
    proc.once('exit', onExit);
  });
}

/**
 * Graceful shutdown: send CDP `Browser.close` over the browser websocket and wait for the
 * process to exit. Never throws; gives up after `ms`.
 */
async function cdpBrowserClose(wsUrl, proc, ms) {
  if (!wsUrl || typeof WebSocket !== 'function' || hasExited(proc)) return;
  let ws;
  try {
    let sent = false;
    let giveUp;
    const failedBeforeSend = new Promise((r) => { giveUp = r; });
    ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => {
      try { ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); sent = true; } catch { giveUp(); }
    });
    // Could not even connect -> don't wait out the budget, go straight to the kill.
    // (After a successful send, Chrome tearing the socket down is expected; keep waiting for exit.)
    ws.addEventListener('error', () => { if (!sent) giveUp(); });
    ws.addEventListener('close', () => { if (!sent) giveUp(); });
    await Promise.race([waitForExit(proc, ms), failedBeforeSend]);
  } catch { /* ignore */ } finally {
    try { ws?.close(); } catch { /* ignore */ }
  }
}

/** Force-kill the Chrome process tree. Never throws. */
function killTree(proc) {
  if (!proc.pid || hasExited(proc)) return Promise.resolve(); // never taskkill a pid that may be reused
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: KILL_WAIT_MS },
        () => resolve());
    });
  }
  try { proc.kill('SIGKILL'); } catch { /* ignore */ }
  return Promise.resolve();
}

/**
 * Spawn the real Chrome with a dedicated profile and a CDP port, and wait for the DevTools
 * endpoint. Chrome is a plain (non-detached) child of this process with stdio ignored.
 *
 * @param {{
 *   chromePath?: string, profileDir: string, headless?: boolean, muteAudio?: boolean,
 *   log?: any, startUrl?: string, extraArgs?: string[]
 * }} opts  chromePath defaults to findChrome().
 * @returns {Promise<{ proc: import('node:child_process').ChildProcess, port: number, cdpUrl: string,
 *   wsUrl: string, close: () => Promise<void> }>}  cdpUrl is `http://127.0.0.1:<port>` (for connectChrome).
 * @throws {Error} code 'chrome_not_found' | 'chrome_launch_failed'
 */
export async function launchChrome({
  chromePath, profileDir, headless = false, muteAudio = true, log, startUrl = 'about:blank', extraArgs = [],
} = /** @type {any} */ ({})) {
  if (!profileDir) throw new TypeError('launchChrome: profileDir is required');
  const exe = chromePath || findChrome();
  if (!isFile(exe)) throw codedError('chrome_not_found');

  const userDataDir = path.resolve(profileDir);
  fs.mkdirSync(userDataDir, { recursive: true });
  if (profileLocked(userDataDir)) {
    const err = codedError('chrome_launch_failed',
      `The profile ${userDataDir} is already in use by another Chrome window. ` +
      'Close that Chrome window (or wait for the other meeting to end), or use a different profile.');
    say(log, 'error', err.message);
    throw err;
  }
  const port = await getFreePort();
  const args = [...chromeArgs({ profileDir: userDataDir, port, headless, muteAudio }), ...extraArgs, startUrl];

  say(log, 'info', `chrome: launching ${exe} (port ${port}, profile ${userDataDir}, headless=${!!headless})`);
  const proc = spawn(exe, args, { stdio: 'ignore' });

  let spawnError = null;
  proc.on('error', (e) => { spawnError = e; });

  // If this Node process exits without close(), don't leave Chrome running.
  const onParentExit = () => { try { if (!hasExited(proc)) proc.kill(); } catch { /* ignore */ } };
  process.on('exit', onParentExit);
  proc.once('exit', () => process.off('exit', onParentExit));

  const versionUrl = `http://127.0.0.1:${port}/json/version`;
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  let wsUrl = null;
  let failure = null;
  for (;;) {
    if (spawnError) {
      failure = codedError('chrome_launch_failed', `could not start ${exe}: ${spawnError.message}`);
      break;
    }
    if (hasExited(proc)) {
      failure = codedError('chrome_launch_failed',
        `Chrome exited (code ${proc.exitCode ?? proc.signalCode}) before its DevTools endpoint answered. ` +
        `The profile ${userDataDir} is probably already in use by another Chrome window ` +
        '(Chrome hands a launch for the same --user-data-dir off to the already running process). ' +
        'Close that Chrome window, or use a different profile.');
      break;
    }
    const info = await getJson(versionUrl, 1000);
    if (info && typeof info.webSocketDebuggerUrl === 'string') {
      wsUrl = info.webSocketDebuggerUrl;
      break;
    }
    if (Date.now() >= deadline) {
      failure = codedError('chrome_launch_failed',
        `Chrome's DevTools endpoint ${versionUrl} did not answer within ${LAUNCH_TIMEOUT_MS / 1000} s.`);
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (failure) {
    await killTree(proc);
    await waitForExit(proc, KILL_WAIT_MS);
    process.off('exit', onParentExit);
    say(log, 'error', failure.message);
    throw failure;
  }

  say(log, 'info', `chrome: DevTools ready on port ${port} (pid ${proc.pid})`);

  /** @type {Promise<void> | null} */
  let closing = null;
  const close = () => {
    if (!closing) {
      closing = (async () => {
        await cdpBrowserClose(wsUrl, proc, GRACEFUL_CLOSE_MS);
        if (!hasExited(proc)) {
          say(log, 'warn', `chrome: graceful close did not finish, killing process tree (pid ${proc.pid})`);
          await killTree(proc);
          await waitForExit(proc, KILL_WAIT_MS);
        }
        process.off('exit', onParentExit);
        say(log, 'info', 'chrome: closed');
      })();
    }
    return closing;
  };

  return { proc, port, cdpUrl: `http://127.0.0.1:${port}`, wsUrl, close };
}

/**
 * Attach Playwright to a running Chrome over CDP.
 * @param {string} cdpUrl  `http://127.0.0.1:<port>` or the browser websocket URL
 * @returns {Promise<{ browser: import('playwright-core').Browser,
 *   context: import('playwright-core').BrowserContext, page: import('playwright-core').Page }>}
 */
export async function connectChrome(cdpUrl) {
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 30_000 });
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => {});
    throw codedError('chrome_launch_failed', 'connected over CDP but Chrome has no default browser context');
  }
  const page = context.pages()[0] ?? await context.newPage();
  return { browser, context, page };
}
