import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../../src/config.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('repo root fixture sanity: contains package.json', () => {
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'package.json')));
});

test('defaults with an empty env', () => {
  const c = getConfig({});
  assert.equal(c.home, REPO_ROOT);
  assert.equal(c.meetingsDir, path.join(REPO_ROOT, 'meetings'));
  assert.equal(c.profileDir, path.join(REPO_ROOT, 'chrome-profile'));
  assert.equal(c.chromePath, null);
  assert.equal(c.displayName, 'Arthur Wang');
  assert.equal(c.captionLang, 'cmn-Hant-TW');
  assert.equal(c.headless, false);
  assert.equal(c.muteAudio, true);
  assert.equal(c.allowAnyHost, false);
  assert.equal(c.lobbyTimeoutMs, 15 * 60_000);
  assert.equal(c.aloneTimeoutMs, 60_000);
  assert.equal(c.noOneTimeoutMs, 15 * 60_000);
  assert.equal(c.maxDurationMs, 4 * 3600_000);
  assert.equal(c.pollMs, 1500);
  assert.equal(c.sttVenv, path.join(REPO_ROOT, '.venv-stt'));
  assert.equal(c.trackMirror, false);
  assert.equal(c.langCheckMs, 60_000);
  assert.equal(c.noAudioWarnMs, 60_000);
});

test('trackMirror: off by default, on only for OPENMEETING_TRACK_MIRROR=1', () => {
  assert.equal(getConfig({}).trackMirror, false);
  assert.equal(getConfig({ OPENMEETING_TRACK_MIRROR: '1' }).trackMirror, true);
  for (const v of ['0', 'true', 'yes', '', ' 1']) {
    assert.equal(getConfig({ OPENMEETING_TRACK_MIRROR: v }).trackMirror, false, JSON.stringify(v));
  }
});

test('langCheckMs / noAudioWarnMs come from OPENMEETING_LANG_CHECK_MS / OPENMEETING_NO_AUDIO_WARN_MS', () => {
  const c = getConfig({ OPENMEETING_LANG_CHECK_MS: '1000', OPENMEETING_NO_AUDIO_WARN_MS: '2500' });
  assert.equal(c.langCheckMs, 1000);
  assert.equal(c.noAudioWarnMs, 2500);
  const bad = getConfig({ OPENMEETING_LANG_CHECK_MS: 'soon', OPENMEETING_NO_AUDIO_WARN_MS: '-1' });
  assert.equal(bad.langCheckMs, 60_000);
  assert.equal(bad.noAudioWarnMs, 60_000);
});

test('repoRoot is always the code location, even when home is overridden', () => {
  const home = path.join(REPO_ROOT, 'test', '.tmp', 'core', 'home');
  const c = getConfig({ OPENMEETING_HOME: home });
  assert.equal(c.repoRoot, REPO_ROOT);
  assert.equal(c.home, home);
});

test('OPENMEETING_HOME moves meetingsDir, profileDir and sttVenv', () => {
  const home = path.join(REPO_ROOT, 'test', '.tmp', 'core', 'home');
  const c = getConfig({ OPENMEETING_HOME: home });
  assert.equal(c.home, home);
  assert.equal(c.meetingsDir, path.join(home, 'meetings'));
  assert.equal(c.profileDir, path.join(home, 'chrome-profile'));
  assert.equal(c.sttVenv, path.join(home, '.venv-stt'));
});

test('relative OPENMEETING_HOME / OPENMEETING_PROFILE are resolved to absolute paths', () => {
  const c = getConfig({ OPENMEETING_HOME: 'rel-home', OPENMEETING_PROFILE: 'rel-profile' });
  assert.ok(path.isAbsolute(c.home));
  assert.equal(c.home, path.resolve('rel-home'));
  assert.equal(c.profileDir, path.resolve('rel-profile'));
});

test('string/boolean env overrides', () => {
  const profile = path.join(REPO_ROOT, 'test', '.tmp', 'core', 'prof');
  const c = getConfig({
    OPENMEETING_PROFILE: profile,
    CHROME_PATH: 'C:\\chrome\\chrome.exe',
    OPENMEETING_NAME: 'Bot',
    OPENMEETING_CAPTION_LANG: 'en-US',
    OPENMEETING_HEADLESS: '1',
    OPENMEETING_MUTE: '0',
    OPENMEETING_ALLOW_ANY_HOST: '1',
  });
  assert.equal(c.profileDir, profile);
  assert.equal(c.chromePath, 'C:\\chrome\\chrome.exe');
  assert.equal(c.displayName, 'Bot');
  assert.equal(c.captionLang, 'en-US');
  assert.equal(c.headless, true);
  assert.equal(c.muteAudio, false);
  assert.equal(c.allowAnyHost, true);
});

