// Node wrapper around the Whisper fallback (stt/transcribe.py, spec 5.16).
// Owns: locating the STT venv interpreter, creating it with `uv`, and running transcribe.py.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Absolute path of stt/transcribe.py in this repo. */
export const TRANSCRIBE_SCRIPT = path.join(REPO_ROOT, 'stt', 'transcribe.py');
/** Absolute path of stt/requirements.txt in this repo. */
export const REQUIREMENTS_FILE = path.join(REPO_ROOT, 'stt', 'requirements.txt');

export const DEFAULT_MODEL = 'large-v3-turbo';
export const DEFAULT_THREADS = 14;
export const DEFAULT_LANG = 'zh';

const STDERR_TAIL_CHARS = 2000;

/**
 * @typedef {object} SttConfig  Subset of getConfig() (spec 5.1) used here.
 * @property {string} home      OPENMEETING_HOME (models live in <home>/models)
 * @property {string} [sttVenv] <home>/.venv-stt
 */

/**
 * @typedef {((msg: string) => void) | { info?: Function, warn?: Function, error?: Function, debug?: Function } | undefined} Logger
 */

function pathFor(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function venvDir(config, platform) {
  const p = pathFor(platform);
  if (config.sttVenv) return p.resolve(config.sttVenv);
  return p.resolve(config.home || '.', '.venv-stt');
}

/** Normalizes a logger (function or {info,warn,error}) into { info, warn }. */
function toLogger(log) {
  if (typeof log === 'function') return { info: log, warn: log };
  if (log && typeof log === 'object') {
    const info = (log.info || log.log || log.debug || (() => {})).bind(log);
    const warn = (log.warn || log.error || info).bind(log);
    return { info, warn };
  }
  return { info: () => {}, warn: () => {} };
}

/**
 * Absolute path of the STT venv's Python interpreter.
 * @param {SttConfig} config
 * @param {NodeJS.Platform} [platform] defaults to process.platform (override for tests)
 * @returns {string} `<sttVenv>\Scripts\python.exe` on win32, `<sttVenv>/bin/python` elsewhere
 */
export function sttPython(config, platform = process.platform) {
  const p = pathFor(platform);
  const venv = venvDir(config, platform);
  return platform === 'win32' ? p.join(venv, 'Scripts', 'python.exe') : p.join(venv, 'bin', 'python');
}

/** Python packages transcribe.py imports (directory names inside site-packages). */
const REQUIRED_PACKAGES = ['faster_whisper', 'opencc'];

/**
 * site-packages directories of the venv (`Lib/site-packages` on win32,
 * `lib/python3.X/site-packages` elsewhere).
 * @param {string} venv
 * @param {NodeJS.Platform} platform
 * @returns {string[]}
 */
function sitePackagesDirs(venv, platform) {
  const p = pathFor(platform);
  if (platform === 'win32') return [p.join(venv, 'Lib', 'site-packages')];
  try {
    return fs.readdirSync(p.join(venv, 'lib'))
      .filter((d) => /^python\d/.test(d))
      .map((d) => p.join(venv, 'lib', d, 'site-packages'));
  } catch {
    return [];
  }
}

/**
 * True when the STT venv is usable: the interpreter exists AND faster-whisper and opencc are
 * installed in it (an interrupted `setup-stt` leaves an interpreter without the packages).
 * @param {SttConfig} config
 * @param {NodeJS.Platform} [platform] defaults to process.platform (override for tests)
 * @returns {boolean}
 */
export function sttAvailable(config, platform = process.platform) {
  try {
    if (!config || (!config.sttVenv && !config.home)) return false;
    if (!fs.statSync(sttPython(config, platform)).isFile()) return false;
    const dirs = sitePackagesDirs(venvDir(config, platform), platform);
    return REQUIRED_PACKAGES.every((pkg) => dirs.some((d) => fs.existsSync(pathFor(platform).join(d, pkg))));
  } catch {
    return false;
  }
}

/**
 * The `uv` invocations performed by setupStt, in order. `--allow-existing` makes a re-run
 * (after an interrupted install, or on an installed machine) repair/upgrade the venv in place
 * instead of failing with "A virtual environment already exists".
 * @param {SttConfig} config
 * @param {{ uv?: string, uvPrefixArgs?: string[], platform?: NodeJS.Platform }} [opts]
 * @returns {{ cmd: string, args: string[] }[]}
 */
export function setupSteps(config, { uv = 'uv', uvPrefixArgs = [], platform = process.platform } = {}) {
  return [
    { cmd: uv, args: [...uvPrefixArgs, 'venv', venvDir(config, platform), '--python', '3.12', '--allow-existing'] },
    { cmd: uv, args: [...uvPrefixArgs, 'pip', 'install', '--python', sttPython(config, platform), '-r', REQUIREMENTS_FILE] },
  ];
}

/**
 * Builds the argv (script first) passed to the venv interpreter for transcribe.py.
 * @param {{ config: SttConfig, wavPath: string, outDir: string, model?: string, threads?: number, lang?: string, script?: string }} o
 * @returns {string[]}
 */
export function transcribeArgs({ config, wavPath, outDir, model = DEFAULT_MODEL, threads = DEFAULT_THREADS, lang = DEFAULT_LANG, script = TRANSCRIBE_SCRIPT }) {
  return [
    script,
    '--audio', path.resolve(wavPath),
    '--out-dir', path.resolve(outDir),
    '--model', String(model),
    '--threads', String(threads),
    '--lang', String(lang),
    '--model-dir', path.resolve(config.home || '.', 'models'),
  ];
}

/**
 * Extracts the segment count from transcribe.py stdout (`SEGMENTS=<n>` line; last one wins).
 * @param {string} stdout
 * @returns {number | null}
 */
export function parseSegments(stdout) {
  if (typeof stdout !== 'string') return null;
  let found = null;
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*SEGMENTS=(\d+)\s*$/.exec(line);
    if (m) found = Number(m[1]);
  }
  return found;
}

