import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { installCaptionObserver } from '../../src/page/caption-observer.js';
import { CaptionAssembler } from '../../src/captions/assembler.js';

// Use the shared selectors when another module already provides them; otherwise fall back to the
// spec's caption selector lists. The observer itself only uses what is passed in.
const selectorsUrl = new URL('../../src/meet/selectors.js', import.meta.url);
const INLINE_SEL = {
  captionRegion: ['[role="region"][aria-label="Captions"]', 'div[role="region"][tabindex="0"]', '.vNKgIf'],
  captionBlock: '.nMcdL',
  captionSpeaker: '.NWpY1d',
  captionText: '.ygicle',
};
const SEL_SOURCE = existsSync(selectorsUrl) ? (await import(selectorsUrl.href)).SEL : INLINE_SEL;
/** serializable copy (functions such as captionLangItem are dropped) */
const SEL = JSON.parse(JSON.stringify(SEL_SOURCE, (_k, v) => (typeof v === 'function' ? undefined : v)));

const FIXTURE = new URL('../fixtures/captions/meet-captions.html', import.meta.url).href;
const CONTROL_WORDS = /Jump to bottom|Chinese \(Mandarin|arrow_drop_down|arrow_downward/;

/** @type {import('playwright-core').Browser} */
let browser;

before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});

after(async () => {
  await browser?.close();
});

/**
 * Open the fixture in a fresh page with a payload collector.
 * @param {{ install?: boolean, sel?: object }} [opts]
 */
async function open({ install = true, sel = SEL } = {}) {
  const page = await browser.newPage();
  /** @type {any[]} */
  const payloads = [];
  await page.exposeFunction('__omCaptions', (p) => {
    payloads.push(p);
  });
  await page.goto(FIXTURE);
  if (install) await page.evaluate(installCaptionObserver, sel);
  return { page, payloads };
}

/**
 * Wait for the first payload at index >= from that satisfies pred.
 * @param {any[]} payloads @param {(p: any) => boolean} pred @param {number} [from] @param {number} [timeout]
 */
async function waitFor(payloads, pred, from = 0, timeout = 5000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    for (let i = from; i < payloads.length; i++) if (pred(payloads[i])) return payloads[i];
    if (Date.now() > deadline) {
      throw new Error(`timed out; last payloads: ${JSON.stringify(payloads.slice(-3))}`);
    }
    await sleep(25);
  }
}

const texts = (p) => (p.blocks || []).map((b) => b.text);
const lastBlocks = (payloads) => payloads[payloads.length - 1].blocks;

