/**
 * One meeting, start to finish (spec 5.14): launch Chrome, join, record captions + audio,
 * detect the end, finalize the transcript. Used by the detached worker and `join --foreground`.
 * @module session
 */
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from './config.js';
import { readStatus, writeStatus } from './status.js';
import { createLogger } from './log.js';
import { launchChrome, connectChrome } from './chrome.js';
import { JoinError, clickElement, joinMeeting, sleep, takeSnapshot, toLog, withTimeout } from './meet/join.js';
import { dismissModals, ensureCaptions, getCaptionLanguage, leaveCall, prepareInCall, setCaptionLanguage } from './meet/incall.js';
import { classifyInCall, inCallSignal, STATES } from './meet/state.js';
import { SEL, TEXT, matchAny, serializableSel } from './meet/selectors.js';
import { installCaptionObserver } from './page/caption-observer.js';
import { installAudioCapture, installAudioOutputCapture, installTrackMirror } from './page/audio-capture.js';
import { CaptionAssembler } from './captions/assembler.js';
import { TranscriptStore } from './transcript/store.js';
import { WavWriter } from './audio/wav-writer.js';
import { runTranscribe, sttAvailable } from './stt.js';

/** Terminal status states. */
export const TERMINAL_STATES = Object.freeze(['done', 'failed']);
/** status.json error codes (spec 5.3). */
export const ERROR_CODES = Object.freeze([
  'signin_required', 'not_found', 'blocked', 'denied', 'lobby_timeout',
  'chrome_not_found', 'chrome_launch_failed', 'join_failed', 'crashed',
]);

const STATS_EVERY_MS = 5000;
const RECONNECT_GRACE_MS = 60_000;
const OUT_OF_CALL_GRACE_MS = 10_000;
const BLANK_GRACE_MS = 60_000;
const UNKNOWN_SCREENSHOT_MS = 15_000;
const NO_CAPTIONS_WARN_MS = 90_000;
const MIN_WHISPER_AUDIO_S = 20;
/** Popups are re-dismissed at most this often while the page is UNKNOWN / RECONNECTING. */
const DISMISS_OUT_OF_CALL_MS = 10_000;
/**
 * The caption language is re-checked every config.langCheckMs (60 s); after this many failed
 * attempts in a row to set it, the session stops trying.
 */
const LANG_MAX_RETRIES = 4;
/**
 * A caption language switched away from the requested one after it was set (by Meet, or by a
 * participant / the person at the bot's window who wants another language) is set back at most
 * this many times per meeting; a further switch is left alone, so the bot never keeps fighting
 * someone over it (each switch is visible to everyone when the language is meeting-wide).
 */
const LANG_MAX_SWITCHBACKS = 2;
/** Without a readable participant count, the self-only tile view must last this many aloneTimeouts. */
const TILE_ALONE_FACTOR = 5;
const COUNT_MISSING_WARN_MS = 60_000;
/** status.json `heartbeatAt` refresh interval (lets `wait` spot a dead worker whose pid was reused). */
export const HEARTBEAT_MS = 15_000;
/** Caption languages whose meetings the Whisper fallback (zh) can transcribe. */
const ZH_LANG_RE = /^(cmn|yue|zh)\b/i;
const SERIAL_SEL = serializableSel();

/** @param {string} s */
const safeName = (s) => String(s).replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 60);

/** Local timestamp for file names: HHmmss-SSS. */
function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

/**
 * Status error for any thrown value: JoinError / chrome errors keep their code, anything
 * else is `crashed`.
 * @param {any} err
 * @returns {{ code: string, message: string }}
 */
export function toStatusError(err) {
  const code = err && typeof err.code === 'string' && ERROR_CODES.includes(err.code) ? err.code : 'crashed';
  const message = String((err && (err.message || err)) || code);
  return { code, message };
}

/**
 * Run one meeting session. Never throws for meeting-level problems: the outcome is in the
 * returned (and persisted) status.
 *
 * @param {{
 *   url: string, code: string, id: string, dir: string,
 *   displayName?: string, captionLang?: string,
 *   config?: ReturnType<typeof getConfig>, log?: any, foreground?: boolean,
 *   maintenanceMs?: number,
 *   hooks?: { beforeClose?: (page: import('playwright-core').Page) => Promise<unknown> },
 * }} opts  maintenanceMs: how often popups are re-dismissed / captions re-checked (default 30 s);
 *   hooks.beforeClose: test hook, called with the page right before the bot leaves.
 * @returns {Promise<Record<string, any>>} the final status.json content
 */