/** Keeps the last `max` characters of a growing string. */
function appendTail(tail, chunk, max = STDERR_TAIL_CHARS * 4) {
  const s = tail + chunk;
  return s.length > max ? s.slice(-max) : s;
}

/** Splits a stream into lines, calling onLine for each complete line (tqdm '\r' updates collapse to the last one). */
function lineSplitter(onLine) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        emit(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
      if (buf.length > 64 * 1024) buf = buf.slice(-4096); // runaway progress bar without newline
    },
    end() {
      if (buf) emit(buf);
      buf = '';
    },
  };
  function emit(line) {
    const parts = line.split('\r').map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) onLine(last);
  }
}

/**
 * Runs a child process, streaming its output lines to `onLine`.
 * Resolves { code, stdout, stderrTail }; rejects with the spawn error (e.g. ENOENT).
 */
function runChild(cmd, args, { env, onLine, cwd } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderrTail = '';
    const outLines = lineSplitter((l) => onLine?.(l, 'stdout'));
    const errLines = lineSplitter((l) => onLine?.(l, 'stderr'));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; outLines.push(d); });
    child.stderr.on('data', (d) => { stderrTail = appendTail(stderrTail, d); errLines.push(d); });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      outLines.end();
      errLines.end();
      resolve({ code: code ?? (signal ? 1 : 0), signal, stdout, stderrTail });
    });
  });
}

/** Last part of stderr, tidied for an error message (progress-bar carriage returns collapsed). */
function tidyTail(text) {
  const lines = text.split(/\r?\n/).map((l) => {
    const parts = l.split('\r');
    return parts[parts.length - 1].trimEnd();
  }).filter(Boolean);
  let out = lines.join('\n');
  if (out.length > STDERR_TAIL_CHARS) out = out.slice(-STDERR_TAIL_CHARS);
  return out;
}

function childEnv(extra = {}) {
  return {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
    HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
    HF_HUB_DISABLE_TELEMETRY: '1',
    ...extra,
  };
}

