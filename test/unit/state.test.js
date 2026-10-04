import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classify, classifyInCall, inCallSignal, STATES } from '../../src/meet/state.js';
import { TEXT } from '../../src/meet/selectors.js';

const MEET = 'https://meet.google.com';
const MEET_URL = `${MEET}/abc-defg-hij?hl=en`;
const MOCK = 'http://127.0.0.1:5555';

/** A neutral snapshot (nothing recognizable) with optional overrides. */
function snap(overrides = {}) {
  return {
    url: MEET_URL,
    text: 'Some neutral page text',
    nameInputVisible: false,
    ctaTexts: [],
    leaveButton: false,
    captionsOn: null,
    captionRegion: false,
    participantTiles: 0,
    selfName: false,
    participantCount: null,
    bodyEmpty: false,
    ...overrides,
  };
}

/** Snapshot that looks fully in-call (used to prove earlier rules win). */
function inCall(overrides = {}) {
  return snap({ leaveButton: true, captionsOn: false, participantTiles: 2, selfName: true, participantCount: 2, ...overrides });
}

const opts = { meetingOrigin: MEET };

describe('STATES', () => {
  test('exposes every state name', () => {
    assert.deepEqual(Object.keys(STATES).sort(), [
      'BLANK', 'BLOCKED', 'DENIED', 'ENDED', 'IN_CALL', 'LOBBY', 'LOBBY_TIMEOUT',
      'NOT_FOUND', 'PREJOIN', 'RECONNECTING', 'SIGNIN_REQUIRED', 'UNKNOWN',
    ]);
    for (const [k, v] of Object.entries(STATES)) assert.equal(k, v);
  });
});

describe('classify: result shape', () => {
  test('returns exactly { state, matched }', () => {
    const r = classify(snap(), opts);
    assert.deepEqual(Object.keys(r).sort(), ['matched', 'state']);
  });

  test('meetingOrigin options object is optional', () => {
    assert.equal(classify(snap()).state, 'UNKNOWN');
  });

  test('null / empty snapshots do not throw', () => {
    assert.equal(classify(null).state, 'BLANK');
    assert.equal(classify(undefined).state, 'BLANK');
    assert.equal(classify({}).state, 'BLANK');
    assert.equal(classify({ text: 'Hello there world' }).state, 'UNKNOWN');
  });
});

describe('1. SIGNIN_REQUIRED', () => {
  test('accounts.google.com host wins over everything', () => {
    const r = classify(inCall({ url: 'https://accounts.google.com/v3/signin/identifier?continue=x', text: 'Meeting ended' }), opts);
    assert.deepEqual(r, { state: 'SIGNIN_REQUIRED', matched: 'accounts.google.com' });
  });

  test('accounts.google.com with any path', () => {
    assert.equal(classify(snap({ url: 'https://accounts.google.com/' }), opts).state, 'SIGNIN_REQUIRED');
    assert.equal(classify(snap({ url: 'https://accounts.google.com/' })).state, 'SIGNIN_REQUIRED');
  });

  const signinPaths = [
    ['/v3/signin/identifier', '/v3/signin'],
    ['/signin', '/signin'],
    ['/signin/v2/challenge', '/signin'],
    ['/ServiceLogin?service=x', '/ServiceLogin'],
  ];
  for (const [p, prefix] of signinPaths) {
    test(`signin path ${p} on any host (mock server)`, () => {
      const r = classify(snap({ url: `${MOCK}${p}` }), { meetingOrigin: MOCK });
      assert.deepEqual(r, { state: 'SIGNIN_REQUIRED', matched: prefix });
      // also when the signin page is on a foreign origin (must not be reported as BLOCKED)
      assert.equal(classify(snap({ url: `https://example.com${p}` }), { meetingOrigin: MOCK }).state, 'SIGNIN_REQUIRED');
      assert.equal(classify(snap({ url: `https://example.com${p}` })).state, 'SIGNIN_REQUIRED');
    });
  }

  test('a meeting path that merely contains "signin" later is not a signin page', () => {
    assert.equal(classify(snap({ url: `${MEET}/abc-defg-hij/signin` }), opts).state, 'UNKNOWN');
  });
});

