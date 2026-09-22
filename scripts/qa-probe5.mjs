/* Instrument sync(): dispatch a real editor command to set qTitle via __pn.editors — does THAT work? Also probe dispatch errors. */
import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(30000);
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
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
const withMcq = (fn) => page.evaluate((f) => {
  const eds = (window).__pn?.editors ?? {};
  const ed = Object.values(eds)[0];
  if (!ed) return 'no editor';
  let pos = -1;
  ed.state.doc.descendants((n, p) => { if (pos < 0 && n.type.name === 'mcqBlock') pos = p; return pos < 0; });
  if (pos < 0) return 'no mcq';
  return eval(f)(ed, pos);
}, fn);

await insert('سوال چهارگزینه‌ای');
// 1) direct command: set qTitle attr
const r1 = await withMcq(`(ed,pos) => { ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...ed.state.doc.nodeAt(pos).attrs, qTitle: 'مستقیم' })); return 'dispatched'; }`);
console.log('direct set:', r1, JSON.stringify(await page.evaluate(() => {
  const eds = (window).__pn?.editors ?? {}; const ed = Object.values(eds)[0];
  let f = null; ed.state.doc.descendants((n) => { if (!f && n.type.name === 'mcqBlock') f = n; return !f; });
  return f?.attrs.qTitle;
})));
// 2) caret inside title + document.execCommand insertText — does DOM change but attr not?
const tb = await page.locator('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .edu-title-text').first().boundingBox();
await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
await page.keyboard.type('تایپ');
await page.waitForTimeout(500);
const probe = await page.evaluate(() => {
  const eds = (window).__pn?.editors ?? {}; const ed = Object.values(eds)[0];
  let f = null; ed.state.doc.descendants((n) => { if (!f && n.type.name === 'mcqBlock') f = n; return !f; });
  const span = document.querySelector('.ProseMirror:not(.pn-page-thumb *) .edu-mcq .edu-title-text');
  return { dom: span?.textContent, attr: f?.attrs.qTitle };
});
console.log('typing:', JSON.stringify(probe));
console.log('page errors:', errs.slice(0, 3).join(' | ') || 'none');
await browser.close();
