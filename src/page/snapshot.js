/**
 * Browser-side page snapshot for the state classifier (src/meet/state.js).
 *
 * `collectSnapshot` is serialized by Playwright and run inside the page, so it MUST stay fully
 * self-contained: no imports, no references to module scope, every helper defined inside.
 * @module page/snapshot
 */

/**
 * Collect everything `classify()` needs from the current page.
 *
 * Call forms (page.evaluate passes a single argument, so all are accepted):
 *   page.evaluate(collectSnapshot, [serializableSel(), TEXT])
 *   page.evaluate(collectSnapshot, { SEL: serializableSel(), TEXT })
 *   collectSnapshot(serializableSel(), TEXT)
 *
 * "Visible" = connected, no `aria-hidden="true"` on itself/ancestors, computed
 * `visibility` not hidden/collapse, `display` not none, and it has client rects.
 *
 * @param {Record<string, any> | [Record<string, any>, Record<string, string[]>] | { SEL: Record<string, any>, TEXT: Record<string, string[]> }} SEL_SERIALIZABLE
 *   `serializableSel()` from src/meet/selectors.js (or one of the packed forms above)
 * @param {Record<string, string[]>} [TEXT] `TEXT` from src/meet/selectors.js
 * @returns {{
 *   url: string, text: string, nameInputVisible: boolean, ctaTexts: string[],
 *   leaveButton: boolean, captionsOn: boolean | null, captionRegion: boolean,
 *   participantTiles: number, selfName: boolean, participantCount: number | null,
 *   bodyEmpty: boolean, micOn: boolean, camOn: boolean,
 * }} micOn / camOn (additions to spec 5.6): a "Turn off microphone/camera" toggle is visible,
 *   i.e. the bot's microphone/camera is ON.
 */
