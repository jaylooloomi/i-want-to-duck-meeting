import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sttPython,
  sttAvailable,
  transcribeArgs,
  parseSegments,
  setupSteps,
  setupStt,
  runTranscribe,
  TRANSCRIBE_SCRIPT,
  REQUIREMENTS_FILE,
} from '../../src/stt.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = path.join(REPO, 'test', '.tmp', 'stt', 'unit');

function freshDir(name) {
  const dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('sttPython: Scripts\\python.exe on win32, absolute', () => {
  const config = { home: 'D:\\om', sttVenv: 'D:\\om\\.venv-stt' };
  assert.equal(sttPython(config, 'win32'), path.win32.join('D:\\om\\.venv-stt', 'Scripts', 'python.exe'));
});

test('sttPython: bin/python on posix', () => {
  const config = { home: '/opt/om', sttVenv: '/opt/om/.venv-stt' };
  assert.equal(sttPython(config, 'linux'), '/opt/om/.venv-stt/bin/python');
  assert.equal(sttPython(config, 'darwin'), '/opt/om/.venv-stt/bin/python');
});

test('sttPython: defaults to current platform and resolves relative venv to absolute', () => {
  const p = sttPython({ home: '.', sttVenv: 'some-venv' });
  assert.ok(path.isAbsolute(p), p);
  const expectedTail = process.platform === 'win32'
    ? path.join('some-venv', 'Scripts', 'python.exe')
    : path.join('some-venv', 'bin', 'python');
  assert.ok(p.endsWith(expectedTail), p);
});

test('sttPython: falls back to <home>/.venv-stt when sttVenv missing', () => {
  const p = sttPython({ home: 'D:\\om' }, 'win32');
  assert.equal(p, 'D:\\om\\.venv-stt\\Scripts\\python.exe');
});

test('sttAvailable: false when interpreter missing, true when present with packages (fake venv)', () => {
  const venv = freshDir('fake-venv');
  const config = { home: TMP, sttVenv: venv };
  assert.equal(sttAvailable(config), false);
  const py = sttPython(config);
  fs.mkdirSync(path.dirname(py), { recursive: true });
  fs.writeFileSync(py, '');
  const site = process.platform === 'win32'
    ? path.join(venv, 'Lib', 'site-packages')
    : path.join(venv, 'lib', 'python3.12', 'site-packages');
  fs.mkdirSync(path.join(site, 'faster_whisper'), { recursive: true });
  assert.equal(sttAvailable(config), false, 'opencc still missing');
  fs.mkdirSync(path.join(site, 'opencc'), { recursive: true });
  assert.equal(sttAvailable(config), true);
});

test('sttAvailable: an interpreter without faster-whisper/opencc (interrupted setup-stt) is not available', () => {
  const venv = freshDir('empty-venv');
  const config = { home: TMP, sttVenv: venv };
  const py = sttPython(config);
  fs.mkdirSync(path.dirname(py), { recursive: true });
  fs.writeFileSync(py, '');
  assert.equal(sttAvailable(config), false);
});

test('sttAvailable: false for non-existent venv dir and for bad config', () => {
  assert.equal(sttAvailable({ home: TMP, sttVenv: path.join(TMP, 'nope-does-not-exist') }), false);
  assert.equal(sttAvailable({}), false);
  assert.equal(sttAvailable(null), false);
});

test('transcribeArgs: builds the transcribe.py argv with defaults', () => {
  const config = { home: 'D:\\om', sttVenv: 'D:\\om\\.venv-stt' };
  const args = transcribeArgs({ config, wavPath: 'D:\\m\\audio.wav', outDir: 'D:\\m' });
  assert.deepEqual(args, [
    TRANSCRIBE_SCRIPT,
    '--audio', path.resolve('D:\\m\\audio.wav'),
    '--out-dir', path.resolve('D:\\m'),
    '--model', 'large-v3-turbo',
    '--threads', '14',
    '--lang', 'zh',
    '--model-dir', path.resolve(path.join('D:\\om', 'models')),
  ]);
  assert.ok(path.isAbsolute(TRANSCRIBE_SCRIPT));
  assert.ok(TRANSCRIBE_SCRIPT.endsWith(path.join('stt', 'transcribe.py')));
});

test('transcribeArgs: honours model, threads, lang and script overrides', () => {
  const config = { home: '/x', sttVenv: '/x/.venv-stt' };
  const args = transcribeArgs({ config, wavPath: '/a.wav', outDir: '/o', model: 'tiny', threads: 4, lang: 'en', script: '/s.py' });
  assert.equal(args[0], '/s.py');
  const get = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(get('--model'), 'tiny');
  assert.equal(get('--threads'), '4');
  assert.equal(get('--lang'), 'en');
  assert.equal(get('--model-dir'), path.resolve('/x/models'));
});

test('parseSegments: reads SEGMENTS=<n> (LF / CRLF / surrounded by noise)', () => {
  assert.equal(parseSegments('SEGMENTS=12\n'), 12);
  assert.equal(parseSegments('loading model\r\nJSON=x\r\nSEGMENTS=3\r\n'), 3);
  assert.equal(parseSegments('SEGMENTS=0'), 0);
  assert.equal(parseSegments('  SEGMENTS=7  \n'), 7);
});

test('parseSegments: null when absent or malformed, last one wins', () => {
  assert.equal(parseSegments(''), null);
  assert.equal(parseSegments('no segments here'), null);
  assert.equal(parseSegments('SEGMENTS=abc'), null);
  assert.equal(parseSegments('XSEGMENTS=5'), null);
  assert.equal(parseSegments(undefined), null);
  assert.equal(parseSegments('SEGMENTS=1\nSEGMENTS=9\n'), 9);
});

test('setupSteps: uv venv + uv pip install against the venv interpreter', () => {
  const config = { home: 'D:\\om', sttVenv: 'D:\\om\\.venv-stt' };
  const steps = setupSteps(config, { platform: 'win32' });
  assert.deepEqual(steps, [
    { cmd: 'uv', args: ['venv', 'D:\\om\\.venv-stt', '--python', '3.12', '--allow-existing'] },
    { cmd: 'uv', args: ['pip', 'install', '--python', 'D:\\om\\.venv-stt\\Scripts\\python.exe', '-r', REQUIREMENTS_FILE] },
  ]);
  assert.ok(REQUIREMENTS_FILE.endsWith(path.join('stt', 'requirements.txt')));
  assert.ok(fs.existsSync(REQUIREMENTS_FILE), 'stt/requirements.txt exists');
});

test('requirements.txt pins faster-whisper 1.2.1, av<19, opencc', () => {
  const lines = fs.readFileSync(REQUIREMENTS_FILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  assert.ok(lines.includes('faster-whisper==1.2.1'));
  assert.ok(lines.includes('av<19'));
  assert.ok(lines.some((l) => /^opencc\b/i.test(l)));
});

test('setupStt: throws uv_not_found when uv is missing', async () => {
  const venv = path.join(TMP, 'never-created-venv');
  await assert.rejects(
    setupStt({ home: TMP, sttVenv: venv }, { log: () => {}, uv: 'openmeeting-no-such-uv-binary' }),
    (err) => err instanceof Error && err.message === 'uv_not_found',
  );
  assert.equal(fs.existsSync(venv), false);
});

test('setupStt: runs both steps in order, logs, and fails with exit info', async () => {
  const dir = freshDir('fake-uv');
  const logFile = path.join(dir, 'calls.jsonl');
  // A fake "uv": node running a script that records its argv; fails on "pip" when asked to.
  const script = path.join(dir, 'fake-uv.mjs');
  fs.writeFileSync(script, [
    "import fs from 'node:fs';",
    'const args = process.argv.slice(2);',
    `fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(args) + '\\n');`,
    "console.log('fake uv ' + args[0]);",
    "if (args[0] === 'pip' && process.env.FAKE_UV_FAIL) { console.error('boom: no wheel'); process.exit(3); }",
  ].join('\n'));
  const config = { home: dir, sttVenv: path.join(dir, 'venv') };
  const logs = [];
  await setupStt(config, { log: (m) => logs.push(m), uv: process.execPath, uvPrefixArgs: [script] });
  const calls = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['venv', config.sttVenv, '--python', '3.12', '--allow-existing']);
  assert.deepEqual(calls[1].slice(0, 3), ['pip', 'install', '--python']);
  assert.equal(calls[1][3], sttPython(config));
  assert.deepEqual(calls[1].slice(4), ['-r', REQUIREMENTS_FILE]);
  assert.ok(logs.some((m) => String(m).includes('fake uv venv')), 'child output is logged');

  process.env.FAKE_UV_FAIL = '1';
  try {
    await assert.rejects(
      setupStt(config, { log: () => {}, uv: process.execPath, uvPrefixArgs: [script] }),
      (err) => /^setup_stt_failed: uv pip install exited with code 3/.test(err.message) && err.message.includes('boom: no wheel'),
    );
  } finally {
    delete process.env.FAKE_UV_FAIL;
  }
});

/** Writes a fake transcribe script (run by node instead of python). */
function writeFakeTranscriber(dir, body) {
  const script = path.join(dir, 'fake-transcribe.mjs');
  fs.writeFileSync(script, [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    'const argv = process.argv.slice(2);',
    'const get = (f) => argv[argv.indexOf(f) + 1];',
    body,
  ].join('\n'));
  return script;
}

test('runTranscribe: spawns interpreter with args, parses SEGMENTS, returns paths', async () => {
  const dir = freshDir('run-ok');
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir);
  const wavPath = path.join(dir, 'audio.wav');
  fs.writeFileSync(wavPath, 'RIFF');
  const script = writeFakeTranscriber(dir, [
    "fs.writeFileSync(path.join(get('--out-dir'), 'argv.json'), JSON.stringify(argv));",
    "fs.writeFileSync(path.join(get('--out-dir'), 'transcript-whisper.json'), '{}');",
    "fs.writeFileSync(path.join(get('--out-dir'), 'transcript-whisper.md'), '# x');",
    "console.error('loading model');",
    "console.log('SEGMENTS=4');",
  ].join('\n'));
  const config = { home: dir, sttVenv: path.join(dir, 'venv') };
  const logs = [];
  const res = await runTranscribe({
    config, wavPath, outDir, model: 'tiny', threads: 2,
    log: (m) => logs.push(m), python: process.execPath, script,
  });
  assert.deepEqual(res, {
    segments: 4,
    mdPath: path.join(outDir, 'transcript-whisper.md'),
    jsonPath: path.join(outDir, 'transcript-whisper.json'),
  });
  const argv = JSON.parse(fs.readFileSync(path.join(outDir, 'argv.json'), 'utf8'));
  assert.deepEqual(argv, transcribeArgs({ config, wavPath, outDir, model: 'tiny', threads: 2, script }).slice(1));
  assert.ok(logs.some((m) => String(m).includes('loading model')), 'stderr lines are logged');
});

