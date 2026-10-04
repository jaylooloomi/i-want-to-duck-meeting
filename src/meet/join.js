/**
 * Join flow (spec 5.8): prejoin screen → lobby → IN_CALL, plus the small page helpers the
 * in-call code reuses (snapshot, find a visible element, human-like click / typing).
 *
 * Every click is a real Playwright mouse click (hover, 150–400 ms pause, click) on an element
 * handle — never `element.click()` in page JS — so Meet only ever sees trusted input.
 * @module meet/join
 */
import { SEL, TEXT, serializableSel } from './selectors.js';
import { classify, classifyInCall, STATES } from './state.js';
import { collectSnapshot } from '../page/snapshot.js';

/** Error codes a JoinError can carry (status.json `error.code`), plus 'aborted' (stop requested). */
export const JOIN_ERROR_CODES = Object.freeze(['signin_required', 'not_found', 'blocked', 'denied', 'lobby_timeout', 'join_failed', 'aborted']);

/** A join failure with a status.json error code. */
export class JoinError extends Error {
  /**
   * @param {string} code one of the status error codes (or 'aborted' when a stop was requested)
   * @param {string} [message] human readable detail
   */
  constructor(code, message) {
    super(message || code);
    this.name = 'JoinError';
    this.code = code;
    /** @type {string|null} why the join was aborted (only for code 'aborted') */
    this.reason = null;
  }
}

const SNAPSHOT_ARG = [serializableSel(), TEXT];
const DEFAULT_CLICK_TIMEOUT_MS = 3000;

/** @param {number} ms */
export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Random integer in [min, max]. @param {number} min @param {number} max */
export function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * Reject when `promise` does not settle within `ms` (the promise itself keeps running; its
 * late rejection is swallowed).
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} [label]
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Logger adapter: accepts a src/log.js logger, a function, or nothing.
 * @param {any} log
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
export function toLog(log) {
  const noop = () => {};
  if (typeof log === 'function') return { debug: noop, info: log, warn: log, error: log };
  if (log && typeof log === 'object') {
    const pick = (k, ...alts) => {
      for (const name of [k, ...alts]) if (typeof log[name] === 'function') return log[name].bind(log);
      return noop;
    };
    return { debug: pick('debug'), info: pick('info', 'log'), warn: pick('warn', 'info', 'log'), error: pick('error', 'warn', 'info') };
  }
  return { debug: noop, info: noop, warn: noop, error: noop };
}

/**
 * Snapshot of the current page for classify() (src/page/snapshot.js, run in the page).
 * @param {import('playwright-core').Page} page
 * @param {number} [timeoutMs]
 */
export function takeSnapshot(page, timeoutMs = 10_000) {
  return withTimeout(page.evaluate(collectSnapshot, SNAPSHOT_ARG), timeoutMs, 'snapshot');
}

/**
 * Browser-side: the first visible element for `spec`. Self-contained (passed to evaluateHandle).
 * - `{ selectors }`: CSS selector(s), tried in order; first visible hit wins.
 * - `{ texts, scope?, exact? }`: elements matching `scope` (default buttons) whose text equals
 *   (or, with exact:false, contains) an entry of `texts`; entries are tried in list order.
 *   Text = normalized text without aria-hidden descendants (icon ligatures), or innerText.
 * Visible = connected, no aria-hidden ancestor, not display:none / visibility:hidden, has rects.
 * @param {{ selectors?: string|string[], texts?: string|string[], scope?: string|string[], exact?: boolean }} spec
 * @returns {Element|null}
 */
