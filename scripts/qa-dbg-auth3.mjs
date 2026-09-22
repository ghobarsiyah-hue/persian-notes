import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://[::1]:5199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (email, password) => {
  await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await sleep(1800);
};
await login('demo@pernote.local', 'demo1234');
const bEmail = `auth3-${Date.now()}@test.local`;
await page.evaluate(async (em) => {
  await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'B کاربر', email: em, password: 'S3cure!pass9' }) });
}, bEmail);
await page.evaluate((t) => { localStorage.setItem('pn_token', t); }, (await page.evaluate(async (em) => {
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em, password: 'S3cure!pass9' }) });
  return (await r.json()).token;
}), bEmail));
/* replicate probe: /settings?tab=notifications */
await page.goto(`${BASE}/settings?tab=notifications`, { waitUntil: 'load' });
await sleep(1100);
await page.goto(`${BASE}/settings`, { waitUntil: 'load' });
await sleep(700);
await page.evaluate(() => {
  [...document.querySelectorAll('aside button')].find((b) => b.textContent?.trim() === 'خروج از حساب' || b.getAttribute('aria-label') === 'خروج از حساب')?.click();
});
await sleep(1200);
console.log('after logout url:', page.url(), 'token:', await page.evaluate(() => localStorage.getItem('pn_token')));
await login(bEmail, 'S3cure!pass9');
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await sleep(1500);
console.log('url:', page.url());
console.log('aside:', JSON.stringify(await page.evaluate(() => document.querySelector('aside')?.textContent?.slice(0, 60))));
await browser.close();
