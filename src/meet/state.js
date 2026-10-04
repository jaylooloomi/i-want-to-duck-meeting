/**
 * Pure page-state classifier: turns a snapshot (from src/page/snapshot.js) into one of the
 * {@link STATES}. No I/O, no DOM — unit-testable with hand-built snapshot objects.
 * @module meet/state
 */
import { TEXT, matchAny, normalizeText } from './selectors.js';

/** All states `classify` can return. */
export const STATES = Object.freeze({
  SIGNIN_REQUIRED: 'SIGNIN_REQUIRED',
  BLOCKED: 'BLOCKED',
  NOT_FOUND: 'NOT_FOUND',
  DENIED: 'DENIED',
  LOBBY_TIMEOUT: 'LOBBY_TIMEOUT',
  ENDED: 'ENDED',
  RECONNECTING: 'RECONNECTING',
  LOBBY: 'LOBBY',
  PREJOIN: 'PREJOIN',
  IN_CALL: 'IN_CALL',
  BLANK: 'BLANK',
  UNKNOWN: 'UNKNOWN',
});

const SIGNIN_HOST = 'accounts.google.com';
// Any host: lets the mock server emulate the Google sign-in wall.
const SIGNIN_PATH_PREFIXES = ['/v3/signin', '/signin', '/ServiceLogin'];
const REDIRECT_BLOCKED_HOSTS = ['workspace.google.com'];
const MEET_HOST = 'meet.google.com';

/** Text rules 3–9, in decision order (5b: the weak 'Ask to join again' marker, after lobbyTimeout). */
const TEXT_RULES = /** @type {const} */ ([
  ['notFound', STATES.NOT_FOUND],
  ['denied', STATES.DENIED],
  ['lobbyTimeout', STATES.LOBBY_TIMEOUT],
  ['deniedFallback', STATES.DENIED],
  ['blocked', STATES.BLOCKED],
  ['ended', STATES.ENDED],
  ['reconnecting', STATES.RECONNECTING],
  ['lobby', STATES.LOBBY],
]);

/**
 * @typedef {object} Snapshot
 * @property {string} [url]
 * @property {string} [text]
 * @property {boolean} [nameInputVisible]
 * @property {string[]} [ctaTexts]
 * @property {boolean} [leaveButton]
 * @property {boolean|null} [captionsOn]
 * @property {boolean} [captionRegion]
 * @property {number} [participantTiles]
 * @property {boolean} [selfName]
 * @property {number|null} [participantCount]
 * @property {boolean} [bodyEmpty]
 */

/**
 * Classify a page snapshot. First matching rule wins:
 * 1 SIGNIN_REQUIRED (accounts.google.com, or a /v3/signin|/signin|/ServiceLogin path on any host)
 * 2 BLOCKED by redirect (workspace.google.com; origin ≠ meetingOrigin; meeting-host landing page)
 * 3 NOT_FOUND 4 DENIED 5 LOBBY_TIMEOUT 5b DENIED ('Ask to join again') 6 BLOCKED 7 ENDED
 * 8 RECONNECTING 9 LOBBY (TEXT matchers)
 * 10 PREJOIN (CTA or name input visible) 11 IN_CALL (an in-call signal AND the leave button)
 * 12 BLANK 13 UNKNOWN.
 *
 * @param {Snapshot | null | undefined} snap
 * @param {{ meetingOrigin?: string | null }} [options] meetingOrigin: origin (or any URL) of the
 *   meeting being joined, e.g. 'https://meet.google.com' or the mock server's origin.
 * @returns {{ state: string, matched: string | null }} matched = the text/selector/URL part that decided it
 */
export function classify(snap, { meetingOrigin } = {}) {
  const s = snap || {};

  const urlVerdict = classifyUrl(s.url, meetingOrigin);
  if (urlVerdict) return urlVerdict;

  const text = normalizeText(s.text);
  for (const [key, state] of TEXT_RULES) {
    const m = matchAny(text, TEXT[key]);
    if (m) return result(state, m);
  }

  if (Array.isArray(s.ctaTexts) && s.ctaTexts.length > 0) return result(STATES.PREJOIN, String(s.ctaTexts[0]));
  if (s.nameInputVisible) return result(STATES.PREJOIN, 'nameInput');

  if (s.leaveButton) {
    const signal = inCallSignal(s);
    if (signal) return result(STATES.IN_CALL, `leaveButton+${signal}`);
  }

  const bodyEmpty = typeof s.bodyEmpty === 'boolean' ? s.bodyEmpty : text.length < 5;
  if (bodyEmpty) return result(STATES.BLANK, 'bodyEmpty');

  return result(STATES.UNKNOWN, null);
}

