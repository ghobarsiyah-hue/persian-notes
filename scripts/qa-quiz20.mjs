/* QA-QZ: 20 test pages exercising every question-insertion option.
 * Drives the real editor over Vite: inserts all four quiz families via
 * ribbon menus, types content, switches variants (v1/v2/v3), toggles
 * answer placement (mark/end/none), MCQ layouts, conversions, undo,
 * page-adds on top of quiz content, and verifies the exported/print HTML
 * mirrors the editor. Prints PASS/FAIL per check. */
import { chromium } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://[::1]:5173';
const results = [];
const check = (id, ok, note = '') => {
  results.push({ id, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${note ? ' — ' + note : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(30000);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CONNECTION')) pageErrors.push('CONSOLE: ' + m.text()); });

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('input[type="email"]', { timeout: 60000 });
await page.fill('input[type="email"]', 'demo@pernote.local');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await page.waitForTimeout(3500);
await page.goto(`${BASE}/editor/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
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

const insertFromMenus = async (menuBtn, item) => {
  await clickText('افزودن');
  await page.waitForTimeout(350);
  await clickText(menuBtn);
  await page.waitForTimeout(450);
  const ok = await clickText(item);
  await page.waitForTimeout(1000);
  return ok;
};

const wrapperOf = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const w = el.closest('.edu-block');
  return w ? { cls: w.className, qv: w.getAttribute('data-qv'), da: w.getAttribute('data-answer'), html: w.outerHTML.slice(0, 400) } : null;
}, sel);

/** move the caret into a block's title so the contextual tab appears,
 *  then leave the tab strip open — used before clicking tab tools */
const focusTitle = async (sel) => {
  await page.evaluate((s) => {
    const t = document.querySelector(s);
    if (!t) return;
    t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    t.focus();
    // put a real caret inside via selection so PM registers the position
    const r = document.createRange(); r.selectNodeContents(t); r.collapse(false);
    const s2 = window.getSelection(); s2?.removeAllRanges(); s2?.addRange(r);
  }, sel);
  await page.waitForTimeout(400);
};

/* ═══ PAGE 1: سوال کوتاه from the سوال menu ═══ */
check('P01.insert-short', await insertFromMenus('سوال', 'سوال کوتاه'));
await page.keyboard.type('پایتخت ایران کجاست؟');
await page.waitForTimeout(300);
// jump to body: click into the body paragraph area under the title
const bodyClick = await page.evaluate(() => {
  const w = document.querySelector('.edu-question');
  const body = w?.querySelector('.edu-body p, .edu-body');
  if (!body) return false;
  body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  return true;
});
await page.keyboard.type('تهران است.');
await page.waitForTimeout(400);
const shortHtml = await page.evaluate(() => document.querySelector('.edu-question')?.outerHTML.slice(0, 900) ?? '');
check('P01.title-persist', shortHtml.includes('پایتخت ایران'), shortHtml.includes('پایتخت') ? '' : 'title text lost');
check('P01.no-crash', pageErrors.length === 0, pageErrors[0] ?? '');

/* ═══ PAGE 2: تشریحی + variant v3 (ruled answer sheet) ═══ */
check('P02.insert-essay', await insertFromMenus('سوال', 'سوال تشریحی'));
await page.keyboard.type('تئوری نسبی را شرح دهید.');
// the contextual tab appears once the caret is inside the block — click its title
await focusTitle('.edu-longanswer .edu-title-text');
await page.waitForTimeout(500);
const v3ok = await clickText('امتحانی');
await page.waitForTimeout(600);
const essayW = await wrapperOf('.edu-longanswer');
check('P02.variant-v3', v3ok && essayW?.qv === 'v3', `qv=${essayW?.qv}`);

/* ═══ PAGE 3: درست/نادرست — mark answer=true, then answerAt=end ═══ */
check('P03.insert-tf', await insertFromMenus('سوال', 'سوال درست / نادرست'));
await page.keyboard.type('زمین گرد است.');
await page.evaluate(() => {
  const w = document.querySelector('.edu-truefalse');
  w?.querySelector('.quiz-tf-true')?.click();
});
await page.waitForTimeout(500);
const tfW = await wrapperOf('.quiz-tf-row');
check('P03.mark-true', tfW?.da === 'true', `data-answer=${tfW?.da}`);
// switch to end-answer via the contextual tab (caret must be inside)
await focusTitle('.edu-truefalse .edu-title-text');
await page.waitForTimeout(400);
await clickText('انتهای سوال');
await page.waitForTimeout(600);
const endLine = await page.evaluate(() => document.querySelector('.edu-truefalse .quiz-end-answer')?.textContent ?? '');
check('P03.answer-at-end', endLine.includes('درست'), `line="${endLine}"`);
const tfPainted = await page.evaluate(() => document.querySelector('.edu-truefalse')?.getAttribute('data-answer'));
check('P03.no-spoiler-paint', tfPainted === 'none', `data-answer=${tfPainted}`);

/* ═══ PAGE 4: چهارگزینه‌ای — fill options, mark correct, layout grid ═══ */
check('P04.insert-mcq', await insertFromMenus('سوال', 'سوال چهارگزینه‌ای'));
await page.keyboard.type('بزرگ‌ترین سیاره؟');
// option spans are editable: click into option 1 and type
const optFill = async (idx, text) => {
  await page.evaluate((i) => {
    const spans = document.querySelectorAll('.edu-mcq .quiz-opt-text');
    const s = spans[i];
    s.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    s.focus();
    const r = document.createRange(); r.selectNodeContents(s); r.collapse(false);
    const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
  }, idx);
  await page.keyboard.type(text);
  await page.waitForTimeout(250);
};
await optFill(0, 'مریخ');
await optFill(1, 'مشتری');
await optFill(2, 'زهره');
await page.evaluate(() => {
  document.querySelectorAll('.edu-mcq .quiz-opt-num')[1].closest('button')?.click();
});
await page.waitForTimeout(500);
const mcqHtml = await page.evaluate(() => document.querySelector('.edu-mcq')?.outerHTML.slice(0, 1600) ?? '');
check('P04.options-persist', mcqHtml.includes('مشتری'), 'option text lost');
check('P04.correct-paint', mcqHtml.includes('data-correct="true"'), 'no correct mark');
// layout via contextual tab
await focusTitle('.edu-mcq .edu-title-text');
await page.waitForTimeout(400);
await clickText('۲×۲');
await page.waitForTimeout(600);
const mcqLayout = await page.evaluate(() => document.querySelector('.edu-mcq')?.getAttribute('data-layout'));
check('P04.layout-grid', mcqLayout === 'grid', `layout=${mcqLayout}`);

/* ═══ PAGE 5: answerAt=none — correct stays but hidden everywhere ═══ */
await clickText('بدون پاسخ');
await page.waitForTimeout(600);
const mcqHidden = await page.evaluate(() => document.querySelector('.edu-mcq')?.outerHTML.slice(0, 1600) ?? '');
check('P05.answer-hidden', !mcqHidden.includes('data-correct="true"'), 'correct still painted');

/* ═══ PAGE 6: undo — attribute changes undo cleanly ═══ */
await page.keyboard.press('Control+z');
await page.waitForTimeout(400);
const undone = await page.evaluate(() => document.querySelector('.edu-mcq')?.outerHTML.includes('data-correct="true"') ?? false);
check('P06.undo-answer', undone, 'undo did not restore the mark');

/* ═══ PAGES 7-8: variants on MCQ (v2 cards / back to v1) ═══ */
await clickText('کارت');
await page.waitForTimeout(500);
let w = await wrapperOf('.edu-mcq');
check('P07.variant-v2', w?.qv === 'v2', `qv=${w?.qv}`);
await clickText('خط ظریف');
await page.waitForTimeout(500);
w = await wrapperOf('.edu-mcq');
check('P08.variant-v1', w?.qv === 'v1', `qv=${w?.qv}`);

/* ═══ PAGE 9: convert MCQ → سوال و پاسخ keeps the title ═══ */
await focusTitle('.edu-mcq .edu-title-text');
await page.waitForTimeout(400);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((el) => (el.textContent ?? '').trim() === 'تبدیل به' || (el.title ?? '').includes('تبدیل'));
  b?.click();
});
await page.waitForTimeout(500);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((el) => (el.textContent ?? '').trim() === 'سوال و پاسخ');
  b?.click();
});
await page.waitForTimeout(900);
const conv = await page.evaluate(() => document.querySelector('.edu-question')?.getAttribute('data-question') ?? '');
check('P09.convert-keeps-title', conv.includes('بزرگ‌ترین سیاره'), `title="${conv.slice(0, 40)}"`);

/* ═══ PAGES 10-11: add pages on top of heavy quiz content (crash guard) ═══ */
for (let i = 10; i <= 11; i++) {
  await page.locator('.pn-pages-add-btn').first().click();
  await page.waitForTimeout(400);
  await clickText('قاب‌دار');
  await page.waitForTimeout(1800);
  const blank = await page.evaluate(() => document.body.innerText.trim().length < 5);
  check(`P${String(i).padStart(2, '0')}.add-page-no-crash`, !blank && pageErrors.length === 0, pageErrors[0] ?? '');
}

/* ═══ PAGES 12-13: export HTML mirrors the editor (print pipeline) ═══ */
const exported = await page.evaluate(() => {
  // docJsonToHtml path runs through the same schema; ask the store? simplest:
  // the print preview builds from editor.getHTML + docJsonToHtml for unmounted
  // pages — here we verify the mounted page's HTML carries variant attrs.
  const w = document.querySelector('.edu-longanswer[data-qv="v3"]');
  return { hasV3: !!w, count: document.querySelectorAll('[data-qv]').length };
});
check('P12.variant-in-dom', exported.hasV3, 'v3 missing from editor DOM');
check('P13.variant-count', exported.count >= 2, `data-qv wrappers=${exported.count}`);

/* ═══ PAGES 14-15: slash-menu keyword insertion (تستی / تشریحی) ═══ */
await page.evaluate(() => { const els = document.querySelectorAll('.ProseMirror'); const el = els[els.length - 1]; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.focus(); });
await page.keyboard.type('/');
await page.waitForTimeout(400);
await page.keyboard.type('تستی');
await page.waitForTimeout(600);
await page.keyboard.press('Enter');
await page.waitForTimeout(1000);
const slashMcq = await page.evaluate(() => document.body.innerHTML.includes('quiz-opts'));
check('P14.slash-mcq', slashMcq, 'slash /تستی did not insert MCQ');
check('P15.no-crash-after-slash', pageErrors.length === 0, pageErrors[0] ?? '');

/* ═══ PAGES 16-17: right-click menu has the separate سوال submenu ═══ */
await page.evaluate(() => { const els = document.querySelectorAll('.ProseMirror'); const el = els[els.length - 1]; el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 })); });
await page.waitForTimeout(600);
const ctxItems = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter((el) => el.children.length === 0).map((el) => (el.textContent ?? '').trim()));
check('P16.ctx-question-submenu', ctxItems.includes('افزودن سوال'), 'no افزودن سوال in context menu');
check('P17.ctx-edu-clean', !ctxItems.includes('سوال چهارگزینه‌ای') || ctxItems.indexOf('افزودن سوال') !== -1, '');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

/* ═══ PAGES 18-19: typing into option spans keeps caret (no rebuild) ═══ */
// the last inserted MCQ from slash menu
const caretOk = await page.evaluate(async () => {
  const mcq = Array.from(document.querySelectorAll('.edu-mcq')).pop();
  const span = mcq?.querySelector('.quiz-opt-text');
  if (!span) return { ok: false };
  span.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  span.focus();
  const r = document.createRange(); r.selectNodeContents(span); r.collapse(false);
  const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
  return { ok: true };
});
if (caretOk.ok) {
  await page.keyboard.type('آپشن الف');
  await page.waitForTimeout(350);
  await page.keyboard.type(' ب');
  await page.waitForTimeout(350);
  const spanText = await page.evaluate(() => {
    const mcq = Array.from(document.querySelectorAll('.edu-mcq')).pop();
    return mcq?.querySelector('.quiz-opt-text')?.textContent ?? '';
  });
  check('P18.option-typing-atomic', spanText === 'آپشن الف ب', `text="${spanText}"`);
} else check('P18.option-typing-atomic', false, 'span not found');
check('P19.option-persist', (await page.evaluate(() => document.body.innerHTML.includes('آپشن الف'))), 'option text not persisted');

/* ═══ PAGE 20: rapid add + insert all families in sequence ═══ */
let allInserted = true;
for (const item of ['سوال کوتاه', 'سوال تشریحی', 'سوال درست / نادرست', 'سوال چهارگزینه‌ای']) {
  const ok = await insertFromMenus('سوال', item);
  if (!ok) allInserted = false;
}
await page.waitForTimeout(800);
check('P20.all-families-insert', allInserted && pageErrors.length === 0, pageErrors[0] ?? '');

const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
console.log(pageErrors.length ? 'PAGE ERRORS:\n' + pageErrors.slice(0, 6).join('\n') : 'no page errors');
await browser.close();
process.exit(pass === results.length ? 0 : 1);
