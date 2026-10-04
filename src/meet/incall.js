/**
 * Post-join setup (spec 5.9): dismiss popups, turn captions on, set the caption language,
 * and leave the call. All clicks are real Playwright mouse clicks (see meet/join.js), except
 * the caption-language list item, which Meet keeps hidden until its dropdown opens and is
 * therefore clicked through `el.click()` in the page as the spec prescribes.
 * @module meet/incall
 */
import { SEL, TEXT } from './selectors.js';
import { clickElement, findElement, humanClick, sleep, takeSnapshot, toLog } from './join.js';

const MENU_ITEM_SCOPE = ['[role="menuitem"]', '[role="menu"] li', '[role="menuitemradio"]'];
const ALERT_JOIN_SCOPE = ['[role="alertdialog"] button', '[role="alertdialog"] [role="button"]'];
/** Fallback for SEL.captionsSettingsTab: a settings tab whose text is "Captions". */
const SETTINGS_TAB_SCOPE = ['[role="dialog"] [role="tab"]', '[role="tab"]'];
/** Fallback for SEL.captionLangItem: the English UI label of a caption language. */
const CAPTION_LANG_LABELS = Object.freeze({
  'cmn-Hant-TW': ['Chinese (Mandarin, Traditional)'],
  'cmn-Hans-CN': ['Chinese (Mandarin, Simplified)'],
});

/**
 * Browser-side (self-contained): find the caption-language list item by selector, else by
 * its label among list options; optionally click it with `el.click()` (works while Meet keeps
 * the dropdown hidden).
 * @param {{ selector: string, labels: string[], click?: boolean }} o
 * @returns {'selector'|'label'|'none'}
 */
function findCaptionLangItem({ selector, labels, click }) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  let el = null;
  let how = 'none';
  try {
    el = document.querySelector(selector);
  } catch {
    el = null;
  }
  if (el) how = 'selector';
  else if (labels && labels.length) {
    const wanted = labels.map(norm);
    el = Array.from(document.querySelectorAll('li, [role="option"]')).find((e) => wanted.includes(norm(e.textContent))) || null;
    if (el) how = 'label';
  }
  if (el && click) /** @type {HTMLElement} */ (el).click();
  return how;
}

/**
 * Poll `fn` until it returns a truthy value or `ms` elapse.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} ms
 * @param {number} [every]
 * @returns {Promise<T|null>}
 */
async function until(fn, ms, every = 250) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try {
      v = await fn();
    } catch {
      v = null;
    }
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(every);
  }
}

/**
 * Click visible popup buttons (`TEXT.dismiss`: "Got it", "Dismiss", "Stay in the call") and a
 * consent "Join now" inside a `[role=alertdialog]`. Repeats while something was clicked (max 4).
 * @param {import('playwright-core').Page} page
 * @param {{ log?: any }} [opts]
 * @returns {Promise<number>} how many buttons were clicked
 */
export async function dismissModals(page, { log } = {}) {
  const L = toLog(log);
  let clicked = 0;
  for (let i = 0; i < 4; i++) {
    const hit = (await clickElement(page, { texts: TEXT.dismiss }, { log: L, label: 'dismiss' }))
      || (await clickElement(page, { texts: ['Join now'], scope: ALERT_JOIN_SCOPE }, { log: L, label: 'consent Join now' }));
    if (!hit) break;
    clicked += 1;
    await sleep(300);
  }
  if (clicked) L.info(`incall: dismissed ${clicked} popup(s)`);
  return clicked;
}

/**
 * Captions state from a snapshot: on = "Turn off captions" visible or the caption region shown.
 * @param {import('playwright-core').Page} page
 */
async function captionsVisible(page) {
  const snap = await takeSnapshot(page);
  return snap.captionsOn === true || snap.captionRegion === true;
}

/**
 * Make sure live captions are on. Already on ("Turn off captions" or the caption region
 * visible) → true, without touching anything: the `c` shortcut TOGGLES captions, so it is only
 * pressed when they are known to be off. Otherwise click "Turn on captions" (or press `c` when
 * that button is not found) and verify within `verifyMs` that the caption region or "Turn off
 * captions" appears. Retries once; when the button click did not work, the retry presses
 * Escape (the button may have opened a panel) and then `c`.
 * @param {import('playwright-core').Page} page
 * @param {{ log?: any, verifyMs?: number }} [opts]
 * @returns {Promise<boolean>}
 */
export async function ensureCaptions(page, { log, verifyMs = 5000 } = {}) {
  const L = toLog(log);
  try {
    if (await captionsVisible(page)) return true;
  } catch (err) {
    L.debug(`incall: snapshot failed: ${err && err.message}`);
  }
  let buttonFailed = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let how = 'button';
    const useButton = !buttonFailed
      && (await clickElement(page, { selectors: SEL.captionsTurnOn }, { log: L, label: 'turn on captions' }));
    if (!useButton) {
      how = 'c key';
      try {
        if (buttonFailed) await page.keyboard.press('Escape');
        // the first check may have raced a slow toggle: never press c while captions show
        if (attempt > 1 && (await captionsVisible(page))) {
          L.info('incall: captions are on');
          return true;
        }
        await page.keyboard.press('c');
      } catch (err) {
        L.debug(`incall: pressing c failed: ${err && err.message}`);
      }
    }
    if (await until(() => captionsVisible(page), verifyMs)) {
      L.info(`incall: captions are on (via ${how})`);
      return true;
    }
    if (useButton) buttonFailed = true;
    L.warn(`incall: captions did not turn on (attempt ${attempt}, via ${how})`);
  }
  return false;
}