export async function runSession(opts) {
  const { url, code, id, dir, foreground = false, hooks = {} } = opts;
  const config = opts.config || getConfig();
  const displayName = opts.displayName || config.displayName;
  const captionLang = opts.captionLang || config.captionLang;
  const maintenanceMs = opts.maintenanceMs ?? 30_000;
  const pollMs = Math.max(50, config.pollMs);
  const langCheckMs = Math.max(250, config.langCheckMs ?? 60_000);
  const noAudioWarnMs = config.noAudioWarnMs ?? 60_000;
  // UNKNOWN with no leave button and no in-call element at all for this long = an end screen we don't know
  const unknownEndMs = config.unknownEndMs ?? 60_000;
  const log = opts.log || createLogger({
    dir, echo: !!foreground, level: process.env.OPENMEETING_DEBUG === '1' ? 'debug' : 'info', prefix: 'session',
  });
  const L = toLog(log);
  /** @param {string} name */
  const sub = (name) => (log && typeof log.child === 'function' ? log.child(name) : log);
  const meetingOrigin = new URL(url).origin;
  const stopFile = path.join(dir, 'STOP');
  fs.mkdirSync(path.join(dir, 'screens'), { recursive: true });

  const previous = readStatus(dir) || {};
  const startedAt = previous.startedAt || new Date().toISOString();
  /**
   * audioTracks: only present once the "no remote audio track" warning fired (then 0, later the
   * captured track count).
   * @type {{ utterances: number, speakers: string[], audioSeconds: number, audioPeak: number, captionLang: string, captionsOn: boolean, audioTracks?: number }}
   */
  const stats = { utterances: 0, speakers: [], audioSeconds: 0, audioPeak: 0, captionLang: 'unknown', captionsOn: false };
  writeStatus(dir, {
    id, code, url, displayName, pid: process.pid, state: 'starting', startedAt,
    joinedAt: null, endedAt: null, endReason: null, error: null, stats, heartbeatAt: new Date().toISOString(),
  });
  L.info(`session ${id} starting`, { url, displayName, captionLang, pid: process.pid });

  /** State-transition status write that never throws (a status hiccup must not end the meeting). */
  const setStatus = (/** @type {Record<string, any>} */ patch) => {
    try {
      writeStatus(dir, patch);
    } catch (err) {
      L.warn(`status write failed: ${err && err.message}`, { patch: Object.keys(patch) });
    }
  };
  // Heartbeat: `wait` treats a non-terminal status whose heartbeat stopped as a dead worker
  // (covers a reused pid after a hard kill / reboot, where the pid check alone is fooled).
  const heartbeat = setInterval(() => setStatus({ heartbeatAt: new Date().toISOString() }), HEARTBEAT_MS);
  heartbeat.unref();

  // --- stop sources: signals and the STOP file ----------------------------------------------
  /** @type {string|null} */
  let signalReason = null;
  const onSignal = (/** @type {string} */ sig) => {
    if (signalReason) {
      L.warn(`received ${sig} again; exiting immediately`);
      process.exit(130);
    }
    signalReason = 'signal';
    L.warn(`received ${sig}; leaving the meeting`);
  };
  const signals = process.platform === 'win32' ? ['SIGINT', 'SIGTERM', 'SIGBREAK'] : ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const s of signals) process.on(s, onSignal);
  const stopRequested = () => signalReason || (fs.existsSync(stopFile) ? 'user_stop' : null);

  // Never leave a non-terminal status behind, whatever happens to this process.
  const onExit = () => {
    try {
      const s = readStatus(dir);
      if (!s || !TERMINAL_STATES.includes(s.state)) {
        writeStatus(dir, {
          state: 'failed', endedAt: new Date().toISOString(),
          error: { code: 'crashed', message: 'the bot process exited before the session finished' },
        });
      }
    } catch {
      /* nothing more we can do */
    }
  };
  process.on('exit', onExit);

  // --- session state ------------------------------------------------------------------------
  /** @type {Awaited<ReturnType<typeof launchChrome>>|null} */ let chrome = null;
  /** @type {import('playwright-core').Browser|null} */ let browser = null;
  /** @type {import('playwright-core').Page|null} */ let page = null;
  /** @type {import('playwright-core').CDPSession|null} */ let permissionSession = null;
  /** @type {WavWriter|null} */ let wav = null;
  /** @type {TranscriptStore|null} */ let store = null;
  /** @type {CaptionAssembler|null} */ let assembler = null;
  let captionsOpen = false;
  let pageGone = false;
  /** @type {number|null} */ let joinedAtMs = null;
  /** @type {string|null} */ let endReason = null;
  /** @type {{ code: string, message: string }|null} */ let failure = null;
  let monoClock = 0;
  let lastCaptionActivity = 0;
  let sawCaptions = false;
  let lastStatsWrite = 0;
  /** @type {number|null} */ let lastAudioTracks = null;
  /** Since when no remote audio track has been captured (null: tracks are being captured). */
  /** @type {number|null} */ let noTracksSince = null;
  let noAudioWarned = false;

  const mono = (/** @type {number} */ t) => {
    monoClock = Math.max(monoClock, Number.isFinite(t) ? t : Date.now());
    return monoClock;
  };
  const pageAlive = () => !!page && !pageGone && !page.isClosed();

  const emit = (/** @type {{ speaker: string, text: string, startMs: number, endMs: number }[]} */ utterances) => {
    if (!store || !utterances || utterances.length === 0) return;
    for (const u of utterances) {
      const rec = store.append(u);
      if (rec) L.debug(`utterance from ${rec.speaker || '(unknown)'}`, { chars: rec.text.length, text: rec.text });
    }
  };

  const writeStats = (force = false) => {
    if (store) {
      stats.utterances = store.count;
      stats.speakers = store.speakers;
    }
    if (wav) {
      stats.audioSeconds = Math.round(wav.seconds * 10) / 10;
      stats.audioPeak = wav.peak;
    }
    const now = Date.now();
    if (!force && now - lastStatsWrite < STATS_EVERY_MS) return;
    lastStatsWrite = now;
    try {
      writeStatus(dir, { stats: { ...stats } });
    } catch (err) {
      L.warn(`could not write stats: ${err && err.message}`);
    }
  };

  const screenshot = async (/** @type {string} */ name) => {
    if (!pageAlive() || !page) return;
    const file = path.join(dir, 'screens', `${stamp()}-${safeName(name)}.png`);
    try {
      await withTimeout(page.screenshot({ path: file, timeout: 5000 }), 7000, 'screenshot');
      L.info(`screenshot saved: ${file}`);
    } catch (err) {
      L.debug(`screenshot failed: ${err && err.message}`);
    }
  };

  // --- page → node callbacks ----------------------------------------------------------------
  const onCaptions = (/** @type {any} */ p) => {
    if (!captionsOpen || !assembler) return;
    try {
      const blocks = p && Array.isArray(p.blocks) ? p.blocks : null;
      if (blocks && blocks.length) {
        lastCaptionActivity = Date.now();
        sawCaptions = true;
      }
      emit(assembler.update(blocks, mono(Number(p && p.ts))));
    } catch (err) {
      L.warn(`caption payload failed: ${err && err.message}`);
    }
  };
  const onAudio = (/** @type {string} */ b64) => {
    try {
      if (wav && typeof b64 === 'string' && b64) wav.write(Buffer.from(b64, 'base64'));
    } catch (err) {
      L.warn(`audio write failed: ${err && err.message}`);
    }
  };
  const onAudioStatus = (/** @type {any} */ s) => {
    const tracks = s && typeof s.tracks === 'number' ? s.tracks : null;
    if (tracks !== lastAudioTracks) {
      lastAudioTracks = tracks;
      L.info('audio capture status', s);
    } else {
      L.debug('audio capture status', s);
    }
    if (tracks !== null) {
      if (tracks > 0) noTracksSince = null;
      else noTracksSince ??= Date.now();
      // after the "no remote audio track" warning, stats.audioTracks follows the capture
      if (noAudioWarned) stats.audioTracks = tracks;
    }
  };

  const ensureAudioCapture = async () => {
    if (!page) return;
    const r = await withTimeout(page.evaluate(installAudioCapture), 20_000, 'installAudioCapture');
    L.info('audio capture installed', r);
  };
  const ensureCaptionObserver = async () => {
    if (!page) return;
    await withTimeout(page.evaluate(installCaptionObserver, SERIAL_SEL), 10_000, 'installCaptionObserver');
    L.info('caption observer installed');
  };
  /** Re-install the in-page hooks after a reload (both installers are idempotent). */
  const checkPageHooks = async () => {
    if (!page) return;
    const have = await withTimeout(page.evaluate(() => ({
      captions: !!(/** @type {any} */ (window).__omCaptionObserver),
      audio: !!(/** @type {any} */ (window).__omAudioCapture),
    })), 5000, 'hook check');
    if (!have.audio) {
      L.warn('audio capture missing (page reloaded?); re-installing');
      await ensureAudioCapture();
    }
    if (!have.captions) {
      L.warn('caption observer missing (page reloaded?); re-installing');
      await ensureCaptionObserver();
    }
  };

  /** Main loop: poll until the meeting is over; returns the endReason. */
  const mainLoop = async () => {
    let sawOthers = false;
    /** @type {number|null} */ let aloneSince = null;
    /** @type {number|null} */ let reconnectSince = null;
    /** @type {number|null} */ let outSince = null;
    /** @type {number|null} */ let blankSince = null;
    /** @type {number|null} */ let unknownSince = null;
    /** @type {number|null} */ let unknownOutSince = null;
    let unknownShot = false;
    let lastState = '';
    let lastIgnoredText = '';
    let lastMaintenance = Date.now();
    let lastOutOfCallDismiss = 0;
    let lastCaptionRetry = Date.now();
    let lastLangCheck = Date.now();
    let langRetries = 0;
    let langGaveUp = false;
    let langSwitchbacks = 0;
    let langLeftAlone = false;
    let lastDeviceFix = 0;
    let countWarned = false;
    let snapFailures = 0;
    const joined = /** @type {number} */ (joinedAtMs);
    lastCaptionActivity = Date.now();

    /**
     * Every langCheckMs in the call: read the caption language from the caption bar. Meet or a
     * participant may switch it: a known code other than `captionLang` → warn and set it again,
     * at most LANG_MAX_SWITCHBACKS times per meeting (then the switch is left alone for good).
     * Unreadable (null) while it was never set → retry. After LANG_MAX_RETRIES failed attempts
     * in a row it stops trying. stats.captionLang follows the language the caption bar shows.
     */
    const checkCaptionLanguage = async () => {
      if (!page) return;
      const current = await getCaptionLanguage(page);
      if (current === captionLang) {
        langRetries = 0;
        langGaveUp = false;
        if (stats.captionLang !== captionLang) {
          L.info(`caption language is ${captionLang} now`);
          stats.captionLang = captionLang;
          writeStats(true);
        }
        return;
      }
      if (current === null && stats.captionLang === captionLang) return; // set earlier; not readable here
      // it was set (or believed set), and now shows another language
      const switchedAway = !!current && stats.captionLang === captionLang;
      if (current && stats.captionLang !== current) {
        stats.captionLang = current;
        writeStats(true);
      }
      if (langLeftAlone) return;
      if (switchedAway) {
        if (langSwitchbacks >= LANG_MAX_SWITCHBACKS) {
          langLeftAlone = true;
          L.warn(`caption language is ${current} again after ${LANG_MAX_SWITCHBACKS} switch-backs to ${captionLang}; leaving it `
            + `(someone probably wants it; captions may not be ${captionLang}, audio is still recorded)`);
          return;
        }
        langSwitchbacks += 1;
      }
      if (langRetries >= LANG_MAX_RETRIES) {
        if (!langGaveUp) {
          langGaveUp = true;
          L.warn(`could not set the caption language to ${captionLang} after ${LANG_MAX_RETRIES} attempts; giving up (captions may be wrong, audio is still recorded)`);
        }
        return;
      }
      langRetries += 1;
      if (current) {
        L.warn(`caption language changed to ${current} (by Meet or a participant?); setting it back to ${captionLang} `
          + `(attempt ${langRetries}/${LANG_MAX_RETRIES}, switch-back ${langSwitchbacks}/${LANG_MAX_SWITCHBACKS})`);
      } else {
        L.warn(`caption language is still not ${captionLang}; retrying (${langRetries}/${LANG_MAX_RETRIES})`);
      }
      let ok = false;
      try {
        ok = await setCaptionLanguage(page, captionLang, { log: sub('incall') });
      } catch (err) {
        L.debug(`setCaptionLanguage failed: ${err && err.message}`);
      }
      const shown = await getCaptionLanguage(page);
      stats.captionLang = shown || (ok ? captionLang : current || stats.captionLang);
      if (stats.captionLang === captionLang) langRetries = 0;
      writeStats(true);
    };

    for (;;) {
      const stop = stopRequested();
      if (stop) return stop;
      if (!pageAlive() || !page) return 'page_closed';
      const now = Date.now();
      if (now - joined >= config.maxDurationMs) return 'max_duration';

      /** @type {any} */
      let snap;
      try {
        snap = await takeSnapshot(page);
        snapFailures = 0;
      } catch (err) {
        if (!pageAlive() || (browser && !browser.isConnected())) return 'page_closed';
        snapFailures += 1;
        L.warn(`snapshot failed (${snapFailures}): ${err && err.message}`);
        if (snapFailures >= 20) return 'page_closed';
        await sleep(pollMs);
        continue;
      }
      if (assembler) emit(assembler.tick(mono(Date.now())));

      // classifyInCall: end-screen texts next to the call toolbar (chat toasts) are ignored
      const verdict = classifyInCall(snap, { meetingOrigin });
      const { state, matched } = verdict;
      if (state !== lastState) {
        L.info(`page state ${state}`, matched ? { matched } : undefined);
        lastState = state;
      }
      if (verdict.ignoredText && verdict.ignoredText !== lastIgnoredText) {
        L.info(`ignoring "${verdict.ignoredText}" on the page: the in-call toolbar is still there (chat message or notification)`);
      }
      lastIgnoredText = verdict.ignoredText || '';
      if (state !== STATES.RECONNECTING) reconnectSince = null;
      if (state !== STATES.BLANK) blankSince = null;
      if (state !== STATES.UNKNOWN) {
        unknownSince = null;
        unknownOutSince = null;
        unknownShot = false;
      }

      switch (state) {
        case STATES.ENDED:
          return /removed/i.test(String(matched || '')) || /been removed/i.test(String(snap.text || '')) ? 'removed' : 'meeting_ended';
        case STATES.RECONNECTING:
          reconnectSince ??= now;
          if (now - reconnectSince > RECONNECT_GRACE_MS) return 'meeting_ended';
          break;
        case STATES.IN_CALL:
          outSince = null;
          stats.captionsOn = snap.captionsOn === true || !!snap.captionRegion;
          break;
        case STATES.BLANK:
          blankSince ??= now;
          if (now - blankSince > BLANK_GRACE_MS) return 'page_closed';
          break;
        case STATES.UNKNOWN:
          unknownSince ??= now;
          if (!unknownShot && now - unknownSince > UNKNOWN_SCREENSHOT_MS) {
            unknownShot = true;
            L.warn('page state UNKNOWN for more than 15 s (Meet UI changed?); still recording');
            await screenshot('incall-unknown');
          }
          // No toolbar and no in-call element at all: an end screen whose wording we don't
          // know (e.g. a time-limit cutoff). Selector drift that keeps any in-call element
          // (captions, tiles, People count) keeps recording instead.
          if (!snap.leaveButton && !inCallSignal(snap) && snap.participantCount === null) {
            unknownOutSince ??= now;
            if (now - unknownOutSince > unknownEndMs) {
              L.warn(`no call controls for ${Math.round(unknownEndMs / 1000)} s on an unrecognized screen; treating the meeting as ended`);
              return 'meeting_ended';
            }
          } else {
            unknownOutSince = null;
          }
          break;
        case STATES.PREJOIN:
          // a stray visible text input while the in-call toolbar is still there is not "out of the call"
          if (snap.leaveButton) break;
        // falls through
        default:
          // lobby / prejoin / denied / blocked (e.g. redirected to the landing page) / ...
          outSince ??= now;
          if (now - outSince > OUT_OF_CALL_GRACE_MS) return 'meeting_ended';
      }

      // safety net: the bot's microphone / camera must never be on
      if ((snap.micOn || snap.camOn) && Date.now() - lastDeviceFix >= 5000) {
        lastDeviceFix = Date.now();
        for (const [label, on, selectors] of [['microphone', snap.micOn, SEL.micOff], ['camera', snap.camOn, SEL.camOff]]) {
          if (!on) continue;
          L.error(`the bot's ${label} is ON in the call; turning it off`);
          await clickElement(page, { selectors }, { log: sub('incall'), label: `turn off ${label}` });
        }
      }

      // participants. Primary signal: the participant count. If Meet's count can't be read
      // (null), fall back to the "you're the only one here" hint, or to the tile view
      // showing only the bot's own tile (slower, to ride out spotlight / presentation layouts).
      const n = snap.participantCount;
      const tiles = snap.participantTiles ?? 0;
      if ((typeof n === 'number' && n >= 2) || tiles >= 2 || sawCaptions) sawOthers = true;
      let aloneNow = false;
      let aloneLimit = config.aloneTimeoutMs;
      if (typeof n === 'number') {
        aloneNow = n <= 1 && sawOthers;
      } else if (sawOthers && state === STATES.IN_CALL) {
        if (matchAny(snap.text, TEXT.alone)) {
          aloneNow = true;
        } else if (tiles === 1) {
          aloneNow = true;
          aloneLimit = TILE_ALONE_FACTOR * config.aloneTimeoutMs;
        }
      }
      if (aloneNow) {
        aloneSince ??= now;
        if (now - aloneSince >= aloneLimit) return 'alone';
      } else {
        aloneSince = null;
      }
      if (!sawOthers && now - joined >= config.noOneTimeoutMs) return 'no_one_joined';
      if (!countWarned && typeof n !== 'number' && state === STATES.IN_CALL && now - joined >= COUNT_MISSING_WARN_MS) {
        countWarned = true;
        L.warn('the participant count could not be read for a minute (Meet UI changed?); "alone" detection falls back to page hints and tiles');
      }

      // re-install hooks after a reload; periodic maintenance
      try {
        await checkPageHooks();
      } catch (err) {
        L.debug(`hook check failed: ${err && err.message}`);
      }
      const captionsShowing = snap.captionsOn === true || !!snap.captionRegion;
      if (state === STATES.IN_CALL && Date.now() - lastMaintenance >= maintenanceMs) {
        lastMaintenance = Date.now();
        try {
          await dismissModals(page, { log: sub('incall') });
          if (snap.captionsOn === false && !snap.captionRegion) {
            L.warn('captions are off; turning them back on');
            stats.captionsOn = await ensureCaptions(page, { log: sub('incall') });
          }
        } catch (err) {
          L.debug(`maintenance failed: ${err && err.message}`);
        }
      } else if ((state === STATES.UNKNOWN || state === STATES.RECONNECTING)
        && Date.now() - lastOutOfCallDismiss >= Math.min(DISMISS_OUT_OF_CALL_MS, maintenanceMs)) {
        // a modal over the call hides the toolbar (aria-hidden) → UNKNOWN; answer it
        lastOutOfCallDismiss = Date.now();
        try {
          await dismissModals(page, { log: sub('incall') });
        } catch (err) {
          L.debug(`dismissing popups failed: ${err && err.message}`);
        }
      }
      if (state === STATES.IN_CALL && !captionsShowing && Date.now() - lastCaptionActivity > NO_CAPTIONS_WARN_MS
        && Date.now() - lastCaptionRetry > NO_CAPTIONS_WARN_MS) {
        lastCaptionRetry = Date.now();
        L.warn('no captions for 90 s; re-checking captions (audio is still recorded)');
        try {
          stats.captionsOn = await ensureCaptions(page, { log: sub('incall') });
        } catch (err) {
          L.debug(`ensureCaptions failed: ${err && err.message}`);
        }
      }
      if (state === STATES.IN_CALL && captionLang && Date.now() - lastLangCheck >= langCheckMs) {
        try {
          await checkCaptionLanguage();
        } catch (err) {
          L.debug(`caption language check failed: ${err && err.message}`);
        }
        lastLangCheck = Date.now();
      }
      // no remote audio track at all: warn once (the track mirror is NOT switched on mid-call)
      if (!noAudioWarned && state === STATES.IN_CALL && noTracksSince !== null && Date.now() - noTracksSince >= noAudioWarnMs) {
        noAudioWarned = true;
        stats.audioTracks = 0;
        L.warn(`no remote audio track for ${Math.round(noAudioWarnMs / 1000)} s; audio.wav stays silent until one appears`
          + (config.trackMirror ? '' : ' (the RTCPeerConnection track mirror is off; OPENMEETING_TRACK_MIRROR=1 enables it for the next meeting)'));
        writeStats(true);
      }

      writeStats(false);
      // sleep, but notice a stop request quickly
      const until = Date.now() + pollMs;
      while (Date.now() < until && !stopRequested() && pageAlive()) await sleep(Math.min(100, until - Date.now()));
    }
  };

  // --- run ----------------------------------------------------------------------------------
  try {
    setStatus({ state: 'launching' });
    chrome = await launchChrome({
      chromePath: config.chromePath || undefined,
      profileDir: config.profileDir,
      headless: config.headless,
      muteAudio: config.muteAudio,
      log: sub('chrome'),
    });
    const conn = await connectChrome(chrome.cdpUrl);
    browser = conn.browser;
    page = conn.page;
    browser.on('disconnected', () => { pageGone = true; });
    page.on('close', () => { pageGone = true; });
    page.on('crash', () => {
      L.error('the meeting page crashed');
      pageGone = true;
    });

    // before navigation: page→node bindings, deny mic/cam for the meeting origin. The
    // Capture decoded WebAudio playback before navigation. Native receiver tracks may be silent
    // when Meet decodes audio in its own worklet. The optional receiver-track mirror remains a
    // fallback for pages that render neither a WebAudio output nor native media elements.
    await conn.context.addInitScript(installAudioOutputCapture);
    if (config.trackMirror) {
      await conn.context.addInitScript(installTrackMirror);
      L.info('RTCPeerConnection track mirror enabled (OPENMEETING_TRACK_MIRROR=1)');
    }
    await page.exposeFunction('__omCaptions', onCaptions);
    await page.exposeFunction('__omAudio', onAudio);
    await page.exposeFunction('__omAudioStatus', onAudioStatus);
    // Browser.setPermission takes Permissions-API names ('microphone'/'camera'; the
    // 'audioCapture'/'videoCapture' PermissionType names are rejected). The override is reset
    // when the CDP session detaches, so the session stays open until the meeting is over.
    // The deny is a hard precondition: the bot must never be able to send the PC's microphone
    // or camera into a meeting, so if neither way of denying works, it does not join at all.
    let devicesDenied = false;
    try {
      permissionSession = await browser.newBrowserCDPSession();
      for (const name of ['microphone', 'camera']) {
        await permissionSession.send('Browser.setPermission', { permission: { name }, setting: 'denied', origin: meetingOrigin });
      }
      devicesDenied = true;
      L.info(`microphone and camera denied for ${meetingOrigin}`);
    } catch (err) {
      L.warn(`could not deny microphone/camera via Browser.setPermission: ${err && err.message}`);
    }
    if (!devicesDenied) {
      try {
        // Browser.grantPermissions: grants the listed permissions (none) and rejects all others.
        await conn.context.grantPermissions([], { origin: meetingOrigin });
        devicesDenied = true;
        L.info(`all permissions (microphone and camera included) denied for ${meetingOrigin}`);
      } catch (err) {
        L.error(`could not deny permissions via Browser.grantPermissions: ${err && err.message}`);
      }
    }
    if (!devicesDenied) {
      throw new JoinError('join_failed', 'could not block the microphone and camera for the meeting page; refusing to join');
    }

    setStatus({ state: 'joining' });
    const { admittedAfterMs } = await joinMeeting(page, {
      url,
      displayName,
      lobbyTimeoutMs: config.lobbyTimeoutMs,
      pollMs,
      meetingOrigin,
      blockedBackoffMs: config.blockedBackoffMs ?? 20_000,
      log: sub('join'),
      screenshot,
      shouldStop: stopRequested,
      onState: (s) => setStatus({ state: s }),
    });
    joinedAtMs = Date.now();
    noTracksSince = joinedAtMs; // until audio capture reports a remote track
    setStatus({ state: 'in_call', joinedAt: new Date(joinedAtMs).toISOString() });
    L.info(`joined the meeting (waited ${Math.round(admittedAfterMs / 1000)} s for admission)`);

    store = new TranscriptStore(dir, { code, startedAt });
    assembler = new CaptionAssembler();
    wav = new WavWriter(path.join(dir, 'audio.wav'));
    try {
      await ensureAudioCapture();
    } catch (err) {
      L.warn(`audio capture could not be installed: ${err && err.message}`);
    }

    const prep = await prepareInCall(page, { captionLang, log: sub('incall') });
    stats.captionLang = prep.captionLang;
    stats.captionsOn = prep.captionsOn;
    captionsOpen = true;
    try {
      await ensureCaptionObserver();
    } catch (err) {
      L.warn(`caption observer could not be installed: ${err && err.message}`);
    }
    writeStats(true);

    endReason = await mainLoop();
    L.info(`meeting over: ${endReason}`);
  } catch (err) {
    if (err instanceof JoinError && err.code === 'aborted') {
      endReason = err.reason === 'signal' ? 'signal' : 'user_stop';
      L.info(`stopped before joining: ${endReason}`);
    } else {
      failure = toStatusError(err);
      L.error(`session failed: ${failure.code}`, err);
    }
  }

  // --- finalize -----------------------------------------------------------------------------
  const endedAt = new Date().toISOString();
  if (joinedAtMs !== null) setStatus({ state: 'leaving' });
  try {
    if (pageAlive() && page) {
      await withTimeout(page.evaluate(async () => {
        const cap = /** @type {any} */ (window).__omAudioCapture;
        if (cap && typeof cap.stop === 'function') await cap.stop();
      }), 3000, 'audio stop').catch((e) => L.debug(`audio stop failed: ${e && e.message}`));
      await sleep(300); // let the last __omAudio chunk arrive
    }
    if (hooks.beforeClose && page && pageAlive()) {
      await withTimeout(Promise.resolve(hooks.beforeClose(page)), 10_000, 'beforeClose').catch((e) => L.warn(`beforeClose hook failed: ${e && e.message}`));
    }
    if (assembler) emit(assembler.flush(mono(Date.now())));
    captionsOpen = false;
    if (pageAlive() && page) await withTimeout(leaveCall(page), 6000, 'leaveCall').catch(() => {});
  } catch (err) {
    L.warn(`finalize (page) failed: ${err && err.message}`);
  }
  try {
    if (wav) {
      stats.audioSeconds = Math.round(wav.seconds * 10) / 10;
      stats.audioPeak = wav.peak;
      L.info(`audio: ${stats.audioSeconds} s, peak ${wav.peak}`);
      if (wav.seconds > 0 && wav.peak === 0) L.warn('audio.wav contains only zero samples; no voice was recorded');
      await wav.close();
    }
  } catch (err) {
    L.warn(`closing audio.wav failed: ${err && err.message}`);
  }
  try {
    if (permissionSession) await permissionSession.detach().catch(() => {});
    if (chrome) await chrome.close();
  } catch (err) {
    L.warn(`closing Chrome failed: ${err && err.message}`);
  }

  let extraNote;
  if (!store && !failure) {
    // stopped before joining: still leave an (empty) transcript.md behind
    try {
      store = new TranscriptStore(dir, { code, startedAt });
    } catch (err) {
      L.warn(`could not open the transcript store: ${err && err.message}`);
    }
  }
  if (store) {
    stats.utterances = store.count;
    stats.speakers = store.speakers;
    // Captions in the wrong language (Meet's default is English) turn Mandarin speech into
    // nonsense that still counts as utterances, so the recording is transcribed then too.
    const langMissed = joinedAtMs !== null && !!captionLang && ZH_LANG_RE.test(captionLang) && stats.captionLang !== captionLang;
    const langNote = `字幕語言未能設定為 ${captionLang}，下面的字幕內容可能不正確`;
    const enoughAudio = stats.audioSeconds >= MIN_WHISPER_AUDIO_S;
    if (langMissed && store.count > 0) {
      extraNote = enoughAudio && !sttAvailable(config)
        ? `${langNote}（可安裝 setup-stt 後執行 transcribe，用錄音重新轉錄）`
        : langNote;
    }
    try {
      store.renderMarkdown({ endedAt, captionLang: stats.captionLang, extraNote });
    } catch (err) {
      L.warn(`rendering transcript.md failed: ${err && err.message}`);
    }
    if (!failure && (store.count === 0 || langMissed) && enoughAudio && sttAvailable(config)) {
      const why = store.count === 0 ? '沒有擷取到字幕' : langNote;
      try {
        setStatus({ state: 'transcribing', endedAt, endReason, stats: { ...stats } });
        const r = await runTranscribe({ config, wavPath: path.join(dir, 'audio.wav'), outDir: dir, log: sub('stt') });
        extraNote = `${why}，已用 Whisper 語音辨識錄音：transcript-whisper.md（${r.segments} 段）`;
      } catch (err) {
        L.warn(`Whisper fallback failed: ${err && err.message}`);
        extraNote = `${why}；Whisper 語音辨識失敗（${String((err && err.message) || err).split('\n')[0]}）`;
      }
      try {
        store.renderMarkdown({ endedAt, captionLang: stats.captionLang, extraNote });
      } catch (err) {
        L.warn(`rendering transcript.md failed: ${err && err.message}`);
      }
    }
  }
  clearInterval(heartbeat);

  /** @type {Record<string, any>} */
  const final = failure
    ? { state: 'failed', endedAt, endReason, error: failure, stats: { ...stats } }
    : { state: 'done', endedAt, endReason: endReason || 'meeting_ended', error: null, stats: { ...stats } };
  let result;
  try {
    result = writeStatus(dir, final);
  } catch (err) {
    L.error(`writing the final status failed: ${err && err.message}`);
    result = { ...(readStatus(dir) || {}), ...final };
  }
  L.info(`session ${id} finished: ${final.state}`, { endReason: final.endReason, error: final.error, stats: final.stats });

  for (const s of signals) process.off(s, onSignal);
  process.off('exit', onExit);
  return result;
}