describe('installCaptionObserver (headless Chrome, fixture DOM)', () => {
  test('reports caption blocks with speaker and text and ignores the region controls', async () => {
    const { page, payloads } = await open();
    try {
      const p = await waitFor(payloads, (x) => Array.isArray(x.blocks) && x.blocks.length > 0);
      assert.equal(typeof p.ts, 'number');
      assert.ok(Math.abs(p.ts - Date.now()) < 60_000);
      assert.equal(p.region, true);
      assert.deepEqual(
        p.blocks.map(({ speaker, text }) => ({ speaker, text })),
        [
          { speaker: '王小明', text: '大家好，今天我們來討論新版本的上線時間' },
          { speaker: 'Arthur Wang', text: '好的，我先review一下' },
        ],
      );
      for (const b of p.blocks) {
        assert.ok(b.id !== undefined && b.id !== null && String(b.id) !== '', 'block has an id');
        assert.doesNotMatch(b.text, CONTROL_WORDS);
        assert.doesNotMatch(b.speaker, CONTROL_WORDS);
      }
      assert.notEqual(p.blocks[0].id, p.blocks[1].id);
      // ids are recorded on the elements themselves
      const domIds = await page.$$eval('.nMcdL', (els) => els.map((el) => el.dataset.omId));
      assert.deepEqual(domIds, p.blocks.map((b) => String(b.id)));
    } finally {
      await page.close();
    }
  });

  test('ids stay stable through text revisions, span splits and characterData edits; new blocks get new ids', async () => {
    const { page, payloads } = await open();
    try {
      const first = await waitFor(payloads, (x) => x.blocks?.length === 2);
      const [id1, id2] = first.blocks.map((b) => b.id);

      // revise the newest block's text (textContent replacement)
      let from = payloads.length;
      await page.evaluate(() => {
        document.querySelectorAll('.nMcdL .ygicle')[1].textContent = '好的，我先review一下再回覆';
      });
      let p = await waitFor(payloads, (x) => texts(x).includes('好的，我先review一下再回覆'), from);
      assert.deepEqual(p.blocks.map((b) => b.id), [id1, id2]);

      // split the text into several spans (no whitespace between them, like Meet)
      from = payloads.length;
      await page.evaluate(() => {
        document.querySelectorAll('.nMcdL .ygicle')[1].innerHTML = '<span>好的，</span><span>我先review</span><span>一下吧</span>';
      });
      p = await waitFor(payloads, (x) => texts(x).includes('好的，我先review一下吧'), from);
      assert.deepEqual(p.blocks.map((b) => b.id), [id1, id2]);

      // characterData-only mutation
      from = payloads.length;
      await page.evaluate(() => {
        const span = document.querySelectorAll('.nMcdL .ygicle')[1].lastChild;
        span.firstChild.data = '一下吧，謝謝';
      });
      p = await waitFor(payloads, (x) => texts(x).includes('好的，我先review一下吧，謝謝'), from);
      assert.deepEqual(p.blocks.map((b) => b.id), [id1, id2]);

      // a new caption block is appended before the trailing controls
      from = payloads.length;
      await page.evaluate(() => {
        const region = document.querySelector('[role="region"][aria-label="Captions"]');
        const blocks = region.querySelectorAll('.nMcdL');
        const clone = blocks[0].cloneNode(true);
        delete clone.dataset.omId;
        clone.querySelector('.NWpY1d').textContent = 'Lisa Chen';
        clone.querySelector('img').alt = 'Lisa Chen';
        clone.querySelector('.ygicle').textContent = '我補充一點';
        blocks[blocks.length - 1].after(clone);
      });
      p = await waitFor(payloads, (x) => x.blocks?.length === 3, from);
      assert.deepEqual(p.blocks.map((b) => b.speaker), ['王小明', 'Arthur Wang', 'Lisa Chen']);
      assert.equal(p.blocks[2].text, '我補充一點');
      assert.equal(p.blocks[0].id, id1);
      assert.equal(p.blocks[1].id, id2);
      assert.ok(![id1, id2].includes(p.blocks[2].id), 'new element gets a new id');
    } finally {
      await page.close();
    }
  });

  test('removed blocks disappear from the payload', async () => {
    const { page, payloads } = await open();
    try {
      const first = await waitFor(payloads, (x) => x.blocks?.length === 2);
      const from = payloads.length;
      await page.evaluate(() => document.querySelector('.nMcdL').remove());
      const p = await waitFor(payloads, (x) => x.blocks?.length === 1, from);
      assert.equal(p.blocks[0].id, first.blocks[1].id);
      assert.equal(p.blocks[0].speaker, 'Arthur Wang');
    } finally {
      await page.close();
    }
  });

  test('is idempotent: a second install does not add a second observer', async () => {
    const { page, payloads } = await open();
    try {
      await waitFor(payloads, (x) => x.blocks?.length === 2);
      const before = await page.evaluate(() => !!window.__omCaptionObserver);
      assert.ok(before, 'window.__omCaptionObserver is set');
      await page.evaluate(installCaptionObserver, SEL);
      await sleep(400);
      const from = payloads.length;
      await page.evaluate(() => {
        document.querySelectorAll('.nMcdL .ygicle')[0].textContent = '大家好，今天我們來討論新版本的上線時間跟流程';
      });
      await sleep(900);
      const hits = payloads.slice(from).filter((x) => texts(x).includes('大家好，今天我們來討論新版本的上線時間跟流程'));
      assert.equal(hits.length, 1, 'exactly one payload for one edit');
    } finally {
      await page.close();
    }
  });

  test('throttles bursts of mutations and always delivers the latest text', async () => {
    const { page, payloads } = await open();
    try {
      await waitFor(payloads, (x) => x.blocks?.length === 2);
      const from = payloads.length;
      await page.evaluate(async () => {
        const el = document.querySelectorAll('.nMcdL .ygicle')[1];
        for (let i = 1; i <= 20; i++) {
          el.textContent = '好的'.padEnd(2 + i, '嗯');
          await new Promise((r) => setTimeout(r, 15));
        }
      });
      const final = '好的'.padEnd(22, '嗯');
      await waitFor(payloads, (x) => texts(x).includes(final), from);
      await sleep(300);
      const n = payloads.length - from;
      assert.ok(n >= 1 && n <= 4, `expected a throttled handful of payloads, got ${n}`);
      assert.deepEqual(texts(payloads[payloads.length - 1])[1], final);
    } finally {
      await page.close();
    }
  });

  test('reports region:false while the region is missing and re-attaches to a replacement region', async () => {
    const { page, payloads } = await open();
    try {
      const first = await waitFor(payloads, (x) => x.blocks?.length === 2);
      const oldIds = first.blocks.map((b) => b.id);

      // captions toggled off: Meet removes the whole region
      let from = payloads.length;
      await page.evaluate(() => {
        window.__savedRegionHtml = document.querySelector('[role="region"][aria-label="Captions"]').outerHTML;
        document.querySelector('[role="region"][aria-label="Captions"]').remove();
      });
      const missing = await waitFor(payloads, (x) => x.region === false, from, 4000);
      assert.equal(missing.blocks, null);
      assert.equal(typeof missing.ts, 'number');

      // captions back on / language changed: a brand-new region element with fresh blocks
      from = payloads.length;
      await page.evaluate(() => {
        const holder = document.createElement('div');
        holder.innerHTML = window.__savedRegionHtml;
        const region = holder.firstElementChild;
        region.querySelectorAll('.nMcdL').forEach((el) => delete el.dataset.omId);
        const blocks = region.querySelectorAll('.nMcdL');
        blocks[1].remove();
        blocks[0].querySelector('.ygicle').textContent = '換成中文字幕了';
        document.querySelector('.a4cQT').appendChild(region);
      });
      const back = await waitFor(payloads, (x) => x.region === true && texts(x).includes('換成中文字幕了'), from, 4000);
      assert.equal(back.blocks.length, 1);
      assert.equal(back.blocks[0].speaker, '王小明');
      assert.ok(!oldIds.includes(back.blocks[0].id), 'blocks in the new region get new ids');

      // the observer now watches the new region
      from = payloads.length;
      await page.evaluate(() => {
        document.querySelector('[role="region"][aria-label="Captions"] .ygicle').textContent = '換成中文字幕了，大家看得到嗎';
      });
      const edited = await waitFor(payloads, (x) => texts(x).includes('換成中文字幕了，大家看得到嗎'), from, 2000);
      assert.equal(edited.blocks[0].id, back.blocks[0].id);
    } finally {
      await page.close();
    }
  });

  test('installed before captions exist: reports region:false, then picks the region up', async () => {
    const { page, payloads } = await open({ install: false });
    try {
      await page.evaluate(() => {
        window.__savedRegionHtml = document.querySelector('[role="region"][aria-label="Captions"]').outerHTML;
        document.querySelector('[role="region"][aria-label="Captions"]').remove();
      });
      await page.evaluate(installCaptionObserver, SEL);
      const missing = await waitFor(payloads, (x) => x.region === false, 0, 3000);
      assert.equal(missing.blocks, null);
      const from = payloads.length;
      await page.evaluate(() => {
        document.querySelector('.a4cQT').insertAdjacentHTML('beforeend', window.__savedRegionHtml);
      });
      const p = await waitFor(payloads, (x) => x.blocks?.length === 2, from, 4000);
      assert.deepEqual(p.blocks.map((b) => b.speaker), ['王小明', 'Arthur Wang']);
    } finally {
      await page.close();
    }
  });

  test('falls back to region children when the block/speaker/text selectors no longer match', async () => {
    const sel = { ...SEL, captionBlock: '.no-such-block', captionSpeaker: '.no-such-speaker', captionText: '.no-such-text' };
    const { page, payloads } = await open({ sel });
    try {
      const p = await waitFor(payloads, (x) => x.blocks?.length > 0);
      assert.deepEqual(
        p.blocks.map(({ speaker, text }) => ({ speaker, text })),
        [
          { speaker: '王小明', text: '大家好，今天我們來討論新版本的上線時間' },
          { speaker: 'Arthur Wang', text: '好的，我先review一下' },
        ],
      );
    } finally {
      await page.close();
    }
  });

  test('end to end: payloads from a Meet-like caption timeline assemble into the expected utterances', async () => {
    const { page, payloads } = await open({ install: false });
    try {
      // start with an empty caption region (controls only), like right after captions are turned on
      await page.evaluate(() => {
        window.__tpl = document.querySelector('.nMcdL').cloneNode(true);
        document.querySelectorAll('.nMcdL').forEach((el) => el.remove());
      });
      await page.evaluate(installCaptionObserver, SEL);
      await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const region = document.querySelector('[role="region"][aria-label="Captions"]');
        const controls = region.querySelector('.IMKgW');
        const make = (name, text) => {
          const el = window.__tpl.cloneNode(true);
          el.querySelector('.NWpY1d').textContent = name;
          el.querySelector('img').alt = name;
          el.querySelector('.ygicle').textContent = text;
          return el;
        };
        const a = make('王小明', '今天我們');
        region.insertBefore(a, controls);
        for (const t of ['今天我們來討論新版本的上限', '今天我們來討論新版本的上限時間', '今天我們來討論新版本的上線時間']) {
          await wait(300);
          a.querySelector('.ygicle').textContent = t;
        }
        await wait(300);
        const b = make('Arthur Wang', '好的');
        region.insertBefore(b, controls);
        await wait(300);
        b.querySelector('.ygicle').innerHTML = '<span>好的，</span><span>我先review一下</span>';
        await wait(300);
        // Meet re-renders the row as a new element continuing the same text
        const b2 = make('Arthur Wang', '好的，我先review一下再回覆');
        b.replaceWith(b2);
        await wait(300);
        // silence: Meet clears the captions
        a.remove();
        b2.remove();
        await wait(400);
      });
      await waitFor(payloads, (x) => texts(x).includes('好的，我先review一下再回覆'), 0, 3000);
      const rerender = payloads.findIndex((x) => texts(x).includes('好的，我先review一下再回覆'));
      await waitFor(payloads, (x) => Array.isArray(x.blocks) && x.blocks.length === 0, rerender + 1, 3000);

      const asm = new CaptionAssembler();
      const out = [];
      for (const p of payloads) out.push(...asm.update(p.blocks, p.ts));
      out.push(...asm.flush(payloads[payloads.length - 1].ts + 5000));
      assert.deepEqual(
        out.map(({ speaker, text }) => ({ speaker, text })),
        [
          { speaker: '王小明', text: '今天我們來討論新版本的上線時間' },
          { speaker: 'Arthur Wang', text: '好的，我先review一下再回覆' },
        ],
      );
      assert.ok(out[0].startMs <= out[0].endMs && out[0].endMs <= out[1].startMs);
    } finally {
      await page.close();
    }
  });

  test('stop() disconnects and allows a clean re-install', async () => {
    const { page, payloads } = await open();
    try {
      await waitFor(payloads, (x) => x.blocks?.length === 2);
      const idsBefore = lastBlocks(payloads).map((b) => b.id);
      await page.evaluate(() => window.__omCaptionObserver.stop());
      assert.equal(await page.evaluate(() => typeof window.__omCaptionObserver), 'undefined');
      let from = payloads.length;
      await page.evaluate(() => {
        document.querySelectorAll('.nMcdL .ygicle')[0].textContent = '停止之後的修改';
      });
      await sleep(600);
      assert.equal(payloads.length, from, 'no payloads after stop()');
      await page.evaluate(installCaptionObserver, SEL);
      from = 0;
      const p = await waitFor(payloads, (x) => texts(x).includes('停止之後的修改'), from);
      assert.deepEqual(p.blocks.map((b) => b.id), idsBefore, 'element ids survive a re-install');
    } finally {
      await page.close();
    }
  });
});
