/** Probe: table caret placement — selection, activeElement, doc structure. */
import { chromium } from 'playwright-core';
const VITE = process.argv[2] ?? 'http://localhost:5174';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
const killer = setTimeout(() => { console.error('WATCHDOG'); process.exit(2); }, 120_000);
try {
  await page.goto(`${VITE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  await page.fill('input[type="email"]', 'demo@pernote.local');
  await page.fill('input[type="password"]', 'demo1234');
  await page.click('button[type="submit"]');
  await sleep(2500);
  await page.goto(`${VITE}/editor/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
  await sleep(2000);

  const dump = () => page.evaluate(() => {
    const editors = window.__pn?.editors ?? {};
    const id = Object.keys(editors)[0];
    const ed = editors[id];
    if (!ed) return { err: 'no editor' };
    const doc = ed.state.doc;
    const structure = [];
    doc.forEach((n, off) => structure.push(`${n.type.name}@${off}`));
    const ae = document.activeElement;
    return {
      id: id.slice(-4),
      structure,
      selection: { from: ed.state.selection.from, to: ed.state.selection.to },
      activeTag: ae?.tagName ?? null,
      inCell: !!(ae && ae.closest && ae.closest('td,th')),
      docSize: doc.content.size,
    };
  });

  console.log('initial:', await dump());
  await page.evaluate(() => {
    const editors = window.__pn?.editors ?? {};
    const ed = editors[Object.keys(editors)[0]];
    ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  });
  await sleep(800);
  console.log('after insert:', await dump());

  /* place caret at first text pos inside the LAST CELL via cell resolve */
  const placed = await page.evaluate(() => {
    const papers = Array.from(document.querySelectorAll('.document-pages .page-paper'));
    let editorId = null;
    for (const paper of papers) {
      if (paper.querySelector('.pn-editor table')) { editorId = paper.getAttribute('data-page-id'); break; }
    }
    const ed = (window.__pn?.editors ?? {})[editorId];
    if (!ed) return { err: 'no table editor', editorId };
    const doc = ed.state.doc;
    /* find last table INDEX (not offset) */
    let tableIndex = -1, off = 0, tableOff = -1;
    doc.forEach((n, o, i) => { if (n.type.name === 'table') { tableIndex = i; tableOff = o; } });
    if (tableIndex < 0) return { err: 'no table' };
    const table = doc.child(tableIndex);
    const lastRow = table.child(table.childCount - 1);
    const lastCell = lastRow.child(lastRow.childCount - 1);
    /* start of the last cell = tableOff + 1 + rows... compute inside-table offsets */
    let pos = tableOff + 1;
    for (let r = 0; r < table.childCount - 1; r++) pos += table.child(r).nodeSize;
    pos += 1; // into the row
    for (let c = 0; c < lastRow.childCount - 1; c++) pos += lastRow.child(c).nodeSize;
    pos += 1; // into the cell
    pos += 1; // into the cell's paragraph (text pos)
    ed.commands.setTextSelection(pos);
    ed.view.dom.focus({ preventScroll: true });
    return { pos, structure: Array.from({ length: doc.childCount }, (_, i) => doc.child(i).type.name) };
  });
  console.log('placed:', placed);
  await sleep(300);
  console.log('before type:', await dump());
  await page.keyboard.type('X', { delay: 20 });
  await sleep(300);
  console.log('after type:', await dump());
  const text = await page.evaluate(() => Array.from(document.querySelectorAll('.document-pages .pn-editor')).map((e) => e.textContent).join(''));
  console.log('docText:', JSON.stringify(text.slice(0, 120)));
} finally {
  clearTimeout(killer);
  await browser.close().catch(() => {});
}
process.exit(0);
