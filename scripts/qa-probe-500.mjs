import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage();
const bad = [];
page.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
console.log(bad.join('\n') || 'none');
await browser.close();
