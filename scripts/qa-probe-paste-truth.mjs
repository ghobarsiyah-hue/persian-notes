/* Decisive C7 probe — is the accepted paste REAL overflow or harness noise?
 * Ground truth: after the paste, does .pn-editor-wrap scrollHeight exceed
 * clientHeight? (yes → the guard let real overflow through; no → the paste
 * genuinely fit and the C7 test text was too small) */
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || 'http://localhost:5199';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('input[type="email"]', { timeout: 30000 });
await page.fill('input[type="email"]', 'demo@pernote.local');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await sleep(1500);
await page.goto(BASE + '/editor/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
await sleep(2500);

await page.evaluate(() => {
  const ed = document.querySelector('.document-pages .pn-editor');
  ed.focus();
});
await page.keyboard.press('Control+a');
await page.keyboard.type('شروع');

const truth = () => page.evaluate(() => {
  const wrap = document.querySelector('.document-pages .pn-editor-wrap');
  const overflow = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
  const cs = getComputedStyle(wrap);
  const zoom = parseFloat(cs.zoom || '1') || 1;
  const ed = wrap.querySelector('.pn-editor');
  // last content line bottom vs wrap bottom (content-box)
  const wRect = wrap.getBoundingClientRect();
  let lastBottom = 0;
  ed.querySelectorAll(':scope > *').forEach((c) => {
    const r = c.getBoundingClientRect();
    if (r.bottom > lastBottom) lastBottom = r.bottom;
  });
  return {
    overflowPx: Math.round(overflow),
    freeByScroll: Math.round(wrap.clientHeight - wrap.scrollHeight),
    lastContentOverhangPx: Math.round((lastBottom - wRect.bottom) / zoom),
    freePx: null,
    padBottom: cs.paddingBottom,
  };
});

console.log('before fill:', JSON.stringify(await truth()));

let free = await page.evaluate(() => {
  /* real free height: wrap content-box bottom − last content bottom
     (scrollHeight is useless pre-fill: it equals clientHeight) */
  const wrap = document.querySelector('.document-pages .pn-editor-wrap');
  if (!wrap) return null;
  const cs = getComputedStyle(wrap);
  const zoom = parseFloat(cs.zoom || '1') || 1;
  const wRect = wrap.getBoundingClientRect();
  let lastBottom = wRect.top;
  wrap.querySelectorAll('.pn-editor > *').forEach((c) => {
    const r = c.getBoundingClientRect();
    if (r.bottom > lastBottom) lastBottom = r.bottom;
  });
  const pad = parseFloat(cs.paddingBottom || '0');
  return Math.round(((wRect.bottom - pad) - lastBottom) / zoom);
});
for (let i = 0; i < 400 && free !== null && free > 120; i++) {
  await page.keyboard.type('خط آزمون سرریز برای صفحه ثابت ۰۱۲۳ ');
  await page.keyboard.press('Enter');
  free = await page.evaluate(() => {
    const wrap = document.querySelector('.document-pages .pn-editor-wrap');
    if (!wrap) return null;
    const cs = getComputedStyle(wrap);
    const zoom = parseFloat(cs.zoom || '1') || 1;
    const wRect = wrap.getBoundingClientRect();
    let lastBottom = wRect.top;
    wrap.querySelectorAll('.pn-editor > *').forEach((c) => {
      const r = c.getBoundingClientRect();
      if (r.bottom > lastBottom) lastBottom = r.bottom;
    });
    const pad = parseFloat(cs.paddingBottom || '0');
    return Math.round(((wRect.bottom - pad) - lastBottom) / zoom);
  });
}
console.log('after fill:', JSON.stringify(await truth()));

const bigText = 'بند سرریز شماره یک. بند سرریز شماره دو. بند سرریز شماره سه. بند سرریز شماره چهار که طول کل را از مرز صفحه می‌گذراند. بند پنج. بند شش. بند هفت. بند هشت که قطعاً از فضای باقی‌مانده بزرگ‌تر است.';
await page.evaluate((t) => {
  const dt = new DataTransfer();
  dt.setData('text/plain', t);
  const ed = document.activeElement?.classList?.contains('pn-editor')
    ? document.activeElement
    : document.querySelector('.document-pages .pn-editor');
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, bigText);
await sleep(400);
const after = await truth();
console.log('after paste:', JSON.stringify(after));
console.log(after.overflowPx > 2 || after.lastContentOverhangPx > 2
  ? `VERDICT: REAL OVERFLOW got through the guard (${after.overflowPx}px scroll-overflow, ${after.lastContentOverhangPx}px overhang) → GUARD BUG`
  : 'VERDICT: paste genuinely fit — no real overflow; C7 test text was too small (harness calibration)');

await browser.close();
