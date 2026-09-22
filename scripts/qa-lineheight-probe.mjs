/* Isolate the 30px under-measure on Enter steps.
 * Candidates:
 *   C1: an empty trailing <p> renders a full line box (32px) in the REAL
 *       editor but measures ~0 in the guard's scratch walk (children loop
 *       uses offsetHeight — check what an empty p reports there)
 *   C2: min-height:100% inflation (only matters on short pages)
 *   C3: trailing margin/line collapse differences
 * Probe A: fresh scratch replica with doc = 20 paragraphs + 1 empty p,
 *          measured like measureDocHeight (children offsetHeight walk)
 * Probe B: the SAME content appended after real Persian paragraphs in a
 *          real-editor clone — per-child heights compared.
 */
import { chromium } from 'playwright-core';

const VITE = process.argv[2] ?? 'http://localhost:5199';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

await page.goto(VITE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[type="email"]', 'demo@pernote.local');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await wait(1500);
await page.goto(VITE + '/editor/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
await wait(2000);

const res = await page.evaluate(() => {
  /* ── scratch-context replica (same box the guard builds) ── */
  const sheet = document.createElement('div');
  sheet.style.cssText = 'position:fixed;left:-20000px;top:0;width:794px;height:1123px;padding:30px 32px;box-sizing:border-box;overflow:hidden;';
  const inner = document.createElement('div');
  inner.className = 'pn-editor-wrap';
  inner.style.cssText = 'height:1063px;overflow:hidden;';
  sheet.appendChild(inner);
  document.body.appendChild(sheet);
  const scratchPm = document.createElement('div');
  scratchPm.className = 'pn-editor ProseMirror';
  scratchPm.setAttribute('dir', 'rtl');
  inner.appendChild(scratchPm);
  const wrap = document.querySelector('.document-pages .pn-editor-wrap');
  const cs = getComputedStyle(wrap);
  inner.style.setProperty('--editor-font-size', cs.getPropertyValue('--editor-font-size') || '16px');
  inner.style.setProperty('--editor-line-height', cs.getPropertyValue('--editor-line-height') || '2');

  /* content: 20 Persian paragraphs + 1 EMPTY trailing paragraph */
  scratchPm.innerHTML = '';
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('p');
    p.textContent = 'خط آزمون سرریز برای صفحهٔ ثابت شمارهٔ ' + i;
    scratchPm.appendChild(p);
  }
  const emptyP = document.createElement('p');
  scratchPm.appendChild(emptyP);

  const kids = Array.from(scratchPm.children).map((c) => ({
    tag: c.tagName,
    h: c.offsetHeight,
    bottom: Math.round(c.offsetTop + c.offsetHeight),
    text: (c.textContent || '').slice(0, 12),
  }));
  const last = kids[kids.length - 1];
  const walkBottom = kids.reduce((m, c) => Math.max(m, c.bottom), 0);
  const rectBottom = Math.round(Array.from(scratchPm.children).reduce((m, c) => Math.max(m, c.getBoundingClientRect().bottom), 0) - scratchPm.getBoundingClientRect().top);

  sheet.remove();
  return {
    walkBottom,
    rectBottom,
    lastThree: kids.slice(-3),
    emptyPHeight: last.h,
    emptyPBottom: last.bottom,
    pmStyleMinHeight: getComputedStyle(scratchPm).minHeight,
    scratchPmOwnHeight: scratchPm.offsetHeight,
  };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
