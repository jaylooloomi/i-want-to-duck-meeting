// Mock page configuration, read from the meeting URL's query string.

export const SCENARIOS = ['happy', 'denied', 'blocked', 'lobby_timeout', 'removed', 'alone', 'signin', 'notfound', 'continue_dialog'];

/**
 * @typedef {object} MockConfig
 * @property {string} code         meeting code (path without the leading slash)
 * @property {string} scenario     one of SCENARIOS (default 'happy')
 * @property {number} lobbyMs      time spent in the lobby before admit/deny/timeout
 * @property {boolean} signedIn    signedin=1 → no name input, CTA "Join now"
 * @property {string} account      display name used when signed in
 * @property {number} endAfterMs   delay between the end of the caption timeline and the scenario's end event
 * @property {number} stepScale    multiplier for timeline step times (query param captionStepMs)
 * @property {number} captionLeadMs silence after captions go on before speech starts when the
 *                                 caption language is NOT cmn-Hant-TW (speech starts at once when it is)
 * @property {number} maxCallMs    hard end of the call after joining (default: never)
 * @property {string} toast        toast=<text>: a notification (e.g. a chat message) that appears toastAtMs
 *                                 after joining and stays up for the rest of the call
 * @property {number} toastAtMs    default 3000
 * @property {string} endText      endText=<text>: title of the "call ended" screen (an unrecognized end screen)
 * @property {boolean} noCount     nocount=1: the People button shows no participant count
 * @property {boolean} aloneHint   alonehint=1: "You're the only one here" appears once everybody else left
 * @property {string} langList     langlist=missing: no cmn-Hant-TW entry in the caption-language list;
 *                                 langlist=nodatavalue: list items carry no data-value (only their labels)
 */

/**
 * @param {Location | URL} loc
 * @returns {MockConfig}
 */
export function readConfig(loc) {
  const q = new URLSearchParams(loc.search);
  /** Non-negative number param, or `fallback` when missing/invalid. */
  const num = (name, fallback) => {
    const raw = q.get(name);
    if (raw === null || raw.trim() === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const scenario = q.get('scenario') ?? 'happy';
  return {
    code: loc.pathname.replace(/^\//, ''),
    scenario: SCENARIOS.includes(scenario) ? scenario : 'happy',
    lobbyMs: num('lobbyMs', 1500),
    signedIn: q.get('signedin') === '1',
    account: q.get('account') || 'OpenMeeting Bot',
    endAfterMs: num('endAfterMs', 2000),
    stepScale: num('captionStepMs', num('captionScale', 1)),
    captionLeadMs: num('captionLeadMs', 8000),
    maxCallMs: num('maxCallMs', Infinity),
    toast: q.get('toast') || '',
    toastAtMs: num('toastAtMs', 3000),
    endText: q.get('endText') || '',
    noCount: q.get('nocount') === '1',
    aloneHint: q.get('alonehint') === '1',
    langList: q.get('langlist') || '',
  };
}