describe('2. BLOCKED by redirect', () => {
  test('workspace.google.com (marketing redirect) with or without meetingOrigin', () => {
    const url = 'https://workspace.google.com/products/meet/';
    assert.deepEqual(classify(inCall({ url }), opts), { state: 'BLOCKED', matched: 'workspace.google.com' });
    assert.equal(classify(snap({ url })).state, 'BLOCKED');
  });

  test('URL origin differs from meetingOrigin', () => {
    const r = classify(inCall({ url: 'https://www.google.com/search?q=x' }), opts);
    assert.equal(r.state, 'BLOCKED');
    assert.match(r.matched, /www\.google\.com/);
  });

  test('mock origin vs real Meet origin mismatch', () => {
    assert.equal(classify(inCall({ url: MEET_URL }), { meetingOrigin: MOCK }).state, 'BLOCKED');
    assert.equal(classify(inCall({ url: `${MOCK}/abc-defg-hij?scenario=happy` }), opts).state, 'BLOCKED');
  });

  test('same origin (any path/query) is not blocked', () => {
    assert.equal(classify(inCall({ url: `${MOCK}/abc-defg-hij?scenario=happy&hl=en` }), { meetingOrigin: MOCK }).state, 'IN_CALL');
    assert.equal(classify(inCall({ url: `${MEET}/abc-defg-hij?authuser=0&hl=en` }), opts).state, 'IN_CALL');
  });

  test('meetingOrigin may be given as a full URL', () => {
    const o = { meetingOrigin: 'https://meet.google.com/abc-defg-hij?hl=en' };
    assert.equal(classify(inCall(), o).state, 'IN_CALL');
    assert.equal(classify(inCall({ url: 'https://example.com/x' }), o).state, 'BLOCKED');
  });

  test('an unparseable meetingOrigin is ignored', () => {
    assert.equal(classify(inCall({ url: 'https://example.com/x' }), { meetingOrigin: 'not a url' }).state, 'IN_CALL');
  });

  test('meet.google.com landing page without a code', () => {
    for (const url of [`${MEET}/`, `${MEET}/?pli=1&authuser=0`, `${MEET}/landing?hl=en`, `${MEET}/landing/`]) {
      assert.equal(classify(snap({ url, text: 'Video calls and meetings for everyone' }), opts).state, 'BLOCKED', url);
      assert.equal(classify(snap({ url, text: 'Video calls and meetings for everyone' })).state, 'BLOCKED', url);
    }
  });

  test('landing page of the mock meeting origin', () => {
    assert.equal(classify(snap({ url: `${MOCK}/` }), { meetingOrigin: MOCK }).state, 'BLOCKED');
  });

  test('a code path or lookup path on meet.google.com is not a landing page', () => {
    assert.equal(classify(snap({ url: `${MEET}/lookup/teamsync` }), opts).state, 'UNKNOWN');
    assert.equal(classify(snap({ url: `${MEET}/abc-defg-hij` })).state, 'UNKNOWN');
  });

  test('no meetingOrigin and an arbitrary host: no redirect verdict', () => {
    assert.equal(classify(inCall({ url: 'http://localhost:9999/abc-defg-hij' })).state, 'IN_CALL');
  });

  test('about:blank / non-http URLs are not treated as a redirect', () => {
    assert.equal(classify(snap({ url: 'about:blank', text: '', bodyEmpty: true }), opts).state, 'BLANK');
    assert.equal(classify(snap({ url: 'about:blank', text: '', bodyEmpty: true }), { meetingOrigin: MOCK }).state, 'BLANK');
  });

  test('missing or invalid snapshot url falls through to the content rules', () => {
    assert.equal(classify(inCall({ url: undefined }), opts).state, 'IN_CALL');
    assert.equal(classify(inCall({ url: '::not-a-url::' }), opts).state, 'IN_CALL');
  });
});

/** Each text list → its state; every single entry must classify on its own. */
const TEXT_RULES = [
  ['notFound', 'NOT_FOUND'],
  ['denied', 'DENIED'],
  ['lobbyTimeout', 'LOBBY_TIMEOUT'],
  ['deniedFallback', 'DENIED'],
  ['blocked', 'BLOCKED'],
  ['ended', 'ENDED'],
  ['reconnecting', 'RECONNECTING'],
  ['lobby', 'LOBBY'],
];

