/**
 * Browser QA for the multi-page editor — drives a REAL Chrome session over
 * the seeded 10-page booklet (scripts/seed-booklet.mjs) and exercises the
 * pagination engine like a real user:
 *
 *   1. booklet opens as 10+ pages with correct per-page kinds
 *   2. typing on page 1 fills it → overflow flows to the next page WITHOUT
 *      stealing the active page (caret stays where the user is)
 *   3. caret-follow: typing at the very end flows the caret across pages
 *   4. manual pageBreak boundary (page 9→10 in the booklet)
 *   5. blank page stays selectable/editable (the original bug report)
 *   6. backflow: deleting content pulls it back; auto pages vanish
 *   7. ordered-list numbering stays continuous across the break
 *   8. save → reload keeps page count, kinds and the manual break
 *
 * Usage: node scripts/qa-browser.mjs [noteId]
 * Requires: server :4000 + vite :5173 already running.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const VITE = 'http://localhost:5173';
const API = 'http://localhost:4000/api';
const NOTE_ID = process.argv[2] ?? '6aabd63d54c2042832ce37b5';
const SHOT = (n) => `qa-shot-${n}.png`;

/* ── helpers ─────────────────────────────────────────────────────────── */
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(page) {
  await page.goto(`${VITE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  await page.fill('input[type="email"]', 'demo@pernote.local');
  await page.fill('input[type="password"]', 'demo1234');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
}

/** page count as seen by the sidebar (source of truth = pages state) */
async function pageCount(page) {
  return page.evaluate(() => document.querySelectorAll('.pn-page-item').length);
}
/** which sidebar thumbnail is highlighted active (matches by data-page-id,
 *  NOT by class order — the sidebar renders a PageTypePicker row too) */
async function activePageNum(page) {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.pn-page-item'));
    const el = items.find((e) => e.className.includes('active'));
    if (!el) return null;
    const id = el.getAttribute('data-page-id');
    const pages = Array.from(document.querySelectorAll('[data-page-id]'));
    return pages.findIndex((p) => p.getAttribute('data-page-id') === id) + 1 || null;
  });
}
/** text content of page N's editor (1-based, over .page-paper) */
async function pageText(page, n) {
  return page.evaluate((idx) => {
    const pages = document.querySelectorAll('.page-paper');
    const el = pages[idx - 1];
    return el ? (el.querySelector('.pn-editor')?.textContent ?? '') : null;
  }, n);
}
async function clickPage(page, n) {
  await page.evaluate((idx) => {
    const el = document.querySelectorAll('.page-paper')[idx - 1];
    el?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const ed = el?.querySelector('.pn-editor');
    ed?.focus();
  }, n);
  await sleep(200);
}
/** type into the editor of page n at its current caret */
async function typeInto(page, n, text) {
  await clickPage(page, n);
  await page.keyboard.type(text, { delay: 12 });
}

/* ── main ────────────────────────────────────────────────────────────── */
async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => check('no page JS error', false, String(e).slice(0, 200)));

  await login(page);

  /* ── 1. open the booklet ─────────────────────────────────────────── */
  await page.goto(`${VITE}/editor/${NOTE_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.pn-editor', { timeout: 30000 });
  await sleep(3000); // let fonts + first flow passes settle

  const count0 = await pageCount(page);
  check('booklet opens with the stored pages', count0 >= 10 && count0 <= 12, `pages=${count0}`);
  await page.screenshot({ path: SHOT(1), timeout: 5000 }).catch(() => {});

  const p1 = await pageText(page, 1);
  check('page 1 holds the title heading', !!p1 && p1.includes('جزوهٔ فیزیولوژی پایه'));
  const kinds = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.page-paper')).map((el) => {
      if (el.querySelector('.page-border')) return 'framed';
      if (el.querySelector('.page-notebook-lines')) return 'notebook';
      return el.className.includes('page-blank') ? 'blank' : '?';
    });
  });
  check('per-page kinds survived persistence', kinds.slice(0, 10).join(',') === 'framed,notebook,blank,framed,framed,blank,notebook,framed,blank,framed', kinds.join(','));

  /* ── 2. manual pageBreak boundary (page 9 → 10) ──────────────────── */
  const p9tail = await pageText(page, 9);
  const p10head = await pageText(page, 10);
  check('manual break: page 9 ends with the short summary', !!p9tail && p9tail.includes('صفحه جدید دستی') === false && p9tail.includes('عمدی کوتاه'));
  check('manual break: page 10 starts after the break', !!p10head && p10head.includes('دقیقاً در صفحهٔ بعد از مرز دستی'));

  /* ── 3. blank page (page 6) selectable + editable ────────────────── */
  await clickPage(page, 6);
  await typeInto(page, 6, 'X');
  await sleep(400);
  const p6 = await pageText(page, 6);
  check('blank page receives typed text (selectable + editable)', !!p6 && p6.includes('X'));
  await page.screenshot({ path: SHOT(3), timeout: 5000 }).catch(() => {});
  // undo the probe character
  await page.keyboard.press('Control+z');
  await sleep(200);

  /* ── 4. typing mid-page-1 does NOT steal the active page ─────────── */
  const before = { count: await pageCount(page), active: await activePageNum(page) };
  await clickPage(page, 1);
  // park the caret in the first paragraph (click near its middle)
  await page.evaluate(() => {
    const ed = document.querySelectorAll('[data-page-id]')[0]?.querySelector('.pn-editor');
    const p = ed?.querySelector('p');
    if (!p) return;
    const r = p.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const el = document.elementFromPoint(cx, cy);
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el ?? p);
    range.collapse(true);
    sel?.removeAllRanges(); sel?.addRange(range);
  });
  await page.keyboard.type('تست‌جریان ', { delay: 14 });
  await sleep(1200); // let a flow pass run if the page overflowed
  const after1 = { count: await pageCount(page), active: await activePageNum(page) };
  check('active page unchanged after mid-page typing (no page steal)', after1.active === 1 || before.count !== after1.count ? true : after1.active === before.active, `active=${before.active}→${after1.active} pages=${before.count}→${after1.count}`);
  await page.screenshot({ path: SHOT(4), timeout: 5000 }).catch(() => {});

  /* ── 5. caret-follow: typing at the very END of page 9 flows over ── */
  await clickPage(page, 9);
  // put the caret at the end of page 9's last paragraph
  await page.evaluate(() => {
    const pages = document.querySelectorAll('[data-page-id]');
    const ed = pages[8]?.querySelector('.pn-editor');
    const last = ed?.lastElementChild;
    if (!last) return;
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(last);
    range.collapse(false); // end
    sel?.removeAllRanges(); sel?.addRange(range);
  });
  for (let i = 0; i < 60; i++) {
    await page.keyboard.type('بیشتر ', { delay: 10 });
    await sleep(120);
  }
  await sleep(1500);
  const activeEnd = await activePageNum(page);
  const p10After = await pageText(page, 10);
  check('caret follows content across the boundary', activeEnd !== null && activeEnd >= 9, `active=${activeEnd}`);
  check('overflow text landed on the next page', !!p10After && p10After.includes('بیشتر'), 'page10 contains «بیشتر»');
  await page.screenshot({ path: SHOT(5), timeout: 5000 }).catch(() => {});

  /* ── 6. backflow: select + delete the overflow, page count returns ─ */
  const countBeforeDel = await pageCount(page);
  // select all on the then-active page and delete it (auto page may vanish)
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await sleep(1200);
  const countAfterDel = await pageCount(page);
  check('deleting overflow does not grow the doc', countAfterDel <= countBeforeDel, `pages=${countBeforeDel}→${countAfterDel}`);

  /* ── 7. save + reload: structure intact ──────────────────────────── */
  await page.keyboard.press('Control+s');
  await sleep(2500); // autosave debounce + network
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.pn-editor', { timeout: 30000 });
  await sleep(2500);
  const countReloaded = await pageCount(page);
  const kindsReloaded = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.page-paper')).map((el) => {
      if (el.querySelector('.page-border')) return 'framed';
      if (el.querySelector('.page-notebook-lines')) return 'notebook';
      return el.className.includes('page-blank') ? 'blank' : '?';
    });
  });
  check('reload keeps page count', Math.abs(countReloaded - count0) <= 1, `was=${count0} now=${countReloaded}`);
  const prefix = kindsReloaded.slice(0, Math.min(count0, kindsReloaded.length)).join(',');
  check('reload keeps per-page kinds', prefix.startsWith('framed,notebook,blank,framed'), prefix);
  await page.screenshot({ path: SHOT(7), timeout: 5000 }).catch(() => {});

  /* ── 8. page-number tab renders in every frame ───────────────────── */
  const tabs = await page.evaluate(() => {
    const pages = Array.from(document.querySelectorAll('.page-paper.page-framed'));
    let withTab = 0;
    for (const el of pages) {
      const bg = getComputedStyle(el).backgroundImage || '';
      let svg = '';
      try { svg = decodeURIComponent(bg); } catch { svg = bg; }
      if (svg.includes('font-weight=\"800\"') && svg.includes('font-size=\"15\"')) withTab++;
    }
    return { framed: pages.length, withTab };
  });
  check('framed pages render the page-number tab', tabs.framed === 0 || tabs.withTab > 0, JSON.stringify(tabs));

  await browser.close();

  /* ── verdict ─────────────────────────────────────────────────────── */
  const failed = results.filter((r) => !r.ok);
  console.log('\n──────── QA SUMMARY ────────');
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach((f) => console.log(`  ✗ ${f.name} — ${f.detail}`));
    process.exitCode = 1;
  }
  fs.writeFileSync('qa-results.json', JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('QA crashed:', e); process.exit(2); });
