/* G3 cold-start probe: which single transaction near the start of typing
 * takes the MEASURE path instead of fastHeadroom/prevalidated? */
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
await wait(2500);
await page.evaluate(() => { window.__layoutDebug = true; });

await page.evaluate(() => {
  const el = document.querySelector('.document-pages .pn-editor');
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  el.focus();
});
await wait(300);
await page.evaluate(() => { window.__pnGuardStats = {}; });

const snap = (label) => page.evaluate((l) => ({ label: l, stats: { ...window.__pnGuardStats }, last: window.__pnGuardLast ?? null }), label);

const events = [];
for (const ch of 'سلام') {
  await page.keyboard.type(ch);
  events.push(await snap('char ' + ch));
}
await page.keyboard.press('Enter');
events.push(await snap('Enter1'));
for (const ch of 'خط') {
  await page.keyboard.type(ch);
  events.push(await snap('char ' + ch));
}
await page.keyboard.press('Enter');
events.push(await snap('Enter2'));
for (const e of events) {
  const nz = Object.fromEntries(Object.entries(e.stats).filter(([, v]) => v > 0));
  console.log(e.label.padEnd(10), JSON.stringify(nz), e.last ? 'last=' + JSON.stringify(e.last) : '');
}
console.log('last steps:', JSON.stringify(await page.evaluate(() => (window).__pnStepLog ?? null)));
await browser.close();
