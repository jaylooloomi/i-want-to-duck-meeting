// Live caption region + scripted caption timeline player.
//
// The region mirrors Meet's caption DOM:
//   div[role=region][aria-label=Captions][tabindex=0].vNKgIf.UDinHf
//     div.nMcdL                                    one block per speaker turn
//       div.adE6rb > img.Z6byG[alt=name] + div.KcIKyf.jxFHg > span.NWpY1d (name)
//       div.ygicle.VbkSUe                          text (a text node, or several <span>s)
//     div.caption-lang-picker                      trailing controls, not captions:
//       div[role=combobox][aria-label="Meeting language"]  current language label (Sep-Oct 2026 Meet)
//       ul[role=listbox] > li[role=option][data-value][aria-selected]  hidden until the combobox is clicked
//       (langpicker=settings: a plain button showing the current language instead)
//     button "Jump to bottom"
import { h, icon, avatarUrl } from './dom.js';
import { MAX_BLOCKS } from './timeline.js';

/** Speech is only captioned correctly in this language; anything else shows GIBBERISH. */
export const TARGET_LANG = 'cmn-Hant-TW';
export const GIBBERISH = '(english captions)';

/** Caption languages offered in Settings > Captions > Meeting language. */
export const CAPTION_LANGUAGES = [
  ['en-US', 'English'],
  ['cmn-Hant-TW', 'Chinese (Mandarin, Traditional)'],
  ['cmn-Hans-CN', 'Chinese (Mandarin, Simplified)'],
  ['ja-JP', 'Japanese'],
  ['ko-KR', 'Korean'],
  ['es-MX', 'Spanish (Mexico)'],
  ['fr-FR', 'French'],
  ['de-DE', 'German'],
];

/** @param {string} code */
export function languageName(code) {
  return CAPTION_LANGUAGES.find(([c]) => c === code)?.[1] ?? code;
}

/**
 * The caption languages a list offers under `langList` (see config.js): 'missing' drops
 * TARGET_LANG; 'nodatavalue' is applied by the list builders (items without data-value).
 * @param {string} langList
 */
export function offeredLanguages(langList) {
  return CAPTION_LANGUAGES.filter(([code]) => !(langList === 'missing' && code === TARGET_LANG));
}

const TICK_MS = 40;
const LIST_ID = 'mock-caption-lang-listbox';

/**
 * The caption bar's "Meeting language" picker: a combobox and its listbox (hidden until the
 * combobox is clicked). Only trusted (real mouse) clicks open it or pick an option, so tests
 * prove the bot clicks like a user. Escape or a click elsewhere closes it.
 * @param {{ state: any, langList: string, onChoose: (code: string) => void, log: (type: string, detail?: unknown) => void }} o
 */