describe('3–9. text rules: every entry classifies', () => {
  for (const [key, state] of TEXT_RULES) {
    for (const entry of TEXT[key]) {
      test(`${state} ← "${entry}"`, () => {
        const r = classify(snap({ text: `Header stuff ${entry} footer stuff` }), opts);
        assert.deepEqual(r, { state, matched: entry });
      });
    }
  }
});

describe('3–9. text rules: decision order', () => {
  const cases = [
    ['NOT_FOUND beats DENIED', 'Check your meeting code. You were denied', 'NOT_FOUND'],
    ['DENIED beats LOBBY_TIMEOUT', 'You were denied. No one responded to your request to join', 'DENIED'],
    ['LOBBY_TIMEOUT beats BLOCKED', "No one responded to your request to join. You can't join this meeting", 'LOBBY_TIMEOUT'],
    ['BLOCKED beats ENDED', "You can't join this video call. Call ended", 'BLOCKED'],
    ['ENDED beats RECONNECTING', 'Call ended. Reconnecting', 'ENDED'],
    ['RECONNECTING beats LOBBY', 'Trying to reconnect. Asking to be let in', 'RECONNECTING'],
  ];
  for (const [name, text, state] of cases) {
    test(name, () => assert.equal(classify(snap({ text }), opts).state, state));
  }

  test('text rules beat PREJOIN and IN_CALL signals', () => {
    assert.equal(classify(inCall({ text: 'Meeting ended', ctaTexts: ['Join now'], nameInputVisible: true }), opts).state, 'ENDED');
  });
});

describe('4. DENIED', () => {
  test('"Ask to join again" + denied text', () => {
    const r = classify(snap({ text: 'Someone in the call denied your request to join Ask to join again Return to home screen' }), opts);
    assert.deepEqual(r, { state: 'DENIED', matched: 'denied your request to join' });
  });

  test('"Ask to join again" alone is DENIED, never PREJOIN', () => {
    const r = classify(snap({ text: 'Ask to join again', ctaTexts: [] }), opts);
    assert.deepEqual(r, { state: 'DENIED', matched: 'Ask to join again' });
    // even if a (buggy) snapshot reported a CTA, denied text wins (rule 4 < rule 10)
    assert.equal(classify(snap({ text: 'Ask to join again', ctaTexts: ['Ask to join'] }), opts).state, 'DENIED');
  });

  test('curly apostrophe variant', () => {
    assert.equal(classify(snap({ text: 'You weren’t allowed to join this call' }), opts).state, 'DENIED');
  });

  test('a "no one responded" screen offering "Ask to join again" is LOBBY_TIMEOUT, not DENIED', () => {
    const r = classify(snap({ text: 'No one responded to your request to join Ask to join again Return to home screen' }), opts);
    assert.deepEqual(r, { state: 'LOBBY_TIMEOUT', matched: 'No one responded to your request to join' });
  });
});

describe('7. ENDED', () => {
  test('curly "You’ve been removed from the meeting"', () => {
    const r = classify(inCall({ text: 'You’ve been removed from the meeting\nReturn to home screen' }), opts);
    assert.deepEqual(r, { state: 'ENDED', matched: "You've been removed from the meeting" });
  });

  test('everyone left / host ended / you left', () => {
    assert.equal(classify(snap({ text: 'The call ended because everyone left' }), opts).state, 'ENDED');
    assert.equal(classify(snap({ text: 'Your host ended the meeting for everyone' }), opts).state, 'ENDED');
    assert.equal(classify(snap({ text: 'You left the meeting Rejoin Return to home screen' }), opts).state, 'ENDED');
  });

  test('other end-screen wordings', () => {
    for (const text of [
      'The call has ended Rejoin Return to home screen',
      'Your meeting has ended Rejoin Return to home screen',
      'The host ended the meeting for everyone Return to home screen',
      'You’ve left the meeting Rejoin Return to home screen',
    ]) {
      assert.equal(classify(snap({ text }), opts).state, 'ENDED', text);
    }
  });
});