export function findInPage(spec) {
  const norm = (s) => (s === null || s === undefined ? '' : String(s))
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/[‘’‛ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  const asList = (v) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]);
  const all = (sel) => {
    if (typeof sel !== 'string' || !sel.trim()) return [];
    try {
      return Array.from(document.querySelectorAll(sel));
    } catch {
      return [];
    }
  };
  const isVisible = (el) => {
    if (!el || !el.isConnected) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    return el.getClientRects().length > 0;
  };
  const ownText = (el) => {
    let out = '';
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) out += c.data;
        else if (c.nodeType === 1) {
          if (c.getAttribute('aria-hidden') === 'true' || c.tagName === 'SCRIPT' || c.tagName === 'STYLE') continue;
          out += ' ';
          walk(c);
          out += ' ';
        }
      }
    };
    walk(el);
    return norm(out);
  };
  const s = spec || {};
  if (s.texts !== undefined) {
    const seen = new Set();
    const candidates = [];
    for (const sc of asList(s.scope || 'button, [role="button"]')) {
      for (const el of all(sc)) {
        if (!seen.has(el)) {
          seen.add(el);
          if (isVisible(el)) candidates.push(el);
        }
      }
    }
    for (const t of asList(s.texts)) {
      const want = norm(t);
      if (!want) continue;
      for (const el of candidates) {
        const a = ownText(el);
        const b = norm(el.innerText);
        const hit = s.exact === false ? a.includes(want) || b.includes(want) : a === want || b === want;
        if (hit) return el;
      }
    }
    return null;
  }
  for (const sel of asList(s.selectors)) {
    for (const el of all(sel)) if (isVisible(el)) return el;
  }
  return null;
}

/**
 * First visible element for `spec` (see {@link findInPage}) as an ElementHandle, or null.
 * The caller owns the handle (dispose it).
 * @param {import('playwright-core').Page} page
 * @param {Parameters<typeof findInPage>[0]} spec
 * @returns {Promise<import('playwright-core').ElementHandle<Element>|null>}
 */
export async function findElement(page, spec) {
  const handle = await withTimeout(page.evaluateHandle(findInPage, spec), 10_000, 'findElement');
  const el = handle.asElement();
  if (!el) {
    await handle.dispose().catch(() => {});
    return null;
  }
  return el;
}

/**
 * Human-like real mouse click: scroll into view, hover, wait 150–400 ms, click.
 * @param {import('playwright-core').ElementHandle<Element>} el
 * @param {{ timeout?: number }} [opts]
 */
export async function humanClick(el, { timeout = DEFAULT_CLICK_TIMEOUT_MS } = {}) {
  await el.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
  await el.hover({ timeout });
  await sleep(randInt(150, 400));
  await el.click({ timeout });
}

/**
 * Find the first visible element for `spec` and click it like a human.
 * @param {import('playwright-core').Page} page
 * @param {Parameters<typeof findInPage>[0]} spec
 * @param {{ log?: any, label?: string, timeout?: number }} [opts]
 * @returns {Promise<boolean>} true when something was clicked
 */
export async function clickElement(page, spec, { log, label, timeout } = {}) {
  const L = toLog(log);
  let el = null;
  try {
    el = await findElement(page, spec);
    if (!el) return false;
    await humanClick(el, { timeout });
    L.debug(`clicked ${label || describeSpec(spec)}`);
    return true;
  } catch (err) {
    L.debug(`click failed: ${label || describeSpec(spec)}: ${err && err.message}`);
    return false;
  } finally {
    if (el) await el.dispose().catch(() => {});
  }
}

/** @param {any} spec */
function describeSpec(spec) {
  if (!spec) return '?';
  const v = spec.texts ?? spec.selectors;
  return Array.isArray(v) ? v[0] + (v.length > 1 ? ` (+${v.length - 1})` : '') : String(v);
}

/**
 * Type `text` into the focused element, one character at a time with a 30–80 ms pause per key
 * (trusted keyboard input; non-ASCII characters arrive as input events).
 * @param {import('playwright-core').Page} page
 * @param {string} text
 */
export async function humanType(page, text) {
  for (const ch of String(text)) {
    await page.keyboard.type(ch);
    await sleep(randInt(30, 80));
  }
}

/**
 * Prejoin actions for one poll, in spec order. Returns what was done:
 * 'continue' | 'dismiss' (a dialog was handled; re-snapshot before anything else),
 * 'cta' (the join button was clicked) or null.
 * @param {import('playwright-core').Page} page
 * @param {{ displayName: string, log: ReturnType<typeof toLog> }} o
 * @returns {Promise<'continue'|'dismiss'|'cta'|'devices_on'|null>} 'devices_on': the microphone
 *   or camera could not be turned off, so the join button was NOT clicked
 */
