/**
 * Browser-side caption observer. Passed to `page.evaluate(installCaptionObserver, SEL)`, so it
 * MUST stay fully self-contained: no imports, no references to module scope, all inputs as
 * parameters.
 * @module page/caption-observer
 */

/**
 * @typedef {object} CaptionPayload
 * @property {number} ts                 Date.now() in the page
 * @property {{ id: string, speaker: string, text: string }[] | null} blocks   null while the region is missing
 * @property {boolean} region            false while no caption region is found
 */

/**
 * Watch Meet's caption region and report its blocks to `window.__omCaptions(payload)`.
 *
 * - Idempotent: a second call while installed does nothing (`window.__omCaptionObserver`,
 *   which also exposes `stop()` and `check()`).
 * - Region = first hit of `SEL.captionRegion` (selectors tried in order).
 * - MutationObserver `{ childList, subtree, characterData }`, throttled to one report per
 *   200 ms; identical consecutive reports are skipped.
 * - Blocks: elements matching `SEL.captionBlock` inside the region, or (if none match) the
 *   region's children that have text and are not controls (buttons such as the caption
 *   language/settings button and "Jump to bottom"). Per block: `id` = `el.dataset.omId`
 *   (assigned on first sight from an incrementing integer seeded with Date.now(), so ids are
 *   unique across page reloads), `speaker` = `SEL.captionSpeaker` text || first child's text
 *   if < 60 chars || avatar `img[alt]` || '', `text` = `SEL.captionText` textContent ||
 *   textContent minus the speaker. Whitespace is collapsed. Blocks with empty text are skipped.
 * - Every 2 s the region is re-resolved: a missing/disconnected/replaced region is re-attached;
 *   while none is found `{ ts, blocks: null, region: false }` is reported.
 * @param {{ captionRegion?: string|string[], captionBlock?: string|string[],
 *   captionSpeaker?: string|string[], captionText?: string|string[] }} SEL serializable selectors
 * @returns {void}
 */
export function installCaptionObserver(SEL) {
  const w = /** @type {any} */ (window);
  if (w.__omCaptionObserver) return;

  const THROTTLE_MS = 200;
  const CHECK_MS = 2000;
  const sel = SEL || {};
  /** @param {unknown} v @returns {string[]} */
  const list = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s) : typeof v === 'string' && v ? [v] : []);
  const regionSels = list(sel.captionRegion);
  const blockSels = list(sel.captionBlock);
  const speakerSels = list(sel.captionSpeaker);
  const textSels = list(sel.captionText);
  const CONTROL = 'button,[role="button"],[role="toolbar"],[role="menu"],[role="listbox"]';

  /** @param {unknown} s */
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  /** @param {ParentNode} root @param {string[]} sels @returns {Element|null} */
  const first = (root, sels) => {
    for (const s of sels) {
      try {
        const el = root.querySelector(s);
        if (el) return el;
      } catch {
        // invalid selector: try the next one
      }
    }
    return null;
  };

  /** @param {Element} el */
  const isControl = (el) => {
    try {
      if (el.matches(CONTROL) || el.getAttribute('aria-hidden') === 'true') return true;
      return !first(el, textSels) && !!el.querySelector(CONTROL);
    } catch {
      return false;
    }
  };

  let nextId = Date.now();
  /** @param {HTMLElement} el */
  const idOf = (el) => {
    if (!el.dataset.omId) el.dataset.omId = String(nextId++);
    return el.dataset.omId;
  };

  /** @param {Element} region @returns {Element[]} */
  const blockElements = (region) => {
    for (const s of blockSels) {
      /** @type {Element[]} */
      let found = [];
      try {
        found = Array.from(region.querySelectorAll(s));
      } catch {
        continue;
      }
      if (found.length) {
        // drop nested matches and anything that is itself a control
        return found.filter((el) => !el.matches(CONTROL) && !found.some((o) => o !== el && o.contains(el)));
      }
    }
    return Array.from(region.children).filter((el) => !isControl(el));
  };

  /** @param {Element} region */
  const collect = (region) => {
    /** @type {{ id: string, speaker: string, text: string }[]} */
    const blocks = [];
    for (const el of blockElements(region)) {
      const full = clean(el.textContent);
      if (!full) continue;
      let speaker = clean(first(el, speakerSels)?.textContent);
      if (!speaker && el.children.length >= 2) {
        const t = clean(el.children[0].textContent);
        if (t && t.length < 60) speaker = t;
      }
      if (!speaker) {
        const img = el.querySelector('img[alt]');
        const alt = clean(img && img.getAttribute('alt'));
        if (alt && alt.length < 60) speaker = alt;
      }
      const textEl = first(el, textSels);
      let text;
      if (textEl) text = clean(textEl.textContent);
      else if (speaker && full.startsWith(speaker)) text = full.slice(speaker.length).trim();
      else text = full;
      if (!text) continue;
      blocks.push({ id: idOf(/** @type {HTMLElement} */ (el)), speaker, text });
    }
    return blocks;
  };

  /** @param {object} payload */
  const send = (payload) => {
    try {
      const fn = w.__omCaptions;
      if (typeof fn !== 'function') return;
      const r = fn(payload);
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch {
      // the binding may be gone (page closing): ignore
    }
  };

  const findRegion = () => first(document, regionSels);

  const state = {
    /** @type {Element|null} */ region: null,
    /** @type {MutationObserver|null} */ observer: null,
    /** @type {ReturnType<typeof setTimeout>|null} */ timer: null,
    /** @type {ReturnType<typeof setInterval>|null} */ interval: null,
    /** @type {string|null} */ lastKey: null,
  };

  /** @param {boolean} force */
  const emit = (force) => {
    const region = state.region;
    if (!region || !region.isConnected) return;
    const blocks = collect(region);
    const key = JSON.stringify(blocks);
    if (!force && key === state.lastKey) return;
    state.lastKey = key;
    send({ ts: Date.now(), blocks, region: true });
  };

  const schedule = () => {
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      emit(false);
    }, THROTTLE_MS);
  };

  const detach = () => {
    if (state.observer) state.observer.disconnect();
    state.observer = null;
    state.region = null;
    state.lastKey = null;
  };

  /** @param {Element} region */
  const attach = (region) => {
    detach();
    state.region = region;
    state.observer = new MutationObserver(schedule);
    state.observer.observe(region, { childList: true, subtree: true, characterData: true });
    emit(true);
  };

  const check = () => {
    const found = findRegion();
    if (found) {
      if (found !== state.region || !state.observer || !found.isConnected) attach(found);
      return;
    }
    detach();
    send({ ts: Date.now(), blocks: null, region: false });
  };

  const stop = () => {
    if (state.interval) clearInterval(state.interval);
    if (state.timer) clearTimeout(state.timer);
    state.interval = null;
    state.timer = null;
    detach();
    if (w.__omCaptionObserver === api) delete w.__omCaptionObserver;
  };

  const api = { stop, check, emit: () => emit(true) };
  w.__omCaptionObserver = api;
  state.interval = setInterval(check, CHECK_MS);
  check();
}
