/**
 * PROBE 2: is the guard's verdict per-keystroke CORRECT and CHEAP?
 *  - fresh stat reset before each single char
 *  - freePx before/after
 *  - 500-char burst into a full page: rejection must fire ONCE-ish, not 1400x
 *
 * Usage: node scripts/qa-probe-reject-loop.mjs [viteUrl]
 */
import { chromium } from 'playwright-core';

const VITE = process.argv[2] ?? 'http://localhost:5199';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
  page.on('console', (m) => { const t = m.text(); if (t.includes('FixedPageGuard') || t.includes('measure')) console.log('CONSOLE[' + m.type() + ']:', t.slice(0, 400)); });

  await page.goto(VITE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  await page.fill('input[type="email"]', 'demo@pernote.local');
  await page.fill('input[type="password"]', 'demo1234');
  await page.click('button[type="submit"]');
  await sleep(1500);
  await page.goto(VITE + '/editor/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
  await sleep(2500);

  await page.evaluate(() => {
    const pagesEls = () => Array.from(document.querySelectorAll('.document-pages .page-paper'));
    const el = pagesEls()[0];
    const ed = el.querySelector('.pn-editor');
    const r = ed.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + 40;
    const t = document.elementFromPoint(cx, cy) ?? ed;
    const o = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
    t.dispatchEvent(new MouseEvent('mousedown', o));
    t.dispatchEvent(new MouseEvent('mouseup', o));
    t.dispatchEvent(new MouseEvent('click', o));
    ed.focus();
    window.__free = () => {
      const el0 = pagesEls()[0];
      const ed0 = el0.querySelector('.pn-editor');
      const wrap = ed0.closest('.pn-editor-wrap');
      let bottom = 0;
      for (const c of Array.from(ed0.children)) bottom = Math.max(bottom, c.getBoundingClientRect().bottom);
      return Math.round(wrap.getBoundingClientRect().bottom - bottom);
    };
  });
  await sleep(300);

  // fill until genuinely full (reject begins) — use the SAME threshold the guard uses
  const LINE = 'تایپ برای پر کردن کامل صفحه در حالت برگه ثابت. ';
  for (let i = 0; i < 120; i++) {
    await page.keyboard.type(LINE, { delay: 0 });
    await page.keyboard.press('Enter');
    await sleep(30);
    await page.evaluate(() => { window.__layoutDebug = true; window.__pnGuardStats = {}; });
    const st = await page.evaluate(() => Object.assign({}, window.__pnGuardStats || {}));
    if ((st.rejected ?? 0) > 0) { console.log('fill: rejection first fired at iteration', i); break; }
  }
  await sleep(300);
  console.log('free after fill:', await page.evaluate(() => window.__free()));

  // single chars with fresh stats each
  for (const ch of ['x', 'y', 'z']) {
    await page.evaluate(() => { window.__pnGuardStats = {}; });
    await page.keyboard.type(ch, { delay: 0 });
    await sleep(250);
    const st = await page.evaluate(() => Object.assign({}, window.__pnGuardStats || {}));
    console.log('char ' + ch + ' ->', JSON.stringify(st), 'free=' + (await page.evaluate(() => window.__free())));
  }

  // 500-char burst into the FULL page
  await page.evaluate(() => { window.__pnGuardStats = {}; });
  const t0 = Date.now();
  await page.keyboard.type('ب'.repeat(500), { delay: 0 });
  const wall = Date.now() - t0;
  await sleep(400);
  const stB = await page.evaluate(() => Object.assign({}, window.__pnGuardStats || {}));
  console.log('burst 500 ->', JSON.stringify(stB), 'wall=' + wall + 'ms');
  const tail = await page.evaluate(() => (document.querySelector('.document-pages .pn-editor').textContent || '').slice(-30));
  console.log('DOM tail:', JSON.stringify(tail));

  // sanity: deleting 3 chars must free room and re-allow typing
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.evaluate(() => { window.__pnGuardStats = {}; });
  await page.keyboard.type('مجددا', { delay: 10 });
  await sleep(250);
  const stR = await page.evaluate(() => Object.assign({}, window.__pnGuardStats || {}));
  const tail2 = await page.evaluate(() => (document.querySelector('.document-pages .pn-editor').textContent || '').slice(-30));
  console.log('retype after delete ->', JSON.stringify(stR), 'tail=', JSON.stringify(tail2));

  await browser.close();
}

main().catch((e) => { console.error('PROBE ERROR:', e); process.exit(2); });