async function prejoinStep(page, { displayName, log }) {
  if (await clickElement(page, { texts: TEXT.continueWithoutDevices }, { log, label: 'continue without devices' })) {
    log.info('join: clicked "continue without microphone and camera"');
    return 'continue';
  }
  if (await clickElement(page, { texts: TEXT.dismiss }, { log, label: 'dismiss' })) {
    log.info('join: dismissed a popup');
    return 'dismiss';
  }

  // name input (anonymous join): click it and type the display name
  let input = null;
  try {
    input = await findElement(page, { selectors: SEL.nameInput });
    if (input) {
      const value = String(await input.evaluate((el) => /** @type {HTMLInputElement} */ (el).value ?? ''));
      if (!value.trim()) {
        await humanClick(input);
        const focused = await input.evaluate((el) => document.activeElement === el);
        if (!focused) await input.focus();
        await humanType(page, displayName);
        const typed = String(await input.evaluate((el) => /** @type {HTMLInputElement} */ (el).value ?? ''));
        log.info(`join: typed display name (${typed === displayName ? 'ok' : `got "${typed}"`})`);
        await sleep(randInt(200, 500));
      }
    }
  } catch (err) {
    log.warn(`join: could not fill the name input: ${err && err.message}`);
  } finally {
    if (input) await input.dispose().catch(() => {});
  }

  // microphone / camera: click every visible "Turn off ..." toggle so both end up off
  const devices = /** @type {const} */ ([['microphone', SEL.micOff], ['camera', SEL.camOff]]);
  for (const [label, selectors] of devices) {
    if (await clickElement(page, { selectors }, { log, label: `turn off ${label}` })) {
      log.info(`join: turned off ${label}`);
      await sleep(randInt(150, 350));
    }
  }
  // Never join with a live microphone or camera: if a "Turn off ..." toggle is still visible
  // (the click failed, e.g. a popup was in the way), skip the join button this round.
  const stillOn = [];
  for (const [label, selectors] of devices) {
    if (await isShown(page, { selectors })) stillOn.push(label);
  }
  if (stillOn.length) {
    log.warn(`join: the ${stillOn.join(' and ')} is still on; not clicking the join button yet`);
    return 'devices_on';
  }

  // The bot's Google account is already in this call on another device. 'Switch here' would
  // move the call away from that device (the user's own seat): it is never clicked.
  if (await isShown(page, { texts: TEXT.switchHere })) {
    log.warn('join: this Google account is already in the call on another device; joining as an extra device ("Join here too"), never "Switch here"');
  }

  // the join button, first visible one in TEXT.joinCtas order
  if (await clickElement(page, { texts: TEXT.joinCtas }, { log, label: 'join CTA' })) return 'cta';
  return null;
}

/**
 * Whether a visible element matches `spec` (see {@link findInPage}).
 * @param {import('playwright-core').Page} page
 * @param {Parameters<typeof findInPage>[0]} spec
 */
async function isShown(page, spec) {
  const el = await findElement(page, spec).catch(() => null);
  if (!el) return false;
  await el.dispose().catch(() => {});
  return true;
}

/**
 * Join a Meet meeting: navigate, get through the prejoin screen, wait in the lobby until
 * admitted, and return once IN_CALL has been observed on `inCallPolls` consecutive polls.
 *
 * Failure handling: SIGNIN_REQUIRED / NOT_FOUND / DENIED / LOBBY_TIMEOUT throw at once;
 * BLOCKED (or BLANK for more than 10 s) re-navigates, at most `maxAttempts` attempts in total
 * with `blockedBackoffMs` × attempt backoff (20 s, 40 s), then throws `blocked`. Stuck on the
 * prejoin screen for `prejoinTimeoutMs` → `join_failed`; asked to join but not admitted within
 * `lobbyTimeoutMs` → `lobby_timeout`. A screenshot is taken on every throw and once per UNKNOWN
 * stretch longer than 15 s. `shouldStop()` returning a reason aborts with JoinError('aborted').
 *
 * @param {import('playwright-core').Page} page
 * @param {{
 *   url: string, displayName: string, lobbyTimeoutMs?: number, pollMs?: number,
 *   onState?: (state: string) => void, log?: any, screenshot?: (name: string) => Promise<unknown>,
 *   meetingOrigin?: string, prejoinTimeoutMs?: number, blockedBackoffMs?: number, maxAttempts?: number,
 *   blankRetryMs?: number, unknownScreenshotMs?: number, inCallPolls?: number,
 *   shouldStop?: () => (string|null|undefined),
 * }} opts
 * @returns {Promise<{ admittedAfterMs: number }>}
 * @throws {JoinError}
 */
