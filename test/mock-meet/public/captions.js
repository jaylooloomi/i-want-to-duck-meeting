// Live caption region + scripted caption timeline player.
//
// The region mirrors Meet's caption DOM:
//   div[role=region][aria-label=Captions][tabindex=0].vNKgIf.UDinHf
//     div.nMcdL                                    one block per speaker turn
//       div.adE6rb > img.Z6byG[alt=name] + div.KcIKyf.jxFHg > span.NWpY1d (name)
//       div.ygicle.VbkSUe                          text (a text node, or several <span>s)
//     button (current caption language)            trailing controls, not captions
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

const TICK_MS = 40;

/**
 * Create the caption region and start the timeline clock. The clock only runs while
 * `state.captionsOn`; speech starts once captions are on AND (the caption language is
 * TARGET_LANG, or captions have been on for `leadMs`).
 * @param {{ state: any, timeline: readonly import('./timeline.js').CaptionStep[], stepScale: number,
 *           leadMs: number, onDone: () => void, log: (type: string, detail?: unknown) => void }} o
 */
export function createCaptions({ state, timeline, stepScale, leadMs, onDone, log }) {
  const langButton = h('button', { type: 'button', class: 'caption-lang' }, languageName(state.captionLang));
  const jumpButton = h('button', { type: 'button', class: 'caption-jump', 'aria-label': 'Jump to bottom' }, icon('arrowDown'), 'Jump to bottom');
  const region = h('div', { role: 'region', 'aria-label': 'Captions', tabindex: '0', class: 'vNKgIf UDinHf' }, langButton, jumpButton);

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
      region.insertBefore(block.el, langButton);
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
    /** Switch the caption language; visible blocks re-render in the new language. @param {string} code */
    setLanguage(code) {
      state.captionLang = code;
      langButton.textContent = languageName(code);
      blocks.forEach(renderText);
      log('caption_language', code);
    },
    destroy() {
      clearInterval(timer);
      region.remove();
    },
  };
}
