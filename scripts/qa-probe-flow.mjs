/**
 * Engine-state probe — types enough to overflow page 1, then dumps the
 * pagination engine's view of the world via window.__flowDbg (set in
 * runAutoFlow) plus raw measurements. Tells us whether findOverflowSplit
 * sees overflow, whether a move is computed, and whether it is applied.
 */
import { chromium } from 'playwright-core';

const VITE = process.argv[2] ?? 'http://localhost:5174';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

await page.goto(`${VITE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('input[type="email"]', { timeout: 30000 });
await page.fill('input[type="email"]', 'demo@pernote.local');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await sleep(1500);

await page.goto(`${VITE}/editor/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
await sleep(2500);

/* enable the engine's own debug channel BEFORE typing */
await page.evaluate(() => {
  window.__layoutDebug = true;
  window.__flowDbg = null;
});
await page.evaluate(() => {
  const el = document.querySelector('.document-pages .page-paper .pn-editor');
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + 40;
  const target = document.elementFromPoint(cx, cy) ?? el;
  for (const type of ['mousedown', 'mouseup', 'click']) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
  }
  el.focus();
});
await sleep(300);

const LINE = 'تایپ پیوسته برای عبور از انتهای برگه اول. ';
let maxPmH = 0;
for (let i = 0; i < 220; i++) {
  await page.keyboard.type(LINE, { delay: 5 });
  if (i % 20 === 19) {
    const probe = await page.evaluate(() => {
      const ed = document.querySelector('.document-pages .page-paper .pn-editor');
      return { pmH: ed?.offsetHeight ?? 0, pages: document.querySelectorAll('.document-pages .page-paper').length };
    });
    maxPmH = Math.max(maxPmH, probe.pmH);
    if (probe.pages >= 2) break;
  }
  await sleep(60);
}
await sleep(2500);

const state = await page.evaluate(() => {
  const papers = Array.from(document.querySelectorAll('.document-pages .page-paper'));
  return {
    pageCount: papers.length,
    flowDbg: window.__flowDbg ?? null,
    perPage: papers.map((p) => {
      const ed = p.querySelector('.pn-editor');
      const wrap = p.querySelector('.pn-editor-wrap');
      return {
        id: p.getAttribute('data-page-id')?.slice(-4),
        paperH: p.offsetHeight,
        pmH: ed?.offsetHeight ?? null,
        wrapH: wrap?.clientHeight ?? null,
        text: ed?.textContent?.length ?? 0,
        zoom: getComputedStyle(p.parentElement).zoom,
      };
    }),
  };
});
console.log(JSON.stringify(state, null, 2));

/* keep the console traces: the [LAYOUT]/[SPLIT]/[PAGE] channel is ON */
page.on('console', (msg) => {
  const t = msg.text();
  if (t.startsWith('[LAYOUT]') || t.startsWith('[SPLIT]') || t.startsWith('[PAGE]') || t.startsWith('[WIDOW]')) {
    console.log(t);
  }
});
await browser.close();
