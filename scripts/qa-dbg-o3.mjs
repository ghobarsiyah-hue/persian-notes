/* Isolated O3: resize works standalone? + does top-center+10 grab the ROTATION handle? */
import { chromium } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://[::1]:5199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.setDefaultTimeout(45000);
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 160)));

await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('input[type="email"]', { timeout: 30000 });
await page.fill('input[type="email"]', 'demo@pernote.local');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await page.waitForTimeout(1500);
await page.goto(`${BASE}/editor/new`, { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
await page.waitForTimeout(2500);

const addTab = page.locator('[data-ribbon-root] button', { hasText: 'افزودن' }).first();
if (await addTab.count()) { await addTab.click(); await page.waitForTimeout(200); }
const shapeBtn = await page.$('[data-ribbon-root] button[title*="شکل‌ها"]');
await shapeBtn.click();
await page.waitForTimeout(220);
const item = page.locator('body > .pn-glass-panel').filter({ hasText: 'مستطیل' }).first();
await item.locator('text=مستطیل').first().click();
await page.waitForTimeout(600);

/* select the object */
const c = await page.evaluate(() => {
  const el = document.querySelector('.document-pages .page-paper [data-float-id]');
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.click(c.x, c.y);
await page.waitForTimeout(300);

/* what's at top-center+10? (the O3 probe's first grab point) */
const topCenter = await page.evaluate(() => {
  const el = document.querySelector('[data-float-id]');
  const r = el.getBoundingClientRect();
  const el2 = document.elementFromPoint(r.left + r.width / 2, r.top + 10);
  return {
    tag: el2?.tagName,
    w: el2?.offsetWidth,
    isHandle: el2 ? el2.offsetWidth <= 12 : null,
    style: el2?.getAttribute('style')?.slice(0, 90),
  };
});
console.log('top-center+10 element:', JSON.stringify(topCenter));

/* ── mimic the suite: O2-style deep drag first (top-center grab, 8 moves of -80,-90) ── */
const seq = await page.evaluate(() => {
  const el = document.querySelector('[data-float-id]');
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + 10, px: el.offsetLeft, py: el.offsetTop };
});
await page.mouse.move(seq.x, seq.y);
await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(seq.x - i * 80, seq.y - i * 90);
await page.mouse.up();
await page.waitForTimeout(200);
const afterDrag = await page.evaluate(() => {
  const el = document.querySelector('[data-float-id]');
  return { px: el.offsetLeft, py: el.offsetTop, w: el.offsetWidth, transformed: el.style.transform };
});
console.log('after-O2-drag:', JSON.stringify(afterDrag));

/* resize via SE handle */
const se = await page.evaluate(() => {
  const el = document.querySelector('[data-float-id]');
  const handles = [...document.querySelectorAll('[data-float-id]')].filter((n) => n !== el && n.offsetWidth <= 12);
  const cand = handles.find((n) => Math.abs(n.offsetLeft + n.offsetWidth - (el.offsetLeft + el.offsetWidth)) < 8 &&
                                Math.abs(n.offsetTop + n.offsetHeight - (el.offsetTop + el.offsetHeight)) < 8);
  if (!cand) return null;
  const r = cand.getBoundingClientRect();
  return { x: r.left + 5, y: r.top + 5, w: el.offsetWidth, h: el.offsetHeight };
});
console.log('se-handle:', JSON.stringify(se));
if (se) {
  await page.mouse.move(se.x, se.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(se.x + i * 60, se.y + i * 60);
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => {
    const el = document.querySelector('[data-float-id]');
    return { w: el.offsetWidth, h: el.offsetHeight };
  });
  console.log('after-resize:', JSON.stringify(after), 'grew:', after.w > se.w);
}
await browser.close();
