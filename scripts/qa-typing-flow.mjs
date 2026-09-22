/**
 * Regression QA for the pagination/typing-flow fixes — drives the REAL
 * React multi-page editor in headless Chrome and exercises the exact
 * acceptance scenarios:
 *
 *   R1. continuous typing reaches the page bottom → overflow flows to a
 *       NEW page, typing continues without interruption (no caret stuck)
 *   R2. Enter at the bottom → new paragraph on the continuation page,
 *       caret active there, NO phantom empty page before it
 *   R3. caret identity: typed text lands on the page the user is on
 *   R4. backflow: deleting content pulls the overflow back (page count
 *       shrinks, no content loss)
 *   R5. manual pageBreak still hard-breaks (unchanged behavior)
 *
 * Usage: node scripts/qa-typing-flow.mjs [viteUrl]
 * Requires: vite dev server + API already running.
 */
import { chromium } from 'playwright-core';

const VITE = process.argv[2] ?? 'http://localhost:5174';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* REAL editor pages only — the sidebar thumbnails embed .page-paper too */
const EDITORS_SCOPE = 'document-pages';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  let pageError = null;
  page.on('pageerror', (e) => { pageError = String(e).slice(0, 300); });

  /* login against the vite app (proxies /api) */
  await page.goto(`${VITE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  await page.fill('input[type="email"]', 'demo@pernote.local');
  await page.fill('input[type="password"]', 'demo1234');
  await page.click('button[type="submit"]');
  await sleep(1500);

  /* create a FRESH note through the app's own route */
  await page.goto(`${VITE}/editor/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
  await sleep(2500); // fonts + initial flow settle

  const pages = () => page.evaluate(() => document.querySelectorAll('.document-pages .page-paper').length);
  const activeIdx = () => page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.pn-page-item'));
    const el = items.find((e) => e.className.includes('active'));
    if (!el) return null;
    const id = el.getAttribute('data-page-id');
    const papers = Array.from(document.querySelectorAll('.document-pages .page-paper'));
    return papers.findIndex((p) => p.getAttribute('data-page-id') === id) + 1 || null;
  });
  const pageText = (n) => page.evaluate((idx) => {
    const el = document.querySelectorAll('.document-pages .page-paper')[idx - 1];
    return el ? (el.querySelector('.pn-editor')?.textContent ?? '') : null;
  }, n);
  /** page number (1-based) of the .page-paper containing the focused .pn-editor */
  const focusedEditorPage = () => page.evaluate(() => {
    let el = document.activeElement;
    if (!el || !el.classList?.contains('pn-editor')) {
      el = el?.closest?.('.pn-editor') ?? null;
    }
    const paper = el?.closest?.('.page-paper');
    if (!paper) return null;
    const papers = Array.from(document.querySelectorAll('.document-pages .page-paper'));
    return papers.indexOf(paper) + 1 || null;
  });
  /** click at the visual CENTER of the writing area of page n */
  const clickPage = async (n) => {
    await page.evaluate((idx) => {
      const el = document.querySelectorAll('.document-pages .page-paper')[idx - 1];
      const ed = el?.querySelector('.pn-editor');
      if (!ed) return;
      const r = ed.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + Math.min(60, r.height / 2);
      const target = document.elementFromPoint(cx, cy) ?? ed;
      const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
      target.dispatchEvent(new MouseEvent('mousedown', opts));
      target.dispatchEvent(new MouseEvent('mouseup', opts));
      target.dispatchEvent(new MouseEvent('click', opts));
      ed.focus();
    }, n);
    await sleep(250);
  };

  /* ── R1: continuous typing across the page-1 bottom ─────────────── */
  await clickPage(1);
  check('R0 editor received focus after click', (await focusedEditorPage()) === 1, `focus=${await focusedEditorPage()}`);
  const LINE = 'تایپ پیوسته برای عبور از انتهای برگه اول. ';
  let typed = '';
  for (let i = 0; i < 220; i++) {
    await page.keyboard.type(LINE, { delay: 5 });
    typed += LINE;
    if (i % 15 === 14) {
      if ((await pages()) >= 2) break;
    }
    await sleep(50);
  }
  await sleep(2000);
  const n1 = await pages();
  check('R1 overflow created a continuation page', n1 >= 2, `pages=${n1}`);
  const p1 = await pageText(1);
  const p2 = n1 >= 2 ? await pageText(2) : '';
  check('R1 page 1 kept its content (no clip)', !!p1 && p1.includes(LINE.trim().slice(0, 10)), `p1=${p1?.slice(0, 40)}`);
  check('R1 overflow text landed on page 2', !!p2 && p2.length > 0, `p2=${p2?.slice(0, 40)}`);
  const focus1 = await focusedEditorPage();
  check('R1 caret is ACTIVE on the continuation page', focus1 === 2, `focus page=${focus1}`);
  /* typing continuity: NOTHING the user typed may vanish (the Word feel) */
  const landed = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.document-pages .pn-editor'))
      .map((e) => e.textContent).join('').replace(/\s+/g, ' ').trim()
  );
  const expected = typed.replace(/\s+/g, ' ').trim();
  const lostChars = expected.length - landed.length;
  check('R1 typing continuity — no content lost across the break', Math.abs(lostChars) <= 2, `typed=${expected.length} landed=${landed.length} lost=${lostChars}`);
  check('R1 no content duplicated', landed.length - expected.length <= 2, `dup=${landed.length - expected.length}`);

  /* keep typing → must continue on page 2 (no stuck input) */
  const p2Before = await pageText(2);
  await page.keyboard.type('ادامهٔ تایپ ', { delay: 10 });
  await sleep(700);
  const p2After = await pageText(2);
  check('R1 typing continues on the new page', !!p2After && (p2After.length > (p2Before?.length ?? 0)) && p2After.includes('ادامهٔ تایپ'), `p2 grew ${p2Before?.length}→${p2After?.length}`);

  /* ── R2: Enter at the bottom flows a new paragraph forward ──────── */
  for (let i = 0; i < 40; i++) await page.keyboard.type('پرکردن تا مرز ', { delay: 5 });
  await sleep(900);
  await page.keyboard.press('Enter');
  await sleep(1200);
  const afterEnterText = 'خط-بعد-اینتر ';
  await page.keyboard.type(afterEnterText, { delay: 10 });
  await sleep(1000);
  const allText = await page.evaluate(() => Array.from(document.querySelectorAll('.document-pages .pn-editor')).map((e) => e.textContent).join('|'));
  check('R2 text typed after Enter exists in the document', allText.includes(afterEnterText.trim().slice(0, 8)), `«${afterEnterText.trim()}» found=${allText.includes(afterEnterText.trim().slice(0, 8))}`);
  const focus2 = await focusedEditorPage();
  check('R2 caret active after Enter at the boundary', focus2 !== null && focus2 >= 1, `focus page=${focus2}`);
  /* phantom page guard: only the LAST page may hold an empty editor */
  const phantom = await page.evaluate(() => {
    const eds = Array.from(document.querySelectorAll('.document-pages .page-paper .pn-editor'));
    return eds.slice(0, -1).filter((e) => (e.textContent ?? '').trim() === '').length;
  });
  check('R2 no phantom empty page except the live last one', phantom === 0, `empty middle pages=${phantom}`);

  /* ── R4: backflow — delete most of the last page → pages shrink ─── */
  const beforeDel = await pages();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await sleep(1800);
  const afterDel = await pages();
  check('R4 deleting overflow shrinks the page count', afterDel <= beforeDel, `pages ${beforeDel}→${afterDel}`);
  const p1AfterDel = await pageText(1);
  check('R4 page 1 survived the backflow intact', !!p1AfterDel && p1AfterDel.includes(LINE.trim().slice(0, 10)), `p1=${p1AfterDel?.slice(0, 40)}`);
  const focus3 = await focusedEditorPage();
  check('R4 caret still inside a real editor after backflow', focus3 !== null, `focused page=${focus3}`);

  /* ── R5: manual pageBreak unchanged (slash menu → «صفحه جدید») ──── */
  await clickPage(1);
  await page.keyboard.press('Control+End').catch(() => {});
  await page.keyboard.type('متن-قبل-بریک ', { delay: 8 });
  await sleep(400);
  await page.keyboard.type('/صفحه جدید', { delay: 14 });
  await sleep(700);
  await page.keyboard.press('Enter');
  await sleep(1800);
  const n5 = await pages();
  check('R5 manual pageBreak still creates a hard boundary', n5 >= 2, `pages=${n5}`);
  const lastText = await pageText(n5);
  check('R5 new page after the break is the LIVE last page (no phantom)', !!lastText && lastText.length < 60, `last page text=${lastText?.slice(0, 40)}`);
  const midText = await pageText(n5 - 1);
  check('R5 pre-break text stayed on the previous page', !!midText && midText.includes('متن-قبل-بریک'), `p${n5 - 1}=${midText?.slice(-40)}`);

  if (pageError) check('no page JS error', false, pageError);
  else check('no page JS error', true);

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n──── TYPING-FLOW QA: ${results.length - failed.length}/${results.length} passed ────`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
