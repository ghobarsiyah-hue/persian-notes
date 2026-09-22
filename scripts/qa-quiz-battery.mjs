/* Full live-surface battery: MCQ options+mark+grid, TF mark+end-line, short-q answerAt=end */
import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(30000);
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
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
const live = () => page.evaluate(() => [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb')));

/* MCQ */
await insert('سوال چهارگزینه‌ای');
let pm = await live();
let box = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .quiz-opt-text').first().boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.keyboard.type('مریخ');
await page.waitForTimeout(300);
box = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .quiz-opt-text').nth(1).boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.keyboard.type('مشتری');
await page.waitForTimeout(300);
// mark option 2 correct (real click on badge)
const num = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .quiz-opt-num').nth(1).boundingBox();
await page.mouse.click(num.x + num.width / 2, num.y + num.height / 2);
await page.waitForTimeout(500);
let mcqState = await page.evaluate(() => {
  const m = [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb')).querySelector('.edu-mcq');
  return { correct: [...m.querySelectorAll('.quiz-opt')].map((r) => r.getAttribute('data-correct')).join(','), opt1: m.querySelectorAll('.quiz-opt-text')[1].textContent };
});
console.log('MCQ mark:', JSON.stringify(mcqState));
// grid layout via contextual tab
await page.evaluate(() => { [...document.querySelectorAll('[data-ribbon-root] button')].find((b) => (b.textContent ?? '').includes('کادر آموزشی'))?.click(); });
await page.waitForTimeout(450);
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '۲×۲')?.click(); });
await page.waitForTimeout(600);
const layout = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb')).querySelector('.edu-mcq')?.getAttribute('data-layout'));
console.log('MCQ layout:', layout);
// answerAt=end via contextual tab (پاسخ group)
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'انتهای سوال')?.click(); });
await page.waitForTimeout(600);
const endLine = await page.evaluate(() => {
  const m = [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb')).querySelector('.edu-mcq');
  return { line: m.querySelector(':scope > .quiz-end-answer')?.textContent ?? '', painted: [...m.querySelectorAll('.quiz-opt')].some((r) => r.getAttribute('data-correct') === 'true') };
});
console.log('MCQ end-answer:', JSON.stringify(endLine));

/* TF */
await insert('سوال درست / نادرست');
const tfb = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-truefalse .quiz-tf-true').first().boundingBox();
await page.mouse.click(tfb.x + tfb.width / 2, tfb.y + tfb.height / 2);
await page.waitForTimeout(500);
const tfState = await page.evaluate(() => {
  const w = [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb')).querySelector('.edu-truefalse');
  return w?.getAttribute('data-answer');
});
console.log('TF answer:', tfState);

/* Undo check: undo should restore pre-grid layout? We did grid via setNodeMarkup — undo once should revert TF answer instead (last op was TF mark). */
await page.keyboard.press('Control+z');
await page.waitForTimeout(400);
const tfUndo = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror')].find((el) => !el.closest('.pn-page-thumb')).querySelector('.edu-truefalse')?.getAttribute('data-answer'));
console.log('TF after undo:', tfUndo);
console.log('errors:', errs.slice(0, 3).join(' | ') || 'none');
await browser.close();