/**
 * Creates the STT venv with uv and installs stt/requirements.txt into it:
 *   uv venv "<sttVenv>" --python 3.12
 *   uv pip install --python "<sttPython>" -r "<repo>/stt/requirements.txt"
 * @param {SttConfig} config
 * @param {{ log?: Logger, uv?: string, uvPrefixArgs?: string[] }} [opts]  `uv`/`uvPrefixArgs` override the uv command (tests)
 * @returns {Promise<void>}
 * @throws {Error} 'uv_not_found' when uv is not installed; `setup_stt_failed: ...` when a step fails
 */
export async function setupStt(config, { log, uv = 'uv', uvPrefixArgs = [] } = {}) {
  const L = toLogger(log);
  for (const step of setupSteps(config, { uv, uvPrefixArgs })) {
    L.info(`[stt] $ ${step.cmd} ${step.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
    let res;
    try {
      // Cache and venv usually sit on different drives here → uv cannot hardlink; copy quietly.
      const env = childEnv({ UV_LINK_MODE: process.env.UV_LINK_MODE || 'copy' });
      res = await runChild(step.cmd, step.args, { env, onLine: (l) => L.info(`[stt] ${l}`) });
    } catch (err) {
      if (err && err.code === 'ENOENT') throw new Error('uv_not_found');
      throw err;
    }
    if (res.code !== 0) {
      const what = step.args.slice(uvPrefixArgs.length, uvPrefixArgs.length + 2).join(' ');
      throw new Error(`setup_stt_failed: uv ${what} exited with code ${res.code}\n${tidyTail(res.stderrTail || res.stdout)}`);
    }
  }
  L.info(`[stt] ready: ${sttPython(config)}`);
}

/**
 * Runs the Whisper fallback on a WAV file.
 * Writes <outDir>/transcript-whisper.json and <outDir>/transcript-whisper.md.
 * The first run downloads the model into <config.home>/models.
 * @param {{ config: SttConfig, wavPath: string, outDir: string, model?: string, threads?: number, lang?: string,
 *           log?: Logger, python?: string, script?: string }} o  `python`/`script` override the interpreter/script (tests)
 * @returns {Promise<{ segments: number, mdPath: string, jsonPath: string }>}
 * @throws {Error} 'stt_not_installed' when the venv interpreter is missing;
 *                 `transcribe_failed: exit code N\n<stderr tail>` on failure
 */
export async function runTranscribe({
  config, wavPath, outDir, model = DEFAULT_MODEL, threads = DEFAULT_THREADS, lang = DEFAULT_LANG, log, python, script,
}) {
  const L = toLogger(log);
  const interpreter = python || sttPython(config);
  if (!python && !sttAvailable(config)) throw new Error('stt_not_installed');
  const args = transcribeArgs({ config, wavPath, outDir, model, threads, lang, script });
  const absOut = path.resolve(outDir);
  fs.mkdirSync(absOut, { recursive: true });
  fs.mkdirSync(path.resolve(config.home || '.', 'models'), { recursive: true });
  L.info(`[stt] transcribing ${path.resolve(wavPath)} (model ${model}, ${threads} threads)`);
  let res;
  try {
    res = await runChild(interpreter, args, {
      env: childEnv(),
      onLine: (l) => { if (!/^SEGMENTS=\d+$/.test(l)) L.info(`[stt] ${l}`); },
    });
  } catch (err) {
    if (err && err.code === 'ENOENT') throw new Error('stt_not_installed');
    throw err;
  }
  if (res.code !== 0) {
    throw new Error(`transcribe_failed: exit code ${res.code}\n${tidyTail(res.stderrTail)}`);
  }
  const segments = parseSegments(res.stdout);
  if (segments === null) {
    throw new Error(`transcribe_failed: no SEGMENTS line in output\n${tidyTail(res.stderrTail || res.stdout)}`);
  }
  L.info(`[stt] done: ${segments} segments`);
  return {
    segments,
    mdPath: path.join(absOut, 'transcript-whisper.md'),
    jsonPath: path.join(absOut, 'transcript-whisper.json'),
  };
}
