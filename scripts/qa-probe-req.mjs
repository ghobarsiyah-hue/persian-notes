import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage();
const reqs = [];
page.on('request', (r) => reqs.push((r.resourceType() === 'fetch' || r.resourceType() === 'xhr' ? 'REQ ' : 'res ') + r.method() + ' ' + r.url().slice(0, 130)));
page.on('requestfailed', (r) => reqs.push('>>>FAILED ' + r.method() + ' ' + r.url().slice(0, 130)));
await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);
await page.fill('input[type="email"]', 'demo@pernote.local');
await page.fill('input[type="password"]', 'demo1234');
reqs.length = 0; // only requests after submit
await page.click('button[type="submit"]');
await page.waitForTimeout(5000);
console.log(reqs.slice(0, 20).join('\n') || 'NO-REQUESTS-AFTER-SUBMIT');
await browser.close();
