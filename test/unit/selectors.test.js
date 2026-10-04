import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SEL, TEXT, normalizeText, matchAny, serializableSel } from '../../src/meet/selectors.js';

// The contract from spec 5.5, copied so any drift is caught here. Deliberate deviations (see
// src/meet/selectors.js): 'Switch here' is NOT a join CTA (it would kick the account's other
// device out of the call), 'Ask to join again' is a weak denial marker checked after the
// lobby-timeout texts, extra end-screen wordings, and the new alone / switchHere lists.
const SPEC_TEXT = {
  joinCtas: ['Join now', 'Ask to join', 'Join here too', 'Join anyway', 'Ask to join anyway', 'Join the call now'],
  continueWithoutDevices: ['Continue without microphone and camera', 'Continue without microphone', 'Continue without camera'],
  lobby: ['Asking to be let in', "You'll join the call when someone lets you in", 'Please wait until a meeting host brings you into the call', 'Waiting for the host to join', 'Waiting for the host to let you in'],
  denied: ['denied your request to join', 'request to join was denied', 'You were denied', "weren't allowed to join", 'not allowed to join'],
  deniedFallback: ['Ask to join again'],
  lobbyTimeout: ['No one responded to your request to join', 'No one has responded to your request to join'],
  blocked: ["You can't join this video call", "You can't join this meeting", 'There is a problem connecting to this video call'],
  notFound: ['Check your meeting code', 'Invalid video call name', 'Your meeting code has expired', "The meeting code you entered doesn't work", 'Meeting not found'],
  ended: ["You've been removed from the meeting", 'The call ended because everyone left', 'Your host ended the meeting for everyone', 'Meeting ended', 'Call ended', 'You left the meeting',
    "You've left the meeting", 'ended the meeting for everyone', 'call has ended', 'meeting has ended'],
  reconnecting: ['Trying to reconnect', 'You lost your network connection', 'Reconnecting'],
  dismiss: ['Got it', 'Dismiss', 'Stay in the call'],
  alone: ["You're the only one here", 'No one else is here'],
  switchHere: ['Switch here'],
};

const SPEC_SEL_SERIALIZABLE = {
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
  closeDialog: ['button[aria-label="Close dialog"]', 'button[aria-label="Close dialogue"]'],
  captionRegion: ['[role="region"][aria-label="Captions"]', 'div[role="region"][tabindex="0"]', '.vNKgIf'],
  captionBlock: '.nMcdL',
  captionSpeaker: '.NWpY1d',
  captionText: '.ygicle',
};

/** @param {unknown} v */
function containsFunction(v) {
  if (typeof v === 'function') return true;
  if (v && typeof v === 'object') return Object.values(v).some(containsFunction);
  return false;
}

describe('TEXT', () => {
  test('matches the spec contract exactly', () => {
    assert.deepEqual(TEXT, SPEC_TEXT);
  });

  test('"Switch here" is never a join CTA, and "Join here too" is', () => {
    assert.ok(!TEXT.joinCtas.includes('Switch here'));
    assert.ok(TEXT.joinCtas.includes('Join here too'));
  });

  test('every entry is already in normalized form', () => {
    for (const [key, list] of Object.entries(TEXT)) {
      for (const entry of list) {
        assert.equal(normalizeText(entry), entry, `TEXT.${key}: ${entry}`);
      }
    }
  });
});

describe('SEL', () => {
  test('matches the spec contract (serializable part)', () => {
    const { captionLangItem, ...rest } = SEL;
    assert.deepEqual(rest, SPEC_SEL_SERIALIZABLE);
  });

  test('captionLangItem builds the language list item selector', () => {
    assert.equal(typeof SEL.captionLangItem, 'function');
    assert.equal(SEL.captionLangItem('cmn-Hant-TW'), 'li[data-value="cmn-Hant-TW"]');
    assert.equal(SEL.captionLangItem('en-US'), 'li[data-value="en-US"]');
  });

  test('selector lists are non-empty arrays of non-empty strings', () => {
    for (const [key, value] of Object.entries(SEL)) {
      if (typeof value === 'function') continue;
      const list = Array.isArray(value) ? value : [value];
      assert.ok(list.length > 0, key);
      for (const s of list) assert.ok(typeof s === 'string' && s.length > 0, `${key}: ${s}`);
    }
  });
});

