/* THE missing piece: does the NodeView UPDATE() get called when PM re-renders due to the DOM mutation it parsed? Actually: does PM parse the title DOM mutation into a doc change (setting TEXT inside the block)? Track doc changes. */
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
await page.evaluate(() => {
  const eds = (window).__pn?.editors ?? {};
  const ed = Object.values(eds)[0];
  window.__trLog = [];
  ed.on('transaction', ({ transaction }) => {
    if (transaction.docChanged) window.__trLog.push(JSON.stringify(transaction.steps.map((s) => s.toJSON())).slice(0, 200));
  });
});
const tb = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .edu-title-text').first().boundingBox();
await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
await page.keyboard.type('اب');
await page.waitForTimeout(700);
const out = await page.evaluate(() => ({
  log: window.__trLog,
  docText: (() => { const eds = (window).__pn?.editors ?? {}; const ed = Object.values(eds)[0]; let t = ''; ed.state.doc.descendants((n) => { if (n.isText && n.text) t += n.text; return true; }); return t; })(),
}));
console.log(JSON.stringify(out, null, 1));
await browser.close();
