import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { findChrome, launchChrome, connectChrome } from '../../src/chrome.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.resolve(here, '..', '.tmp', 'chrome');
const RUN = path.join(TMP, `run-${process.pid}-${Date.now()}`);

/** @type {Array<{ close: () => Promise<void> }>} */
const launched = [];

after(async () => {
  for (const h of launched) {
    try { await h.close(); } catch { /* ignore */ }
  }
  fs.rmSync(RUN, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

/** Resolves true if http://127.0.0.1:<port>/json/version answers 200. */
function endpointAnswers(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/json/version', agent: false, timeout: 1500 },
      (res) => { res.resume(); resolve(res.statusCode === 200); },
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** win32 only: number of chrome.exe processes whose command line mentions profileDir. */
function chromeProcsForProfile(profileDir) {
  const needle = path.basename(profileDir);
  const out = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${needle}*' }).Count`,
  ], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  return Number(out.trim());
}

const logLines = [];
const log = { info: (m) => logLines.push(m), warn: (m) => logLines.push(m), error: (m) => logLines.push(m) };

describe('launchChrome + connectChrome (real Chrome, headless)', { timeout: 120_000 }, () => {
  const chromePath = findChrome();

  test('launch, connect, navigate, no webdriver flag, close kills everything', async () => {
    const profileDir = path.join(RUN, 'nested', 'profile-a'); // does not exist yet
    assert.equal(fs.existsSync(profileDir), false);

    const chrome = await launchChrome({ chromePath, profileDir, headless: true, muteAudio: true, log });
    launched.push(chrome);
    assert.ok(fs.existsSync(profileDir), 'profileDir is created');
    assert.equal(typeof chrome.port, 'number');
    assert.ok(chrome.port > 0);
    assert.equal(typeof chrome.cdpUrl, 'string');
    assert.ok(chrome.proc && chrome.proc.pid > 0);
    assert.equal(await endpointAnswers(chrome.port), true);

    const { browser, context, page } = await connectChrome(chrome.cdpUrl);
    assert.ok(browser.isConnected());
    assert.equal(context, browser.contexts()[0]);
    assert.ok(context.pages().includes(page));

    await page.goto('data:text/html,<h1>hi</h1>');
    assert.equal(await page.textContent('h1'), 'hi');
    assert.equal(await page.evaluate(() => navigator.webdriver), false);

    const pid = chrome.proc.pid;
    const disconnected = new Promise((r) => browser.once('disconnected', r));
    const t0 = Date.now();
    await chrome.close();
    const took = Date.now() - t0;
    assert.ok(took < 5_500, `close() took ${took} ms`);
    await disconnected;

    assert.ok(chrome.proc.exitCode !== null || chrome.proc.signalCode !== null, 'child has exited');
    assert.equal(pidAlive(pid), false, 'browser pid is gone');
    assert.equal(await endpointAnswers(chrome.port), false, 'port no longer answers');
    if (process.platform === 'win32') {
      assert.equal(chromeProcsForProfile(profileDir), 0, 'no chrome.exe left for this profile');
    }

    // Idempotent.
    await chrome.close();
    await chrome.close();
  });

  test('second launch on a profile that is in use rejects fast with chrome_launch_failed', async () => {
    const profileDir = path.join(RUN, 'profile-b');
    const first = await launchChrome({ chromePath, profileDir, headless: true, muteAudio: true, log });
    launched.push(first);
    assert.equal(await endpointAnswers(first.port), true);

    const t0 = Date.now();
    await assert.rejects(
      launchChrome({ chromePath, profileDir, headless: true, muteAudio: true, log }),
      (err) => {
        assert.equal(err.code, 'chrome_launch_failed');
        assert.match(err.message, /^chrome_launch_failed/);
        assert.match(err.message, /in use/i);
        return true;
      },
    );
    const took = Date.now() - t0;
    // win32 detects the held lockfile before spawning; elsewhere the early-exit check catches it.
    const limit = process.platform === 'win32' ? 3_000 : 15_000;
    assert.ok(took < limit, `second launch should fail fast, took ${took} ms`);

    // The first instance is unaffected and still closes cleanly.
    assert.equal(await endpointAnswers(first.port), true);
    const pid = first.proc.pid;
    await first.close();
    assert.equal(pidAlive(pid), false);
    assert.equal(await endpointAnswers(first.port), false);
    if (process.platform === 'win32') {
      assert.equal(chromeProcsForProfile(profileDir), 0, 'no chrome.exe left for this profile');
    }
  });

  test('a process that exits before the DevTools endpoint answers -> chrome_launch_failed, fast', async () => {
    // node.exe stands in for a Chrome that exits immediately (it rejects the Chrome flags with exit 9).
    const t0 = Date.now();
    await assert.rejects(
      launchChrome({ chromePath: process.execPath, profileDir: path.join(RUN, 'profile-fake'), headless: true, log }),
      (err) => {
        assert.equal(err.code, 'chrome_launch_failed');
        assert.match(err.message, /^chrome_launch_failed: Chrome exited \(code 9\)/);
        assert.match(err.message, /in use by another Chrome window/);
        return true;
      },
    );
    assert.ok(Date.now() - t0 < 5_000, 'fails fast instead of waiting 20 s');
  });

  test('close() falls back to killing the process tree when CDP Browser.close is unavailable', async () => {
    const profileDir = path.join(RUN, 'profile-kill');
    const chrome = await launchChrome({ chromePath, profileDir, headless: true, muteAudio: true, log });
    launched.push(chrome);
    const { page } = await connectChrome(chrome.cdpUrl);
    await page.goto('data:text/html,<p>busy</p>');
    const pid = chrome.proc.pid;
    const savedWs = globalThis.WebSocket;
    globalThis.WebSocket = undefined; // disables the graceful path
    const t0 = Date.now();
    try {
      await chrome.close();
    } finally {
      globalThis.WebSocket = savedWs;
    }
    assert.ok(Date.now() - t0 < 5_500, 'forced close stays within budget');
    assert.equal(pidAlive(pid), false);
    assert.equal(await endpointAnswers(chrome.port), false);
    if (process.platform === 'win32') {
      assert.equal(chromeProcsForProfile(profileDir), 0, 'taskkill /T removed the whole tree');
    }
  });

  test('close() after Chrome already exited on its own resolves quickly', async () => {
    const profileDir = path.join(RUN, 'profile-gone');
    const chrome = await launchChrome({ chromePath, profileDir, headless: true, muteAudio: true, log });
    launched.push(chrome);
    const exited = new Promise((r) => chrome.proc.once('exit', r));
    if (process.platform === 'win32') {
      // spawnSync, not execFileSync: `taskkill /T /F` exits 255 now and then when a child of the
      // tree is already gone by the time it is visited (a race, the tree still dies). The real
      // check is `await exited` below.
      spawnSync('taskkill', ['/pid', String(chrome.proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      chrome.proc.kill('SIGKILL');
    }
    await exited;
    const t0 = Date.now();
    await chrome.close();
    assert.ok(Date.now() - t0 < 500);
  });

  test('a stale lockfile from a crashed Chrome does not block the launch', async () => {
    const profileDir = path.join(RUN, 'profile-stale');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'lockfile'), '');
    const chrome = await launchChrome({ chromePath, profileDir, headless: true, muteAudio: true, log });
    launched.push(chrome);
    assert.equal(await endpointAnswers(chrome.port), true);
    await chrome.close();
    assert.equal(await endpointAnswers(chrome.port), false);
  });

  test('a missing chromePath rejects with chrome_not_found', async () => {
    await assert.rejects(
      launchChrome({
        chromePath: path.join(RUN, 'no-such', 'chrome.exe'),
        profileDir: path.join(RUN, 'profile-c'),
        headless: true,
        muteAudio: true,
      }),
      (err) => err.code === 'chrome_not_found' && err.message === 'chrome_not_found',
    );
  });
});