test('runTranscribe: works with an object logger ({ info, warn })', async () => {
  const dir = freshDir('run-objlog');
  const script = writeFakeTranscriber(dir, "console.error('hello'); console.log('SEGMENTS=1');");
  const seen = [];
  const log = { info: (m) => seen.push(['info', m]), warn: (m) => seen.push(['warn', m]), error: (m) => seen.push(['error', m]) };
  const res = await runTranscribe({
    config: { home: dir, sttVenv: path.join(dir, 'venv') }, wavPath: path.join(dir, 'a.wav'), outDir: dir,
    log, python: process.execPath, script,
  });
  assert.equal(res.segments, 1);
  assert.ok(seen.some(([, m]) => String(m).includes('hello')));
});

test('runTranscribe: non-zero exit throws with stderr tail', async () => {
  const dir = freshDir('run-fail');
  const script = writeFakeTranscriber(dir, [
    "for (let i = 0; i < 200; i++) console.error('noise line ' + i);",
    "console.error('RuntimeError: Unable to open file audio.wav');",
    'process.exit(2);',
  ].join('\n'));
  await assert.rejects(
    runTranscribe({
      config: { home: dir, sttVenv: path.join(dir, 'venv') }, wavPath: path.join(dir, 'a.wav'), outDir: dir,
      log: () => {}, python: process.execPath, script,
    }),
    (err) => {
      assert.match(err.message, /^transcribe_failed/);
      assert.match(err.message, /exit code 2/);
      assert.ok(err.message.includes('RuntimeError: Unable to open file audio.wav'));
      assert.ok(!err.message.includes('noise line 0\n'), 'only the tail is kept');
      assert.ok(err.message.length < 4000);
      return true;
    },
  );
});

