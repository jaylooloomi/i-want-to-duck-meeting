/**
 * Post-join setup (spec 5.9): dismiss popups, turn captions on, set the caption language,
 * and leave the call. All clicks are real Playwright mouse clicks (see meet/join.js). The one
 * exception is the last resort of the Settings path: a caption-language list item that stays
 * hidden even after its dropdown was clicked is clicked through `el.click()` in the page.
 *
 * Caption language (deviation from spec 5.9, verified against the Sep-Oct 2026 Meet DOM): with
 * captions on, the caption bar shows a "Meeting language" combobox (`SEL.captionLangCombobox`)
 * whose listbox holds `li[role=option][data-value=<BCP-47 code>]`. That is path A; the spec's
 * More options > Settings > Captions route is path B, the fallback. With `?hl=en` captions start
 * in English, so the language is set on every join.
 * @module meet/incall
 */
import { SEL, TEXT, captionLangOptionSelectors, normalizeText } from './selectors.js';
import { clickElement, findElement, humanClick, sleep, takeSnapshot, toLog, withTimeout } from './join.js';

const MENU_ITEM_SCOPE = ['[role="menuitem"]', '[role="menu"] li', '[role="menuitemradio"]'];
const ALERT_JOIN_SCOPE = ['[role="alertdialog"] button', '[role="alertdialog"] [role="button"]'];
/** Fallback for SEL.captionsSettingsTab: a settings tab whose text is "Captions". */
const SETTINGS_TAB_SCOPE = ['[role="dialog"] [role="tab"]', '[role="tab"]'];
/** Fallback for a caption-language option without data-value: its listbox option, by label. */
const OPTION_SCOPE = ['[role="listbox"] [role="option"]', '[role="option"]'];
/**
 * English UI labels of caption languages: the fallback when an option carries no data-value,
 * and how a combobox label alone is mapped back to a code (exact match only).
 */
const CAPTION_LANG_LABELS = Object.freeze({
  'cmn-Hant-TW': ['Chinese (Mandarin, Traditional)'],
  'cmn-Hans-CN': ['Chinese (Mandarin, Simplified)'],
  'en-US': ['English', 'English (United States)'],
});
/** Shape of a caption language code (BCP-47-like: 'en-US', 'cmn-Hant-TW'). */
const LANG_CODE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;
/** Path A timings: wait for the combobox, for its option after the click, for the selection to show. */
const COMBO_WAIT_MS = 1000;
const OPTION_WAIT_MS = 3000;
const VERIFY_MS = 2500;

/**
 * Browser-side (self-contained): state of the caption bar's language combobox.
 * - `selected`: data-value of the `[aria-selected=true]` option in the combobox's listbox (found
 *   via aria-controls / aria-owns, inside the combobox, or next to it), even while it is hidden;
 *   `selectedText`: that option's text (for options without data-value).
 * - `optionSelected`: an option matching `optionSels` (outside dialogs) has aria-selected=true.
 * - `text`: the combobox's own text without aria-hidden parts (icon ligatures).
 * @param {{ comboSels: string[], optionSels?: string[] }} o
 * @returns {{ combobox: boolean, visible: boolean, expanded: boolean, text: string,
 *   selected: string|null, selectedText: string, optionSelected: boolean }}
 */
function readCaptionLangState({ comboSels, optionSels }) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const all = (s, root = document) => {
    try {
      return Array.from(root.querySelectorAll(s));
    } catch {
      return [];
    }
  };
  const isVisible = (el) => {
    if (!el || !el.isConnected || el.closest('[aria-hidden="true"]')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    return el.getClientRects().length > 0;
  };
  const ownText = (el) => {
    let out = '';
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) out += c.data;
        else if (c.nodeType === 1 && c.getAttribute('aria-hidden') !== 'true' && c.getAttribute('role') !== 'listbox') {
          out += ' ';
          walk(c);
          out += ' ';
        }
      }
    };
    walk(el);
    return norm(out);
  };
  let combo = null;
  let firstAny = null;
  for (const s of comboSels || []) {
    for (const el of all(s)) {
      if (!firstAny) firstAny = el;
      if (!combo && isVisible(el)) combo = el;
    }
    if (combo) break;
  }
  combo = combo || firstAny;
  const out = {
    combobox: !!combo, visible: !!combo && isVisible(combo), expanded: !!combo && combo.getAttribute('aria-expanded') === 'true',
    text: combo ? ownText(combo) : '', selected: null, selectedText: '', optionSelected: false,
  };
  if (!combo) return out;
  const comboDialog = combo.closest('[role="dialog"]');
  /** @type {Element[]} */
  const boxes = [];
  const add = (el) => {
    if (el && !boxes.includes(el) && el.closest('[role="dialog"]') === comboDialog) boxes.push(el);
  };
  for (const attr of ['aria-controls', 'aria-owns']) {
    for (const id of (combo.getAttribute(attr) || '').split(/\s+/)) {
      const t = id ? document.getElementById(id) : null;
      if (!t) continue;
      if (t.getAttribute('role') === 'listbox') add(t);
      else all('[role="listbox"]', t).forEach(add);
    }
  }
  all('[role="listbox"]', combo).forEach(add);
  for (let p = combo.parentElement, i = 0; p && i < 4 && !boxes.length; p = p.parentElement, i++) all('[role="listbox"]', p).forEach(add);
  for (const box of boxes) {
    const opt = box.querySelector('[role="option"][aria-selected="true"]');
    if (opt) {
      out.selected = opt.getAttribute('data-value') || null;
      out.selectedText = norm(opt.textContent);
      break;
    }
  }
  for (const s of optionSels || []) {
    const opt = all(s).find((e) => !e.closest('[role="dialog"]'));
    if (opt) {
      out.optionSelected = opt.getAttribute('aria-selected') === 'true';
      break;
    }
  }
  return out;
}