/**
 * Close whatever dialog/menu is open: "Close dialog" button, else Escape.
 * @param {import('playwright-core').Page} page
 * @param {ReturnType<typeof toLog>} L
 */
async function closeOverlays(page, L) {
  if (await clickElement(page, { selectors: SEL.closeDialog }, { log: L, label: 'close dialog' })) return;
  try {
    await page.keyboard.press('Escape');
  } catch {
    /* ignore */
  }
}

/**
 * Set Meet's caption ("meeting") language: More options → Settings → Captions tab →
 * `li[data-value=<code>]` (clicked in the page, works while the dropdown is hidden) → close.
 * Fallbacks (additions to spec 5.9): a `[role=tab]` whose text is "Captions", and a list
 * option whose text is the language's English label (e.g. "Chinese (Mandarin, Traditional)").
 * Failure is non-fatal (logged); the session retries while the language is unknown.
 * @param {import('playwright-core').Page} page
 * @param {string} code e.g. 'cmn-Hant-TW'
 * @param {{ log?: any }} [opts]
 * @returns {Promise<boolean>} true when the language item existed and was clicked
 */
export async function setCaptionLanguage(page, code, { log } = {}) {
  const L = toLog(log);
  let dialogOpen = false;
  try {
    if (!(await clickElement(page, { selectors: SEL.moreOptions }, { log: L, label: 'more options' }))) {
      throw new Error('"More options" button not found');
    }
    const settings = SEL.settingsMenuItemText;
    const openedSettings = await until(async () => (
      (await clickElement(page, { texts: [settings], scope: MENU_ITEM_SCOPE }, { log: L, label: 'Settings menu item' }))
      || (await clickElement(page, { texts: [settings], scope: MENU_ITEM_SCOPE, exact: false }, { log: L, label: 'Settings menu item' }))
    ), 3000);
    if (!openedSettings) throw new Error('"Settings" menu item not found');
    dialogOpen = true;

    const tab = await until(async () => (
      (await clickElement(page, { selectors: SEL.captionsSettingsTab }, { log: L, label: 'Captions tab' }))
      || (await clickElement(page, { texts: ['Captions'], scope: SETTINGS_TAB_SCOPE }, { log: L, label: 'Captions tab (by text)' }))
    ), 5000);
    if (!tab) throw new Error('"Captions" settings tab not found');

    const itemSel = SEL.captionLangItem(code);
    const labels = CAPTION_LANG_LABELS[code] || [];
    const exists = await until(() => page.evaluate(findCaptionLangItem, { selector: itemSel, labels }).then((h) => h !== 'none'), 3000);
    if (!exists) throw new Error(`caption language item ${itemSel} not found`);
    const how = await page.evaluate(findCaptionLangItem, { selector: itemSel, labels, click: true });
    if (how === 'none') throw new Error(`caption language item ${itemSel} disappeared`);
    if (how === 'label') L.info(`incall: caption language item found by its label (${labels.join(' / ')})`);
    await sleep(300);
    await closeOverlays(page, L);
    dialogOpen = false;
    L.info(`incall: caption language set to ${code}`);
    return true;
  } catch (err) {
    L.warn(`incall: could not set the caption language to ${code}: ${err && err.message}`);
    try {
      if (dialogOpen) await closeOverlays(page, L);
      else await page.keyboard.press('Escape');
    } catch {
      /* ignore */
    }
    return false;
  }
}

/**
 * Click "Leave call" if it is visible. Never throws.
 * @param {import('playwright-core').Page} page
 * @returns {Promise<void>}
 */
export async function leaveCall(page) {
  let el = null;
  try {
    if (!page || page.isClosed()) return;
    el = await findElement(page, { selectors: SEL.leave });
    if (el) await humanClick(el, { timeout: 3000 });
  } catch {
    /* ignore: the page may be gone or already left */
  } finally {
    if (el) await el.dispose().catch(() => {});
  }
}

/**
 * Everything after admission: dismiss popups, turn captions on, set the caption language
 * (then make sure captions are still on).
 * @param {import('playwright-core').Page} page
 * @param {{ captionLang?: string, log?: any }} opts
 * @returns {Promise<{ captionsOn: boolean, captionLang: string }>} captionLang: the code, or 'unknown' if it could not be set
 */
export async function prepareInCall(page, { captionLang, log } = {}) {
  const L = toLog(log);
  await dismissModals(page, { log: L });
  let captionsOn = await ensureCaptions(page, { log: L });
  let lang = 'unknown';
  if (captionLang) {
    if (await setCaptionLanguage(page, captionLang, { log: L })) lang = captionLang;
  }
  try {
    const snap = await takeSnapshot(page);
    if (snap.captionsOn === false) captionsOn = await ensureCaptions(page, { log: L });
    else if (snap.captionsOn === true || snap.captionRegion) captionsOn = true;
  } catch (err) {
    L.debug(`incall: snapshot failed: ${err && err.message}`);
  }
  return { captionsOn, captionLang: lang };
}
