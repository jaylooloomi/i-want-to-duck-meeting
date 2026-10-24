// ensureCaptions and the prejoin safety rules against small inline pages in headless Chrome.
// Pages are served from a fake origin via request interception (no network, no server).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { ensureCaptions, getCaptionLanguage, setCaptionLanguage } from '../../src/meet/incall.js';
import { JoinError, joinMeeting, dismissDevicePrompt } from '../../src/meet/join.js';

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

test('device invitation: closes only the microphone prompt without enabling devices', async () => {
  const page = await open('device-prompt', `
    <div role="dialog" id="other"><p>Other settings</p><button aria-label="Close dialog" onclick="window.wrong=true">Close</button></div>
    <div role="dialog" id="devices"><p>Do you want people to hear you in the meeting?</p>
      <button aria-label="Close dialog" onclick="window.trusted=event.isTrusted; this.parentElement.remove()">Close</button>
      <button onclick="window.enabled=true">Use microphone</button>
      <button onclick="window.enabled=true">Use microphone and camera</button>
    </div>`);
  try {
    assert.equal(await dismissDevicePrompt(page), true);
    assert.equal(await page.locator('#devices').count(), 0);
    assert.equal(await page.evaluate(() => window.trusted), true);
    assert.equal(await page.evaluate(() => !!window.enabled || !!window.wrong), false);
    assert.equal(await dismissDevicePrompt(page), false);
    assert.equal(await page.locator('#other').count(), 1);
  } finally {
    await page.close();
  }
});

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

// --- caption language: the caption bar's "Meeting language" combobox (path A) and
// --- More options > Settings > Captions (path B, the fallback) ---------------------------------

const LANGS = [['en-US', 'English'], ['cmn-Hant-TW', 'Chinese (Mandarin, Traditional)'], ['cmn-Hans-CN', 'Chinese (Mandarin, Simplified)']];
let langPageCounter = 0;

/**
 * A call page with the caption-bar language picker and/or the Settings path. Records what
 * happened in `window.events` ('combo', 'option:<code>:<isTrusted>', 'escape', 'more',
 * 'settings', 'trigger:<isTrusted>', 'settings-option:<code>:<isTrusted>', 'close').
 * @param {{ combobox?: boolean, settings?: boolean, lang?: string, brokenOption?: boolean,
 *   deadTrigger?: boolean, portal?: boolean, missing?: boolean, listbox?: boolean, label?: string }} [o]
 *   brokenOption: picking a combobox option does nothing; deadTrigger: the Settings dropdown never
 *   opens; portal: the caption listbox lives at the end of <body>; missing: no cmn-Hant-TW anywhere;
 *   listbox:false: the combobox has no listbox in the DOM; label: combobox text override
 */
