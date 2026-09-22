/**
 * QA — Word-like table escape + pagination behavior around tables.
 * Drives the REAL React editor in headless Chrome:
 *
 *  T0. insert a table via the editor's own QA hook (__pn.editors), type in
 *  T1. Enter inside the last cell (after typing) → line INSIDE the cell
 *      (normal in-cell behavior must be preserved)
 *  T2. Enter again (empty last block) → paragraph AFTER the table, caret
 *      there, typing works
 *  T3. table + several paragraphs → the TABLE stays on page 1, only the
 *      following paragraphs flow to page 2 (the «کل جدول می‌پرد» bug)
 *  T5. ArrowDown at the end of the last cell → escapes below the table
 *  T4. Backspace at the start of the para after the table → back INSIDE
 *  T6. backflow regression: deleting everything shrinks the page count
 *
 * Usage: node scripts/qa-tables.mjs [viteUrl]
 */
import { chromium } from 'playwright-core';

const VITE = process.argv[2] ?? 'http://localhost:5174';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EDITORS_SCOPE = '.document-pages';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const killer = setTimeout(() => { console.error('⏱ WATCHDOG: force exit after 200s'); process.exit(2); }, 200_000);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  let pageError = null;
  page.on('pageerror', (e) => { pageError = String(e).slice(0, 300); });

  try {
    /* login through the app UI (vite proxies /api) */
    await page.goto(`${VITE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('input[type="email"]', { timeout: 30000 });
    await page.fill('input[type="email"]', 'demo@pernote.local');
    await page.fill('input[type="password"]', 'demo1234');
    await page.click('button[type="submit"]');
    await sleep(2500);
    check('login succeeded', !page.url().includes('/login'), page.url());

    await page.goto(`${VITE}/editor/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector(`.document-pages .pn-editor`, { timeout: 30000 });
    await sleep(2500);

    const pages = () => page.evaluate(() => document.querySelectorAll(`.document-pages .page-paper`).length);
    const paperText = (n) => page.evaluate((idx) => {
      const el = document.querySelectorAll(`.document-pages .page-paper`)[idx - 1];
      return el ? (el.querySelector('.pn-editor')?.textContent ?? '') : null;
    }, n);
    const docText = () => page.evaluate(() =>
      Array.from(document.querySelectorAll(`.document-pages .pn-editor`)).map((e) => e.textContent).join('')
    );
    /* authoritative in-cell check via ProseMirror state (activeElement is
       always the contenteditable DIV, never the TD) */
    const caretInTable = () => page.evaluate(() => {
      const ae = document.activeElement;
      const paper = ae?.closest ? ae.closest('.page-paper') : null;
      const pid = paper?.getAttribute('data-page-id');
      const ed = (window.__pn?.editors ?? {})[pid];
      if (!ed) return false;
      const $from = ed.state.selection.$from;
      for (let d = $from.depth; d > 0; d--) {
        const name = $from.node(d).type.name;
        if (name === 'tableCell' || name === 'tableHeader') return true;
        if (name === 'table') return false;
      }
      return false;
    });
    const tablePage = () => page.evaluate(() => {
      const papers = Array.from(document.querySelectorAll(`.document-pages .page-paper`));
      return papers.findIndex((p) => p.querySelector('.pn-editor table')) + 1 || null;
    });
    const clickPage = async (n) => {
      await page.evaluate((idx) => {
        const el = document.querySelectorAll(`.document-pages .page-paper`)[idx - 1];
        const ed = el?.querySelector('.pn-editor');
        if (!ed) return;
        const r = ed.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + 40 };
        const target = document.elementFromPoint(opts.clientX, opts.clientY) ?? ed;
        target.dispatchEvent(new MouseEvent('mousedown', opts));
        target.dispatchEvent(new MouseEvent('mouseup', opts));
        target.dispatchEvent(new MouseEvent('click', opts));
        ed.focus();
      }, n);
      await sleep(250);
    };
    /** focus the editor's LAST textblock position and select it */
    const focusEnd = async () => {
      await page.evaluate(() => {
        const editors = window.__pn?.editors ?? {};
        const ed = editors[Object.keys(editors)[0]];
        if (!ed) return;
        const size = ed.state.doc.content.size;
        ed.commands.focus();
        ed.commands.setTextSelection(Math.max(1, size - 1));
        ed.view.dom.focus({ preventScroll: true });
      });
      await sleep(250);
    };

    /* ── T0: insert a table through the QA hook, then click into it ── */
    await page.evaluate(() => {
      const editors = window.__pn?.editors ?? {};
      const ed = editors[Object.keys(editors)[0]];
      if (!ed) return;
      ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    });
    await sleep(1000);
    const hasTable = await page.evaluate(() => !!document.querySelector(`.document-pages .pn-editor table`));
    check('T0 table inserted', hasTable);
    /* put the caret in the last cell of the table */
    await page.evaluate(() => {
      const papers = Array.from(document.querySelectorAll('.document-pages .page-paper'));
      let editorId = null;
      for (const paper of papers) {
        if (paper.querySelector('.pn-editor table')) {
          editorId = paper.getAttribute('data-page-id');
          break;
        }
      }
      const ed = (window.__pn?.editors ?? {})[editorId];
      if (!ed) return;
      // select the first text position of the table's last cell
      const doc = ed.state.doc;
      let lastTableStart = -1;
      doc.forEach((n, off) => { if (n.type.name === 'table') lastTableStart = off; });
      if (lastTableStart < 0) return;
      const table = doc.child(lastTableStart);
      let cellStart = lastTableStart + 1;
      const lastRow = table.child(table.childCount - 1);
      for (let i = 0; i < table.childCount - 1; i++) cellStart += table.child(i).nodeSize;
      let lastCellStart = cellStart + 1;
      for (let i = 0; i < lastRow.childCount - 1; i++) lastCellStart += lastRow.child(i).nodeSize;
      ed.commands.setTextSelection(lastCellStart + 1);
      ed.view.dom.focus({ preventScroll: true });
    });
    await page.keyboard.type('ردیف آخر', { delay: 8 });
    await sleep(400);
    check('T0 typed into the last cell', (await docText()).includes('ردیف آخر') && (await caretInTable()));

    /* ── T1: Enter after typing → still INSIDE the cell ───────────── */
    await page.keyboard.press('Enter');
    await sleep(400);
    check('T1 first Enter stays inside the cell (in-cell line)', await caretInTable());

    /* ── T2: Enter on the now-empty last block → escape BELOW table ── */
    await page.keyboard.press('Enter');
    await sleep(500);
    check('T2 second Enter escapes below the table', !(await caretInTable()));
    await page.keyboard.type('متنی-بعد-از-جدول ', { delay: 10 });
    await sleep(600);
    check('T2 typing works in the paragraph after the table', (await docText()).includes('متنی-بعد-از-جدول'));

    /* ── T3: grow the table to the page bottom, then flow paragraphs ── */
    for (let i = 0; i < 8; i++) {
      await page.keyboard.type(`ردیف ${i + 1} کمی متن بیشتر `, { delay: 4 });
      await page.keyboard.press('Enter');
      await sleep(180);
    }
    /* back inside the table? (Enter kept us below it each time is fine) */
    await sleep(1200);
    const t3TablePage = await tablePage();
    const n3 = await pages();
    check('T3 document state ready', t3TablePage === 1 && (await docText()).includes('ردیف 8'), `tablePage=${t3TablePage} pages=${n3}`);

    /* pile paragraphs after the table until a page 2 exists */
    await focusEnd();
    let guard = 0;
    while ((await pages()) < 2 && guard++ < 40) {
      await page.keyboard.type('پاراگراف-پرکننده-پس-از-جدول ', { delay: 3 });
      await page.keyboard.press('Enter');
      await sleep(200);
    }
    await sleep(2000);
    const nPages = await pages();
    const p1 = (await paperText(1)) ?? '';
    const p2 = nPages >= 2 ? ((await paperText(2)) ?? '') : '';
    check('T3 page 2 exists after typing past the bottom', nPages >= 2, `pages=${nPages}`);
    check('T3 table stayed on page 1 (no teleport)', p1.includes('ردیف آخر') || p1.includes('ردیف 1'), 'table text on p1');
    check('T3 following paragraphs flowed to page 2', nPages >= 2 && p2.length > 0, `p2=${p2.slice(0, 30)}`);
    const tableOnP2 = nPages >= 2 ? await page.evaluate(() => {
      const p2ed = document.querySelectorAll(`.document-pages .page-paper`)[1];
      return !!p2ed?.querySelector('.pn-editor table');
    }) : false;
    check('T3 the table itself did NOT jump to page 2', !tableOnP2);
    const focus3 = await page.evaluate(() => {
      let el = document.activeElement;
      if (!el || !el.classList?.contains('pn-editor')) el = el?.closest?.('.pn-editor') ?? null;
      const paper = el?.closest?.('.page-paper');
      if (!paper) return null;
      const papers = Array.from(document.querySelectorAll(`.document-pages .page-paper`));
      return papers.indexOf(paper) + 1 || null;
    });
    check('T3 caret still active in an editor after flow', focus3 !== null, `focus=${focus3}`);

    /* ── T4: Backspace at the paragraph start → back INSIDE the table ── */
    await page.evaluate(() => {
      const editors = window.__pn?.editors ?? {};
      const ed = editors[Object.keys(editors)[0]];
      if (!ed) return;
      const doc = ed.state.doc;
      let tableEnd = -1;
      let off = 0;
      doc.forEach((n) => {
        if (tableEnd === -1 && n.type.name === 'table') tableEnd = off + n.nodeSize;
        off += n.nodeSize;
      });
      if (tableEnd < 0) return;
      ed.commands.setTextSelection(tableEnd + 1);
      ed.view.dom.focus({ preventScroll: true });
    });
    await sleep(300);
    const inTableBefore = await caretInTable();
    await page.keyboard.press('Backspace');
    await sleep(400);
    check('T4 Backspace on the para start returns INTO the table', !inTableBefore && (await caretInTable()));

    /* ── T6: backflow regression — delete everything, pages shrink ── */
    const beforeDel = await pages();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await sleep(2000);
    const afterDel = await pages();
    check('T6 deleting shrinks the page count', afterDel <= beforeDel, `pages ${beforeDel}→${afterDel}`);

    if (pageError) check('no page JS error', false, pageError);
    else check('no page JS error', true);
  } finally {
    clearTimeout(killer);
    await browser.close().catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n──── TABLE QA: ${results.length - failed.length}/${results.length} passed ────`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
