import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMeetingIntent } from '../../src/meeting-intent.js';

test('meeting prototype routes Meet to the silent browser adapter', () => {
  const intent = parseMeetingIntent('/meeting https://meet.google.com/abc-defg-hij');
  assert.equal(intent.platform, 'meet');
  assert.equal(intent.mode, 'silent-notetaker');
  assert.equal(intent.hasAutonomousJoinAdapter, true);
});

test('Teams join parameters survive routing, without claiming unattended admission', () => {
  const link = 'https://teams.live.com/meet/123456789?p=example';
  const intent = parseMeetingIntent('/meeting ' + link);
  assert.equal(intent.url, link);
  assert.equal(intent.platform, 'teams');
  assert.equal(intent.hasAutonomousJoinAdapter, false);
  assert.equal(parseMeetingIntent('/meeting https://teams.microsoft.com/l/meetup-join/example?context=demo').platform, 'teams');
});

test('invalid or ambiguous input cannot silently launch a different meeting', () => {
  for (const input of [null, '', '/meeting', '/meeting https://meet.google.com/abc-defg-hij https://meet.google.com/def-ghij-klm',
    '/meeting http://meet.google.com/abc-defg-hij', '/meeting https://meet.google.com.evil.test/abc-defg-hij',
    '/meeting https://user:password@meet.google.com/abc-defg-hij', '/meeting https://meet.google.com:8443/abc-defg-hij',
    '/meeting https://meet.google.com/new', '/meeting https://teams.live.com/not-a-meeting',
    '/meeting https://example.com/abc-defg-hij', '/meeting https://meet.google.com\\@example.com/abc-defg-hij',
    '/meeting https://meet.google.com/abc-defg-hij ; whoami']) {
    assert.throws(() => parseMeetingIntent(input), String(input));
  }
});
