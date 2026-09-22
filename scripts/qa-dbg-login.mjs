import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://[::1]:5199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('pageerror:', String(e).slice(0, 300)));
page.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });
const res = await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 60000 });
console.log('status:', res.status());
await page.waitForTimeout(3000);
const info = await page.evaluate(() => ({
  inputs: document.querySelectorAll('input').length,
  forms: document.querySelectorAll('form').length,
  h1: document.querySelector('h1')?.textContent?.trim(),
  root: (document.getElementById('root')?.innerHTML || '').length,
}));
console.log('dom:', JSON.stringify(info));
await browser.close();
