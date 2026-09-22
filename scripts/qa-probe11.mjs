/* Does blur or another later event wipe it? Wait longer + click body. */
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
const tb = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .edu-title-text').first().boundingBox();
await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
await page.keyboard.type('اب');
await page.waitForTimeout(1500);
let state = await page.evaluate(() => document.querySelector('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .edu-title-text').textContent);
console.log('t+1500:', JSON.stringify(state));
// click into body — blur fires; sync() should dispatch
const body = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .edu-body').first().boundingBox();
await page.mouse.click(body.x + body.width / 2, body.y + body.height / 2);
await page.waitForTimeout(800);
const attrs = await page.evaluate(() => {
  const eds = (window).__pn?.editors ?? {};
  const ed = Object.values(eds)[0];
  let f = null; ed.state.doc.descendants((n) => { if (!f && n.type.name === 'mcqBlock') f = n; return !f; });
  const span = document.querySelector('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .edu-title-text');
  return { attr: f?.attrs.qTitle, dom: span?.textContent };
});
console.log('after body click (blur):', JSON.stringify(attrs));
await browser.close();
