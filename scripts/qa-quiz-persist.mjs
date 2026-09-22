/* Print-parity + persistence: reload the page and compare editor HTML vs export path (docJsonToHtml) */
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
let box = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .quiz-opt-text').first().boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.keyboard.type('مریخ');
const num = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .quiz-opt-num').nth(2).boundingBox();
await page.mouse.click(num.x + num.width / 2, num.y + num.height / 2);
await page.waitForTimeout(600);
// switch variant to v3 for parity check
await page.evaluate(() => { [...document.querySelectorAll('[data-ribbon-root] button')].find((b) => (b.textContent ?? '').includes('کادر آموزشی'))?.click(); });
await page.waitForTimeout(450);
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'امتحانی')?.click(); });
await page.waitForTimeout(600);

// wait for autosave
await page.waitForTimeout(3000);
// RELOAD — does everything persist?
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.ProseMirror', { timeout: 60000 });
await page.waitForTimeout(2500);
const after = await page.evaluate(() => {
  const m = [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb'))?.querySelector('.edu-mcq');
  if (!m) return null;
  return {
    qv: m.getAttribute('data-qv'),
    correct: [...m.querySelectorAll('.quiz-opt')].map((r) => r.getAttribute('data-correct')).join(','),
    opt0: m.querySelectorAll('.quiz-opt-text')[0].textContent,
  };
});
console.log('after reload:', JSON.stringify(after));

// print-parity: run the export serializer on the doc and compare wrapper attrs
const parity = await page.evaluate(async () => {
  const mod = await import('/src/utils/staticSchema.ts');
  const edEl = [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb'));
  // editor JSON lives in the store; approximate: grab the note via DOM? Use editor view from element
  return null;
}).catch(() => 'static-import-failed');
console.log('parity hook:', parity);
await browser.close();
