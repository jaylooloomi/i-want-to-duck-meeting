// Smoke test for the mock Google Meet server (test/mock-meet). Drives every scenario by hand
// with Playwright in headless Chrome, so the bot's own integration tests can trust the mock.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { startMockMeet, SCENARIOS } from '../mock-meet/server.js';
import { HAPPY_TIMELINE, HAPPY_EXPECTED, HAPPY_DURATION_MS, ROLL_WINDOW, MAX_BLOCKS } from '../mock-meet/timeline.js';

const CODE = 'abc-defg-hij';
const GIBBERISH = '(english captions)';
/** Parameters that make a scenario run in well under a second once captions are on. */
const FAST = { lobbyMs: 200, captionLeadMs: 0, captionStepMs: 0.03, endAfterMs: 100 };

/** @type {Awaited<ReturnType<typeof startMockMeet>>} */
let mock;
/** @type {import('playwright-core').Browser} */
let browser;

before(async () => {
  mock = await startMockMeet();
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--lang=en-US'],
  });
});

after(async () => {
  await browser?.close();
  await mock?.close();
});

// ---------------------------------------------------------------------------------------------
// helpers

/** Open a fresh browser context on the mock meeting URL; closed automatically after the test. */
async function openMeet(t, params = {}) {
  const context = await browser.newContext({ locale: 'en-US' });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(mock.urlFor(CODE, params), { waitUntil: 'domcontentloaded' });
  return page;
}

/** Wait until the page's visible text contains `text`. */
function waitText(page, text, timeout = 10_000) {
  return page.waitForFunction((s) => document.body.innerText.includes(s), text, { timeout });
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

/** @returns {Promise<any>} a JSON copy of window.__mock */
function mockState(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__mock)));
}

function waitPhase(page, phase, timeout = 10_000) {
  return page.waitForFunction((p) => window.__mock?.phase === p, phase, { timeout });
}

/** Prejoin as an anonymous guest: type the name, turn mic + camera off, ask to join. */
async function askToJoin(page, name = 'Smoke Bot') {
  await page.locator('input[type="text"][aria-label="Your name"]').pressSequentially(name, { delay: 5 });
  await page.locator('button[aria-label="Turn off microphone"]').click();
  await page.locator('button[aria-label="Turn off camera"]').click();
  await page.getByRole('button', { name: 'Ask to join', exact: true }).click();
}

/** From prejoin all the way into the call. */
async function joinCall(page, name) {
  await askToJoin(page, name);
  await waitPhase(page, 'in_call');
  await page.locator('button[aria-label="Turn on captions"]').waitFor();
}

/**
 * Model of the caption DOM the page builds from a timeline (same rules as public/captions.js):
 * returns one snapshot ([{ id, speaker, text }]) per step, ids change when an element is replaced.
 */
function simulateCaptionDom(timeline) {
  let nextId = 1;
  /** @type {{ id: number, speaker: string, text: string }[]} */
  let blocks = [];
  const snapshots = [];
  for (const step of timeline) {
    const idx = blocks.findLastIndex((b) => b.speaker === step.speaker);
    if (step.op === 'new' || idx < 0) {
      blocks.push({ id: nextId++, speaker: step.speaker, text: step.text });
      if (blocks.length > MAX_BLOCKS) blocks = blocks.slice(-MAX_BLOCKS);
    } else if (step.op === 'set') {
      blocks[idx] = { ...blocks[idx], text: step.text };
    } else {
      blocks[idx] = { id: nextId++, speaker: step.speaker, text: step.text };
    }
    snapshots.push(blocks.map((b) => ({ ...b })));
  }
  return snapshots;
}