/**
 * Browser-side (self-contained): the Settings caption-language list item for path B — by
 * selector, else by its label among list options. Items inside a dialog win; items inside the
 * caption region or the caption bar's own listbox are never returned.
 * @param {{ selector: string, labels: string[], exclude: string[], comboSels: string[] }} o
 * @returns {{ el: Element|null, how: 'selector'|'label'|'none' }}
 */
function locateCaptionLangItem({ selector, labels, exclude, comboSels }) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const all = (s) => {
    try {
      return Array.from(document.querySelectorAll(s));
    } catch {
      return [];
    }
  };
  /** @type {Element[]} */
  const excluded = [];
  for (const s of exclude || []) excluded.push(...all(s));
  for (const s of comboSels || []) {
    for (const combo of all(s)) {
      for (const id of `${combo.getAttribute('aria-controls') || ''} ${combo.getAttribute('aria-owns') || ''}`.split(/\s+/)) {
        const t = id ? document.getElementById(id) : null;
        if (t) excluded.push(t);
      }
    }
  }
  const allowed = (el) => !excluded.some((x) => x.contains(el));
  const pick = (els) => {
    const ok = els.filter(allowed);
    return ok.find((e) => e.closest('[role="dialog"]')) || ok[0] || null;
  };
  let el = pick(all(selector));
  let how = el ? 'selector' : 'none';
  if (!el && labels && labels.length) {
    const wanted = labels.map(norm);
    el = pick(all('li, [role="option"]').filter((e) => wanted.includes(norm(e.textContent))));
    if (el) how = 'label';
  }
  return { el, how };
}

/**
 * Browser-side (self-contained): the control that opens the dropdown holding `item` — the
 * element naming its listbox in aria-controls / aria-owns, else a combobox / listbox-popup
 * button next to it.
 * @param {Element} item
 * @returns {Element|null}
 */
function findLangTrigger(item) {
  const box = item.closest('[role="listbox"]') || item.parentElement;
  if (!box) return null;
  if (box.id) {
    const id = CSS.escape(box.id);
    const t = document.querySelector(`[aria-controls~="${id}"], [aria-owns~="${id}"]`);
    if (t) return t;
  }
  for (let p = box.parentElement, i = 0; p && i < 3; p = p.parentElement, i++) {
    const t = Array.from(p.querySelectorAll('[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="true"]')).find((e) => !box.contains(e));
    if (t) return t;
  }
  return null;
}

/**
 * The caption bar's language state (see {@link readCaptionLangState}).
 * @param {import('playwright-core').Page} page
 * @param {string} [code] also report whether this code's option is aria-selected
 */
function readLangState(page, code) {
  return withTimeout(page.evaluate(readCaptionLangState, {
    comboSels: SEL.captionLangCombobox,
    optionSels: code ? captionLangOptionSelectors(code) : [],
  }), 5000, 'caption language state');
}

/**
 * Exact English label → caption language code (CAPTION_LANG_LABELS), else null.
 * @param {string} text
 */
function codeForLabel(text) {
  const t = normalizeText(text);
  if (!t) return null;
  for (const [code, labels] of Object.entries(CAPTION_LANG_LABELS)) if (labels.includes(t)) return code;
  return null;
}

/**
 * Does the caption bar show `code`? Selected option (data-value or aria-selected on the code's
 * option) first; else the combobox text: `exact` = text equals a label / the code (used before
 * clicking, where a listbox naming another language wins), otherwise contains one (verification).
 * @param {Awaited<ReturnType<typeof readLangState>>|null} st
 * @param {string} code
 * @param {string[]} labels
 * @param {boolean} exact
 */