test('boolean flags only flip on their exact values', () => {
  const c = getConfig({ OPENMEETING_HEADLESS: 'true', OPENMEETING_MUTE: 'false', OPENMEETING_ALLOW_ANY_HOST: 'yes' });
  assert.equal(c.headless, false);
  assert.equal(c.muteAudio, true); // only '0' disables muting
  assert.equal(c.allowAnyHost, false);
  assert.equal(getConfig({ OPENMEETING_MUTE: '1' }).muteAudio, true);
});

test('empty-string env values fall back to defaults', () => {
  const c = getConfig({ OPENMEETING_HOME: '', OPENMEETING_NAME: '', CHROME_PATH: '', OPENMEETING_CAPTION_LANG: '' });
  assert.equal(c.home, REPO_ROOT);
  assert.equal(c.displayName, 'Arthur Wang');
  assert.equal(c.chromePath, null);
  assert.equal(c.captionLang, 'cmn-Hant-TW');
});

test('every *_MS timeout can be overridden via OPENMEETING_<UPPER_SNAKE>_MS', () => {
  const c = getConfig({
    OPENMEETING_LOBBY_TIMEOUT_MS: '1000',
    OPENMEETING_ALONE_TIMEOUT_MS: '2000',
    OPENMEETING_NO_ONE_TIMEOUT_MS: '3000',
    OPENMEETING_MAX_DURATION_MS: '4000',
    OPENMEETING_POLL_MS: '250',
    OPENMEETING_UNKNOWN_END_MS: '5000',
    OPENMEETING_LANG_CHECK_MS: '6000',
    OPENMEETING_NO_AUDIO_WARN_MS: '7000',
  });
  assert.equal(c.langCheckMs, 6000);
  assert.equal(c.noAudioWarnMs, 7000);
  assert.equal(c.unknownEndMs, 5000);
  assert.equal(getConfig({}).unknownEndMs, 60_000);
  assert.equal(c.lobbyTimeoutMs, 1000);
  assert.equal(c.aloneTimeoutMs, 2000);
  assert.equal(c.noOneTimeoutMs, 3000);
  assert.equal(c.maxDurationMs, 4000);
  assert.equal(c.pollMs, 250);
});

test('zero is a valid timeout override; whitespace is trimmed', () => {
  const c = getConfig({ OPENMEETING_ALONE_TIMEOUT_MS: '0', OPENMEETING_POLL_MS: ' 300 ' });
  assert.equal(c.aloneTimeoutMs, 0);
  assert.equal(c.pollMs, 300);
});

test('invalid timeout overrides are ignored (default kept)', () => {
  const c = getConfig({
    OPENMEETING_LOBBY_TIMEOUT_MS: 'abc',
    OPENMEETING_ALONE_TIMEOUT_MS: '-5',
    OPENMEETING_NO_ONE_TIMEOUT_MS: '',
    OPENMEETING_MAX_DURATION_MS: 'Infinity',
    OPENMEETING_POLL_MS: '   ',
  });
  assert.equal(c.lobbyTimeoutMs, 15 * 60_000);
  assert.equal(c.aloneTimeoutMs, 60_000);
  assert.equal(c.noOneTimeoutMs, 15 * 60_000);
  assert.equal(c.maxDurationMs, 4 * 3600_000);
  assert.equal(c.pollMs, 1500);
});

test('getConfig() without arguments reads process.env', () => {
  const saved = process.env.OPENMEETING_POLL_MS;
  process.env.OPENMEETING_POLL_MS = '777';
  try {
    assert.equal(getConfig().pollMs, 777);
  } finally {
    if (saved === undefined) delete process.env.OPENMEETING_POLL_MS;
    else process.env.OPENMEETING_POLL_MS = saved;
  }
});

test('returns a fresh object each call (callers may mutate)', () => {
  const a = getConfig({});
  a.pollMs = 1;
  assert.equal(getConfig({}).pollMs, 1500);
});