async function openLangPage(o = {}) {
  const { combobox = true, settings = true, lang = 'en-US', brokenOption = false, deadTrigger = false, portal = false, missing = false, listbox = true } = o;
  const langs = LANGS.filter(([c]) => !(missing && c === 'cmn-Hant-TW'));
  const name = (c) => (LANGS.find((l) => l[0] === c) || [c, c])[1];
  const options = langs.map(([c, n]) => `<li role="option" data-value="${c}" aria-selected="${c === lang}">${n}</li>`).join('');
  const lb = listbox ? `<ul id="lb" role="listbox" style="display:none">${options}</ul>` : '';
  const comboHtml = combobox ? `
    <div class="picker">
      <div id="combo" role="combobox" aria-label="Meeting language" aria-haspopup="listbox" aria-expanded="false" ${listbox ? 'aria-controls="lb"' : ''} tabindex="0"><span id="combo-label">${o.label ?? name(lang)}</span><i aria-hidden="true">arrow_drop_down</i></div>
      ${portal ? '' : lb}
    </div>` : '<button class="caption-lang">English</button>';
  const settingsHtml = settings ? `
    <button aria-label="More options" id="more">more</button>
    <ul id="menu" role="menu" style="display:none"><li role="menuitem" id="settings-item"><span>Settings</span></li></ul>
    <div id="dlg" role="dialog" aria-label="Settings" style="display:none">
      <button aria-label="Close dialog" id="close">x</button>
      <button role="tab" aria-label="Captions" id="tab">Captions</button>
      <div id="panel" style="display:none">
        <button id="trigger" aria-haspopup="listbox" aria-expanded="false"><span id="trigger-label">${name(lang)}</span></button>
        <ul id="slist" role="listbox" aria-label="Meeting language" style="display:none">${langs.map(([c, n]) => `<li role="option" data-value="${c}">${n}</li>`).join('')}</ul>
      </div>
    </div>` : '';
  langPageCounter += 1;
  return open(`lang-${langPageCounter}`, `
    <button aria-label="Leave call">call_end</button>
    <button aria-label="Turn off captions">cc</button>
    <div role="region" aria-label="Captions" tabindex="0">
      <div class="nMcdL"><span class="NWpY1d">王小明</span><div class="ygicle">大家好</div></div>
      ${comboHtml}
    </div>
    ${settingsHtml}
    ${portal ? lb : ''}
    <script>
      const LANGS = ${JSON.stringify(LANGS)};
      const name = (c) => (LANGS.find((l) => l[0] === c) || [c, c])[1];
      const $ = (id) => document.getElementById(id);
      window.lang = ${JSON.stringify(lang)};
      window.events = [];
      function setLang(code, via) {
        window.lang = code;
        window.via = via;
        if ($('combo-label')) $('combo-label').textContent = name(code);
        if ($('trigger-label')) $('trigger-label').textContent = name(code);
        document.querySelectorAll('#lb [role="option"]').forEach((li) => li.setAttribute('aria-selected', String(li.dataset.value === code)));
      }
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        events.push('escape');
        if ($('lb')) $('lb').style.display = 'none';
        if ($('combo')) $('combo').setAttribute('aria-expanded', 'false');
      });
      if ($('combo')) {
        const openList = (on) => {
          if ($('lb')) $('lb').style.display = on ? 'block' : 'none';
          $('combo').setAttribute('aria-expanded', String(on));
        };
        $('combo').addEventListener('click', (e) => {
          if (!e.isTrusted) return events.push('untrusted-combo');
          events.push('combo');
          openList($('combo').getAttribute('aria-expanded') !== 'true');
        });
        if ($('lb')) $('lb').addEventListener('click', (e) => {
          const li = e.target.closest('[role="option"]');
          if (!li) return;
          events.push('option:' + li.dataset.value + ':' + e.isTrusted);
          if (!e.isTrusted || ${brokenOption}) return;
          openList(false);
          setLang(li.dataset.value, 'combobox');
        });
      }
      if ($('more')) {
        $('more').onclick = () => { events.push('more'); $('menu').style.display = 'block'; };
        $('settings-item').onclick = () => { events.push('settings'); $('menu').style.display = 'none'; $('dlg').style.display = 'block'; };
        $('tab').onclick = () => { $('panel').style.display = 'block'; };
        $('trigger').onclick = (e) => {
          events.push('trigger:' + e.isTrusted);
          if (${deadTrigger}) return;
          $('slist').style.display = $('slist').style.display === 'none' ? 'block' : 'none';
        };
        $('slist').onclick = (e) => {
          const li = e.target.closest('[role="option"]');
          if (!li) return;
          events.push('settings-option:' + li.dataset.value + ':' + e.isTrusted);
          $('slist').style.display = 'none';
          setLang(li.dataset.value, 'settings');
        };
        $('close').onclick = () => { events.push('close'); $('dlg').style.display = 'none'; $('panel').style.display = 'none'; };
      }
    </script>`);
}

/** @param {import('playwright-core').Page} page */
const pageState = (page) => page.evaluate(() => ({ lang: window.lang, via: window.via ?? null, events: window.events }));

test('setCaptionLanguage: picks the language in the caption-bar combobox with real clicks (no Settings needed)', async () => {
  const page = await openLangPage({ settings: false });
  const lines = [];
  try {
    assert.equal(await getCaptionLanguage(page), 'en-US');
    assert.equal(await setCaptionLanguage(page, 'cmn-Hant-TW', { log: (m) => lines.push(m) }), true);
    const st = await pageState(page);
    assert.equal(st.lang, 'cmn-Hant-TW');
    assert.equal(st.via, 'combobox');
    assert.deepEqual(st.events, ['combo', 'option:cmn-Hant-TW:true'], 'one real click on the combobox, one on the option');
    assert.equal(await getCaptionLanguage(page), 'cmn-Hant-TW');
    assert.equal(await page.isVisible('#lb'), false, 'the listbox is closed again');
    assert.ok(lines.some((l) => /caption language set to cmn-Hant-TW via the caption bar/.test(l)), lines.join('\n'));
  } finally {
    await page.close();
  }
});

test('setCaptionLanguage: a listbox someone already opened is used as is (not toggled closed by a second click)', async () => {
  const page = await openLangPage({ settings: false });
  try {
    await page.click('#combo'); // e.g. the person at the bot's window opened it
    assert.equal(await page.isVisible('#lb'), true);
    assert.equal(await setCaptionLanguage(page, 'cmn-Hant-TW'), true);
    const st = await pageState(page);
    assert.equal(st.lang, 'cmn-Hant-TW');
    assert.deepEqual(st.events, ['combo', 'option:cmn-Hant-TW:true'], 'only the option was clicked');
  } finally {
    await page.close();
  }
});

