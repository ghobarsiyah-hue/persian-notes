import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(30000);
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERR: ' + e.message));
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

// 1) TF: click درست via real coords
await clickText('افزودن'); await page.waitForTimeout(400);
await clickText('سوال'); await page.waitForTimeout(500);
await clickText('سوال درست / نادرست'); await page.waitForTimeout(1200);
const tfBtn = page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-truefalse .quiz-tf-true').first();
const tb = await tfBtn.boundingBox();
if (tb) { await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2); await page.waitForTimeout(500); }
const tfMarked = await page.evaluate(() => {
  const mainPm = [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb'));
  const w = mainPm.querySelector('.edu-truefalse');
  return { answer: w?.getAttribute('data-answer'), row: w?.querySelector('.quiz-tf-row')?.getAttribute('data-answer') };
});
console.log('TF marked:', JSON.stringify(tfMarked));

// 2) essay variant via contextual tab (click the tab chip then variant)
await clickText('افزودن'); await page.waitForTimeout(300);
await clickText('سوال'); await page.waitForTimeout(400);
await clickText('سوال تشریحی'); await page.waitForTimeout(1200);
// click into the essay block (real click on its body) to raise the contextual tab
const essayBody = page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-longanswer .edu-body').first();
const eb = await essayBody.boundingBox();
if (eb) { await page.mouse.click(eb.x + eb.width / 2, eb.y + 12); await page.waitForTimeout(600); }
// is there a contextual tab chip کادر آموزشی?
const chip = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('button')].filter((b) => (b.textContent ?? '').includes('کادر آموزشی'));
  return chips.length;
});
console.log('contextual chips:', chip);
if (chip) {
  await page.evaluate(() => {
    const chips = [...document.querySelectorAll('button')].filter((b) => (b.textContent ?? '').includes('کادر آموزشی'));
    chips[0].click();
  });
  await page.waitForTimeout(500);
  const v3 = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => (b.textContent ?? '').trim() === 'امتحانی');
    btns[0]?.click();
    return btns.length;
  });
  await page.waitForTimeout(600);
  const qv = await page.evaluate(() => {
    const mainPm = [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb'));
    return mainPm.querySelector('.edu-longanswer')?.getAttribute('data-qv');
  });
  console.log('essay qv after امتحانی:', qv, '(buttons found:', v3 + ')');
}
console.log('errors:', errs.slice(0, 3).join(' | ') || 'none');
await browser.close();