/**
 * The in-call signal of rule 11 (without the leave button): which structural element shows
 * that the page is the in-call view, or null.
 * @param {Snapshot | null | undefined} snap
 * @returns {'captionsButton'|'participantTiles'|'selfName'|'captionRegion'|null}
 */
export function inCallSignal(snap) {
  const s = snap || {};
  if (s.captionsOn !== null && s.captionsOn !== undefined) return 'captionsButton';
  if ((s.participantTiles ?? 0) > 0) return 'participantTiles';
  if (s.selfName) return 'selfName';
  if (s.captionRegion) return 'captionRegion';
  return null;
}

/** Text-decided states that Meet shows as a full-page screen (never next to the call toolbar). */
const SCREEN_TEXT_STATES = new Set([STATES.NOT_FOUND, STATES.DENIED, STATES.LOBBY_TIMEOUT, STATES.BLOCKED, STATES.ENDED]);

/**
 * `classify` for a bot that is already in the call (session main loop). Identical, except that a
 * TEXT-decided NOT_FOUND / DENIED / LOBBY_TIMEOUT / BLOCKED / ENDED is ignored while the in-call
 * view is still there (leave button + an in-call signal): the page text then came from a chat
 * toast or notification ("Call ended?" typed in chat), not from a Meet end screen, which never
 * shows the call toolbar. URL-decided verdicts, RECONNECTING and LOBBY are never overridden.
 * @param {Snapshot | null | undefined} snap
 * @param {{ meetingOrigin?: string | null }} [options]
 * @returns {{ state: string, matched: string | null, ignoredText?: string }} ignoredText: the
 *   matcher that was overridden (only when the verdict was changed to IN_CALL)
 */
export function classifyInCall(snap, options = {}) {
  const verdict = classify(snap, options);
  if (!SCREEN_TEXT_STATES.has(verdict.state)) return verdict;
  const s = snap || {};
  if (!s.leaveButton) return verdict;
  if (classifyUrl(s.url, options.meetingOrigin)) return verdict; // decided by the URL, not by text
  const signal = inCallSignal(s);
  if (!signal) return verdict;
  return { state: STATES.IN_CALL, matched: `leaveButton+${signal}`, ignoredText: String(verdict.matched) };
}

/**
 * Rules 1–2 (URL based).
 * @param {unknown} rawUrl
 * @param {unknown} meetingOrigin
 * @returns {{ state: string, matched: string } | null}
 */
function classifyUrl(rawUrl, meetingOrigin) {
  const url = parseUrl(rawUrl);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (host === SIGNIN_HOST) return result(STATES.SIGNIN_REQUIRED, host);
  const lowerPath = path.toLowerCase();
  const signinPrefix = SIGNIN_PATH_PREFIXES.find((p) => lowerPath.startsWith(p.toLowerCase()));
  if (signinPrefix) return result(STATES.SIGNIN_REQUIRED, signinPrefix);

  // Redirect checks only make sense for real web pages (not about:blank, chrome-error:, ...).
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  if (REDIRECT_BLOCKED_HOSTS.includes(host)) return result(STATES.BLOCKED, host);

  const origin = toOrigin(meetingOrigin);
  if (origin && url.origin !== origin) return result(STATES.BLOCKED, `redirect:${url.origin}`);

  const onMeetingHost = origin ? url.origin === origin : host === MEET_HOST;
  if (onMeetingHost && isLandingPath(path)) return result(STATES.BLOCKED, `landing:${path}`);

  return null;
}

/** Meet's home/landing page (no meeting code): '/', '/landing', '/landing/...'. */
function isLandingPath(/** @type {string} */ path) {
  return path === '' || path === '/' || path === '/landing' || path.startsWith('/landing/');
}

/** @param {unknown} u */
function parseUrl(u) {
  if (typeof u !== 'string' || !u) return null;
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

/** @param {unknown} o origin or full URL @returns {string | null} */
function toOrigin(o) {
  const u = parseUrl(o);
  return u && u.origin !== 'null' ? u.origin : null;
}

/**
 * @param {string} state
 * @param {string | null} matched
 */
function result(state, matched) {
  return { state, matched };
}
