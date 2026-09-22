/* Read the REAL doc JSON via __pn.editors to see if qTitle attr changes when typing */
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

const readMcq = () => page.evaluate(() => {
  const eds = (window).__pn?.editors ?? {};
  for (const id of Object.keys(eds)) {
    const ed = eds[id];
    let found = null;
    ed.state.doc.descendants((n) => { if (!found && n.type.name === 'mcqBlock') found = n; return !found; });
    if (found) return { qTitle: found.attrs.qTitle, options: found.attrs.options, correct: found.attrs.correct };
  }
  return null;
});

await insert('سوال چهارگزینه‌ای');
console.log('after insert:', JSON.stringify(await readMcq()));
const tb = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .edu-title-text').first().boundingBox();
await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
await page.waitForTimeout(250);
await page.keyboard.type('سلام');
await page.waitForTimeout(700);
console.log('after typing سلام:', JSON.stringify(await readMcq()));
// now try selecting all + deleting: does the default text come back?
await page.keyboard.press('Control+a');
await page.keyboard.press('Backspace');
await page.waitForTimeout(600);
console.log('after selectall+delete:', JSON.stringify(await readMcq()));
await browser.close();
