/* Near-bottom typing timing (§26 critical boundary): fill to free≈60px,
 * then time 40 consecutive chars (mixed accept/reject) and report
 * ms/char + guard path mix. Compare vs the 5.7ms/char full-page figure. */
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

/* fill to free ≈ 60px */
let g = await geo();
while (g.limit - g.bottom > 60) {
  await page.keyboard.type('خط آزمون برای زمان‌بندی نزدیک مرز پایین صفحه ');
  await page.keyboard.press('Enter');
  g = await geo();
}
console.log(`near-bottom: free=${g.limit - g.bottom}px`);

const s0 = await page.evaluate(() => ({ ...window.__pnGuardStats }));
const t0 = Date.now();
for (let k = 0; k < 40; k++) await page.keyboard.type('ا');
const wall = Date.now() - t0;
const s1 = await page.evaluate(() => ({ ...window.__pnGuardStats }));
const d = {};
for (const k of new Set([...Object.keys(s0), ...Object.keys(s1)])) d[k] = (s1[k] || 0) - (s0[k] || 0);
console.log(`40 chars in ${wall}ms = ${(wall / 40).toFixed(1)}ms/char`);
console.log('guard paths:', JSON.stringify(d));
const gg = await geo();
console.log(`after: over=${gg.bottom - gg.limit}px (must be ≤4)`);

/* headroom typing timing for comparison (empty page) */
await page.keyboard.press('Control+End');
const t1 = Date.now();
for (let k = 0; k < 100; k++) await page.keyboard.type('ب');
const wall2 = Date.now() - t1;
console.log(`100 chars on near-full-but-accepting page: ${(wall2 / 100).toFixed(1)}ms/char`);
await browser.close();
