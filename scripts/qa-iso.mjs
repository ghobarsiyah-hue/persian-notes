import { chromium } from 'playwright-core';
const BASE = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(30000);
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERR: ' + e.message.slice(0, 200)));
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
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('input[type="email"]', { timeout: 60000 });
await page.fill('input[type="email"]', 'demo@pernote.local');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await page.waitForTimeout(3500);
await page.goto(`${BASE}/editor/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.ProseMirror', { timeout: 60000 });
await page.waitForTimeout(1800);
await page.locator('.ProseMirror').first().click();

// insert TF
await clickText('افزودن'); await page.waitForTimeout(400);
await clickText('سوال'); await page.waitForTimeout(500);
console.log('menu items with سوال:', await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => (b.textContent ?? '').trim()).filter(t => t.includes('سوال')).slice(0, 8)));
console.log('insert TF ok:', await clickText('سوال درست / نادرست'));
await page.waitForTimeout(1200);
await page.keyboard.type('زمین گرد است.');
await page.waitForTimeout(300);
const s1 = await page.evaluate(() => {
  const w = document.querySelector('.edu-truefalse');
  return { found: !!w, cls: w?.className?.slice(0, 80), buttons: Array.from(w?.querySelectorAll('button') ?? []).map(b => (b.textContent ?? '').trim()).slice(0, 6) };
});
console.log('tf state:', JSON.stringify(s1));
const b = await page.evaluate(() => {
  const w = document.querySelector('.edu-truefalse');
  const btn = w?.querySelector('.quiz-tf-true');
  if (!btn) return 'no-btn';
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  btn.click();
  return 'clicked:' + (btn.textContent ?? '').trim();
});
await page.waitForTimeout(700);
const s2 = await page.evaluate(() => {
  const w = document.querySelector('.edu-truefalse');
  return { da: w?.getAttribute('data-answer'), rowDa: w?.querySelector('.quiz-tf-row')?.getAttribute('data-answer') };
});
console.log(b, JSON.stringify(s2));
errs.slice(0, 6).forEach(e => console.log(e));
await browser.close();