describe('classifyInCall (bot already in the call)', () => {
  test('ENDED/DENIED/NOT_FOUND text next to the in-call toolbar (chat toast) stays IN_CALL', () => {
    for (const text of ['Alice: Meeting ended?', 'Bob: Call ended lol', 'Carol: Check your meeting code', 'Dan: You were denied']) {
      const r = classifyInCall(inCall({ text }), opts);
      assert.equal(r.state, 'IN_CALL', text);
      assert.ok(r.ignoredText, 'reports the ignored matcher');
      assert.equal(classify(inCall({ text }), opts).state === 'IN_CALL', false, 'plain classify still decides by text');
    }
  });

  test('a real end screen (no leave button) is still ENDED', () => {
    const r = classifyInCall(snap({ text: 'You left the meeting Rejoin Return to home screen' }), opts);
    assert.deepEqual(r, { state: 'ENDED', matched: 'You left the meeting' });
  });

  test('leave button without any in-call signal does not override', () => {
    assert.equal(classifyInCall(snap({ text: 'Meeting ended', leaveButton: true }), opts).state, 'ENDED');
  });

  test('RECONNECTING, LOBBY and URL-decided verdicts are never overridden', () => {
    assert.equal(classifyInCall(inCall({ text: 'Trying to reconnect' }), opts).state, 'RECONNECTING');
    assert.equal(classifyInCall(inCall({ text: 'Asking to be let in' }), opts).state, 'LOBBY');
    assert.equal(classifyInCall(inCall({ url: 'https://accounts.google.com/v3/signin' }), opts).state, 'SIGNIN_REQUIRED');
    assert.equal(classifyInCall(inCall({ url: 'https://workspace.google.com/products/meet/' }), opts).state, 'BLOCKED');
  });

  test('without overrides it returns exactly what classify returns', () => {
    for (const s of [inCall(), snap(), snap({ bodyEmpty: true, text: '' }), snap({ ctaTexts: ['Join now'] })]) {
      assert.deepEqual(classifyInCall(s, opts), classify(s, opts));
    }
  });
});

describe('inCallSignal', () => {
  test('names the first structural in-call signal, or null', () => {
    assert.equal(inCallSignal(snap({ captionsOn: false })), 'captionsButton');
    assert.equal(inCallSignal(snap({ participantTiles: 2 })), 'participantTiles');
    assert.equal(inCallSignal(snap({ selfName: true })), 'selfName');
    assert.equal(inCallSignal(snap({ captionRegion: true })), 'captionRegion');
    assert.equal(inCallSignal(snap()), null);
    assert.equal(inCallSignal(null), null);
  });
});

describe('8. RECONNECTING', () => {
  test('while still showing in-call controls', () => {
    const r = classify(inCall({ text: 'Trying to reconnect…' }), opts);
    assert.deepEqual(r, { state: 'RECONNECTING', matched: 'Trying to reconnect' });
  });
});

describe('9. LOBBY', () => {
  test('lobby text + leave button present => LOBBY (not IN_CALL)', () => {
    const r = classify(snap({ text: 'Asking to be let in… You’ll join the call when someone lets you in', leaveButton: true }), opts);
    assert.deepEqual(r, { state: 'LOBBY', matched: 'Asking to be let in' });
  });

  test('lobby text + leave + self preview signals => still LOBBY', () => {
    assert.equal(classify(inCall({ text: 'Please wait until a meeting host brings you into the call' }), opts).state, 'LOBBY');
  });

  test('curly "You’ll join the call when someone lets you in"', () => {
    const r = classify(snap({ text: 'You’ll join the call when someone lets you in', leaveButton: true }), opts);
    assert.deepEqual(r, { state: 'LOBBY', matched: "You'll join the call when someone lets you in" });
  });

  test('extra whitespace / newlines inside the phrase', () => {
    assert.equal(classify(snap({ text: 'Asking  to\nbe let in' }), opts).state, 'LOBBY');
  });

  test('lobby text beats a visible CTA', () => {
    assert.equal(classify(snap({ text: 'Asking to be let in', ctaTexts: ['Ask to join'] }), opts).state, 'LOBBY');
  });
});

describe('10. PREJOIN', () => {
  test('a CTA is visible', () => {
    const r = classify(snap({ text: 'Ready to join? Ask to join Other ways to join', ctaTexts: ['Ask to join'] }), opts);
    assert.deepEqual(r, { state: 'PREJOIN', matched: 'Ask to join' });
  });

  test('only the name input is visible', () => {
    const r = classify(snap({ text: "What's your name?", nameInputVisible: true }), opts);
    assert.deepEqual(r, { state: 'PREJOIN', matched: 'nameInput' });
  });

  test('PREJOIN beats IN_CALL signals (e.g. "Join here too" while already in call elsewhere)', () => {
    assert.equal(classify(inCall({ ctaTexts: ['Join here too'] }), opts).state, 'PREJOIN');
  });

  test('PREJOIN beats BLANK', () => {
    assert.equal(classify(snap({ text: '', bodyEmpty: true, ctaTexts: ['Join now'] }), opts).state, 'PREJOIN');
  });
});

