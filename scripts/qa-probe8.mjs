/* Instrument the actual sync closure: monkey-patch dispatch to log setNodeMarkup on mcq; also log getPos result. */
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
// patch dispatch to log transactions with setNodeMarkup steps
await page.evaluate(() => {
  const eds = (window).__pn?.editors ?? {};
  const ed = Object.values(eds)[0];
  window.__log = [];
  const orig = ed.view.dispatch.bind(ed.view);
  ed.view.dispatch = (tr) => {
    for (const step of tr.steps) {
      const j = step.toJSON();
      window.__log.push(['step', j.stepType, JSON.stringify(j).slice(0, 120)]);
    }
    orig(tr);
  };
});
const tb = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .edu-title-text').first().boundingBox();
await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
await page.keyboard.type('اب');
await page.waitForTimeout(600);
const log = await page.evaluate(() => window.__log);
console.log('dispatch log:', JSON.stringify(log.slice(0, 8)));
await browser.close();