describe('normalizeText', () => {
  test('replaces curly apostrophes with a straight one', () => {
    assert.equal(normalizeText('You’ll join'), "You'll join");
    assert.equal(normalizeText('‘quoted’'), "'quoted'");
    assert.equal(normalizeText("You've already straight"), "You've already straight");
  });

  test('collapses all whitespace runs (incl. newlines, tabs, nbsp) and trims', () => {
    assert.equal(normalizeText('  Asking  to\nbe\t\tlet in  '), 'Asking to be let in');
    assert.equal(normalizeText('\n\n'), '');
  });

  test('null, undefined and non-strings are handled', () => {
    assert.equal(normalizeText(null), '');
    assert.equal(normalizeText(undefined), '');
    assert.equal(normalizeText(''), '');
    assert.equal(normalizeText(42), '42');
  });

  test('keeps CJK text intact', () => {
    assert.equal(normalizeText(' 大家好，\n今天 討論 '), '大家好， 今天 討論');
  });
});

describe('matchAny', () => {
  test('returns the matched entry (substring match)', () => {
    assert.equal(matchAny('Someone in the call denied your request to join', TEXT.denied), 'denied your request to join');
    assert.equal(matchAny('Asking to be let in…', TEXT.lobby), 'Asking to be let in');
  });

  test('returns null when nothing matches', () => {
    assert.equal(matchAny('Ready to join?', TEXT.lobby), null);
    assert.equal(matchAny('', TEXT.lobby), null);
    assert.equal(matchAny(null, TEXT.lobby), null);
    assert.equal(matchAny(undefined, TEXT.lobby), null);
  });

  test('normalizes the text (curly apostrophes, whitespace) before matching', () => {
    assert.equal(
      matchAny('You’ll join the call\n when  someone lets you in', TEXT.lobby),
      "You'll join the call when someone lets you in",
    );
    assert.equal(matchAny('You’ve been removed from the meeting', TEXT.ended), "You've been removed from the meeting");
  });

  test('normalizes the entries too', () => {
    assert.equal(matchAny("You'll see", ['You’ll  see']), 'You’ll  see');
  });

  test('first matching entry in list order wins', () => {
    assert.equal(matchAny('Call ended. Meeting ended.', TEXT.ended), 'Meeting ended');
  });

  test('is case-sensitive', () => {
    assert.equal(matchAny('meeting ended', ['Meeting ended']), null);
  });

  test('empty / missing lists and empty entries never match', () => {
    assert.equal(matchAny('anything', []), null);
    assert.equal(matchAny('anything', null), null);
    assert.equal(matchAny('anything', undefined), null);
    assert.equal(matchAny('anything', ['', '   ']), null);
  });
});

describe('serializableSel', () => {
  test('drops function-valued entries and keeps everything else', () => {
    const copy = serializableSel();
    assert.equal('captionLangItem' in copy, false);
    assert.equal(containsFunction(copy), false);
    assert.deepEqual(copy, SPEC_SEL_SERIALIZABLE);
  });

  test('is a deep copy (mutations do not leak into SEL)', () => {
    const copy = serializableSel();
    copy.leave.push('button.mutated');
    copy.participantTile = 'x';
    assert.deepEqual(SEL.leave, SPEC_SEL_SERIALIZABLE.leave);
    assert.equal(SEL.participantTile, '[data-participant-id]');
    assert.notEqual(serializableSel(), serializableSel());
  });

  test('survives a JSON round trip unchanged (safe for page.evaluate)', () => {
    const copy = serializableSel();
    assert.deepEqual(JSON.parse(JSON.stringify(copy)), copy);
  });

  test('accepts a custom object and strips nested functions', () => {
    const custom = { a: ['x'], f: () => 1, nested: { g() {}, b: 'y', list: ['z'] } };
    assert.deepEqual(serializableSel(custom), { a: ['x'], nested: { b: 'y', list: ['z'] } });
  });
});