// Reference implementation of the spec's stitching rules (design spec 5.11), used only to prove
// that HAPPY_EXPECTED is what a perfect assembler produces from HAPPY_TIMELINE.
const CJK = /[⺀-鿿豈-﫿　-〿＀-￯]/;
function joinText(a, b) {
  if (!a) return b;
  if (!b) return a;
  const x = a.at(-1);
  const y = b[0];
  return !CJK.test(x) && !CJK.test(y) && !/\s/.test(x) && !/\s/.test(y) ? `${a} ${b}` : a + b;
}
function mergeVisible(acc, last, next) {
  if (next === last) return acc;
  if (last === '') return joinText(acc, next);
  const head = acc.slice(0, acc.length - last.length);
  let cp = 0;
  while (cp < last.length && cp < next.length && last[cp] === next[cp]) cp++;
  if (cp >= Math.min(8, 0.5 * Math.min(last.length, next.length))) return head + next;
  for (let k = Math.min(400, last.length, next.length); k >= 6; k--) {
    if (last.endsWith(next.slice(0, k))) return acc + next.slice(k);
  }
  const j = last.indexOf(next.slice(0, 12));
  if (j >= 0) return head + last.slice(0, j) + next;
  return joinText(acc, next);
}
function referenceAssemble(snapshots) {
  const byId = new Map();
  const utterances = [];
  let previous = [];
  for (const blocks of snapshots) {
    const ids = new Set(blocks.map((b) => b.id));
    const gone = previous.filter((b) => !ids.has(b.id)).map((b) => byId.get(b.id));
    for (const b of blocks) {
      let rec = byId.get(b.id);
      if (!rec) {
        rec = gone.find((r) => r.speaker === b.speaker && (b.text.startsWith(r.last.slice(-12)) || r.last.startsWith(b.text)));
        if (!rec) utterances.push((rec = { speaker: b.speaker, acc: '', last: '' }));
        byId.set(b.id, rec);
      }
      rec.acc = mergeVisible(rec.acc, rec.last, b.text);
      rec.last = b.text;
    }
    previous = blocks;
  }
  return utterances.map(({ speaker, acc }) => ({ speaker, text: acc }));
}

// ---------------------------------------------------------------------------------------------
// server (no browser)