function showsLang(st, code, labels, exact) {
  if (!st || !st.combobox) return false;
  if (st.selected === code || st.optionSelected) return true;
  const ls = labels.map(normalizeText).filter(Boolean);
  // a selected option without data-value: its label tells
  if (!st.selected && st.selectedText && ls.includes(normalizeText(st.selectedText))) return true;
  // before clicking, a listbox that names another language wins over the combobox text
  if (exact && (st.selected || st.selectedText)) return false;
  const text = normalizeText(st.text);
  if (!text) return false;
  return exact ? text === code || ls.includes(text) : text.includes(code) || ls.some((l) => text.includes(l));
}

/**
 * The current caption ("meeting") language as shown by the caption bar's combobox: the
 * selected option's data-value in its listbox (read even while the listbox is hidden; only
 * when it looks like a language code), else the code whose English label the selected option /
 * combobox shows; null when there is no combobox or nothing can be read. Never throws.
 * @param {import('playwright-core').Page} page
 * @returns {Promise<string|null>}
 */
export async function getCaptionLanguage(page) {
  try {
    const st = await readLangState(page);
    if (!st.combobox) return null;
    // a data-value that is not a BCP-47-like code belongs to some other listbox: not a language
    const selected = st.selected && LANG_CODE_RE.test(st.selected) ? st.selected : null;
    return selected || codeForLabel(st.selectedText) || codeForLabel(st.text) || null;
  } catch {
    return null;
  }
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
 * Path A: the caption bar's "Meeting language" combobox. Already showing `code` → 'already'.
 * Otherwise real clicks: the combobox, then (within OPTION_WAIT_MS) its option for `code` (by
 * data-value, else by English label), then the selection is verified (the option is
 * aria-selected, or the combobox text shows its label / the code). On failure Escape closes
 * the listbox.
 * @param {import('playwright-core').Page} page
 * @param {string} code
 * @param {ReturnType<typeof toLog>} L
 * @returns {Promise<'already'|'ok'|'absent'|'failed'>} absent: no visible combobox
 */
async function setViaCaptionBar(page, code, L) {
  const combo = await until(() => findElement(page, { selectors: SEL.captionLangCombobox }), COMBO_WAIT_MS, 200);
  if (!combo) return 'absent';
  const labels = CAPTION_LANG_LABELS[code] || [];
  let opened = false;
  try {
    const before = await readLangState(page, code);
    if (showsLang(before, code, labels, true)) return 'already';
    opened = true;
    // already open (someone at the bot's window opened it): a click would only close it again
    if (!before.expanded) await humanClick(combo, { timeout: 3000 });
    let byLabel = false;
    const opt = await until(async () => {
      const bySel = await findElement(page, { selectors: captionLangOptionSelectors(code) });
      if (bySel || !labels.length) return bySel;
      const el = await findElement(page, { texts: labels, scope: OPTION_SCOPE });
      byLabel = !!el;
      return el;
    }, OPTION_WAIT_MS);
    if (!opt) throw new Error(`no "${code}" option appeared in the listbox`);
    if (byLabel) L.info(`incall: caption language option found by its label (${labels.join(' / ')})`);
    let label = '';
    try {
      label = normalizeText(await opt.textContent());
      await humanClick(opt, { timeout: 3000 });
    } finally {
      await opt.dispose().catch(() => {});
    }
    const verifyLabels = [...new Set([label, ...labels].filter(Boolean))];
    const verified = await until(async () => showsLang(await readLangState(page, code), code, verifyLabels, false), VERIFY_MS);
    if (!verified) throw new Error('the selection did not take effect');
    return 'ok';
  } catch (err) {
    L.warn(`incall: the caption bar's language picker failed: ${err && err.message}`);
    if (opened) await page.keyboard.press('Escape').catch(() => {});
    return 'failed';
  } finally {
    await combo.dispose().catch(() => {});
  }
}

/**
 * Path B's list item click: a real click when the item is visible; when it is hidden, a real
 * click on its dropdown trigger first, then on the item. Only if it stays hidden (or the real
 * click fails) is it clicked from page script (`el.click()`), the last resort.
 * @param {import('playwright-core').Page} page
 * @param {string} code
 * @param {string[]} labels
 * @param {ReturnType<typeof toLog>} L
 * @returns {Promise<'selector'|'label'|null>} how the item was found; null: not found
 */
async function clickSettingsLangItem(page, code, labels, L) {
  const spec = { selector: SEL.captionLangItem(code), labels, exclude: SEL.captionRegion, comboSels: SEL.captionLangCombobox };
  const locate = async () => {
    const h = await page.evaluateHandle(locateCaptionLangItem, spec);
    try {
      const howH = await h.getProperty('how');
      const how = /** @type {'selector'|'label'|'none'} */ (await howH.jsonValue());
      await howH.dispose().catch(() => {});
      const elh = await h.getProperty('el');
      const el = elh.asElement();
      if (!el) {
        await elh.dispose().catch(() => {});
        return null;
      }
      return { el, how };
    } finally {
      await h.dispose().catch(() => {});
    }
  };
  let item = await until(locate, 3000);
  if (!item) return null;
  const { how } = item;
  try {
    if (!(await item.el.isVisible())) {
      const th = await item.el.evaluateHandle(findLangTrigger);
      const trigger = th.asElement();
      if (trigger) {
        try {
          await humanClick(trigger, { timeout: 3000 });
        } catch (err) {
          L.debug(`incall: opening the caption language dropdown failed: ${err && err.message}`);
        } finally {
          await trigger.dispose().catch(() => {});
        }
        const shown = await until(async () => {
          const x = await locate();
          if (x && (await x.el.isVisible())) return x;
          if (x) await x.el.dispose().catch(() => {});
          return null;
        }, 2000);
        if (shown) {
          await item.el.dispose().catch(() => {});
          item = shown;
        }
      } else {
        await th.dispose().catch(() => {});
      }
    }
    if (await item.el.isVisible()) {
      try {
        await humanClick(item.el, { timeout: 3000 });
        return how;
      } catch (err) {
        L.debug(`incall: real click on the caption language item failed: ${err && err.message}`);
      }
    }
    L.info('incall: caption language item clicked from page script (last resort: it stayed hidden)');
    await item.el.evaluate((el) => /** @type {HTMLElement} */ (el).click());
    return how;
  } finally {
    await item.el.dispose().catch(() => {});
  }
}

/**
 * Set Meet's caption ("meeting") language.
 *
 * Path A (Sep-Oct 2026 Meet): the caption bar's "Meeting language" combobox, see
 * {@link setViaCaptionBar}; a verified selection (or one already showing) → true.
 * Path B, the fallback when there is no combobox or path A failed: More options → Settings →
 * Captions tab → `li[data-value=<code>]` (real clicks; `el.click()` only as the last resort,
 * see {@link clickSettingsLangItem}) → close. Fallbacks (additions to spec 5.9): a `[role=tab]`
 * whose text is "Captions", and a list option whose text is the language's English label
 * (e.g. "Chinese (Mandarin, Traditional)").
 * Failure is non-fatal (logged); the session re-checks it with {@link getCaptionLanguage}.
 * @param {import('playwright-core').Page} page
 * @param {string} code e.g. 'cmn-Hant-TW'
 * @param {{ log?: any }} [opts]
 * @returns {Promise<boolean>} true when path A verified the language, or path B clicked its item
 */
export async function setCaptionLanguage(page, code, { log } = {}) {
  const L = toLog(log);
  const viaBar = await setViaCaptionBar(page, code, L);
  if (viaBar === 'already') {
    L.info(`incall: caption language is already ${code}`);
    return true;
  }
  if (viaBar === 'ok') {
    L.info(`incall: caption language set to ${code} via the caption bar`);
    return true;
  }
  L.info(viaBar === 'absent'
    ? 'incall: no "Meeting language" combobox in the caption bar; using Settings > Captions'
    : 'incall: falling back to Settings > Captions');
  return setViaSettings(page, code, L);
}

/**
 * Path B (the spec's route): More options → Settings → Captions → the language's list item.
 * @param {import('playwright-core').Page} page
 * @param {string} code
 * @param {ReturnType<typeof toLog>} L
 * @returns {Promise<boolean>}
 */
async function setViaSettings(page, code, L) {
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

    const labels = CAPTION_LANG_LABELS[code] || [];
    const how = await clickSettingsLangItem(page, code, labels, L);
    if (!how) throw new Error(`caption language item ${SEL.captionLangItem(code)} not found`);
    if (how === 'label') L.info(`incall: caption language item found by its label (${labels.join(' / ')})`);
    await sleep(300);
    await closeOverlays(page, L);
    dialogOpen = false;
    L.info(`incall: caption language set to ${code} via Settings`);
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
 * @returns {Promise<{ captionsOn: boolean, captionLang: string }>} captionLang: the language the
 *   caption bar shows afterwards ({@link getCaptionLanguage}; may differ from the requested code
 *   when it could not be set), else the requested code when it was set, else 'unknown'
 */
export async function prepareInCall(page, { captionLang, log } = {}) {
  const L = toLog(log);
  await dismissModals(page, { log: L });
  let captionsOn = await ensureCaptions(page, { log: L });
  let lang = 'unknown';
  if (captionLang) {
    const ok = await setCaptionLanguage(page, captionLang, { log: L });
    const shown = await getCaptionLanguage(page);
    if (shown && shown !== captionLang) L.warn(`incall: the caption language reads ${shown}, not ${captionLang}`);
    lang = shown || (ok ? captionLang : 'unknown');
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
