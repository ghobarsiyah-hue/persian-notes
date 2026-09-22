/* Decisive: WHY does the scratch render an empty trailing <p> as 0-height
 * while the real editor gives it a 32px line box?
 * Hypothesis: ProseMirror appends <br class="ProseMirror-trailingBreak"> to
 * empty textblocks for the caret — but ONLY in an EDITABLE view. The guard's
 * scratch view may be non-editable → no <br> → 0 height → 30px under-measure.
 * Probe: after the repro, compare the real PM's empty trailing p (innerHTML,
 * offsetHeight) with the guard's scratch container (body > [aria-hidden],
 * left:-10000px) rendering the same doc.
 */
import { chromium } from 'playwright-core';

const VITE = process.argv[2] ?? 'http://localhost:5199';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto(VITE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[type="email"]', 'demo@pernote.local');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await wait(1500);
await page.goto(VITE + '/editor/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
await wait(2500);
await page.evaluate(() => { window.__layoutDebug = true; });

await page.evaluate(() => { document.querySelector('.document-pages .pn-editor').focus(); });
await page.keyboard.press('Control+a');
await page.keyboard.type('شروع');

const geo = () => page.evaluate(() => {
  const wrap = document.querySelector('.document-pages .pn-editor-wrap');
  const pm = wrap.querySelector('.ProseMirror');
  const zoom = parseFloat(getComputedStyle(wrap).zoom || '1') || 1;
  const wRect = wrap.getBoundingClientRect();
  let bottom = 0;
  pm.querySelectorAll(':scope > *').forEach((c) => {
    const b = (c.getBoundingClientRect().bottom - wRect.top) / zoom;
    if (b > bottom) bottom = b;
  });
  return { limit: Math.round(wrap.clientHeight), bottom: Math.round(bottom) };
});

let g = await geo();
let free = g.limit - g.bottom;
let i = 0;
while (i < 400 && free > 130) {
  await page.keyboard.type('خط آزمون سرریز برای صفحهٔ ثابت ');
  await page.keyboard.type(String(i));
  await page.keyboard.press('Enter');
  g = await geo();
  free = g.limit - g.bottom;
  i++;
}

/* push past the boundary with Enter steps until visible overflow */
for (let k = 0; k < 5; k++) {
  await page.keyboard.type('واژه');
  await page.keyboard.press('Enter');
  await wait(120);
  const gg = await geo();
  if (gg.bottom - gg.limit > 4) { console.log(`reproduced at step ${k}: over=${gg.bottom - gg.limit}px`); break; }
}

const dis = await page.evaluate(() => {
  const realPm = document.querySelector('.document-pages .pn-editor-wrap .ProseMirror');
  const realLast = realPm.lastElementChild;
  /* the guard's scratch container: aria-hidden, off-screen, .pn-editor-wrap inside */
  const scratchInner = Array.from(document.body.children).find(
    (el) => el.getAttribute?.('aria-hidden') === 'true' && el.querySelector?.('.pn-editor-wrap .ProseMirror'),
  );
  const scratchPm = scratchInner?.querySelector('.ProseMirror') ?? null;
  const info = (pm, label) => {
    if (!pm) return { label, present: false };
    const last = pm.lastElementChild;
    return {
      label,
      present: true,
      lastTag: last?.tagName,
      lastHtml: last?.innerHTML?.slice(0, 120),
      lastH: last?.offsetHeight,
      lastIsEditableAttr: pm.isContentEditable,
      pmEditableProp: pm.getAttribute('contenteditable'),
      childCount: pm.children.length,
      hasTrailingBreak: !!last?.querySelector('br.ProseMirror-trailingBreak') || !!last?.querySelector('br'),
    };
  };
  const sReal = info(realPm, 'real');
  const sScratch = info(scratchPm, 'scratch');
  /* also: what does the scratch's last child measure vs the real's? */
  return { real: sReal, scratch: sScratch, realPmTextLen: realPm.textContent.length, scratchPmTextLen: scratchPm?.textContent.length ?? -1 };
});
console.log(JSON.stringify(dis, null, 1));
await browser.close();
