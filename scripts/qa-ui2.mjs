import { chromium } from 'playwright-core';
const BASE = 'http://[::1]:5199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(40000);
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
const res = await page.request.post(BASE + '/api/auth/login', { data: { email: 'demo@pernote.local', password: 'demo1234' } });
const { token } = await res.json();
await page.goto(BASE + '/login', { waitUntil: 'load' });
await page.evaluate((t) => localStorage.setItem('pn_token', t), token);

await page.goto(BASE + '/settings?tab=notifications', { waitUntil: 'load' });
await page.waitForSelector('[role=switch]');
const sw = await page.evaluate(() => {
  const el = document.querySelector('[role=switch]');
  const thumb = el.querySelector('span');
  const cs = getComputedStyle(el), ts = getComputedStyle(thumb);
  return { track: cs.height + 'x' + cs.width, trackColor: cs.backgroundColor, thumbPos: ts.insetInlineStart || ts.left, thumbTrans: ts.transitionDuration, radius: cs.borderRadius, checked: el.getAttribute('aria-checked') };
});
console.log('SWITCH OFF:', JSON.stringify(sw));
await page.locator('[role=switch]').first().click();
await page.waitForTimeout(300);
const sw2 = await page.evaluate(() => {
  const el = document.querySelector('[role=switch]');
  const thumb = el.querySelector('span');
  const cs = getComputedStyle(el), ts = getComputedStyle(thumb);
  return { trackColor: cs.backgroundColor, thumbPos: ts.insetInlineStart || ts.left, checked: el.getAttribute('aria-checked') };
});
console.log('SWITCH ON :', JSON.stringify(sw2));
await page.screenshot({ path: '../qa-switch.png' });

await page.goto(BASE + '/editor/new', { waitUntil: 'load' });
await page.waitForTimeout(1800);
const chip = await page.evaluate(() => {
  const btn = document.querySelector('[aria-label^="حساب کاربری"]');
  if (!btn) return null;
  const cs = getComputedStyle(btn);
  return { round: cs.borderRadius, size: btn.clientWidth, hasDot: btn.innerHTML.includes('0070f3') || btn.innerHTML.includes('ff5b4f') };
});
console.log('CHIP:', JSON.stringify(chip));
await page.screenshot({ path: '../qa-editor-chip.png' });

await page.goto(BASE + '/help/navigation', { waitUntil: 'load' });
await page.waitForTimeout(400);
const wiki = await page.evaluate(() => document.body.textContent.includes('منوی کنار صفحه و نوار ابزار'));
console.log('WIKI navigation article:', wiki);
await browser.close();
