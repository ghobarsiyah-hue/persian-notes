/**
 * Diagnostic probe — how does Persian keyboard.type() land in the editor?
 * Types Persian + Latin on the /editor/new page and dumps what happened.
 */
import { chromium } from 'playwright-core';

const VITE = process.argv[2] ?? 'http://localhost:5174';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

await page.goto(`${VITE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('input[type="email"]', { timeout: 30000 });
await page.fill('input[type="email"]', 'demo@pernote.local');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await sleep(1500);

await page.goto(`${VITE}/editor/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.pn-editor', { timeout: 30000 });
await sleep(2500);

await page.click('.pn-editor');
await page.keyboard.type('سلام دنیا persian test 123', { delay: 20 });
await sleep(800);

const info = await page.evaluate(() => {
  const ed = document.querySelector('.pn-editor');
  const ae = document.activeElement;
  return {
    editorHTML: ed?.innerHTML?.slice(0, 400) ?? null,
    textContent: ed?.textContent ?? null,
    activeElementClass: ae?.className ?? String(ae?.tagName),
    isContentEditable: !!ae?.isContentEditable,
  };
});
console.log(JSON.stringify(info, null, 2));

/* also try insertContent path (like the old regression harness) */
await page.evaluate(() => {
  const ed = document.querySelector('.pn-editor')?.editor;
  if (ed) ed.commands.insertContent(' تزریق-مستقیم ');
});
await sleep(600);
const after = await page.evaluate(() => document.querySelector('.pn-editor')?.textContent ?? null);
console.log('after insertContent:', JSON.stringify(after));

await browser.close();
