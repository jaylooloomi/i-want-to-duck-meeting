// End-to-end sessions (src/session.js → chrome.js → join/incall → captions/audio → transcript)
// against the local mock Meet (test/mock-meet), in real headless Chrome 151 launched by our own
// chrome.js (headless adds --mute-audio, the production default).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockMeet } from '../mock-meet/server.js';
import { HAPPY_EXPECTED } from '../mock-meet/timeline.js';
import { runSession } from '../../src/session.js';
import { getConfig } from '../../src/config.js';
import { createMeetingDir, newMeetingId, readStatus } from '../../src/status.js';
import { parseMeetUrl } from '../../src/url.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = path.join(REPO, 'test', '.tmp', 'integ-session');
const CODE = 'abc-defg-hij';
const NAME = '測試 Bot 的會議記錄';
/** Parameters that make a scenario run in about a second once captions are on. */
const FAST = { lobbyMs: 300, captionLeadMs: 0, captionStepMs: 0.03, endAfterMs: 200 };
/**
 * Short meeting whose speech starts when the bot switches the caption language (the mock's
 * default 8 s lead), like a real meeting where people talk after the bot is set up: use it
 * when utterances are asserted. (With FAST, the whole script can be over before the bot has
 * finished setting the caption language.)
 */
const QUICK = { lobbyMs: 300, captionStepMs: 0.3, endAfterMs: 300 };
const TEST_TIMEOUT = 150_000;

/** @type {Awaited<ReturnType<typeof startMockMeet>>} */
let mock;
let counter = 0;

before(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
  mock = await startMockMeet();
});

after(async () => {
  await mock?.close();
  if (process.env.OPENMEETING_KEEP_TMP !== '1') fs.rmSync(ROOT, { recursive: true, force: true });
});

/**
 * Run one session against a mock scenario with its own OPENMEETING_HOME (and profile).
 * @param {Record<string, unknown>} params mock query params
 * @param {Record<string, string>} [envOverrides]
 */
async function runMock(params, envOverrides = {}) {
  counter += 1;
  const home = path.join(ROOT, `run-${counter}-${params.scenario}`);
  const env = {
    OPENMEETING_HOME: home,
    OPENMEETING_HEADLESS: '1',
    OPENMEETING_ALLOW_ANY_HOST: '1',
    OPENMEETING_POLL_MS: '300',
    OPENMEETING_BLOCKED_BACKOFF_MS: '100',
    OPENMEETING_LOBBY_TIMEOUT_MS: '60000',
    ...envOverrides,
  };
  const config = getConfig(env);
  const { code, url } = parseMeetUrl(mock.urlFor(CODE, params), { allowAnyHost: true });
  const id = newMeetingId(code);
  const dir = createMeetingDir(config.meetingsDir, id);
  /** @type {any} */
  let mockState = null;
  const final = await runSession({
    url,
    code,
    id,
    dir,
    displayName: NAME,
    config,
    hooks: {
      beforeClose: async (page) => {
        mockState = await page.evaluate(() => JSON.parse(JSON.stringify(/** @type {any} */ (window).__mock ?? null)));
      },
    },
  });
  return { final, dir, mockState, status: readStatus(dir) };
}

