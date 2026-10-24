// Runs the browser-side collectSnapshot() in real headless Chrome against small HTML
// fixtures, then feeds the result to classify(). Fixtures are served from a fake origin via
// Playwright request interception (no network, no local server, nothing else is fetched).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { collectSnapshot } from '../../src/page/snapshot.js';
import { SEL, TEXT, serializableSel } from '../../src/meet/selectors.js';
import { classify } from '../../src/meet/state.js';
import {clickElement} from '../../src/meet/join.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/snapshot/', import.meta.url));
const ORIGIN = 'http://meet-fixtures.test';

/** @type {import('playwright-core').Browser | undefined} */
let browser;
/** @type {import('playwright-core').Page} */
let page;

before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) return route.abort();
    const name = path.basename(u.pathname);
    if (!/^[a-z0-9-]+\.html$/.test(name)) return route.fulfill({ status: 404, body: 'not found' });
    try {
      const body = await readFile(path.join(FIXTURES, name));
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
    } catch {
      return route.fulfill({ status: 404, body: 'not found' });
    }
  });
  page = await context.newPage();
});

after(async () => {
  await browser?.close();
});

/**
 * @param {string} name fixture basename without .html
 * @returns {Promise<any>}
 */
async function snapshotOf(name) {
  await page.goto(`${ORIGIN}/${name}.html?hl=en`, { waitUntil: 'load' });
  return page.evaluate(collectSnapshot, [serializableSel(), TEXT]);
}

const opts = { meetingOrigin: ORIGIN };

const SNAPSHOT_KEYS = [
  'bodyEmpty', 'camOn', 'captionRegion', 'captionsOn', 'ctaTexts', 'leaveButton', 'micOn', 'nameInputVisible',
  'participantCount', 'participantTiles', 'selfName', 'text', 'url',
].sort();

