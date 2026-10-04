// Google Meet URL parsing / normalization.

const MEET_HOST = 'meet.google.com';
const SHORT_HOST = 'g.co'; // g.co/meet/<code> redirects to meet.google.com/<code>
const CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
/** Meet paths that are not meetings (landing page / "start a new meeting"). */
const NON_MEETING_PATHS = new Set(['new', 'landing']);
const LEADING_WRAP = /^[<([{"'`「『（]+/;
const TRAILING_WRAP = /[>)\]}"'`.,;:!?。，、；：！？」』）]+$/;

function notMeet() {
  return new Error('not_a_meet_url');
}

/** @param {string} s */
function unwrap(s) {
  return s.replace(LEADING_WRAP, '').replace(TRAILING_WRAP, '');
}

/** @param {string} s */
function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Picks the token that looks like the meeting link when the input contains whitespace
 * (e.g. a pasted calendar invite or "請加入 <link> 謝謝").
 * @param {string} s trimmed input
 * @param {boolean} allowAnyHost
 * @returns {string|undefined}
 */
function pickCandidate(s, allowAnyHost) {
  const tokens = s.split(/\s+/).filter(Boolean).map(unwrap).filter(Boolean);
  if (tokens.length <= 1) return tokens[0];
  return (
    tokens.find((t) => /(^|[/.])meet\.google\.com(?=[/:?#]|$)/i.test(t) || /(^|\/\/)g\.co\/meet\//i.test(t)) ??
    tokens.find((t) => CODE_RE.test(t.toLowerCase())) ??
    (allowAnyHost ? tokens.find((t) => /^https?:\/\//i.test(t)) : undefined)
  );
}

/**
 * @param {string} segment raw path segment
 * @returns {string} lowercase, decoded, restricted to [a-z0-9_-]
 */
function cleanSegment(segment) {
  return safeDecode(segment).toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

/** @param {string} segment */
function codeFromSegment(segment) {
  const lower = safeDecode(segment).toLowerCase();
  return CODE_RE.test(lower) ? lower : lower.replace(/[^a-z0-9-]/g, '');
}

/**
 * @param {string[]} segments cleaned, non-empty path segments on meet.google.com
 * @param {string|null} authuser
 */
function buildMeet(segments, authuser) {
  if (segments.length === 0) throw notMeet();
  if (segments[0] === 'lookup' && segments.length < 2) throw notMeet();
  if (segments.length === 1 && NON_MEETING_PATHS.has(segments[0])) throw notMeet();
  const code = codeFromSegment(segments[segments.length - 1]);
  if (!code) throw notMeet();
  const qs = new URLSearchParams();
  if (authuser) qs.set('authuser', authuser);
  qs.set('hl', 'en');
  return { code, url: `https://${MEET_HOST}/${segments.join('/')}?${qs}` };
}

/**
 * Parses and normalizes a Google Meet link.
 *
 * Accepts `https://meet.google.com/abc-defg-hij` with or without scheme, extra query/hash,
 * trailing slashes, any letter case, surrounding whitespace, a bare code `abc-defg-hij`,
 * `meet.google.com/lookup/<x>` paths, `g.co/meet/<code>` short links, and a link embedded
 * in surrounding text.
 *
 * @param {unknown} input user-supplied link / code
 * @param {{ allowAnyHost?: boolean }} [opts] allowAnyHost: accept non-Meet http(s) hosts
 *   (tests / mock server); their scheme, host, port, path and query are kept, `hl=en` is set.
 * @returns {{ code: string, url: string }} `url` is `https://meet.google.com/<path>?hl=en`
 *   (only `authuser` is kept from the original query).
 * @throws {Error} `Error('not_a_meet_url')` for empty/garbage input or non-Meet hosts.
 */
export function parseMeetUrl(input, { allowAnyHost = false } = {}) {
  if (typeof input !== 'string') throw notMeet();
  const trimmed = input.trim();
  if (!trimmed) throw notMeet();
  const candidate = pickCandidate(trimmed, allowAnyHost);
  if (!candidate) throw notMeet();

  if (CODE_RE.test(candidate.toLowerCase())) return buildMeet([candidate.toLowerCase()], null);

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate);
  /** @type {URL} */
  let u;
  try {
    u = new URL(hasScheme ? candidate : `https://${candidate}`);
  } catch {
    throw notMeet();
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw notMeet();
  if (!u.hostname) throw notMeet();

  const rawSegments = u.pathname.split('/').filter(Boolean);

  if (u.hostname === MEET_HOST || u.hostname === SHORT_HOST) {
    let segs = rawSegments;
    if (u.hostname === SHORT_HOST) {
      if (segs.length === 0 || segs[0].toLowerCase() !== 'meet') throw notMeet();
      segs = segs.slice(1);
    }
    const cleaned = segs.map(cleanSegment).filter(Boolean);
    return buildMeet(cleaned, u.searchParams.get('authuser'));
  }

  if (!allowAnyHost) throw notMeet();

  // Any host (tests / mock server): keep scheme, host, port, path, query; drop hash; set hl=en.
  if (rawSegments.length === 0) throw notMeet();
  const code = codeFromSegment(rawSegments[rawSegments.length - 1]);
  if (!code) throw notMeet();
  u.hash = '';
  u.pathname = u.pathname.replace(/\/+$/, '');
  u.searchParams.set('hl', 'en');
  return { code, url: u.toString() };
}
