// Paths + defaults for openmeeting, with environment overrides.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {object} Config
 * @property {string} repoRoot   directory containing openmeeting's package.json (code location; never overridden)
 * @property {string} home       runtime data root: env OPENMEETING_HOME || repoRoot
 * @property {string} meetingsDir home/meetings
 * @property {string} profileDir env OPENMEETING_PROFILE || home/chrome-profile
 * @property {string|null} chromePath env CHROME_PATH || null (auto-detected in chrome.js)
 * @property {string} displayName env OPENMEETING_NAME || 'Arthur 的會議記錄'
 * @property {string} captionLang env OPENMEETING_CAPTION_LANG || 'cmn-Hant-TW'
 * @property {boolean} headless  env OPENMEETING_HEADLESS === '1' (tests only; real Meet blocks headless)
 * @property {boolean} muteAudio env OPENMEETING_MUTE !== '0'
 * @property {boolean} allowAnyHost env OPENMEETING_ALLOW_ANY_HOST === '1' (tests: allow mock server URLs)
 * @property {number} lobbyTimeoutMs OPENMEETING_LOBBY_TIMEOUT_MS
 * @property {number} aloneTimeoutMs OPENMEETING_ALONE_TIMEOUT_MS (≤1 participant this long after others were seen → leave)
 * @property {number} noOneTimeoutMs OPENMEETING_NO_ONE_TIMEOUT_MS (nobody else ever joined → leave)
 * @property {number} maxDurationMs  OPENMEETING_MAX_DURATION_MS
 * @property {number} pollMs         OPENMEETING_POLL_MS
 * @property {number} blockedBackoffMs OPENMEETING_BLOCKED_BACKOFF_MS (join retry n waits n × this after BLOCKED/BLANK; 20 s, 40 s)
 * @property {number} unknownEndMs   OPENMEETING_UNKNOWN_END_MS (addition to spec 5.1: in the call, an unrecognized
 *   screen with no call controls at all for this long counts as the meeting having ended)
 * @property {number} langCheckMs    OPENMEETING_LANG_CHECK_MS: how often, in the call, the caption language is
 *   re-read (and set again when Meet or a participant switched it, or retried while it is unknown)
 * @property {number} noAudioWarnMs  OPENMEETING_NO_AUDIO_WARN_MS: no remote audio track for this long in the call →
 *   one warning and stats.audioTracks = 0
 * @property {boolean} trackMirror env OPENMEETING_TRACK_MIRROR === '1' (default off): install the RTCPeerConnection
 *   track mirror (src/page/audio-capture.js). Off because wrapping RTCPeerConnection leaves a detectable
 *   main-world fingerprint, and Meet already plays remote audio through <audio>/<video> elements with a srcObject.
 * @property {string} sttVenv    home/.venv-stt
 */

/** Default values for every `*Ms` timeout. Each is overridable via `OPENMEETING_<UPPER_SNAKE>`. */
export const TIMEOUT_DEFAULTS = Object.freeze({
  lobbyTimeoutMs: 15 * 60_000,
  loginTimeoutMs: 10 * 60_000,
  aloneTimeoutMs: 60_000,
  noOneTimeoutMs: 15 * 60_000,
  maxDurationMs: 4 * 3600_000,
  pollMs: 1500,
  blockedBackoffMs: 20_000,
  unknownEndMs: 60_000,
  langCheckMs: 60_000,
  noAudioWarnMs: 60_000,
});

export const DEFAULT_DISPLAY_NAME = 'Arthur Wang';
export const DEFAULT_CAPTION_LANG = 'cmn-Hant-TW';

/**
 * Directory containing openmeeting's package.json, found by walking up from this file
 * (falls back to the parent of src/).
 * @returns {string}
 */
function findRepoRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(here, '..');
}

const REPO_ROOT = findRepoRoot();

/**
 * camelCase key → env var name, e.g. `aloneTimeoutMs` → `OPENMEETING_ALONE_TIMEOUT_MS`.
 * @param {string} key
 */
export function timeoutEnvName(key) {
  return `OPENMEETING_${key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;
}

/**
 * Parses a non-negative finite millisecond value; returns `fallback` for missing/invalid input.
 * @param {string|undefined} raw
 * @param {number} fallback
 */
function parseMs(raw, fallback) {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Builds the runtime configuration. Pure apart from reading `env`; returns a fresh object.
 * @param {Record<string, string|undefined>} [env=process.env]
 * @returns {Config}
 */
export function getConfig(env = process.env) {
  const home = env.OPENMEETING_HOME ? path.resolve(env.OPENMEETING_HOME) : REPO_ROOT;
  /** @type {Record<string, number>} */
  const timeouts = {};
  for (const [key, def] of Object.entries(TIMEOUT_DEFAULTS)) {
    timeouts[key] = parseMs(env[timeoutEnvName(key)], def);
  }
  return {
    repoRoot: REPO_ROOT,
    home,
    meetingsDir: path.join(home, 'meetings'),
    profileDir: env.OPENMEETING_PROFILE ? path.resolve(env.OPENMEETING_PROFILE) : path.join(home, 'chrome-profile'),
    chromePath: env.CHROME_PATH || null,
    displayName: env.OPENMEETING_NAME || DEFAULT_DISPLAY_NAME,
    captionLang: env.OPENMEETING_CAPTION_LANG || DEFAULT_CAPTION_LANG,
    headless: env.OPENMEETING_HEADLESS === '1',
    muteAudio: env.OPENMEETING_MUTE !== '0',
    allowAnyHost: env.OPENMEETING_ALLOW_ANY_HOST === '1',
    trackMirror: env.OPENMEETING_TRACK_MIRROR === '1',
    lobbyTimeoutMs: timeouts.lobbyTimeoutMs,
    aloneTimeoutMs: timeouts.aloneTimeoutMs,
    noOneTimeoutMs: timeouts.noOneTimeoutMs,
    maxDurationMs: timeouts.maxDurationMs,
    pollMs: timeouts.pollMs,
    blockedBackoffMs: timeouts.blockedBackoffMs,
    unknownEndMs: timeouts.unknownEndMs,
    langCheckMs: timeouts.langCheckMs,
    noAudioWarnMs: timeouts.noAudioWarnMs,
    sttVenv: path.join(home, '.venv-stt'),
  };
}
