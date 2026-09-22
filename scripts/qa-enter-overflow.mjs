/* Catch the Enter-step overflow WITH the guard's own verdict:
 * after each keystroke dump window.__pnGuardLast {h,limit,size}. The step
 * where the REAL bottom crosses limit but the guard recorded fits = proof. */
import { chromium } from 'playwright-core';

const VITE = process.argv[2] ?? 'http://localhost:5199';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto(VITE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[type="email"]', 'demo@pernote.local');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await sleep(1500);
await page.goto(VITE + '/editor/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
await sleep(2500);
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
  return { limit: Math.round(wrap.clientHeight), bottom: Math.round(bottom), last: window.__pnGuardLast ?? null };
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
console.log(`filled ${i} lines: limit=${g.limit} bottom=${g.bottom} free=${free}`);
console.log('--- typing past the boundary (Enter-separated words) ---');

for (let k = 0; k < 10; k++) {
  await page.keyboard.type('واژه');
  await page.keyboard.press('Enter');
  await sleep(120);
  const gg = await geo();
  const over = gg.bottom - gg.limit;
  console.log(`step ${k}: real over=${over}px bottom=${gg.bottom} guardLast=${JSON.stringify(gg.last)}`);
  if (over > 4) { console.log(`>>> REPRODUCED at step ${k}`); break; }
}
await browser.close();
