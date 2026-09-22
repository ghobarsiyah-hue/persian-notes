/* Compare: typing into CALLOUT title vs MCQ title */
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
await clickText('کادر آموزشی'); await page.waitForTimeout(450);
await clickText('تعریف'); await page.waitForTimeout(1100);
const tb = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-block.edu-callout .edu-title-text, .ProseMirror:not(.pn-page-thumb *) .edu-definition .edu-title-text').first().boundingBox().catch(async () => {
  return page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-block .edu-title-text').first().boundingBox();
});
await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
await page.keyboard.type('اب');
await page.waitForTimeout(700);
const r = await page.evaluate(() => {
  const eds = (window).__pn?.editors ?? {};
  const ed = Object.values(eds)[0];
  let f = null; ed.state.doc.descendants((n) => { if (!f && n.type.name === 'calloutBlock') f = n; return !f; });
  return { title: f?.attrs.title };
});
console.log('callout title attr:', JSON.stringify(r));
await browser.close();
