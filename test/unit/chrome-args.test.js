import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromeArgs, findChrome } from '../../src/chrome.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.resolve(here, '..', '.tmp', 'chrome', 'unit');

const PROFILE = 'C:\\Users\\Some One\\openmeeting\\chrome-profile';

/** The exact flag set spec 5.4 requires (without the optional toggles). */
function requiredFlags(profileDir, port, windowSize = '1280,800') {
  return [
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
}

const sorted = (a) => [...a].sort();

/** Prefixes of flags that must never be produced (automation-flavoured or unsafe). */
const FORBIDDEN_PREFIXES = [
  '--enable-automation',
  '--disable-web-security',
  '--ignore-certificate-errors',
  '--user-agent',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--remote-debugging-pipe',
  '--disable-blink-features',
  '--test-type',
  '--allow-insecure-localhost',
];

describe('chromeArgs', () => {
  test('produces exactly the required flag set (no toggles)', () => {
    const args = chromeArgs({ profileDir: PROFILE, port: 9333, headless: false, muteAudio: false });
    assert.deepEqual(sorted(args), sorted(requiredFlags(PROFILE, 9333)));
  });

  test('has no duplicate flags', () => {
    const args = chromeArgs({ profileDir: PROFILE, port: 1, headless: true, muteAudio: true });
    assert.equal(new Set(args).size, args.length);
  });

  test('muteAudio adds --mute-audio, and only that', () => {
    const args = chromeArgs({ profileDir: PROFILE, port: 9333, headless: false, muteAudio: true });
    assert.deepEqual(sorted(args), sorted([...requiredFlags(PROFILE, 9333), '--mute-audio']));
  });

  test('headless adds --headless=new, and only that', () => {
    const args = chromeArgs({ profileDir: PROFILE, port: 9333, headless: true, muteAudio: false });
    assert.deepEqual(sorted(args), sorted([...requiredFlags(PROFILE, 9333), '--headless=new']));
  });

  test('both toggles together', () => {
    const args = chromeArgs({ profileDir: PROFILE, port: 4242, headless: true, muteAudio: true });
    assert.deepEqual(
      sorted(args),
      sorted([...requiredFlags(PROFILE, 4242), '--mute-audio', '--headless=new']),
    );
  });

  test('toggles are absent when falsy / omitted', () => {
    const args = chromeArgs({ profileDir: PROFILE, port: 9333 });
    assert.ok(!args.includes('--mute-audio'));
    assert.ok(!args.some((a) => a.startsWith('--headless')));
  });

  test('custom windowSize', () => {
    const args = chromeArgs({ profileDir: PROFILE, port: 9333, windowSize: '1920,1080' });
    assert.ok(args.includes('--window-size=1920,1080'));
    assert.equal(args.filter((a) => a.startsWith('--window-size=')).length, 1);
  });

  test('profileDir with spaces is passed verbatim (no shell quoting; spawn takes an array)', () => {
    const args = chromeArgs({ profileDir: PROFILE, port: 9333 });
    assert.ok(args.includes(`--user-data-dir=${PROFILE}`));
    assert.ok(!args.some((a) => a.includes('"')));
  });

  test('forbidden flags never appear in any combination', () => {
    for (const headless of [false, true]) {
      for (const muteAudio of [false, true]) {
        const args = chromeArgs({ profileDir: PROFILE, port: 9333, headless, muteAudio });
        for (const arg of args) {
          for (const bad of FORBIDDEN_PREFIXES) {
            assert.ok(!arg.startsWith(bad), `forbidden flag ${arg} (headless=${headless}, mute=${muteAudio})`);
          }
        }
        // The old headless mode is never used.
        assert.ok(!args.includes('--headless'));
        assert.ok(!args.includes('--headless=old'));
      }
    }
  });

  test('every entry is a --flag string', () => {
    const args = chromeArgs({ profileDir: PROFILE, port: 9333, headless: true, muteAudio: true });
    for (const a of args) {
      assert.equal(typeof a, 'string');
      assert.match(a, /^--[a-z]/);
    }
  });
});

describe('findChrome', () => {
  /** Creates <TMP>/<name>/<rel> as an empty file and returns its path. */
  function touch(name, rel) {
    const p = path.join(TMP, name, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '');
    return p;
  }
  const CHROME_REL = path.join('Google', 'Chrome', 'Application', 'chrome.exe');

  before(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
  });
  after(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  test('CHROME_PATH wins when it exists', () => {
    const custom = touch('custom', 'my-chrome.exe');
    const pf = path.join(TMP, 'pf1');
    touch('pf1', CHROME_REL);
    assert.equal(findChrome({ CHROME_PATH: custom, ProgramFiles: pf }), custom);
  });

  test('CHROME_PATH that does not exist falls through to ProgramFiles', () => {
    const pf = path.join(TMP, 'pf2');
    const expected = touch('pf2', CHROME_REL);
    const env = { CHROME_PATH: path.join(TMP, 'nope', 'chrome.exe'), ProgramFiles: pf };
    assert.equal(findChrome(env), expected);
  });

  test('order: ProgramFiles, then ProgramFiles(x86), then LOCALAPPDATA', () => {
    const pf = path.join(TMP, 'o-pf');
    const pf86 = path.join(TMP, 'o-pf86');
    const lad = path.join(TMP, 'o-lad');
    const inPf = touch('o-pf', CHROME_REL);
    const inPf86 = touch('o-pf86', CHROME_REL);
    const inLad = touch('o-lad', CHROME_REL);
    const env = { ProgramFiles: pf, 'ProgramFiles(x86)': pf86, LOCALAPPDATA: lad };
    assert.equal(findChrome(env), inPf);
    fs.rmSync(inPf);
    assert.equal(findChrome(env), inPf86);
    fs.rmSync(inPf86);
    assert.equal(findChrome(env), inLad);
    fs.rmSync(inLad);
    assert.throws(() => findChrome(env), { message: 'chrome_not_found' });
  });

  test('env var names are matched case-insensitively (Windows semantics)', () => {
    const lad = path.join(TMP, 'ci-lad');
    const expected = touch('ci-lad', CHROME_REL);
    assert.equal(findChrome({ LocalAppData: lad }), expected);
    const pf86 = path.join(TMP, 'ci-pf86');
    const expected86 = touch('ci-pf86', CHROME_REL);
    assert.equal(findChrome({ 'PROGRAMFILES(X86)': pf86 }), expected86);
  });

  test('a directory at the chrome.exe path is not accepted', () => {
    const pf = path.join(TMP, 'dir-pf');
    fs.mkdirSync(path.join(pf, CHROME_REL), { recursive: true });
    assert.throws(() => findChrome({ ProgramFiles: pf }), { message: 'chrome_not_found' });
  });

  test('throws chrome_not_found (with code) when nothing is found', () => {
    assert.throws(() => findChrome({}), (err) => {
      assert.equal(err.message, 'chrome_not_found');
      assert.equal(err.code, 'chrome_not_found');
      return true;
    });
    assert.throws(
      () => findChrome({ CHROME_PATH: '', ProgramFiles: path.join(TMP, 'empty') }),
      { message: 'chrome_not_found' },
    );
  });

  test('returns an absolute path', () => {
    const pf = path.join(TMP, 'abs-pf');
    touch('abs-pf', CHROME_REL);
    assert.ok(path.isAbsolute(findChrome({ ProgramFiles: pf })));
  });
});
