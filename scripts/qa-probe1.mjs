import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(30000);
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CONNECTION') && !m.text().includes('favicon')) errs.push('CONSOLE: ' + m.text().slice(0, 200)); });
page.on('response', (r) => { if (r.status() >= 400 && r.request().method() !== 'GET') errs.push('HTTP ' + r.status() + ' ' + r.request().method() + ' ' + r.url().split('/api/')[1]); });
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
const title = page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .edu-title-text').first();
const tb = await title.boundingBox();
await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
await page.waitForTimeout(250);
await page.keyboard.press('Control+a');
await page.keyboard.type('صورت سوال جدید');
await page.waitForTimeout(500);
const titleNow = await page.evaluate(() => document.querySelector('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .edu-title-text')?.textContent ?? '(gone)');
console.log('1) title after edit:', JSON.stringify(titleNow));

await page.keyboard.press('Enter');
await page.waitForTimeout(400);
const afterEnter = await page.evaluate(() => {
  const pm = [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb'));
  const mcq = pm.querySelector('.edu-mcq');
  const sel = window.getSelection();
  return { mcqAlive: !!mcq, caretInside: !!(sel?.anchorNode && mcq?.contains(sel.anchorNode)), pmText: pm.textContent.slice(0, 60) };
});
console.log('2) after Enter:', JSON.stringify(afterEnter));

// duplicate via contextual tab
await page.evaluate(() => { [...document.querySelectorAll('[data-ribbon-root] button')].find((b) => (b.textContent ?? '').includes('کادر آموزشی'))?.click(); });
await page.waitForTimeout(450);
const dupBtn = await page.locator('button[title="تکثیر بلوک"]').first().boundingBox().catch(() => null);
if (dupBtn) {
  await page.mouse.click(dupBtn.x + dupBtn.width / 2, dupBtn.y + dupBtn.height / 2);
  await page.waitForTimeout(800);
  const n = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb')).querySelectorAll('.edu-mcq').length);
  console.log('3) MCQ count after duplicate:', n);
} else console.log('3) duplicate button NOT FOUND');

// delete second MCQ: click its title first (real), then حذف
const mcqs = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .edu-title-text').all();
if (mcqs.length > 1) {
  const b2 = await mcqs[1].boundingBox();
  await page.mouse.click(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.waitForTimeout(400);
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'حذف')?.click(); });
  await page.waitForTimeout(600);
}
const n2 = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb')).querySelectorAll('.edu-mcq').length);
console.log('4) MCQ count after delete:', n2);

await page.waitForTimeout(4500);
console.log('errors:', errs.slice(0, 6).join(' || ') || 'none');
await browser.close();
