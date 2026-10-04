/**
 * Every Google Meet selector and text matcher lives here, so a Meet UI change is patched in
 * exactly one place. Meet is forced to English (`--lang=en-US` + `?hl=en`), so the text
 * matchers below are English UI strings.
 *
 * - `SEL`: CSS selectors. Arrays are tried in order; plain strings are a single selector.
 * - `TEXT`: substring matchers, compared against text normalized with {@link normalizeText}.
 *
 * Browser-side code (src/page/*.js) cannot import this module; pass it
 * {@link serializableSel}() and `TEXT` as arguments instead.
 * @module meet/selectors
 */

/**
 * Text matchers (substrings of the normalized page / button text).
 *
 * Deviations from spec 5.5 (each one fixes a real-Meet failure mode):
 * - joinCtas: 'Switch here' removed. Meet shows it next to 'Join here too' when the bot
 *   profile's Google account is already in the call on another device; clicking it MOVES the
 *   call to the bot and drops that other device (the user) from their own meeting.
 * - denied: 'Ask to join again' moved to `deniedFallback`. It is a button label, not a denial
 *   statement, and is checked after `lobbyTimeout`, so a "no one responded" screen offering
 *   that button is reported as lobby_timeout, not denied.
 * - ended: more end-screen wordings. alone / switchHere: new.
 */
export const TEXT = {
  joinCtas: ['Join now', 'Ask to join', 'Join here too', 'Join anyway', 'Ask to join anyway', 'Join the call now'],
  continueWithoutDevices: ['Continue without microphone and camera', 'Continue without microphone', 'Continue without camera'],
  lobby: ['Asking to be let in', "You'll join the call when someone lets you in", 'Please wait until a meeting host brings you into the call', 'Waiting for the host to join', 'Waiting for the host to let you in'],
  denied: ['denied your request to join', 'request to join was denied', 'You were denied', "weren't allowed to join", 'not allowed to join'],
  /** Weak denial marker: DENIED only when no lobbyTimeout text matched (classify rule 5b). */
  deniedFallback: ['Ask to join again'],
  lobbyTimeout: ['No one responded to your request to join', 'No one has responded to your request to join'],
  blocked: ["You can't join this video call", "You can't join this meeting", 'There is a problem connecting to this video call'],
  notFound: ['Check your meeting code', 'Invalid video call name', 'Your meeting code has expired', "The meeting code you entered doesn't work", 'Meeting not found'],
  ended: ["You've been removed from the meeting", 'The call ended because everyone left', 'Your host ended the meeting for everyone', 'Meeting ended', 'Call ended', 'You left the meeting',
    "You've left the meeting", 'ended the meeting for everyone', 'call has ended', 'meeting has ended'],
  reconnecting: ['Trying to reconnect', 'You lost your network connection', 'Reconnecting'],
  dismiss: ['Got it', 'Dismiss', 'Stay in the call'],
  /** In-call hints that nobody else is here (used only while the participant count is unreadable). */
  alone: ["You're the only one here", 'No one else is here'],
  /** Prejoin button that would take the call over from the account's other device: never clicked. */
  switchHere: ['Switch here'],
};

/** CSS selectors (lists are tried in order). */
export const SEL = {
  nameInput: ['input[type="text"][aria-label="Your name"]', 'input[jsname][type="text"]:not([aria-hidden="true"])', 'input[placeholder*="name" i]'],
  micOff: ['[aria-label*="Turn off microphone"]'],
  camOff: ['[aria-label*="Turn off camera"]'],
  leave: ['button[aria-label="Leave call"]', 'button[jsname="CQylAd"]'],
  captionsTurnOn: ['button[aria-label="Turn on captions"]', 'button[aria-label="Captions and translation"]'],
  captionsTurnOff: ['button[aria-label="Turn off captions"]'],
  participantTile: '[data-participant-id]',
  selfName: '[data-self-name]',
  avatarCount: '[data-avatar-count]',
  peopleButton: 'button[aria-label^="People"]',
  moreOptions: ['button[aria-label="More options"]'],
  settingsMenuItemText: 'Settings',
  captionsSettingsTab: ['button[aria-label="Captions"]'],
  /** @param {string} code caption language code, e.g. 'cmn-Hant-TW' */
  captionLangItem: (code) => `li[data-value="${code}"]`,
  closeDialog: ['button[aria-label="Close dialog"]', 'button[aria-label="Close dialogue"]'],
  captionRegion: ['[role="region"][aria-label="Captions"]', 'div[role="region"][tabindex="0"]', '.vNKgIf'],
  captionBlock: '.nMcdL',
  captionSpeaker: '.NWpY1d',
  captionText: '.ygicle',
};

// Typographic apostrophes/quotes that Meet uses in its UI strings (’ ‘ ‛ ʼ).
const APOSTROPHES = /[‘’‛ʼ]/g;
// Zero-width characters that would break substring matching.
const ZERO_WIDTH = /[​-‍⁠﻿]/g;

/**
 * Normalize UI text for matching: curly apostrophes → `'`, zero-width chars removed,
 * every whitespace run (incl. newlines and nbsp) collapsed to one space, trimmed.
 * @param {unknown} s
 * @returns {string} '' for null/undefined
 */
export function normalizeText(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(ZERO_WIDTH, '').replace(APOSTROPHES, "'").replace(/\s+/g, ' ').trim();
}

/**
 * Case-sensitive substring match of `text` against a list of matchers (both sides normalized).
 * @param {unknown} text
 * @param {readonly string[] | null | undefined} list
 * @returns {string | null} the first entry (in list order) contained in the text, else null
 */
export function matchAny(text, list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const hay = normalizeText(text);
  if (!hay) return null;
  for (const entry of list) {
    const needle = normalizeText(entry);
    if (needle && hay.includes(needle)) return entry;
  }
  return null;
}

/**
 * Deep copy of `SEL` (or any plain object) with every function-valued entry removed, so it can
 * be passed to `page.evaluate` / `addInitScript`.
 * @param {Record<string, any>} [sel=SEL]
 * @returns {Record<string, any>}
 */
export function serializableSel(sel = SEL) {
  return /** @type {Record<string, any>} */ (copyWithoutFunctions(sel));
}

/** @param {any} value */
function copyWithoutFunctions(value) {
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v !== 'function').map(copyWithoutFunctions);
  }
  if (value && typeof value === 'object') {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v !== 'function') out[k] = copyWithoutFunctions(v);
    }
    return out;
  }
  return value;
}
