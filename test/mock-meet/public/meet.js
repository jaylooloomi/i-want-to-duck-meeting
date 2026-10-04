// Mock Google Meet page: entry point and phase machine.
//
//   prejoin ──CTA──▶ lobby ──lobbyMs──▶ in_call ──timeline done + endAfterMs──▶ ended | removed
//                      │                   │                                    (alone: others leave)
//                      ├─▶ denied ("Ask to join again" → lobby)
//                      └─▶ lobby_timeout       Leave call ──▶ left
//   signin → redirect to /v3/signin/identifier; notfound / blocked → message screen only.
//
// Everything a test may want to assert is mirrored in `window.__mock`.
import { readConfig } from './config.js';
import { later } from './dom.js';
import { HAPPY_TIMELINE } from './timeline.js';
import { createPreview, prejoinScreen, lobbyScreen } from './prejoin.js';
import { createCaptions } from './captions.js';
import { createInCall } from './incall.js';
import { startRemoteAudio } from './audio.js';
import * as screens from './screens.js';

const cfg = readConfig(location);

/** Observable mock state (read by tests through `window.__mock`). */
const state = {
  scenario: cfg.scenario,
  phase: 'loading',
  signedIn: cfg.signedIn,
  micOff: false,
  camOff: false,
  name: '',
  captionsOn: false,
  captionLang: 'en-US',
  /** How the caption language was last changed: 'combobox' | 'settings' | 'reset' (null: never). */
  captionLangVia: null,
  /** langpicker query param: 'combobox' | 'settings' | 'both'. */
  langPicker: cfg.langPicker,
  speechStarted: false,
  timelineDone: false,
  stepIndex: 0,
  /** One entry per executed caption step: { op, speaker, text } with the text as displayed. */
  rendered: [],
  alone: false,
  audioState: null,
  joinedAt: null,
  /** Event log: { at (ms since load), type, detail }. */
  events: [],
};
window.__mock = state;

const app = /** @type {HTMLElement} */ (document.getElementById('app'));
document.title = `Meet - ${cfg.code}`;

/** @param {string} type @param {unknown} [detail] */
function log(type, detail) {
  state.events.push({ at: Math.round(performance.now()), type, detail: detail ?? null });
}

/** @param {string} phase @param {HTMLElement} [screen] */
function enter(phase, screen) {
  state.phase = phase;
  document.body.dataset.phase = phase;
  if (screen) app.replaceChildren(screen);
  log('phase', phase);
}

// --- prejoin + lobby -------------------------------------------------------------------------

const preview = createPreview({ state, log });

function showPrejoin() {
  enter('prejoin', prejoinScreen({ state, cfg, preview, onJoin: enterLobby, log }));
}

function enterLobby() {
  enter('lobby', lobbyScreen({ preview, onLeave: () => enter('left', screens.leftScreen()) }));
  later(cfg.lobbyMs, () => {
    if (state.phase !== 'lobby') return;
    if (cfg.scenario === 'denied') enter('denied', screens.deniedScreen(enterLobby));
    else if (cfg.scenario === 'lobby_timeout') enter('lobby_timeout', screens.lobbyTimeoutScreen());
    else enterCall();
  });
}

// --- in call ---------------------------------------------------------------------------------

function enterCall() {
  let resetsLeft = cfg.langResets;
  /**
   * Meet (or a participant) switches the caption language back to English langResetAtMs from
   * now; with langResets > 1, again langResetAtMs after each switch away from en-US.
   */
  function scheduleLangReset() {
    later(cfg.langResetAtMs, () => {
      if (state.phase !== 'in_call' || resetsLeft <= 0) return;
      resetsLeft -= 1;
      captions.setLanguage('en-US', 'reset', { rerender: false });
      if (resetsLeft <= 0) return;
      const watch = setInterval(() => {
        if (state.phase !== 'in_call') clearInterval(watch);
        else if (state.captionLang !== 'en-US') {
          clearInterval(watch);
          scheduleLangReset();
        }
      }, 50);
    });
  }
  const captions = createCaptions({
    state,
    timeline: HAPPY_TIMELINE,
    stepScale: cfg.stepScale,
    leadMs: cfg.captionLeadMs,
    log,
    langPicker: cfg.langPicker,
    langList: cfg.langList,
    onDone: () => {
      later(cfg.endAfterMs, scenarioEnd);
      // Meet (or a participant) switches the caption language back to English mid-call
      scheduleLangReset();
    },
  });
  const ui = createInCall({ state, cfg, captions, onLeave: () => finish('left', screens.leftScreen()), log });
  const audio = cfg.noAudio
    ? { stop() {} }
    : startRemoteAudio((s) => {
      state.audioState = s;
    });
  const maxTimer = later(cfg.maxCallMs, () => finish('ended', screens.callEndedScreen(cfg.endText)));

  /** Leave the in-call phase for an end screen (idempotent). */
  function finish(phase, screen) {
    if (state.phase !== 'in_call') return;
    if (maxTimer !== null) clearTimeout(maxTimer);
    ui.destroy();
    captions.destroy();
    audio.stop();
    enter(phase, screen);
  }

  function scenarioEnd() {
    if (state.phase !== 'in_call') return;
    if (cfg.scenario === 'removed') finish('removed', screens.removedScreen());
    else if (cfg.scenario === 'alone') {
      state.alone = true;
      ui.setAlone(); // and the call simply goes on, with nobody else in it
    } else finish('ended', screens.callEndedScreen(cfg.endText));
  }

  state.joinedAt = Date.now();
  enter('in_call', ui.root);
}

// --- start -----------------------------------------------------------------------------------

switch (cfg.scenario) {
  case 'signin': {
    enter('signin');
    const target = new URL('/v3/signin/identifier', location.origin);
    target.searchParams.set('continue', location.href);
    target.searchParams.set('hl', 'en');
    location.replace(target);
    break;
  }
  case 'notfound':
    enter('notfound', screens.notFoundScreen());
    break;
  case 'blocked':
    enter('blocked', screens.blockedScreen());
    break;
  default:
    showPrejoin();
}
