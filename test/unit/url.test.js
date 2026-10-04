import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMeetUrl } from '../../src/url.js';

const MEET = 'https://meet.google.com/abc-defg-hij?hl=en';

/** @param {unknown} input @param {object} [opts] */
function throwsNotMeet(input, opts) {
  assert.throws(
    () => parseMeetUrl(/** @type {any} */ (input), opts),
    (err) => err instanceof Error && err.message === 'not_a_meet_url',
    `expected not_a_meet_url for ${JSON.stringify(input)}`,
  );
}

test('full https URL', () => {
  assert.deepEqual(parseMeetUrl('https://meet.google.com/abc-defg-hij'), {
    code: 'abc-defg-hij',
    url: MEET,
  });
});

test('without scheme', () => {
  assert.deepEqual(parseMeetUrl('meet.google.com/abc-defg-hij'), { code: 'abc-defg-hij', url: MEET });
});

test('http scheme is upgraded to https', () => {
  assert.deepEqual(parseMeetUrl('http://meet.google.com/abc-defg-hij'), { code: 'abc-defg-hij', url: MEET });
});

test('trailing slash(es)', () => {
  assert.deepEqual(parseMeetUrl('https://meet.google.com/abc-defg-hij/'), { code: 'abc-defg-hij', url: MEET });
  assert.deepEqual(parseMeetUrl('meet.google.com/abc-defg-hij//'), { code: 'abc-defg-hij', url: MEET });
});

test('extra query and hash are dropped', () => {
  assert.deepEqual(parseMeetUrl('https://meet.google.com/abc-defg-hij?pli=1&ijlm=123#frag'), {
    code: 'abc-defg-hij',
    url: MEET,
  });
  assert.deepEqual(parseMeetUrl('https://meet.google.com/abc-defg-hij#x'), { code: 'abc-defg-hij', url: MEET });
});

test('authuser is kept, pli dropped, hl=en appended', () => {
  assert.deepEqual(parseMeetUrl('meet.google.com/abc-defg-hij?authuser=1&pli=1'), {
    code: 'abc-defg-hij',
    url: 'https://meet.google.com/abc-defg-hij?authuser=1&hl=en',
  });
});

test('existing hl is replaced by hl=en', () => {
  assert.deepEqual(parseMeetUrl('https://meet.google.com/abc-defg-hij?hl=zh-TW'), {
    code: 'abc-defg-hij',
    url: MEET,
  });
});

test('bare code, including uppercase', () => {
  assert.deepEqual(parseMeetUrl('abc-defg-hij'), { code: 'abc-defg-hij', url: MEET });
  assert.deepEqual(parseMeetUrl('ABC-DEFG-HIJ'), { code: 'abc-defg-hij', url: MEET });
});

test('uppercase full URL is lowercased', () => {
  assert.deepEqual(parseMeetUrl('HTTPS://MEET.GOOGLE.COM/ABC-DEFG-HIJ'), { code: 'abc-defg-hij', url: MEET });
  assert.deepEqual(parseMeetUrl('Meet.Google.com/Abc-Defg-Hij?AuthUser=2'), {
    code: 'abc-defg-hij',
    // query param names are case-sensitive: "AuthUser" is not "authuser" -> dropped
    url: MEET,
  });
});

test('surrounding whitespace is ignored', () => {
  assert.deepEqual(parseMeetUrl('  https://meet.google.com/abc-defg-hij \n'), { code: 'abc-defg-hij', url: MEET });
  assert.deepEqual(parseMeetUrl('\tabc-defg-hij  '), { code: 'abc-defg-hij', url: MEET });
});

test('link embedded in surrounding text (pasted invite) is extracted', () => {
  assert.deepEqual(parseMeetUrl('請加入 https://meet.google.com/abc-defg-hij 謝謝'), {
    code: 'abc-defg-hij',
    url: MEET,
  });
  assert.deepEqual(parseMeetUrl('Join with Google Meet\nmeet.google.com/abc-defg-hij'), {
    code: 'abc-defg-hij',
    url: MEET,
  });
  assert.deepEqual(parseMeetUrl('code: abc-defg-hij'), { code: 'abc-defg-hij', url: MEET });
});

test('wrapping brackets/quotes and trailing punctuation are stripped', () => {
  assert.deepEqual(parseMeetUrl('<https://meet.google.com/abc-defg-hij>'), { code: 'abc-defg-hij', url: MEET });
  assert.deepEqual(parseMeetUrl('"https://meet.google.com/abc-defg-hij"'), { code: 'abc-defg-hij', url: MEET });
  assert.deepEqual(parseMeetUrl('(meet.google.com/abc-defg-hij).'), { code: 'abc-defg-hij', url: MEET });
});

test('lookup paths', () => {
  assert.deepEqual(parseMeetUrl('https://meet.google.com/lookup/AbCdEf1234'), {
    code: 'abcdef1234',
    url: 'https://meet.google.com/lookup/abcdef1234?hl=en',
  });
  assert.deepEqual(parseMeetUrl('meet.google.com/lookup/abcdef1234/?authuser=0&pli=1'), {
    code: 'abcdef1234',
    url: 'https://meet.google.com/lookup/abcdef1234?authuser=0&hl=en',
  });
});

