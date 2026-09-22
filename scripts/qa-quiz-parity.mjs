/* PRINT PARITY v3: compare LIVE page DOM vs static re-render of the LIVE editor's JSON.
   The editor JSON is reachable via the page element's __tiptap instance? Simplest reliable
   route: intercept the autosave PATCH payload (page content JSON) and feed it to docJsonToHtml. */
import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(30000);
let savedJson = null;
await page.goto('http://[::1]:5173/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('input[type="email"]', { timeout: 60000 });
await page.fill('input[type="email"]', 'demo@pernote.local');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await page.waitForTimeout(3500);
// capture autosave payloads
page.on('request', (req) => {
  if (req.method() === 'PATCH' && req.url().includes('/api/notes/')) {
    try { const b = req.postDataJSON(); if (b?.content) savedJson = b.content; } catch {}
  }
});
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
let box = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .quiz-opt-text').first().boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.keyboard.type('مریخ');
const num = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .quiz-opt-num').nth(1).boundingBox();
await page.mouse.click(num.x + num.width / 2, num.y + num.height / 2);
await page.waitForTimeout(400);
await page.evaluate(() => { [...document.querySelectorAll('[data-ribbon-root] button')].find((b) => (b.textContent ?? '').includes('کادر آموزشی'))?.click(); });
await page.waitForTimeout(400);
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '۲×۲')?.click(); });
await page.waitForTimeout(400);
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'امتحانی')?.click(); });
await page.waitForTimeout(600);
await page.waitForTimeout(4500); // let autosave fire

if (!savedJson) { console.log('no autosave payload captured'); await browser.close(); process.exit(1); }
const stat = await page.evaluate(async (j) => {
  const { docJsonToHtml } = await import('/src/utils/staticSchema.ts');
  // savedJson is the full content {doc, floats?} — pass its doc
  return docJsonToHtml(j?.doc ?? j);
}, savedJson);
const live = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb')).innerHTML);
const grab = (h) => /<div[^>]*data-type="mcq"[^>]*>/.exec(h)?.[0] ?? '(missing)';
console.log('LIVE :', grab(live));
console.log('PRINT:', grab(stat));
const opt = (h) => (h.match(/data-correct="true"/g) ?? []).length;
const txt = (h) => h.includes('مریخ');
console.log('PARITY correct-mark:', opt(live) === opt(stat) ? `OK (${opt(live)})` : `MISMATCH live=${opt(live)} print=${opt(stat)}`);
console.log('PARITY option-text:', txt(live) === txt(stat) ? 'OK' : 'MISMATCH');
await browser.close();
