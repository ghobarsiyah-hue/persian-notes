/* Auth UI smoke test: renders /login via the shared AuthShell, exercises
 * client validation, wrong-credentials server error, real demo login,
 * logout state clearing, and /signup deep link. */
import { chromium } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://[::1]:5199';
let pass = 0, fail = 0;
const ok = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}`); c ? pass++ : fail++; };

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('pageerror:', String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });
  await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 60000 });

  /* A1: AuthShell renders (logo + heading + form), RTL */
  await page.waitForSelector('form', { state: 'attached', timeout: 60000 });
  const h1 = (await page.textContent('h1'))?.trim();
  const hdir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
  ok('A1 shell+heading+form', h1 === 'پرشین‌نوت' && hdir === 'rtl');

  /* A2: empty submit → client-side Persian validation, no request */
  await page.click('button[type="submit"]');
  await page.waitForTimeout(150);
  const alerts = await page.$$eval('[role="alert"]', els => els.map(e => e.textContent?.trim()));
  ok('A2 client validation alerts', alerts.some(t => t?.includes('ایمیل')) && alerts.some(t => t?.includes('رمز')));

  /* A3: wrong credentials → generic server error (no enumeration) */
  await page.fill('input[type="email"]', 'auth-a@test.local');
  await page.fill('input[type="password"]', 'definitely-wrong');
  await page.click('button[type="submit"]');
  await page.waitForSelector('form > p[role="alert"]', { timeout: 15000 });
  const srvErr = (await page.textContent('form > p[role="alert"]')) ?? '';
  ok('A3 generic wrong-cred error', srvErr.includes('ایمیل یا رمز عبور اشتباه است'));

  /* A4: demo login → lands in workspace, user state set */
  await page.fill('input[type="email"]', 'demo@pernote.local');
  await page.fill('input[type="password"]', 'demo1234');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|$)/, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  ok('A4 demo login lands', !page.url().includes('/login'));

  /* A5: logout → back to /login, token gone from localStorage */
  await page.waitForFunction(
    () => [...document.querySelectorAll('aside button')].some(b => b.textContent?.trim() === 'خروج از حساب' || b.getAttribute('aria-label') === 'خروج از حساب'),
    { timeout: 20000 }
  );
  await page.evaluate(() => {
    [...document.querySelectorAll('aside button')]
      .find(b => b.textContent?.trim() === 'خروج از حساب' || b.getAttribute('aria-label') === 'خروج از حساب')
      ?.click();
  });
  await page.waitForURL(/\/login/, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  const token = await page.evaluate(() => localStorage.getItem('pn_token'));
  ok('A5 logout clears token', token === null && page.url().includes('/login'));

  /* A7: password visibility toggle works (type flips) — on /login */
  await page.waitForSelector('input[type="password"]', { timeout: 30000 });
  await page.click('[aria-label="نمایش رمز عبور"]');
  await page.waitForTimeout(120);
  const t = await page.getAttribute('input[autocomplete="current-password"]', 'type');
  ok('A7 visibility toggle', t === 'text');

  /* A6: /signup deep link shows register form (name + confirm fields) */
  await page.goto(`${BASE}/signup`, { waitUntil: 'commit', timeout: 30000 });
  await page.waitForSelector('form', { timeout: 30000 });
  const labels = await page.$$eval('form label span', els => els.map(e => e.textContent?.trim()));
  ok('A6 signup fields', labels.includes('نام') && labels.includes('تکرار رمز عبور'));
} finally {
  await browser.close();
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