test('setCaptionLanguage: already selected → true without opening the picker', async () => {
  const page = await openLangPage({ settings: false, lang: 'cmn-Hant-TW' });
  try {
    assert.equal(await setCaptionLanguage(page, 'cmn-Hant-TW'), true);
    assert.deepEqual((await pageState(page)).events, []);
  } finally {
    await page.close();
  }
});

test('getCaptionLanguage: selected option of the hidden listbox (also as a portal), else the combobox label, else null', async () => {
  const pages = [];
  try {
    const plain = await openLangPage();
    pages.push(plain);
    assert.equal(await getCaptionLanguage(plain), 'en-US');

    const portal = await openLangPage({ portal: true, lang: 'cmn-Hans-CN' });
    pages.push(portal);
    assert.equal(await getCaptionLanguage(portal), 'cmn-Hans-CN');

    const labelOnly = await openLangPage({ listbox: false, label: 'Chinese (Mandarin, Traditional)' });
    pages.push(labelOnly);
    assert.equal(await getCaptionLanguage(labelOnly), 'cmn-Hant-TW');

    const unknownLabel = await openLangPage({ listbox: false, label: 'Klingon' });
    pages.push(unknownLabel);
    assert.equal(await getCaptionLanguage(unknownLabel), null);

    const noCombo = await openLangPage({ combobox: false });
    pages.push(noCombo);
    assert.equal(await getCaptionLanguage(noCombo), null);
  } finally {
    for (const p of pages) await p.close();
  }
});

test('getCaptionLanguage: a selected data-value that is not a language code is not taken for one', async () => {
  const page = await open('lang-odd-listbox', `
    <div role="region" aria-label="Captions">
      <div class="nMcdL"><span class="NWpY1d">王小明</span><div class="ygicle">大家好</div></div>
      <div class="picker">
        <div role="combobox" aria-label="Meeting language" aria-controls="odd"><span>Chinese (Mandarin, Traditional)</span></div>
        <ul id="odd" role="listbox" style="display:none"><li role="option" data-value="panel 3: captions" aria-selected="true">Captions</li></ul>
      </div>
    </div>`);
  try {
    assert.equal(await getCaptionLanguage(page), 'cmn-Hant-TW', 'falls back to the combobox label');
  } finally {
    await page.close();
  }
});

test('setCaptionLanguage: a combobox pick that does not stick → Escape, then Settings > Captions with real clicks', async () => {
  const page = await openLangPage({ brokenOption: true });
  const lines = [];
  try {
    assert.equal(await setCaptionLanguage(page, 'cmn-Hant-TW', { log: (m) => lines.push(m) }), true);
    const st = await pageState(page);
    assert.equal(st.lang, 'cmn-Hant-TW');
    assert.equal(st.via, 'settings');
    const e = st.events;
    assert.ok(e.indexOf('escape') > e.indexOf('option:cmn-Hant-TW:true'), e.join(','));
    assert.ok(e.indexOf('more') > e.indexOf('escape'), e.join(','));
    assert.ok(e.includes('trigger:true') && e.includes('settings-option:cmn-Hant-TW:true'), e.join(','));
    assert.ok(!e.some((x) => x.endsWith(':false')), `no synthetic clicks: ${e.join(',')}`);
    assert.equal(e.at(-1), 'close', 'the Settings dialog is closed afterwards');
    assert.equal(await getCaptionLanguage(page), 'cmn-Hant-TW');
    assert.ok(lines.some((l) => /via Settings/.test(l)), lines.join('\n'));
  } finally {
    await page.close();
  }
});

test('setCaptionLanguage: Settings path clicks the hidden list item from page script only as the last resort', async () => {
  const page = await openLangPage({ combobox: false, deadTrigger: true });
  const lines = [];
  try {
    assert.equal(await setCaptionLanguage(page, 'cmn-Hant-TW', { log: (m) => lines.push(m) }), true);
    const st = await pageState(page);
    assert.equal(st.lang, 'cmn-Hant-TW');
    assert.ok(st.events.includes('trigger:true'), 'tried to open the dropdown with a real click first');
    assert.ok(st.events.includes('settings-option:cmn-Hant-TW:false'), st.events.join(','));
    assert.ok(lines.some((l) => /last resort/.test(l)), lines.join('\n'));
  } finally {
    await page.close();
  }
});

test('setCaptionLanguage: language offered nowhere → false, picker and dialog closed', async () => {
  const page = await openLangPage({ missing: true });
  try {
    assert.equal(await setCaptionLanguage(page, 'cmn-Hant-TW'), false);
    const st = await pageState(page);
    assert.equal(st.lang, 'en-US');
    assert.ok(st.events.includes('combo') && st.events.includes('escape'), st.events.join(','));
    assert.equal(await page.isVisible('#lb'), false);
    assert.equal(await page.isVisible('#dlg'), false);
    assert.equal(await getCaptionLanguage(page), 'en-US');
  } finally {
    await page.close();
  }
});