describe('collectSnapshot in headless Chrome', () => {
  test('icon-bearing same-account CTA is PREJOIN and joins alongside rather than switching',async()=>{
    const snap=await snapshotOf('prejoin-icons');
    assert.deepEqual(snap.ctaTexts,['Join here too']);
    assert.equal(classify(snap,opts).state,'PREJOIN');
    assert.equal(await clickElement(page,{texts:TEXT.joinCtas}),true);
    assert.equal(await page.evaluate(()=>window.clicked),'join-too');
  });
  test('prejoin: name input + "Ask to join" button => PREJOIN', async () => {
    const s = await snapshotOf('prejoin');
    assert.deepEqual(Object.keys(s).sort(), SNAPSHOT_KEYS);
    assert.equal(s.url, `${ORIGIN}/prejoin.html?hl=en`);
    assert.equal(s.nameInputVisible, true);
    assert.deepEqual(s.ctaTexts, ['Ask to join']); // hidden "Join now" and "Other ways to join" excluded
    assert.equal(s.leaveButton, false);
    assert.equal(s.captionsOn, null);
    assert.equal(s.captionRegion, false);
    assert.equal(s.participantTiles, 0, 'self preview with "Backgrounds and effects" is not a tile');
    assert.equal(s.selfName, false);
    assert.equal(s.participantCount, null);
    assert.equal(s.bodyEmpty, false);
    assert.equal(s.micOn, true, '"Turn off microphone (ctrl + d)" visible = mic is on');
    assert.equal(s.camOn, true);
    assert.match(s.text, /Ready to join\?/);
    assert.match(s.text, /What's your name\?/);
    assert.deepEqual(classify(s, opts), { state: 'PREJOIN', matched: 'Ask to join' });
  });

  test('lobby with a leave button => LOBBY (curly apostrophe normalized)', async () => {
    const s = await snapshotOf('lobby');
    assert.equal(s.leaveButton, true);
    assert.equal(s.nameInputVisible, false);
    assert.deepEqual(s.ctaTexts, []);
    assert.match(s.text, /You'll join the call when someone lets you in/);
    assert.equal(s.text.includes('’'), false);
    assert.deepEqual(classify(s, opts), { state: 'LOBBY', matched: 'Asking to be let in' });
  });

  test('in call: tiles, captions button (off), [data-avatar-count="3"] => IN_CALL', async () => {
    const s = await snapshotOf('incall');
    assert.equal(s.leaveButton, true);
    assert.equal(s.captionsOn, false);
    assert.equal(s.captionRegion, false);
    assert.equal(s.participantTiles, 3, 'nested [data-participant-id] counted once');
    assert.equal(s.selfName, true);
    assert.equal(s.participantCount, 3);
    assert.equal(s.micOn, false, '"Turn on microphone" visible = mic is off');
    assert.equal(s.camOn, false);
    assert.equal(s.nameInputVisible, false);
    assert.deepEqual(s.ctaTexts, []);
    assert.match(s.text, /王小明/);
    const r = classify(s, opts);
    assert.equal(r.state, 'IN_CALL');
  });

  test('in call with captions on: caption text is excluded from page text; People label count', async () => {
    const s = await snapshotOf('incall-captions');
    assert.equal(s.captionsOn, true);
    assert.equal(s.captionRegion, true);
    assert.equal(s.leaveButton, true);
    assert.equal(s.participantTiles, 2);
    assert.equal(s.participantCount, 4, 'from People button aria-label');
    assert.equal(s.text.includes('Meeting ended'), false);
    assert.equal(s.text.includes('Call ended'), false);
    assert.equal(s.text.includes('You left the meeting'), false);
    assert.match(s.text, /Arthur 的會議記錄/);
    assert.equal(classify(s, opts).state, 'IN_CALL');
  });

  test('hidden elements (display/visibility/hidden/aria-hidden) never count as visible', async () => {
    const s = await snapshotOf('hidden');
    assert.equal(s.nameInputVisible, false);
    assert.deepEqual(s.ctaTexts, []);
    assert.equal(s.leaveButton, false);
    assert.equal(s.captionsOn, null);
    assert.equal(s.captionRegion, false);
    assert.equal(s.participantTiles, 0);
    assert.equal(s.selfName, false);
    assert.equal(s.participantCount, null);
    assert.equal(s.micOn, false);
    assert.equal(s.camOn, false);
    assert.equal(s.bodyEmpty, false);
    assert.equal(s.text.includes('hidden caption'), false);
    assert.deepEqual(classify(s, opts), { state: 'UNKNOWN', matched: null });
  });

  test('ended screen => ENDED', async () => {
    const s = await snapshotOf('ended');
    assert.deepEqual(s.ctaTexts, []);
    assert.equal(s.leaveButton, false);
    assert.deepEqual(classify(s, opts), { state: 'ENDED', matched: 'You left the meeting' });
  });

  test('denied screen: "Ask to join again" is not a CTA => DENIED', async () => {
    const s = await snapshotOf('denied');
    assert.deepEqual(s.ctaTexts, []);
    assert.deepEqual(classify(s, opts), { state: 'DENIED', matched: 'denied your request to join' });
  });

  test('blank page => BLANK', async () => {
    const s = await snapshotOf('blank');
    assert.equal(s.bodyEmpty, true);
    assert.equal(s.text, '');
    assert.deepEqual(classify(s, opts), { state: 'BLANK', matched: 'bodyEmpty' });
  });

  test('a page on another origin is BLOCKED when meetingOrigin is the real Meet', async () => {
    const s = await snapshotOf('incall');
    assert.equal(classify(s, { meetingOrigin: 'https://meet.google.com' }).state, 'BLOCKED');
  });

  test('text is normalized and truncated to 20000 chars', async () => {
    await page.goto(`${ORIGIN}/blank.html`, { waitUntil: 'load' });
    await page.evaluate(() => {
      document.body.textContent = 'word\n\n\t '.repeat(10000);
    });
    const s = await page.evaluate(collectSnapshot, [serializableSel(), TEXT]);
    assert.equal(s.text.length, 20000);
    assert.equal(/\s\s/.test(s.text), false);
    assert.equal(s.text.startsWith('word word'), true);
  });

  test('accepts (SEL, TEXT), [SEL, TEXT] and { SEL, TEXT } call forms with identical results', async () => {
    await page.goto(`${ORIGIN}/prejoin.html?hl=en`, { waitUntil: 'load' });
    const sel = serializableSel();
    const viaArray = await page.evaluate(collectSnapshot, [sel, TEXT]);
    const viaObject = await page.evaluate(collectSnapshot, { SEL: sel, TEXT });
    const viaString = await page.evaluate(`(${collectSnapshot.toString()})(${JSON.stringify(sel)}, ${JSON.stringify(TEXT)})`);
    assert.deepEqual(viaObject, viaArray);
    assert.deepEqual(viaString, viaArray);
  });

  test('missing TEXT and invalid selectors do not throw', async () => {
    await page.goto(`${ORIGIN}/prejoin.html?hl=en`, { waitUntil: 'load' });
    const onlySel = await page.evaluate(collectSnapshot, serializableSel());
    assert.deepEqual(onlySel.ctaTexts, []);
    assert.equal(onlySel.nameInputVisible, true);

    const broken = { ...serializableSel(), nameInput: ['::nope((', 'input[aria-label="Your name"]'], leave: '' };
    const s = await page.evaluate(collectSnapshot, [broken, TEXT]);
    assert.equal(s.nameInputVisible, true);
    assert.equal(s.leaveButton, false);

    const empty = await page.evaluate(collectSnapshot, [{}, {}]);
    assert.equal(empty.nameInputVisible, false);
    assert.equal(empty.participantCount, null);
  });

  test('every selector in SEL is valid CSS in Chrome', async () => {
    await page.goto(`${ORIGIN}/blank.html`, { waitUntil: 'load' });
    const sel = serializableSel();
    /** @type {string[]} */
    const all = [SEL.captionLangItem('cmn-Hant-TW')];
    for (const [key, value] of Object.entries(sel)) {
      if (key === 'settingsMenuItemText') continue; // plain text, not a selector
      all.push(...(Array.isArray(value) ? value : [value]));
    }
    const invalid = await page.evaluate((list) => list.filter((s) => {
      try { document.querySelectorAll(s); return false; } catch { return true; }
    }), all);
    assert.deepEqual(invalid, []);
  });
});
