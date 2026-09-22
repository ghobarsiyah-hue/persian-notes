/* Crash probe v3 — insert the three quiz blocks via Ribbon → افزودن → کادر آموزشی. */
import { chromium } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://[::1]:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack ?? '').split('\n').slice(0, 8).join('\n')));

try {
  await page.goto(BASE + '/login', { waitUntil: "commit", timeout: 60000 });
  await page.waitForSelector('input[type="email"]', { timeout: 60000 }); await page.fill('input[type="email"]', 'demo@pernote.local');
  await page.fill('input[type="password"]', 'demo1234');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2200);
  await page.goto(BASE + '/editor/new', { waitUntil: "commit", timeout: 60000 });
  await page.waitForSelector('.pn-editor', { timeout: 60000 });
  await page.waitForTimeout(2000);

  // go to the افزودن tab
  await page.locator('[data-ribbon-root] button:has-text("افزودن")').first().click();
  await page.waitForTimeout(400);

  for (const label of ['سوال چهارگزینه‌ای', 'سوال درست / نادرست', 'سوال تشریحی']) {
    // open the کادر آموزشی dropdown
    await page.locator('[data-ribbon-root] button:has-text("کادر آموزشی")').first().click();
    await page.waitForTimeout(400);
    const btn = page.locator(`[data-ribbon-root] button:has-text("${label}")`).first();
    if (!(await btn.count())) { console.log('NOT FOUND:', label); continue; }
    const before = await page.evaluate(() => document.querySelectorAll('.page-paper').length);
    await btn.click();
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => document.querySelectorAll('.page-paper').length);
    const rootAlive = await page.evaluate(() => !!document.getElementById('root')?.childElementCount);
    console.log(`INSERT "${label}": pages ${before} -> ${after} | root alive: ${rootAlive} | err: ${errors.length}`);
    if (errors.length) break;
    await page.mouse.click(700, 500);
    await page.waitForTimeout(250);
  }
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n———\n') : 'NO PAGE ERRORS');
} catch (e) {
  console.log('PROBE FAIL:', e.message);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n———\n') : 'NO CAPTURED ERRORS');
} finally {
  await browser.close();
}