/** @param {string} dir */
function readUtterances(dir) {
  const file = path.join(dir, 'transcript.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** Parse a PCM16 WAV: duration and peak |sample|. @param {string} file */
function readWav(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE');
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const dataBytes = buf.readUInt32LE(40);
  assert.equal(dataBytes, buf.length - 44, 'data size in the header matches the file');
  let peak = 0;
  for (let i = 44; i + 1 < buf.length; i += 2) peak = Math.max(peak, Math.abs(buf.readInt16LE(i)));
  return { channels, sampleRate, seconds: dataBytes / (sampleRate * channels * 2), peak };
}

/** @param {any} status */
function assertTerminalShape(status) {
  assert.ok(status, 'status.json exists');
  assert.ok(['done', 'failed'].includes(status.state), `terminal state, got ${status.state}`);
  assert.ok(status.endedAt, 'endedAt set');
  assert.equal(typeof status.pid, 'number');
  assert.ok(status.stats && typeof status.stats.utterances === 'number');
}

test('happy: joins silently, records the exact transcript, audio and stats', { timeout: TEST_TIMEOUT }, async () => {
  const { final, dir, mockState, status } = await runMock({ scenario: 'happy', lobbyMs: 1500 });
  assertTerminalShape(status);
  assert.equal(final.state, 'done');
  assert.equal(final.endReason, 'meeting_ended');
  assert.equal(final.error, null);
  assert.ok(final.joinedAt, 'joinedAt set');

  const utterances = readUtterances(dir);
  assert.deepEqual(utterances.map((u) => ({ speaker: u.speaker, text: u.text })), HAPPY_EXPECTED.map((u) => ({ ...u })));
  for (const u of utterances) {
    assert.equal(u.source, 'captions');
    assert.ok(Date.parse(u.t0) <= Date.parse(u.t1));
  }

  const md = fs.readFileSync(path.join(dir, 'transcript.md'), 'utf8');
  assert.match(md, /^# 會議逐字稿 — abc-defg-hij/);
  assert.match(md, /- 發言者：王小明、Arthur/);
  assert.match(md, /來源：Google Meet 即時字幕（cmn-Hant-TW）/);
  assert.ok(md.includes(HAPPY_EXPECTED[2].text), 'the monologue is in transcript.md');

  assert.equal(final.stats.captionLang, 'cmn-Hant-TW');
  assert.equal(final.stats.captionsOn, true);
  assert.equal(final.stats.utterances, HAPPY_EXPECTED.length);
  assert.deepEqual(final.stats.speakers, ['王小明', 'Arthur']);

  const wav = readWav(path.join(dir, 'audio.wav'));
  assert.equal(wav.sampleRate, 16000);
  assert.equal(wav.channels, 1);
  assert.ok(wav.seconds >= 3, `audio.wav has ${wav.seconds} s`);
  assert.ok(wav.peak > 1000, `audio peak ${wav.peak}`);
  assert.ok(final.stats.audioSeconds >= 3);

  assert.ok(mockState, 'mock state captured before leaving');
  assert.equal(mockState.micOff, true, 'microphone off');
  assert.equal(mockState.camOff, true, 'camera off');
  assert.equal(mockState.name, NAME, 'typed display name');
  assert.equal(mockState.captionLang, 'cmn-Hant-TW');
  assert.equal(mockState.timelineDone, true);
});

test('signedin=1 (no name input, "Join now") joins and records', { timeout: TEST_TIMEOUT }, async () => {
  const { final, dir, mockState } = await runMock({ scenario: 'happy', signedin: 1, ...QUICK });
  assert.equal(final.state, 'done');
  assert.equal(final.endReason, 'meeting_ended');
  assert.ok(readUtterances(dir).length >= 1);
  assert.equal(mockState.signedIn, true);
  assert.equal(mockState.name, 'OpenMeeting Bot');
  assert.equal(mockState.micOff && mockState.camOff, true);
});

test('continue_dialog: dismisses the devices dialog, then joins', { timeout: TEST_TIMEOUT }, async () => {
  const { final, mockState } = await runMock({ scenario: 'continue_dialog', ...FAST });
  assert.equal(final.state, 'done');
  assert.equal(final.endReason, 'meeting_ended');
  assert.ok(mockState.events.some((e) => e.type === 'continue_without_devices'));
  assert.equal(mockState.micOff && mockState.camOff, true);
  assert.equal(mockState.name, NAME);
});

test('denied → failed/denied', { timeout: TEST_TIMEOUT }, async () => {
  const { final, dir, status } = await runMock({ scenario: 'denied', ...FAST });
  assertTerminalShape(status);
  assert.equal(final.state, 'failed');
  assert.equal(final.error.code, 'denied');
  assert.ok(final.error.message);
  assert.ok(fs.readdirSync(path.join(dir, 'screens')).some((f) => f.endsWith('.png')), 'screenshot on failure');
});

test('lobby_timeout → failed/lobby_timeout', { timeout: TEST_TIMEOUT }, async () => {
  const { final } = await runMock({ scenario: 'lobby_timeout', ...FAST });
  assert.equal(final.state, 'failed');
  assert.equal(final.error.code, 'lobby_timeout');
});

test('blocked → retried, then failed/blocked', { timeout: TEST_TIMEOUT }, async () => {
  const { final, dir } = await runMock({ scenario: 'blocked', ...FAST });
  assert.equal(final.state, 'failed');
  assert.equal(final.error.code, 'blocked');
  const log = fs.readFileSync(path.join(dir, 'bot.log'), 'utf8');
  assert.match(log, /attempt 3\/3/);
});

test('notfound → failed/not_found', { timeout: TEST_TIMEOUT }, async () => {
  const { final } = await runMock({ scenario: 'notfound', ...FAST });
  assert.equal(final.state, 'failed');
  assert.equal(final.error.code, 'not_found');
});

test('signin → failed/signin_required', { timeout: TEST_TIMEOUT }, async () => {
  const { final } = await runMock({ scenario: 'signin', ...FAST });
  assert.equal(final.state, 'failed');
  assert.equal(final.error.code, 'signin_required');
});

test('removed → done/removed', { timeout: TEST_TIMEOUT }, async () => {
  const { final, dir } = await runMock({ scenario: 'removed', ...FAST });
  assert.equal(final.state, 'done');
  assert.equal(final.endReason, 'removed');
  assert.ok(fs.existsSync(path.join(dir, 'transcript.md')));
});

test('alone → done/alone after OPENMEETING_ALONE_TIMEOUT_MS', { timeout: TEST_TIMEOUT }, async () => {
  const t0 = Date.now();
  const { final } = await runMock({ scenario: 'alone', ...FAST }, { OPENMEETING_ALONE_TIMEOUT_MS: '3000' });
  assert.equal(final.state, 'done');
  assert.equal(final.endReason, 'alone');
  assert.ok(Date.now() - t0 >= 3000);
});

test('a chat toast quoting an end-screen phrase does not end the recording', { timeout: TEST_TIMEOUT }, async () => {
  const { final, dir, mockState } = await runMock({
    scenario: 'happy', ...QUICK, toast: 'Alice: Meeting ended? Call ended lol', toastAtMs: 1500,
  });
  assert.equal(final.state, 'done');
  assert.equal(final.endReason, 'meeting_ended');
  assert.ok(mockState, 'still on the call page when leaving');
  assert.equal(mockState.timelineDone, true, 'stayed until the mock meeting really ended');
  assert.ok(readUtterances(dir).length >= 1);
  assert.match(fs.readFileSync(path.join(dir, 'bot.log'), 'utf8'), /ignoring "Meeting ended"/);
});

test('an unrecognized end screen (no call controls) ends the session after OPENMEETING_UNKNOWN_END_MS', { timeout: TEST_TIMEOUT }, async () => {
  const { final, dir } = await runMock({ scenario: 'happy', ...QUICK, endText: 'Thanks for joining' }, { OPENMEETING_UNKNOWN_END_MS: '2000', OPENMEETING_MAX_DURATION_MS: '90000' });
  assert.equal(final.state, 'done');
  assert.equal(final.endReason, 'meeting_ended');
  assert.ok(readUtterances(dir).length >= 1, 'recorded while in the call');
  assert.match(fs.readFileSync(path.join(dir, 'bot.log'), 'utf8'), /unrecognized screen; treating the meeting as ended/);
});

test('alone without a readable participant count: falls back to the tiles (5 × aloneTimeout)', { timeout: TEST_TIMEOUT }, async () => {
  const t0 = Date.now();
  const { final, dir } = await runMock({ scenario: 'alone', ...QUICK, nocount: 1 }, { OPENMEETING_ALONE_TIMEOUT_MS: '1000', OPENMEETING_NO_ONE_TIMEOUT_MS: '60000', OPENMEETING_MAX_DURATION_MS: '90000' });
  assert.equal(final.state, 'done');
  assert.equal(final.endReason, 'alone');
  assert.ok(Date.now() - t0 >= 5000);
  // the bot really waited 5 × aloneTimeout after the others left (mock logs "alone" in the page)
  const log = fs.readFileSync(path.join(dir, 'bot.log'), 'utf8');
  const inCall = Date.parse(/^(\S+) INFO \[session\] page state IN_CALL/m.exec(log)[1]);
  const over = Date.parse(/^(\S+) INFO \[session\] meeting over: alone/m.exec(log)[1]);
  assert.ok(over - inCall >= 5000, `left ${over - inCall} ms after the main loop started`);
});

test('alone without a readable participant count: the "only one here" hint is enough', { timeout: TEST_TIMEOUT }, async () => {
  const { final } = await runMock({ scenario: 'alone', ...QUICK, nocount: 1, alonehint: 1 }, { OPENMEETING_ALONE_TIMEOUT_MS: '1000', OPENMEETING_NO_ONE_TIMEOUT_MS: '60000', OPENMEETING_MAX_DURATION_MS: '90000' });
  assert.equal(final.state, 'done');
  assert.equal(final.endReason, 'alone');
});

test('caption language item without data-value is found by its label', { timeout: TEST_TIMEOUT }, async () => {
  const { final, dir, mockState } = await runMock({ scenario: 'happy', ...QUICK, langlist: 'nodatavalue' });
  assert.equal(final.state, 'done');
  assert.equal(final.stats.captionLang, 'cmn-Hant-TW');
  assert.equal(mockState.captionLang, 'cmn-Hant-TW');
  assert.match(fs.readFileSync(path.join(dir, 'bot.log'), 'utf8'), /found by its label/);
});

test('caption language that cannot be set: still recorded, transcript.md warns about it', { timeout: TEST_TIMEOUT }, async () => {
  const { final, dir } = await runMock({ scenario: 'happy', ...QUICK, captionLeadMs: 9000, langlist: 'missing' });
  assert.equal(final.state, 'done');
  assert.equal(final.stats.captionLang, 'unknown');
  assert.ok(readUtterances(dir).length >= 1);
  const md = fs.readFileSync(path.join(dir, 'transcript.md'), 'utf8');
  assert.ok(md.includes('字幕語言未能設定為 cmn-Hant-TW'), md.slice(0, 400));
});

test('STOP file while in the call → done/user_stop', { timeout: TEST_TIMEOUT }, async () => {
  const params = { scenario: 'happy', ...QUICK, endAfterMs: 1e12 };
  counter += 1;
  const home = path.join(ROOT, `run-${counter}-stop`);
  const config = getConfig({
    OPENMEETING_HOME: home, OPENMEETING_HEADLESS: '1', OPENMEETING_ALLOW_ANY_HOST: '1', OPENMEETING_POLL_MS: '300',
  });
  const { code, url } = parseMeetUrl(mock.urlFor(CODE, params), { allowAnyHost: true });
  const id = newMeetingId(code);
  const dir = createMeetingDir(config.meetingsDir, id);
  const timer = setInterval(() => {
    const s = readStatus(dir);
    if (s && s.state === 'in_call' && Date.now() - Date.parse(s.joinedAt) > 4000) {
      fs.writeFileSync(path.join(dir, 'STOP'), 'test\n');
      clearInterval(timer);
    }
  }, 200);
  try {
    const final = await runSession({ url, code, id, dir, displayName: NAME, config });
    assert.equal(final.state, 'done');
    assert.equal(final.endReason, 'user_stop');
    assert.ok(final.stats.utterances >= 1, 'utterances flushed on stop');
  } finally {
    clearInterval(timer);
  }
});