export function collectSnapshot(SEL_SERIALIZABLE, TEXT) {
  const MAX_TEXT = 20000;
  const PREVIEW_TILE_TEXT = 'Backgrounds and effects';

  /** @type {any} */ let sel = SEL_SERIALIZABLE;
  /** @type {any} */ let text = TEXT;
  if (text === undefined || text === null) {
    if (Array.isArray(sel)) {
      text = sel[1];
      sel = sel[0];
    } else if (sel && typeof sel === 'object' && ('SEL' in sel || 'TEXT' in sel)) {
      text = sel.TEXT;
      sel = sel.SEL;
    }
  }
  sel = sel && typeof sel === 'object' ? sel : {};
  text = text && typeof text === 'object' ? text : {};

  /** Same rules as normalizeText() in src/meet/selectors.js. */
  const norm = (/** @type {unknown} */ s) => (s === null || s === undefined ? '' : String(s))
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/[‘’‛ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  const asList = (/** @type {unknown} */ v) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]);

  /** Elements matching any selector of a list, in list order, deduped; bad selectors skipped. */
  const queryAll = (/** @type {unknown} */ selectors) => {
    /** @type {Set<Element>} */
    const out = new Set();
    for (const s of asList(selectors)) {
      if (typeof s !== 'string' || !s.trim()) continue;
      try {
        for (const el of document.querySelectorAll(s)) out.add(el);
      } catch {
        // invalid selector: ignore
      }
    }
    return [...out];
  };

  const isVisible = (/** @type {Element} */ el) => {
    if (!el || !el.isConnected) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    return el.getClientRects().length > 0;
  };

  const anyVisible = (/** @type {unknown} */ selectors) => queryAll(selectors).some(isVisible);

  const innerTextOf = (/** @type {Element} */ el) => {
    const t = /** @type {HTMLElement} */ (el).innerText;
    return typeof t === 'string' ? t : el.textContent || '';
  };
  // Match join.js's button text semantics. Material icon ligatures are visible
  // to innerText even when aria-hidden, so they must not become part of a CTA.
  const buttonText = (el) => {
    let out='';
    const walk=node=>{
      for(const child of node.childNodes) {
        if(child.nodeType===3) out+=child.data;
        else if(child.nodeType===1 && child.getAttribute('aria-hidden')!=='true'
          && !['SCRIPT','STYLE'].includes(child.tagName)) {
          out+=' ';walk(child);out+=' ';
        }
      }
    };
    walk(el);return norm(out);
  };

  // --- text (caption region excluded: spoken words must not look like Meet UI text) ---
  const body = document.body;
  const rawBodyText = body ? innerTextOf(body) : '';
  let pageText = norm(rawBodyText);
  const region = queryAll(sel.captionRegion).find(isVisible);
  if (region && pageText) {
    const regionText = norm(innerTextOf(region));
    const idx = regionText ? pageText.indexOf(regionText) : -1;
    if (idx >= 0) pageText = norm(`${pageText.slice(0, idx)} ${pageText.slice(idx + regionText.length)}`);
  }
  if (pageText.length > MAX_TEXT) pageText = pageText.slice(0, MAX_TEXT);

  // --- visible join CTA buttons (exact text equality, so 'Ask to join again' is not a CTA) ---
  const ctaEntries = asList(text.joinCtas).filter((e) => typeof e === 'string' && norm(e));
  const ctaNorm = ctaEntries.map(norm);
  /** @type {string[]} */
  const ctaTexts = [];
  if (ctaEntries.length) {
    for (const b of document.querySelectorAll('button, [role="button"]')) {
      const rough = norm(b.textContent);
      if (!rough || !ctaNorm.some((c) => rough.includes(c))) continue; // cheap pre-filter
      if (!isVisible(b)) continue;
      const readable=buttonText(b);
      const idx = ctaNorm.findIndex(c=>c===readable || c===norm(innerTextOf(b)));
      if (idx >= 0 && !ctaTexts.includes(ctaEntries[idx])) ctaTexts.push(ctaEntries[idx]);
    }
  }

  // --- captions button state ---
  /** @type {boolean | null} */
  let captionsOn = null;
  if (anyVisible(sel.captionsTurnOff)) captionsOn = true;
  else if (anyVisible(sel.captionsTurnOn)) captionsOn = false;

  // --- participant tiles (self preview excluded; nested tiles counted once) ---
  const tiles = queryAll(sel.participantTile).filter((el) => isVisible(el)
    && !norm(el.textContent).includes(PREVIEW_TILE_TEXT)
    && !el.querySelector(`[aria-label*="${PREVIEW_TILE_TEXT}"]`));
  const tileSet = new Set(tiles);
  const participantTiles = tiles.filter((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (tileSet.has(p)) return false;
    return true;
  }).length;

  // --- participant count: [data-avatar-count] attr, else People button label ---
  const parseCount = (/** @type {unknown} */ v) => {
    const m = /(\d+)/.exec(v === null || v === undefined ? '' : String(v));
    return m ? parseInt(m[1], 10) : null;
  };
  const visibleFirst = (/** @type {Element[]} */ els) => [...els.filter(isVisible), ...els.filter((e) => !isVisible(e))];
  /** @type {number | null} */
  let participantCount = null;
  const avatarAttr = (asList(sel.avatarCount).map((s) => /\[([\w-]+)/.exec(String(s))).find(Boolean) || [])[1]
    || 'data-avatar-count';
  for (const el of visibleFirst(queryAll(sel.avatarCount))) {
    const n = parseCount(el.getAttribute(avatarAttr));
    if (n !== null) { participantCount = n; break; }
  }
  if (participantCount === null) {
    for (const el of visibleFirst(queryAll(sel.peopleButton))) {
      const n = parseCount(el.getAttribute('aria-label')) ?? parseCount(innerTextOf(el));
      if (n !== null) { participantCount = n; break; }
    }
  }

  return {
    url: String(location.href),
    text: pageText,
    nameInputVisible: anyVisible(sel.nameInput),
    ctaTexts,
    leaveButton: anyVisible(sel.leave),
    captionsOn,
    captionRegion: anyVisible(sel.captionRegion),
    participantTiles,
    selfName: anyVisible(sel.selfName),
    participantCount,
    bodyEmpty: rawBodyText.trim().length < 5,
    micOn: anyVisible(sel.micOff),
    camOn: anyVisible(sel.camOff),
  };
}