test('runTranscribe: exit 0 without SEGMENTS line is an error', async () => {
  const dir = freshDir('run-nosegments');
  const script = writeFakeTranscriber(dir, "console.log('done?');");
  await assert.rejects(
    runTranscribe({
      config: { home: dir, sttVenv: path.join(dir, 'venv') }, wavPath: path.join(dir, 'a.wav'), outDir: dir,
      log: () => {}, python: process.execPath, script,
    }),
    /transcribe_failed.*SEGMENTS/s,
  );
});

test('runTranscribe: missing venv interpreter throws stt_not_installed', async () => {
  const dir = freshDir('run-novenv');
  await assert.rejects(
    runTranscribe({ config: { home: dir, sttVenv: path.join(dir, 'venv') }, wavPath: path.join(dir, 'a.wav'), outDir: dir, log: () => {} }),
    (err) => err.message === 'stt_not_installed',
  );
});

test('transcribe.py exists and follows the CLI contract (static check)', () => {
  const src = fs.readFileSync(TRANSCRIBE_SCRIPT, 'utf8');
  for (const flag of ['--audio', '--out-dir', '--model', '--threads', '--lang', '--model-dir']) {
    assert.ok(src.includes(`'${flag}'`), `argparse flag ${flag}`);
  }
  for (const needle of [
    "device='cpu'", "compute_type='int8'", 'vad_filter=True', 'condition_on_previous_text=False',
    'beam_size=5', 's2twp', 'SEGMENTS=', 'transcript-whisper.json', 'transcript-whisper.md',
    '以下是台灣會議的逐字稿，使用繁體中文，專有名詞保留English。', '# 逐字稿（Whisper 備援）',
  ]) {
    assert.ok(src.includes(needle), `transcribe.py contains ${needle}`);
  }
});
