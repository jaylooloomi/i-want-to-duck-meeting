// ensureCaptions and the prejoin safety rules against small inline pages in headless Chrome.
// Pages are served from a fake origin via request interception (no network, no server).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { ensureCaptions } from '../../src/meet/incall.js';
import { JoinError, joinMeeting } from '../../src/meet/join.js';

const ORIGIN = 'http://incall-fixtures.test';

/** @type {Record<string, string>} path → html */
const PAGES = {};

/** @type {import('playwright-core').Browser | undefined} */
let browser;
/** @type {import('playwright-core').BrowserContext} */
let context;

before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) return route.abort();
    const html = PAGES[u.pathname];
    if (!html) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
});

after(async () => {
  await browser?.close();
});

/** Register a page and open it in a fresh tab. @param {string} name @param {string} body */
async function open(name, body) {
  PAGES[`/${name}`] = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Meet</title></head><body>${body}</body></html>`;
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/${name}`);
  return page;
}

// Counts "c" key presses; pressing c toggles a caption region (like Meet's shortcut).
const C_TOGGLE = `
<script>
  window.cPresses = 0;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'c') return;
    window.cPresses++;
    const r = document.getElementById('cap');
    r.hidden = !r.hidden;
  });
</script>`;

test('ensureCaptions: a visible caption region means "on" — c is never pressed (it would toggle them off)', async () => {
  const page = await open('region-only', `
    <button aria-label="Leave call">call_end</button>
    <div id="cap" role="region" aria-label="Captions"><div class="nMcdL">王小明 大家好</div></div>
    ${C_TOGGLE}`);
  try {
    assert.equal(await ensureCaptions(page, { verifyMs: 500 }), true);
    assert.equal(await page.evaluate(() => window.cPresses), 0);
    assert.equal(await page.isVisible('#cap'), true);
  } finally {
    await page.close();
  }
});

test('ensureCaptions: captions known off and no button → presses c once', async () => {
  const page = await open('c-only', `
    <button aria-label="Leave call">call_end</button>
    <div id="cap" role="region" aria-label="Captions" hidden><div class="nMcdL">hi</div></div>
    ${C_TOGGLE}`);
  try {
    assert.equal(await ensureCaptions(page, { verifyMs: 1000 }), true);
    assert.equal(await page.evaluate(() => window.cPresses), 1);
  } finally {
    await page.close();
  }
});

test('ensureCaptions: a "Turn on captions" button that does not work → the retry uses Escape + c', async () => {
  const page = await open('dead-button', `
    <button aria-label="Leave call">call_end</button>
    <button aria-label="Turn on captions" onclick="window.buttonClicks = (window.buttonClicks || 0) + 1">cc</button>
    <div id="cap" role="region" aria-label="Captions" hidden><div class="nMcdL">hi</div></div>
    <script>document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.escapes = (window.escapes || 0) + 1; });</script>
    ${C_TOGGLE}`);
  try {
    assert.equal(await ensureCaptions(page, { verifyMs: 600 }), true);
    assert.equal(await page.evaluate(() => window.buttonClicks), 1, 'the dead button is clicked only once');
    assert.equal(await page.evaluate(() => window.escapes), 1);
    assert.equal(await page.evaluate(() => window.cPresses), 1);
  } finally {
    await page.close();
  }
});

test('joinMeeting: never clicks the join button while the microphone cannot be turned off', async () => {
  const page = await open('mic-stuck', `
    <h1>Ready to join?</h1>
    <button aria-label="Turn off microphone (ctrl + d)" onclick="window.micClicks = (window.micClicks || 0) + 1">mic</button>
    <button aria-label="Turn on camera">cam</button>
    <button onclick="window.ctaClicked = true"><span>Ask to join</span></button>`);
  try {
    await assert.rejects(
      joinMeeting(page, {
        url: `${ORIGIN}/mic-stuck`, displayName: 'Bot', pollMs: 200, prejoinTimeoutMs: 2500, meetingOrigin: ORIGIN,
      }),
      (err) => err instanceof JoinError && err.code === 'join_failed' && /microphone/.test(err.message),
    );
    assert.equal(await page.evaluate(() => window.ctaClicked === true), false, 'the join button was never clicked');
    assert.ok(await page.evaluate(() => window.micClicks >= 1), 'it did try to turn the microphone off');
  } finally {
    await page.close();
  }
});

test('joinMeeting: with "Switch here" and "Join here too", joins as an extra device and never switches', async () => {
  const page = await open('switch-here', `
    <div id="pre">
      <h1>You're already in this call on another device</h1>
      <button aria-label="Turn on microphone">mic</button>
      <button onclick="window.clicked = 'Switch here'"><span>Switch here</span></button>
      <button onclick="window.clicked = 'Join here too'; document.getElementById('pre').hidden = true; document.getElementById('call').hidden = false;"><span>Join here too</span></button>
    </div>
    <div id="call" hidden>
      <button aria-label="Leave call">call_end</button>
      <button aria-label="Turn on captions">cc</button>
    </div>`);
  try {
    const r = await joinMeeting(page, { url: `${ORIGIN}/switch-here`, displayName: 'Bot', pollMs: 200, meetingOrigin: ORIGIN });
    assert.equal(typeof r.admittedAfterMs, 'number');
    assert.equal(await page.evaluate(() => window.clicked), 'Join here too');
  } finally {
    await page.close();
  }
});
