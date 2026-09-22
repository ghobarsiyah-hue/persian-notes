import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(30000);
await page.goto('http://[::1]:5173/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('input[type="email"]', { timeout: 60000 });
await page.fill('input[type="email"]', 'demo@pernote.local');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await page.waitForTimeout(3500);
await page.goto('http://[::1]:5173/editor/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.ProseMirror', { timeout: 60000 });
await page.waitForTimeout(1500);
await page.locator('.ProseMirror').first().click();

const clickText = (txt) => page.evaluate((t) => {
  const leaf = Array.from(document.querySelectorAll('*')).filter((el) => el.children.length === 0).find((el) => (el.textContent ?? '').trim() === t);
  if (!leaf) return false;
  let host = leaf;
  while (host && host !== document.body && host.tagName !== 'BUTTON') host = host.parentElement;
  const target = host && host.tagName === 'BUTTON' ? host : leaf;
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  target.click();
  return true;
}, txt);

await clickText('افزودن'); await page.waitForTimeout(300);
await clickText('سوال'); await page.waitForTimeout(400);
await clickText('سوال تشریحی'); await page.waitForTimeout(1200);
const essayBody = page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-longanswer .edu-body').first();
const eb = await essayBody.boundingBox();
if (eb) { await page.mouse.click(eb.x + eb.width / 2, eb.y + 12); await page.waitForTimeout(600); }

// REAL click on the کادر آموزشی contextual chip
const chip = page.locator('[data-ribbon-root] button', { hasText: 'کادر آموزشی' }).first();
const cb = await chip.boundingBox();
console.log('chip box:', JSON.stringify(cb));
if (cb) {
  await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.waitForTimeout(600);
  // after the tab opens, real-click امتحانی
  const v3btn = page.locator('button', { hasText: 'امتحانی' }).first();
  const vb = await v3btn.boundingBox().catch(() => null);
  console.log('امتحانی box:', JSON.stringify(vb));
  if (vb) {
    await page.mouse.click(vb.x + vb.width / 2, vb.y + vb.height / 2);
    await page.waitForTimeout(700);
  }
}
const qv = await page.evaluate(() => {
  const mainPm = [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb'));
  return mainPm.querySelector('.edu-longanswer')?.getAttribute('data-qv');
});
console.log('essay qv:', qv);
await browser.close();