export async function joinMeeting(page, {
  url,
  displayName,
  lobbyTimeoutMs = 15 * 60_000,
  pollMs = 1500,
  onState = () => {},
  log,
  screenshot = async () => {},
  meetingOrigin,
  prejoinTimeoutMs = 90_000,
  blockedBackoffMs = 20_000,
  maxAttempts = 3,
  blankRetryMs = 10_000,
  unknownScreenshotMs = 15_000,
  inCallPolls = 3,
  shouldStop = () => null,
}) {
  const L = toLog(log);
  const origin = meetingOrigin || new URL(url).origin;

  let attempt = 0;
  let phaseStart = 0; // last navigation
  /** @type {number|null} */ let firstCtaAt = null; // first CTA click (for admittedAfterMs)
  /** @type {number|null} */ let ctaAt = null; // last CTA click
  /** @type {number|null} */ let askedAt = null; // page left PREJOIN after a CTA click
  /** @type {number|null} */ let lobbySince = null;
  /** @type {number|null} */ let blankSince = null;
  /** @type {number|null} */ let unknownSince = null;
  let unknownShot = false;
  let inCallStreak = 0;
  let lastState = '';
  let waitingReported = false;
  let prejoinIssue = '';

  const shot = async (name) => {
    try {
      await screenshot(name);
    } catch (err) {
      L.debug(`join: screenshot failed: ${err && err.message}`);
    }
  };
  const fail = async (code, message) => {
    L.warn(`join: failed: ${code}: ${message}`);
    await shot(`join-${code}`);
    throw new JoinError(code, message);
  };
  const checkStop = () => {
    const reason = shouldStop();
    if (reason) {
      const err = new JoinError('aborted', `stop requested while joining (${reason})`);
      err.reason = reason;
      throw err;
    }
  };
  /** Sleep in small slices so a stop request is noticed quickly. */
  const pause = async (ms) => {
    const end = Date.now() + ms;
    for (;;) {
      checkStop();
      const left = end - Date.now();
      if (left <= 0) return;
      await sleep(Math.min(left, 250));
    }
  };

  const navigate = async () => {
    attempt += 1;
    L.info(`join: opening the meeting (attempt ${attempt}/${maxAttempts})`, { url });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    } catch (err) {
      if (page.isClosed()) throw new JoinError('join_failed', 'the browser page was closed');
      L.warn(`join: navigation error: ${err && err.message}`);
    }
    phaseStart = Date.now();
    ctaAt = null;
    askedAt = null;
    lobbySince = null;
    blankSince = null;
    unknownSince = null;
    unknownShot = false;
    inCallStreak = 0;
  };

  const retryOrFail = async (why) => {
    if (attempt >= maxAttempts) {
      await fail('blocked', `${why}; gave up after ${attempt} attempts`);
    }
    const wait = blockedBackoffMs * attempt;
    L.warn(`join: ${why}; retrying in ${Math.round(wait / 1000)} s`);
    await shot(`join-retry-${attempt}`);
    await pause(wait);
    await navigate();
  };

  checkStop();
  await navigate();

  for (;;) {
    checkStop();
    if (page.isClosed()) throw new JoinError('join_failed', 'the browser page was closed');
    const now = Date.now();
    /** @type {{ state: string, matched: string|null }} */
    let verdict;
    try {
      // Once the call view has been seen, an end-screen phrase next to the call toolbar is a
      // chat toast, not a verdict (see classifyInCall); before that, text decides as usual.
      const classifier = inCallStreak > 0 ? classifyInCall : classify;
      verdict = classifier(await takeSnapshot(page), { meetingOrigin: origin });
    } catch (err) {
      if (page.isClosed()) throw new JoinError('join_failed', 'the browser page was closed');
      L.debug(`join: snapshot failed: ${err && err.message}`);
      verdict = { state: STATES.BLANK, matched: 'snapshot_failed' };
    }
    const { state, matched } = verdict;
    if (state !== lastState) {
      L.info(`join: page state ${state}`, matched ? { matched } : undefined);
      lastState = state;
    }
    if (state !== STATES.IN_CALL) inCallStreak = 0;
    if (state !== STATES.BLANK) blankSince = null;
    if (state !== STATES.UNKNOWN) {
      unknownSince = null;
      unknownShot = false;
    }
    if (ctaAt !== null && state !== STATES.PREJOIN) askedAt ??= now;

    switch (state) {
      case STATES.SIGNIN_REQUIRED:
        await fail('signin_required', `Google asks to sign in (${matched})`);
        break;
      case STATES.NOT_FOUND:
        await fail('not_found', `Meet says: ${matched}`);
        break;
      case STATES.DENIED:
        await fail('denied', `Meet says: ${matched}`);
        break;
      case STATES.LOBBY_TIMEOUT:
        await fail('lobby_timeout', `Meet says: ${matched}`);
        break;
      case STATES.ENDED:
        await fail('join_failed', `the meeting page shows "${matched}" before the bot joined`);
        break;
      case STATES.BLOCKED:
        await retryOrFail(`blocked (${matched})`);
        continue;
      case STATES.BLANK:
        blankSince ??= now;
        if (now - blankSince > blankRetryMs) {
          await retryOrFail('the page stayed blank');
          continue;
        }
        break;
      case STATES.IN_CALL:
        inCallStreak += 1;
        lobbySince = null;
        if (inCallStreak >= inCallPolls) {
          const admittedAfterMs = firstCtaAt === null ? 0 : now - firstCtaAt;
          L.info(`join: in the call (admitted ${Math.round(admittedAfterMs / 1000)} s after asking)`);
          return { admittedAfterMs };
        }
        break;
      case STATES.LOBBY:
        lobbySince ??= now;
        if (!waitingReported) {
          waitingReported = true;
          try {
            onState('waiting_admission');
          } catch (err) {
            L.debug(`join: onState threw: ${err && err.message}`);
          }
        }
        break;
      case STATES.PREJOIN: {
        askedAt = null;
        const did = await prejoinStep(page, { displayName, log: L });
        if (did === 'cta') {
          ctaAt = Date.now();
          firstCtaAt ??= ctaAt;
          L.info('join: clicked the join button');
        }
        prejoinIssue = did === 'devices_on' ? '; the microphone/camera could not be turned off' : '';
        break;
      }
      default:
        // UNKNOWN / RECONNECTING: dialogs can hide the page behind them
        if (await clickElement(page, { texts: TEXT.continueWithoutDevices }, { log: L })) {
          L.info('join: clicked "continue without microphone and camera"');
        } else if (await clickElement(page, { texts: TEXT.dismiss }, { log: L })) {
          L.info('join: dismissed a popup');
        }
        if (state === STATES.UNKNOWN) {
          unknownSince ??= now;
          if (!unknownShot && now - unknownSince > unknownScreenshotMs) {
            unknownShot = true;
            L.warn('join: page state UNKNOWN for more than 15 s (Meet UI changed?)');
            await shot('join-unknown');
          }
        }
    }

    const t = Date.now();
    const waitingSince = askedAt ?? lobbySince;
    if (waitingSince !== null) {
      if (t - waitingSince > lobbyTimeoutMs) {
        await fail('lobby_timeout', `not admitted within ${Math.round(lobbyTimeoutMs / 1000)} s`);
      }
    } else if (t - phaseStart > prejoinTimeoutMs) {
      await fail('join_failed', `could not get past the prejoin screen within ${Math.round(prejoinTimeoutMs / 1000)} s (last state ${state}${prejoinIssue})`);
    }
    await pause(pollMs);
  }
}
