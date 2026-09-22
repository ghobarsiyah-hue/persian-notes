/* Title-edit isolation: after typing in MCQ title, what are node attrs (read the saved title from thumbnail static render) */
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
const liveSel = '.ProseMirror:not(.pn-page-thumb *)';

await insert('سوال چهارگزینه‌ای');
const tb = await page.locator(`${liveSel} .edu-mcq .edu-title-text`).first().boundingBox();
await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
await page.waitForTimeout(250);
await page.keyboard.type('سلام');
await page.waitForTimeout(600);
// title span textContent vs attr truth (thumb is static renderHTML from attrs? thumbs may be live editors too)
const probe = await page.evaluate(() => {
  const live = document.querySelector('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .edu-title-text');
  const thumbs = [...document.querySelectorAll('.pn-page-thumb .edu-mcq .edu-title-text')].map((t) => t.textContent);
  return { liveText: live?.textContent, thumbs, thumbIsEditor: !!document.querySelector('.pn-page-thumb .ProseMirror') };
});
console.log(JSON.stringify(probe, null, 1));
await page.waitForTimeout(3500);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.ProseMirror', { timeout: 60000 });
await page.waitForTimeout(2500);
const after = await page.evaluate(() => document.querySelector('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .edu-title-text')?.textContent ?? '(none)');
console.log('after reload:', JSON.stringify(after));
await browser.close();