function createLangCombobox({ state, langList, onChoose, log }) {
  const label = h('span', { class: 'caption-lang-label' }, languageName(state.captionLang));
  const combo = h('div', {
    role: 'combobox',
    'aria-label': 'Meeting language',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    'aria-controls': LIST_ID,
    tabindex: '0',
    class: 'caption-lang',
  }, label, icon('down'));
  const options = offeredLanguages(langList).map(([code, name]) => h('li', {
    role: 'option',
    'data-value': langList === 'nodatavalue' ? null : code,
    'data-code': code,
    'aria-selected': String(code === state.captionLang),
    class: 'caption-lang-option',
    onClick: (/** @type {MouseEvent} */ event) => {
      if (!event.isTrusted) return log('caption_lang_picker', 'untrusted option click ignored');
      setOpen(false);
      onChoose(code);
    },
  }, name));
  const list = h('ul', { role: 'listbox', id: LIST_ID, class: 'caption-lang-list', style: 'display: none' }, options);
  const el = h('div', { class: 'caption-lang-picker' }, combo, list);

  const isOpen = () => list.style.display !== 'none';
  function setOpen(open) {
    if (open === isOpen()) return;
    if (open) {
      // fixed position just above the combobox, so the region's layout never clips it
      const r = combo.getBoundingClientRect();
      list.style.left = `${Math.round(r.left)}px`;
      list.style.bottom = `${Math.round(window.innerHeight - r.top + 4)}px`;
    }
    list.style.display = open ? 'block' : 'none';
    combo.setAttribute('aria-expanded', String(open));
    log('caption_lang_picker', open ? 'opened' : 'closed');
  }
  combo.addEventListener('click', (event) => {
    if (!event.isTrusted) return log('caption_lang_picker', 'untrusted combobox click ignored');
    setOpen(!isOpen());
  });
  const onDocumentClick = (/** @type {MouseEvent} */ event) => {
    if (isOpen() && !el.contains(/** @type {Node} */ (event.target))) setOpen(false);
  };
  const onKeyDown = (/** @type {KeyboardEvent} */ event) => {
    if (event.key === 'Escape' && isOpen()) setOpen(false);
  };
  document.addEventListener('click', onDocumentClick, true);
  document.addEventListener('keydown', onKeyDown, true);

  return {
    el,
    /** Show `code` as the current language. @param {string} code */
    sync(code) {
      label.textContent = languageName(code);
      for (const li of options) li.setAttribute('aria-selected', String(li.dataset.code === code));
    },
    destroy() {
      document.removeEventListener('click', onDocumentClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
    },
  };
}

/** langpicker=settings: the caption bar only shows the language on a plain button. */
function createLangButton({ state }) {
  const el = h('button', { type: 'button', class: 'caption-lang' }, languageName(state.captionLang));
  return {
    el,
    /** @param {string} code */
    sync(code) {
      el.textContent = languageName(code);
    },
    destroy() {},
  };
}

/**
 * Create the caption region and start the timeline clock. The clock only runs while
 * `state.captionsOn`; speech starts once captions are on AND (the caption language is
 * TARGET_LANG, or captions have been on for `leadMs`).
 * @param {{ state: any, timeline: readonly import('./timeline.js').CaptionStep[], stepScale: number,
 *           leadMs: number, onDone: () => void, log: (type: string, detail?: unknown) => void,
 *           langPicker?: 'combobox'|'settings'|'both', langList?: string }} o
 */
export function createCaptions({ state, timeline, stepScale, leadMs, onDone, log, langPicker = 'both', langList = '' }) {
  const picker = langPicker === 'settings'
    ? createLangButton({ state })
    : createLangCombobox({ state, langList, log, onChoose: (code) => setLanguage(code, 'combobox') });
  const langControl = picker.el;
  const jumpButton = h('button', { type: 'button', class: 'caption-jump', 'aria-label': 'Jump to bottom' }, icon('arrowDown'), 'Jump to bottom');
  const region = h('div', { role: 'region', 'aria-label': 'Captions', tabindex: '0', class: 'vNKgIf UDinHf' }, langControl, jumpButton);

  /** @typedef {{ speaker: string, text: string, spans: boolean, el: HTMLElement, textEl: HTMLElement }} Block */
  /** @type {Block[]} */
  const blocks = [];
  /** @type {HTMLElement | null} */
  let host = null;
  let clock = 0; // ms of captions-on time
  /** @type {number | null} */
  let speechStart = null; // clock value when speech started
  let next = 0; // index of the next timeline step
  let lastTick = performance.now();
  const timer = setInterval(tick, TICK_MS);

  function tick() {
    const now = performance.now();
    const dt = now - lastTick;
    lastTick = now;
    if (!state.captionsOn || state.timelineDone) return;
    clock += dt;
    if (speechStart === null) {
      if (state.captionLang !== TARGET_LANG && clock < leadMs) return;
      speechStart = clock;
      state.speechStarted = true;
      log('speech_started', state.captionLang);
    }
    const t = clock - speechStart;
    while (next < timeline.length && timeline[next].atMs * stepScale <= t) apply(timeline[next++]);
    if (next >= timeline.length) {
      state.timelineDone = true;
      log('timeline_done');
      onDone();
    }
  }

  /** @param {import('./timeline.js').CaptionStep} step */
  function apply(step) {
    const index = blocks.findLastIndex((b) => b.speaker === step.speaker);
    const fresh = () => buildBlock(step.speaker, step.text, !!step.spans);
    if (step.op === 'new' || index < 0) {
      const block = fresh();
      region.insertBefore(block.el, langControl);
      blocks.push(block);
      while (blocks.length > MAX_BLOCKS) blocks.shift()?.el.remove(); // Meet trims old rows
    } else if (step.op === 'set') {
      blocks[index].text = step.text;
      blocks[index].spans = !!step.spans;
      renderText(blocks[index]);
    } else {
      const block = fresh(); // 'rerender': a brand-new element replaces the old one
      blocks[index].el.replaceWith(block.el);
      blocks[index] = block;
    }
    state.stepIndex = next;
    state.rendered.push({ op: step.op, speaker: step.speaker, text: shown(step.text) });
  }

  /** @returns {Block} */
  function buildBlock(speaker, text, spans) {
    const textEl = h('div', { class: 'ygicle VbkSUe' });
    const el = h('div', { class: 'nMcdL bj4p3b' },
      h('div', { class: 'adE6rb M6cG9d' },
        h('img', { class: 'Z6byG r6DyN', alt: speaker, src: avatarUrl(speaker) }),
        h('div', { class: 'KcIKyf jxFHg' }, h('span', { class: 'NWpY1d' }, speaker)),
      ),
      textEl,
    );
    const block = { speaker, text, spans, el, textEl };
    renderText(block);
    return block;
  }

  /** What the viewer sees for a spoken text in the current caption language. */
  function shown(text) {
    return state.captionLang === TARGET_LANG ? text : GIBBERISH;
  }

  /** @param {Block} block */
  function renderText(block) {
    const text = shown(block.text);
    const parts = block.spans ? text.split(/(?<=[，。？！,.?!])/).filter(Boolean) : [text];
    const node = block.textEl;
    if (parts.length === 1 && node.childNodes.length === 1 && node.firstChild?.nodeType === Node.TEXT_NODE) {
      if (node.firstChild.data !== text) node.firstChild.data = text; // characterData mutation
    } else {
      node.replaceChildren(...(parts.length === 1 ? [text] : parts.map((p) => h('span', {}, p))));
    }
  }

  /**
   * Switch the caption language and log `caption_language` { code, via }. Visible blocks
   * re-render in the new language unless `rerender` is false (a switch made by Meet / another
   * participant leaves the captions already on screen as they are).
   * @param {string} code
   * @param {'settings'|'combobox'|'reset'} [via]
   * @param {{ rerender?: boolean }} [opts]
   */
  function setLanguage(code, via = 'settings', { rerender = true } = {}) {
    state.captionLang = code;
    state.captionLangVia = via;
    picker.sync(code);
    if (rerender) blocks.forEach(renderText);
    log('caption_language', { code, via });
  }

  return {
    region,
    /** Where the region is attached while captions are on. @param {HTMLElement} el */
    mount(el) {
      host = el;
      if (state.captionsOn) host.append(region);
    },
    /** Show (attach) or hide (detach) the region; the timeline only advances while shown. */
    setVisible(on) {
      if (on && host) host.append(region);
      else region.remove();
    },
    setLanguage,
    destroy() {
      clearInterval(timer);
      picker.destroy();
      region.remove();
    },
  };
}