describe('11. IN_CALL', () => {
  test('captionsOn=false + leaveButton', () => {
    const r = classify(snap({ captionsOn: false, leaveButton: true }), opts);
    assert.equal(r.state, 'IN_CALL');
    assert.match(r.matched, /leaveButton/);
  });

  test('captionsOn=true + leaveButton', () => {
    assert.equal(classify(snap({ captionsOn: true, leaveButton: true }), opts).state, 'IN_CALL');
  });

  test('participant tiles + leaveButton', () => {
    assert.equal(classify(snap({ participantTiles: 1, leaveButton: true }), opts).state, 'IN_CALL');
  });

  test('selfName + leaveButton', () => {
    assert.equal(classify(snap({ selfName: true, leaveButton: true }), opts).state, 'IN_CALL');
  });

  test('captionRegion + leaveButton', () => {
    assert.equal(classify(snap({ captionRegion: true, leaveButton: true }), opts).state, 'IN_CALL');
  });

  test('on the mock origin', () => {
    assert.equal(classify(inCall({ url: `${MOCK}/abc-defg-hij?scenario=happy` }), { meetingOrigin: MOCK }).state, 'IN_CALL');
  });

  test('leaveButton alone is NOT enough', () => {
    assert.equal(classify(snap({ leaveButton: true }), opts).state, 'UNKNOWN');
    // missing captionsOn (undefined) must behave like null
    const s = snap({ leaveButton: true });
    delete s.captionsOn;
    assert.equal(classify(s, opts).state, 'UNKNOWN');
  });

  test('in-call signals without a leave button are not IN_CALL', () => {
    assert.equal(classify(snap({ captionsOn: false, participantTiles: 3, selfName: true, captionRegion: true }), opts).state, 'UNKNOWN');
  });

  test('participantTiles 0 / captionsOn null do not count', () => {
    assert.equal(classify(snap({ participantTiles: 0, captionsOn: null, leaveButton: true }), opts).state, 'UNKNOWN');
  });

  test('participantCount alone does not make it IN_CALL', () => {
    assert.equal(classify(snap({ participantCount: 3, leaveButton: true }), opts).state, 'UNKNOWN');
  });
});

describe('12. BLANK', () => {
  test('bodyEmpty', () => {
    assert.deepEqual(classify(snap({ text: '', bodyEmpty: true }), opts), { state: 'BLANK', matched: 'bodyEmpty' });
  });

  test('IN_CALL beats BLANK', () => {
    assert.equal(classify(inCall({ text: '', bodyEmpty: true }), opts).state, 'IN_CALL');
  });

  test('bodyEmpty=false with empty text is UNKNOWN (snapshot field is authoritative)', () => {
    assert.equal(classify(snap({ text: '', bodyEmpty: false }), opts).state, 'UNKNOWN');
  });
});

describe('13. UNKNOWN', () => {
  test('nothing recognizable', () => {
    assert.deepEqual(classify(snap({ text: 'Getting ready…' }), opts), { state: 'UNKNOWN', matched: null });
  });

  test('lower-case look-alikes do not match (matchers are case-sensitive)', () => {
    assert.equal(classify(snap({ text: 'we discussed why the meeting ended early' }), opts).state, 'UNKNOWN');
  });
});

describe('curly apostrophe variants across rules', () => {
  const cases = [
    ['The meeting code you entered doesn’t work', 'NOT_FOUND'],
    ['You can’t join this video call', 'BLOCKED'],
    ['You’ve been removed from the meeting', 'ENDED'],
    ['You’ll join the call when someone lets you in', 'LOBBY'],
    ['You‘ll join the call when someone lets you in', 'LOBBY'],
  ];
  for (const [text, state] of cases) {
    test(`${state} ← ${text}`, () => assert.equal(classify(snap({ text }), opts).state, state));
  }
});