test('non-standard code path: code is the sanitized last segment', () => {
  assert.deepEqual(parseMeetUrl('https://meet.google.com/abcdefghij'), {
    code: 'abcdefghij',
    url: 'https://meet.google.com/abcdefghij?hl=en',
  });
  assert.deepEqual(parseMeetUrl('https://meet.google.com/My_Room.1'), {
    code: 'myroom1',
    url: 'https://meet.google.com/my_room1?hl=en',
  });
});

test('g.co/meet short links are normalized to meet.google.com', () => {
  assert.deepEqual(parseMeetUrl('https://g.co/meet/abc-defg-hij'), { code: 'abc-defg-hij', url: MEET });
  assert.deepEqual(parseMeetUrl('g.co/meet/ABC-DEFG-HIJ/'), { code: 'abc-defg-hij', url: MEET });
});

test('meet host without a meeting path throws', () => {
  throwsNotMeet('https://meet.google.com');
  throwsNotMeet('https://meet.google.com/');
  throwsNotMeet('meet.google.com/?authuser=1');
  throwsNotMeet('https://meet.google.com/lookup');
  throwsNotMeet('https://meet.google.com/lookup/');
  throwsNotMeet('https://meet.google.com/new');
  throwsNotMeet('https://meet.google.com/landing');
  throwsNotMeet('https://meet.google.com/%%%/');
  throwsNotMeet('https://g.co/meet/');
});

test('non-meet hosts throw not_a_meet_url', () => {
  throwsNotMeet('https://zoom.us/j/123456789');
  throwsNotMeet('https://evil.com/abc-defg-hij');
  throwsNotMeet('https://meet.google.com.evil.com/abc-defg-hij');
  throwsNotMeet('https://notmeet.google.com/abc-defg-hij');
  throwsNotMeet('https://google.com/abc-defg-hij');
  throwsNotMeet('https://g.co/abc-defg-hij');
  throwsNotMeet('http://127.0.0.1:5555/abc-defg-hij');
  throwsNotMeet('ftp://meet.google.com/abc-defg-hij');
  throwsNotMeet('teams.microsoft.com/l/meetup-join/xyz');
});

test('empty and garbage input throws not_a_meet_url', () => {
  throwsNotMeet('');
  throwsNotMeet('   ');
  throwsNotMeet(null);
  throwsNotMeet(undefined);
  throwsNotMeet(123);
  throwsNotMeet({});
  throwsNotMeet('hello world');
  throwsNotMeet('abc');
  throwsNotMeet('abc-defg-hi');
  throwsNotMeet('abc-defg-hijk');
  throwsNotMeet('javascript:alert(1)');
  throwsNotMeet('mailto:someone@example.com');
  throwsNotMeet('https://');
  throwsNotMeet('://meet');
});

test('allowAnyHost keeps host/scheme/port and appends hl=en', () => {
  assert.deepEqual(parseMeetUrl('http://127.0.0.1:5555/abc-defg-hij', { allowAnyHost: true }), {
    code: 'abc-defg-hij',
    url: 'http://127.0.0.1:5555/abc-defg-hij?hl=en',
  });
  assert.deepEqual(parseMeetUrl('  http://localhost:8080/abc-defg-hij/  ', { allowAnyHost: true }), {
    code: 'abc-defg-hij',
    url: 'http://localhost:8080/abc-defg-hij?hl=en',
  });
});

test('allowAnyHost keeps the mock server query (e.g. scenario) and drops the hash', () => {
  assert.deepEqual(
    parseMeetUrl('http://127.0.0.1:5555/abc-defg-hij?scenario=happy&hl=de#x', { allowAnyHost: true }),
    { code: 'abc-defg-hij', url: 'http://127.0.0.1:5555/abc-defg-hij?scenario=happy&hl=en' },
  );
});

test('allowAnyHost still normalizes real meet URLs the meet way', () => {
  assert.deepEqual(parseMeetUrl('meet.google.com/abc-defg-hij?authuser=1&pli=1', { allowAnyHost: true }), {
    code: 'abc-defg-hij',
    url: 'https://meet.google.com/abc-defg-hij?authuser=1&hl=en',
  });
  assert.deepEqual(parseMeetUrl('abc-defg-hij', { allowAnyHost: true }), { code: 'abc-defg-hij', url: MEET });
});

test('allowAnyHost still rejects garbage and host-only URLs', () => {
  throwsNotMeet('', { allowAnyHost: true });
  throwsNotMeet('hello world', { allowAnyHost: true });
  throwsNotMeet('abc', { allowAnyHost: true });
  throwsNotMeet('http://127.0.0.1:5555/', { allowAnyHost: true });
  throwsNotMeet('file:///C:/x/abc-defg-hij', { allowAnyHost: true });
  throwsNotMeet('javascript:alert(1)', { allowAnyHost: true });
});