test('server: routes, content types, 404/405/400', async () => {
  const meet = await fetch(mock.urlFor(CODE, { scenario: 'happy' }));
  assert.equal(meet.status, 200);
  assert.match(meet.headers.get('content-type'), /^text\/html; charset=utf-8/);
  assert.match(await meet.text(), /meet\.js/);

  for (const asset of ['meet.js', 'captions.js', 'timeline.js']) {
    const res = await fetch(`${mock.origin}/static/${asset}`);
    assert.equal(res.status, 200, asset);
    assert.match(res.headers.get('content-type'), /^text\/javascript; charset=utf-8/, asset);
  }
  const css = await fetch(`${mock.origin}/static/meet.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /^text\/css/);

  const signin = await fetch(`${mock.origin}/v3/signin/identifier?continue=x`);
  assert.equal(signin.status, 200);
  assert.match(await signin.text(), /<h1[^>]*>Sign in<\/h1>/);

  const home = await fetch(`${mock.origin}/`);
  assert.equal(home.status, 200);

  for (const path of ['/nope', '/abc-defg-hi', '/ABC-DEFG-HIJ', '/static/missing.js', '/static/..%2fserver.js',
    '/static/%2e%2e/server.js', '/static/..%5cserver.js', '/v3/signin/identifier/extra']) {
    const res = await fetch(`${mock.origin}${path}`);
    assert.equal(res.status, 404, path);
    await res.arrayBuffer();
  }

  const post = await fetch(mock.urlFor(CODE), { method: 'POST' });
  assert.equal(post.status, 405);
  const bad = await fetch(mock.urlFor(CODE, { scenario: 'bogus' }));
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /unknown scenario/);
});

test('server: urlFor builds meeting URLs with hl=en first', () => {
  const url = new URL(mock.urlFor(CODE, { scenario: 'denied', lobbyMs: 300, skip: undefined }));
  assert.equal(url.origin, mock.origin);
  assert.equal(url.pathname, `/${CODE}`);
  assert.deepEqual([...url.searchParams], [['hl', 'en'], ['scenario', 'denied'], ['lobbyMs', '300']]);
  assert.match(mock.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.deepEqual(SCENARIOS, ['happy', 'denied', 'blocked', 'lobby_timeout', 'removed', 'alone', 'signin', 'notfound', 'continue_dialog']);
});

// ---------------------------------------------------------------------------------------------
// timeline fixture

test('timeline: well-formed and covers revision, code-switching, rolling, rerender, trimming', () => {
  assert.ok(HAPPY_TIMELINE.length > 20);
  let prev = 0;
  for (const step of HAPPY_TIMELINE) {
    assert.ok(['new', 'set', 'rerender'].includes(step.op), JSON.stringify(step));
    assert.ok(step.atMs >= prev, 'atMs must be non-decreasing');
    assert.ok(typeof step.speaker === 'string' && step.speaker && typeof step.text === 'string' && step.text);
    assert.ok(step.text.length <= ROLL_WINDOW, `visible text longer than the window: ${step.text}`);
    prev = step.atMs;
  }
  assert.equal(HAPPY_DURATION_MS, HAPPY_TIMELINE.at(-1).atMs);
  assert.ok(HAPPY_DURATION_MS < 15_000);
  assert.equal(HAPPY_TIMELINE[0].op, 'new');

  const texts = HAPPY_TIMELINE.map((s) => s.text);
  assert.ok(texts.includes('今天我們來討論新版本的上限時間'));
  assert.ok(texts.includes('今天我們來討論新版本的上線時間，大家有什麼想法？'));
  assert.ok(texts.includes('好的，我先 review 一下 PR，星期五前給你回覆。'));
  assert.equal(HAPPY_TIMELINE.filter((s) => s.op === 'rerender').length, 1);
  assert.ok(HAPPY_TIMELINE.some((s) => s.spans), 'some steps render their text as several <span>s');
  assert.ok(HAPPY_TIMELINE.filter((s) => s.op === 'new').length > MAX_BLOCKS, 'old blocks get trimmed');

  assert.equal(HAPPY_EXPECTED.length, 6);
  assert.ok(HAPPY_EXPECTED.some((u) => u.speaker === '王小明' && u.text.length > 150), 'long monologue');
  assert.deepEqual([...new Set(HAPPY_EXPECTED.map((u) => u.speaker))], ['王小明', 'Arthur']);
});

test('timeline: a spec-conformant assembler reproduces HAPPY_EXPECTED (every step and throttled)', () => {
  const snapshots = simulateCaptionDom(HAPPY_TIMELINE);
  assert.deepEqual(referenceAssemble(snapshots), HAPPY_EXPECTED);
  assert.ok(Math.max(...snapshots.map((s) => s.length)) === MAX_BLOCKS);
  // A throttled observer samples the DOM: at the spec's 200 ms, and even when slower than the
  // 300 ms step rate (so it misses some states), the transcript must still come out right.
  for (const periodMs of [200, 450]) {
    for (let offsetMs = 0; offsetMs < periodMs; offsetMs += 50) {
      const seen = [];
      for (let t = offsetMs; t <= HAPPY_DURATION_MS + periodMs; t += periodMs) {
        const i = HAPPY_TIMELINE.findLastIndex((s) => s.atMs <= t);
        if (i >= 0 && seen.at(-1) !== snapshots[i]) seen.push(snapshots[i]);
      }
      assert.ok(seen.length < snapshots.length || periodMs === 200);
      assert.deepEqual(referenceAssemble(seen), HAPPY_EXPECTED, `period ${periodMs} ms, offset ${offsetMs} ms`);
    }
  }
});

test('timeline: a new block never looks like a re-render of an earlier block of the same speaker', () => {
  const lastBySpeaker = new Map();
  for (const step of HAPPY_TIMELINE) {
    const seen = lastBySpeaker.get(step.speaker) ?? [];
    if (step.op === 'new') {
      for (const last of seen) {
        assert.ok(!step.text.startsWith(last.slice(-12)) && !last.startsWith(step.text), `${step.text} vs ${last}`);
      }
      seen.push(step.text);
    } else {
      seen[seen.length - 1] = step.text;
    }
    lastBySpeaker.set(step.speaker, seen);
  }
});

// ---------------------------------------------------------------------------------------------
// browser scenarios

test('happy: prejoin → lobby → in call → Chinese captions → end screen', async (t) => {
  const page = await openMeet(t, { scenario: 'happy', lobbyMs: 400 });

  // PREJOIN
  const nameInput = page.locator('input[type="text"][aria-label="Your name"][jsname="YPqjbf"]');
  await nameInput.waitFor();
  assert.equal((await mockState(page)).phase, 'prejoin');
  await nameInput.pressSequentially('Smoke Bot', { delay: 5 });
  await page.locator('button[aria-label="Turn off microphone"]').click();
  await page.locator('button[aria-label="Turn off camera"]').click();
  await page.locator('button[aria-label="Turn on microphone"]').waitFor();
  await page.locator('button[aria-label="Turn on camera"]').waitFor();
  let st = await mockState(page);
  assert.equal(st.micOff, true);
  assert.equal(st.camOff, true);
  assert.equal(st.name, 'Smoke Bot');
  const cta = page.locator('button', { has: page.locator('span', { hasText: /^Ask to join$/ }) });
  assert.equal(await cta.count(), 1);
  await cta.click();

  // LOBBY
  await waitText(page, 'Asking to be let in…');
  await waitText(page, 'You’ll join the call when someone lets you in');
  assert.equal(await page.locator('button[aria-label="Leave call"]').count(), 1);
  assert.equal(await nameInput.count(), 0);
  assert.equal((await mockState(page)).phase, 'lobby');

  // IN CALL
  await page.locator('button[aria-label="Turn on captions"]').waitFor({ timeout: 5000 });
  assert.equal((await mockState(page)).phase, 'in_call');
  const tiles = await page.$$eval('[data-participant-id]', (els) => els.map((e) => e.innerText));
  assert.equal(tiles.length, 4);
  assert.ok(tiles.some((s) => s.includes('王小明')));
  assert.ok(tiles.some((s) => s.includes('Arthur')));
  assert.ok(tiles.some((s) => s.includes('Backgrounds and effects')));
  assert.match(await page.locator('[data-participant-id][data-self-name]').innerText(), /Smoke Bot/);
  assert.equal(await page.locator('[data-avatar-count]').getAttribute('data-avatar-count'), '3');
  assert.equal(await page.locator('button[aria-label="Leave call"]').count(), 1);

  // "Got it" info popup, shortly after joining
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.getByRole('button', { name: 'Got it' }).waitFor({ state: 'detached' });

  // remote audio: an <audio> whose srcObject carries a live, audible track
  const audio = await page.evaluate(async () => {
    const el = [...document.querySelectorAll('audio')].find((a) => a.srcObject instanceof MediaStream);
    if (!el) return null;
    const track = el.srcObject.getAudioTracks()[0];
    const ctx = new AudioContext();
    await ctx.resume();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(el.srcObject).connect(analyser);
    let peak = 0;
    const buf = new Float32Array(analyser.fftSize);
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 60));
      analyser.getFloatTimeDomainData(buf);
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
    }
    await ctx.close();
    return { autoplay: el.autoplay, readyState: track?.readyState, peak };
  });
  assert.ok(audio, 'remote <audio> element exists');
  assert.equal(audio.autoplay, true);
  assert.equal(audio.readyState, 'live');
  assert.ok(audio.peak > 0.05, `audible remote audio, peak=${audio.peak}`);

  // watch the caption DOM from inside the page
  await page.evaluate(() => {
    const rec = (window.__smoke = { maxBlocks: 0, sawGibberish: false });
    new MutationObserver(() => {
      const blocks = document.querySelectorAll('.nMcdL');
      rec.maxBlocks = Math.max(rec.maxBlocks, blocks.length);
      if ([...blocks].some((b) => b.textContent.includes('(english captions)'))) rec.sawGibberish = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  // captions ON
  await page.locator('button[aria-label="Turn on captions"]').click();
  await page.locator('button[aria-label="Turn off captions"]').waitFor();
  const region = page.locator('div[role="region"][aria-label="Captions"][tabindex="0"].vNKgIf.UDinHf');
  await region.waitFor();
  const controls = await region.evaluate((el) => [...el.children].slice(-2).map((c) => c.tagName + ':' + c.innerText.trim()));
  assert.deepEqual(controls, ['BUTTON:English', 'BUTTON:Jump to bottom']);

  // caption language through More options > Settings > Captions
  await page.locator('button[aria-label="More options"]').click();
  await page.locator('[role="menu"] li[role="menuitem"]', { hasText: 'Settings' }).click();
  const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
  await dialog.waitFor();
  await page.locator('button[aria-label="Captions"]').click();
  const list = page.locator('ul[aria-label="Meeting language"]');
  assert.equal(await list.evaluate((el) => getComputedStyle(el).display), 'none');
  assert.deepEqual(await list.locator('li').evaluateAll((els) => els.slice(0, 3).map((e) => e.dataset.value)),
    ['en-US', 'cmn-Hant-TW', 'cmn-Hans-CN']);
  await page.locator('li[data-value="cmn-Hant-TW"]').evaluate((el) => el.click());
  await page.locator('button[aria-label="Close dialog"]').click();
  await dialog.waitFor({ state: 'detached' });
  st = await mockState(page);
  assert.equal(st.captionLang, 'cmn-Hant-TW');
  assert.equal(st.captionsOn, true);
  assert.equal(await region.evaluate((el) => [...el.children].at(-2).innerText.trim()), 'Chinese (Mandarin, Traditional)');

  // the scripted timeline
  await page.waitForFunction(() => window.__mock.timelineDone === true, null, { timeout: HAPPY_DURATION_MS + 10_000 });
  st = await mockState(page);
  assert.deepEqual(st.rendered.map((r) => r.text), HAPPY_TIMELINE.map((s) => s.text), 'every step rendered in Chinese');

  const blocks = await page.$$eval('.nMcdL', (els) => els.map((b) => ({
    speaker: b.querySelector('.NWpY1d').textContent,
    alt: b.querySelector('img.Z6byG').alt,
    text: b.querySelector('.ygicle.VbkSUe').textContent,
    nested: !!b.querySelector(':scope > .adE6rb > .KcIKyf.jxFHg > span.NWpY1d'),
  })));
  const finalModel = simulateCaptionDom(HAPPY_TIMELINE).at(-1);
  assert.deepEqual(blocks.map(({ speaker, text }) => ({ speaker, text })), finalModel.map(({ speaker, text }) => ({ speaker, text })));
  assert.ok(blocks.every((b) => b.nested && b.alt === b.speaker));
  const smoke = await page.evaluate(() => window.__smoke);
  assert.equal(smoke.maxBlocks, MAX_BLOCKS);
  assert.equal(smoke.sawGibberish, false);

  // END (default endAfterMs = 2000)
  await waitText(page, 'The call ended because everyone left', 10_000);
  await page.getByRole('button', { name: 'Return to home screen' }).waitFor();
  assert.equal(await page.locator('[role="region"][aria-label="Captions"]').count(), 0);
  assert.equal(await page.locator('audio').count(), 0, 'remote audio removed after the call');
  st = await mockState(page);
  assert.equal(st.scenario, 'happy');
  assert.equal(st.phase, 'ended');
  assert.equal(st.micOff, true);
  assert.equal(st.camOff, true);
  assert.equal(st.name, 'Smoke Bot');
  assert.equal(st.captionsOn, true);
  assert.equal(st.captionLang, 'cmn-Hant-TW');
  assert.equal(st.timelineDone, true);
});

test('prejoin: the CTA is ignored while the name is empty', async (t) => {
  const page = await openMeet(t, { scenario: 'happy', lobbyMs: 200 });
  await page.getByRole('button', { name: 'Ask to join', exact: true }).click();
  await page.waitForTimeout(300);
  const st = await mockState(page);
  assert.equal(st.phase, 'prejoin');
  assert.ok(st.events.some((e) => e.type === 'cta_ignored'));
  assert.ok(!(await bodyText(page)).includes('Asking to be let in'));
  await page.locator('input[aria-label="Your name"]').fill('   ');
  await page.getByRole('button', { name: 'Ask to join', exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal((await mockState(page)).phase, 'prejoin', 'whitespace-only name is still empty');
});

test('signedin=1: no name input, "Join now" goes through to the call', async (t) => {
  const page = await openMeet(t, { scenario: 'happy', signedin: 1, lobbyMs: 200 });
  const joinNow = page.locator('button', { has: page.locator('span', { hasText: /^Join now$/ }) });
  await joinNow.waitFor();
  assert.equal(await page.locator('input[type="text"]').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Ask to join', exact: true }).count(), 0);
  await page.locator('button[aria-label="Turn off microphone"]').click();
  await joinNow.click();
  await waitPhase(page, 'in_call');
  const st = await mockState(page);
  assert.equal(st.micOff, true);
  assert.equal(st.camOff, false);
  assert.ok(st.name.length > 0);
  assert.match(await page.locator('[data-self-name]').innerText(), new RegExp(st.name));
});

test('continue_dialog: dialog blocks the CTA until "Continue without microphone and camera"', async (t) => {
  const page = await openMeet(t, { scenario: 'continue_dialog', lobbyMs: 200 });
  const dialog = page.locator('[role="dialog"]', { hasText: 'Continue without microphone and camera' });
  await dialog.waitFor();
  await page.locator('input[aria-label="Your name"]').fill('Dialog Bot');
  const cta = page.getByRole('button', { name: 'Ask to join', exact: true });
  await assert.rejects(cta.click({ timeout: 500 }), /intercepts pointer events|Timeout/);
  await cta.evaluate((el) => el.click()); // a synthetic click is ignored too
  await page.waitForTimeout(200);
  assert.equal((await mockState(page)).phase, 'prejoin');

  await page.getByRole('button', { name: 'Continue without microphone and camera' }).click();
  await dialog.waitFor({ state: 'detached' });
  let st = await mockState(page);
  assert.equal(st.micOff, true);
  assert.equal(st.camOff, true);
  assert.equal(await page.locator('[aria-label*="Turn off microphone"]').count(), 0);
  assert.equal(await page.locator('button[aria-label="Turn on camera"]').count(), 1);
  await cta.click();
  await waitPhase(page, 'in_call');
  st = await mockState(page);
  assert.equal(st.name, 'Dialog Bot');
});

test('denied: lobby → denied screen, "Ask to join again" re-enters the lobby', async (t) => {
  const page = await openMeet(t, { scenario: 'denied', lobbyMs: 300 });
  await askToJoin(page);
  await waitText(page, 'Asking to be let in…');
  await waitText(page, 'Someone in the call denied your request to join');
  assert.equal((await mockState(page)).phase, 'denied');
  await page.getByRole('button', { name: 'Ask to join again' }).click();
  await waitText(page, 'Asking to be let in…');
  await waitText(page, 'Someone in the call denied your request to join');
});

test('lobby_timeout: nobody responds', async (t) => {
  const page = await openMeet(t, { scenario: 'lobby_timeout', lobbyMs: 300 });
  await askToJoin(page);
  await waitText(page, 'No one responded to your request to join the call');
  assert.equal((await mockState(page)).phase, 'lobby_timeout');
  assert.ok(!(await bodyText(page)).includes('Ask to join again'), 'must not look like "denied"');
});

test('blocked: no prejoin UI, only the block message', async (t) => {
  const page = await openMeet(t, { scenario: 'blocked' });
  await waitText(page, 'You can’t join this video call');
  await waitText(page, 'Your meeting is safe');
  assert.equal(await page.locator('input').count(), 0);
  assert.equal(await page.getByRole('button', { name: /join/i }).count(), 0);
  assert.equal((await mockState(page)).phase, 'blocked');
});

test('notfound: "Check your meeting code" with a working "Return to home screen"', async (t) => {
  const page = await openMeet(t, { scenario: 'notfound' });
  await waitText(page, 'Check your meeting code');
  assert.equal((await mockState(page)).phase, 'notfound');
  await page.getByRole('button', { name: 'Return to home screen' }).click();
  await page.waitForURL(`${mock.origin}/`);
});

test('signin: redirected to the sign-in page', async (t) => {
  const context = await browser.newContext({ locale: 'en-US' });
  t.after(() => context.close());
  const page = await context.newPage();
  const url = mock.urlFor(CODE, { scenario: 'signin' });
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {}); // the page replaces itself
  await page.waitForURL(/\/v3\/signin\/identifier\?/);
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  const target = new URL(page.url());
  assert.equal(target.origin, mock.origin);
  assert.equal(target.searchParams.get('continue'), url);
});

test('removed: captions without a language switch are English gibberish, then removed', async (t) => {
  const page = await openMeet(t, { scenario: 'removed', ...FAST });
  await joinCall(page);
  await page.keyboard.press('c'); // keyboard shortcut toggles captions
  await page.locator('button[aria-label="Turn off captions"]').waitFor();
  await waitText(page, 'You’ve been removed from the meeting');
  const st = await mockState(page);
  assert.equal(st.phase, 'removed');
  assert.equal(st.captionLang, 'en-US');
  assert.equal(st.timelineDone, true);
  assert.equal(st.rendered.length, HAPPY_TIMELINE.length);
  assert.ok(st.rendered.every((r) => r.text === GIBBERISH));
});

test('alone: everyone else leaves, avatar count 1, and the call never ends', async (t) => {
  const page = await openMeet(t, { scenario: 'alone', ...FAST });
  await joinCall(page);
  await page.locator('button[aria-label="Turn on captions"]').click();
  await page.locator('[data-avatar-count="1"]').waitFor({ timeout: 5000 });
  const tiles = await page.$$eval('[data-participant-id]', (els) => els.map((e) => e.innerText));
  assert.equal(tiles.filter((s) => !s.includes('Backgrounds and effects')).length, 1);
  assert.equal(await page.locator('[data-participant-id][data-self-name]').count(), 1);
  await page.waitForTimeout(1000);
  const st = await mockState(page);
  assert.equal(st.phase, 'in_call');
  assert.equal(st.timelineDone, true);
  const text = await bodyText(page);
  assert.ok(!/call ended|removed from|left the meeting/i.test(text));
  assert.equal(await page.locator('button[aria-label="Leave call"]').count(), 1);
});

test('in call: "c" toggles captions, timeline pauses while off, huge endAfterMs never ends, Leave call', async (t) => {
  const page = await openMeet(t, { scenario: 'happy', ...FAST, captionStepMs: 0.05, endAfterMs: 1e12 });
  await joinCall(page);
  await page.waitForTimeout(300);
  assert.equal((await mockState(page)).rendered.length, 0, 'no captions while captions are off');

  await page.keyboard.press('c');
  await page.locator('button[aria-label="Turn off captions"]').waitFor();
  await page.locator('[role="region"][aria-label="Captions"]').waitFor();
  await page.waitForFunction(() => window.__mock.rendered.length >= 2);
  await page.keyboard.press('c');
  await page.locator('button[aria-label="Turn on captions"]').waitFor();
  assert.equal(await page.locator('[role="region"][aria-label="Captions"]').count(), 0);
  const paused = (await mockState(page)).rendered.length;
  await page.waitForTimeout(400);
  assert.equal((await mockState(page)).rendered.length, paused, 'timeline paused while captions are off');
  assert.equal((await mockState(page)).captionsOn, false);

  await page.locator('button[aria-label="Turn on captions"]').click();
  await page.waitForFunction(() => window.__mock.timelineDone === true, null, { timeout: 5000 });
  await page.waitForTimeout(800);
  assert.equal((await mockState(page)).phase, 'in_call', 'endAfterMs=1e12 must not overflow setTimeout');

  // Escape closes the options menu
  await page.locator('button[aria-label="More options"]').click();
  await page.locator('[role="menu"]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('[role="menu"]').waitFor({ state: 'detached' });

  await page.locator('button[aria-label="Leave call"]').click();
  await waitText(page, 'You left the meeting');
  assert.equal((await mockState(page)).phase, 'left');
});
