/* Per-child diff: real PM vs guard's scratch PM (same doc, per prior probe).
 * For each index: offsetTop-offsetPM, offsetHeight, text head. Find where
 * the two contexts diverge — that child carries the 30px. */
import { chromium } from 'playwright-core';

const VITE = process.argv[2] ?? 'http://localhost:5199';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

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
for (let i = 0; i < 23; i++) {
  await page.keyboard.type('خط آزمون سرریز برای صفحهٔ ثابت ');
  await page.keyboard.type(String(i));
  await page.keyboard.press('Enter');
}
await page.keyboard.type('واژه');
await page.keyboard.press('Enter');
await wait(300);

const diff = await page.evaluate(() => {
  const walk = (pm) => {
    const out = [];
    let y = 0;
    for (const c of Array.from(pm.children)) {
      const top = c.offsetTop - pm.offsetTop;
      const h = c.offsetHeight;
      out.push({ top, h, bottom: top + h, text: (c.textContent || '').slice(0, 14), tag: c.tagName });
      y = Math.max(y, top + h);
    }
    return { kids: out, bottom: y };
  };
  const realPm = document.querySelector('.document-pages .pn-editor-wrap .ProseMirror');
  const scratchInner = Array.from(document.body.children).find(
    (el) => el.getAttribute?.('aria-hidden') === 'true' && el.querySelector?.('.pn-editor-wrap .ProseMirror'),
  );
  const scratchPm = scratchInner?.querySelector('.ProseMirror');
  const R = walk(realPm);
  const S = scratchPm ? walk(scratchPm) : { kids: [], bottom: -1 };
  const rows = [];
  const n = Math.max(R.kids.length, S.kids.length);
  for (let i = 0; i < n; i++) {
    const r = R.kids[i]; const s = S.kids[i];
    if (!r || !s || r.top !== s.top || r.h !== s.h) {
      rows.push({ i, real: r && { top: r.top, h: r.h, t: r.text }, scratch: s && { top: s.top, h: s.h, t: s.text } });
    }
  }
  const csR = getComputedStyle(realPm);
  const csS = scratchPm ? getComputedStyle(scratchPm) : null;
  return {
    realBottom: R.bottom, scratchBottom: S.bottom,
    realCount: R.kids.length, scratchCount: S.kids.length,
    divergent: rows.slice(0, 8),
    realW: realPm.clientWidth, scratchW: scratchPm?.clientWidth,
    realFont: csR.fontSize + '/' + csR.lineHeight + '/' + csR.fontFamily.slice(0, 24),
    scratchFont: csS ? csS.fontSize + '/' + csS.lineHeight + '/' + csS.fontFamily.slice(0, 24) : null,
    realPmRectTop: Math.round(realPm.getBoundingClientRect().top),
    realFirstKidTop: R.kids[0]?.top,
    scratchFirstKidTop: S.kids[0]?.top,
    realPmOffsetTop: realPm.offsetTop,
    scratchPmOffsetTop: scratchPm?.offsetTop,
  };
});
console.log(JSON.stringify(diff, null, 1));
await browser.close();
