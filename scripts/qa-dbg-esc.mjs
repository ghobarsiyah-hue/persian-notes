/* Isolated N3b reproduction: dblclick → type → dump → Escape → after-state.
 * Answers: which node is the focused CE, is it React-managed, and what
 * exactly remains after Escape. */
import { chromium } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://[::1]:5199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.setDefaultTimeout(45000);
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 200)));
page.on('console', (m) => { if (m.text().includes('[DBG-ESC]')) console.log('PRODUCT:', m.text()); });

await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('input[type="email"]', { timeout: 30000 });
await page.fill('input[type="email"]', 'demo@pernote.local');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await page.waitForTimeout(1500);
await page.goto(`${BASE}/editor/new`, { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
await page.waitForTimeout(2500);

/* insert a rect via the ribbon (same path as the harness) */
const addTab = page.locator('[data-ribbon-root] button', { hasText: 'افزودن' }).first();
if (await addTab.count()) { await addTab.click(); await page.waitForTimeout(200); }
const shapeBtn = await page.$('[data-ribbon-root] button[title*="شکل‌ها"]');
if (!shapeBtn) { console.log('NO shapeBtn'); process.exit(2); }
await shapeBtn.click();
await page.waitForTimeout(220);
const item = page.locator('body > .pn-glass-panel').filter({ hasText: 'مستطیل' }).first();
await item.locator('text=مستطیل').first().click();
await page.waitForTimeout(600);

const p = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.document-pages .page-paper')][0]?.querySelectorAll('[data-float-id]') ?? [];
  const objs = [...els].filter((n) => n.offsetWidth > 40 && n.offsetHeight > 20 && !(n.parentElement && n.parentElement.closest('[data-float-id]')) && n.tagName === 'DIV' && n.style.position === 'absolute');
  const el = objs[objs.length - 1];
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: el.getAttribute('data-float-id') };
});
console.log('target:', JSON.stringify(p));

await page.mouse.dblclick(p.x, p.y);
await page.waitForTimeout(350);
await page.keyboard.type('متن فارسی');
await page.waitForTimeout(250);

const dump = await page.evaluate(() => {
  const ce = document.activeElement;
  /* TRUE root: the position:absolute float root, not the CE itself */
  let root = ce?.closest('[data-float-id]');
  while (root && root.parentElement && root.parentElement.closest('[data-float-id]')) root = root.parentElement.closest('[data-float-id]');
  const ces = [...root.querySelectorAll('[contenteditable]')].map((c) => ({
    ce: c.getAttribute('contenteditable'),
    isFocused: c === document.activeElement,
    flex: c.style.flex || null,
    pos: c.style.position || null,
    reactProps: Object.keys(c).filter((k) => k.startsWith('__reactProps')).length,
  }));
  const roots = [...document.querySelectorAll('.document-pages [data-float-id]')].filter((n) => !(n.parentElement && n.parentElement.closest('[data-float-id]')));
  return {
    floatRoots: roots.length,
    cesInTrueRoot: ces,
    rootChildren: [...root.children].map((c) => `${c.tagName}:ce=${c.getAttribute('contenteditable') ?? '-'}:flex=${c.style.flex || '-'}:pos=${c.style.position || '-'}`),
  };
});
console.log('EDITING-DUMP:', JSON.stringify(dump, null, 1));

await page.keyboard.press('Escape');
await page.waitForTimeout(400);

const after = await page.evaluate(() => {
  const ae = document.activeElement;
  const root = [...document.querySelectorAll('.document-pages .page-paper')][0]
    ?.querySelectorAll('[data-float-id]') ?? [];
  const objs = [...root].filter((n) => n.offsetWidth > 40 && n.offsetHeight > 20 && !(n.parentElement && n.parentElement.closest('[data-float-id]')) && n.tagName === 'DIV' && n.style.position === 'absolute');
  const el = objs[objs.length - 1];
  return {
    aeTag: ae?.tagName,
    aeCE: ae?.getAttribute?.('contenteditable'),
    stillInFloat: !!(ae && el && el.contains(ae)),
    cesInRoot: el ? [...el.querySelectorAll('[contenteditable="true"]')].length : -1,
    staticTextShown: el ? (el.textContent || '').includes('متن فارسی') : false,
    text: (el?.textContent || '').trim().slice(0, 40),
  };
});
console.log('AFTER-ESCAPE:', JSON.stringify(after, null, 1));
await browser.close();
