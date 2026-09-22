/* Parity probe — WHY does the guard accept a doc that visibly overflows?
 *   H1 (doc mismatch):    state.doc ≠ DOM (stray rejected text still rendered)
 *   H2 (geometry mismatch): scratch renders the same doc HIGHER than the real
 *                          editor would (font/margins/box differences)
 *   H3 (both)
 *
 * Method: get the real doc through TipTap's window registry, then measure the
 * SAME doc three ways inside the page:
 *   A) real PM DOM bottom (what the user sees)
 *   B) replica: clone the real PM DOM, strip overflow, place in a
 *      scratch-context box (794px sheet, framed padding, .pn-editor-wrap)
 *   C) guard's scratch view (EditorState.create({doc: state.doc})) measured
 *      exactly like measureDocHeight does
 */
import { chromium } from 'playwright-core';

const VITE = process.argv[2] ?? 'http://localhost:5199';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto(VITE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[type="email"]', 'demo@pernote.local');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await sleep(1500);
await page.goto(VITE + '/editor/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
await sleep(2500);
await page.evaluate(() => { window.__layoutDebug = true; });

await page.evaluate(() => { document.querySelector('.document-pages .pn-editor').focus(); });
await page.keyboard.press('Control+a');
await page.keyboard.type('شروع');

const geo = () => page.evaluate(() => {
  const wrap = document.querySelector('.document-pages .pn-editor-wrap');
  const pm = wrap.querySelector('.ProseMirror');
  const zoom = parseFloat(getComputedStyle(wrap).zoom || '1') || 1;
  const wRect = wrap.getBoundingClientRect();
  let bottom = 0;
  pm.querySelectorAll(':scope > *').forEach((c) => {
    const b = (c.getBoundingClientRect().bottom - wRect.top) / zoom;
    if (b > bottom) bottom = b;
  });
  return { limit: Math.round(wrap.clientHeight), bottom: Math.round(bottom) };
});

let g = await geo();
let free = g.limit - g.bottom;
let i = 0;
while (i < 400 && free > 130) {
  await page.keyboard.type('خط آزمون سرریز برای صفحهٔ ثابت ');
  await page.keyboard.type(String(i));
  await page.keyboard.press('Enter');
  g = await geo();
  free = g.limit - g.bottom;
  i++;
}
console.log(`filled ${i} lines: limit=${g.limit} bottom=${g.bottom} free=${free}`);

/* type 3 chars past the boundary — the state seen by the filter AFTER the
 * first overflow-inducing accept (domLen grows, doc stays put in H1) */
for (let k = 0; k < 3; k++) { await page.keyboard.type('ک'); await sleep(150); }
const afterChars = await geo();
console.log('after 3 extra chars:', JSON.stringify(afterChars));

/* dissect */
const dis = await page.evaluate(() => {
  const wrap = document.querySelector('.document-pages .pn-editor-wrap');
  const pm = wrap.querySelector('.ProseMirror');
  const zoom = parseFloat(getComputedStyle(wrap).zoom || '1') || 1;
  const wRect = wrap.getBoundingClientRect();
  const realBottom = (() => {
    let b = 0;
    pm.querySelectorAll(':scope > *').forEach((c) => {
      const v = (c.getBoundingClientRect().bottom - wRect.top) / zoom;
      if (v > b) b = v;
    });
    return b;
  })();

  /* editor instances live on TipTap's window registry in dev builds */
  const eds = (window).__tiptapEditors || [];
  const ed = eds.length ? eds[eds.length - 1] : null;
  const docSize = ed ? ed.state.doc.content.size : -1;
  const domLen = pm.textContent.length;

  /* replica: clone the real PM DOM into a scratch-context box */
  const sheet = document.createElement('div');
  sheet.style.cssText = 'position:fixed;left:-20000px;top:0;width:794px;height:1123px;padding:30px 32px;box-sizing:border-box;overflow:hidden;';
  const inner = document.createElement('div');
  inner.className = 'pn-editor-wrap';
  inner.style.cssText = 'height:1063px;overflow:hidden;';
  sheet.appendChild(inner);
  document.body.appendChild(sheet);
  const clone = pm.cloneNode(true);
  clone.setAttribute('dir', 'rtl');
  inner.appendChild(clone);
  const cs = getComputedStyle(wrap);
  inner.style.setProperty('--editor-font-size', cs.getPropertyValue('--editor-font-size') || '16px');
  inner.style.setProperty('--editor-line-height', cs.getPropertyValue('--editor-line-height') || '2');
  let replicaBottom = 0;
  clone.querySelectorAll(':scope > *').forEach((c) => {
    replicaBottom = Math.max(replicaBottom, c.offsetTop + c.offsetHeight);
  });
  const replicaLimit = inner.clientHeight;
  sheet.remove();

  return {
    realBottomPx: Math.round(realBottom),
    replicaBottomPx: Math.round(replicaBottom),
    replicaLimit,
    replicaOver: Math.round(replicaBottom - replicaLimit),
    realOver: Math.round(realBottom - wrap.clientHeight),
    docSize,
    domLen,
    pmChildren: pm.children.length,
  };
});
console.log('DISSECT:', JSON.stringify(dis, null, 1));
console.log('pmChildren:', dis.pmChildren);
await browser.close();
