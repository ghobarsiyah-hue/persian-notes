/* duplicate/delete with NODE selection + caret placement after Enter */
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
const insert = async (item) => { await clickText('افزودن'); await page.waitForTimeout(300); await clickText('سوال'); await page.waitForTimeout(450); await clickText(item); await page.waitForTimeout(1100); };

await insert('سوال چهارگزینه‌ای');
// click title (caret inside title span), then duplicate from tab
const tb = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .edu-title-text').first().boundingBox();
await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
await page.waitForTimeout(300);
await page.evaluate(() => { [...document.querySelectorAll('[data-ribbon-root] button')].find((b) => (b.textContent ?? '').includes('کادر آموزشی'))?.click(); });
await page.waitForTimeout(450);
const dup = await page.locator('button[title="تکثیر بلوک"]').first().boundingBox();
await page.mouse.click(dup.x + dup.width / 2, dup.y + dup.height / 2);
await page.waitForTimeout(800);
const n = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb')).querySelectorAll('.edu-mcq').length);
console.log('MCQ count after duplicate (caret in title):', n);
// where is caret after duplicate? does the duplicate have options?
const dupInfo = await page.evaluate(() => {
  const pm = [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb'));
  const list = pm.querySelectorAll('.edu-mcq');
  const last = list[list.length - 1];
  return { count: list.length, lastHasOpts: !!last?.querySelector('.quiz-opts'), lastTitle: last?.querySelector('.edu-title-text')?.textContent };
});
console.log('dup info:', JSON.stringify(dupInfo));
await browser.close();
