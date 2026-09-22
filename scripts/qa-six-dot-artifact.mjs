/* SIX-DOT ARTIFACT REGRESSION HARNESS
 * Invariant under test: NO USER ACTION = NO NEW USER OBJECT.
 *
 * The old DragHandle injected '⋮⋮' (2 columns × 3 dots = the six-dot artifact)
 * INSIDE the hovered ProseMirror block on mere pointer movement; PM's
 * MutationObserver parsed it into the document as real, undoable, persisted
 * text. This harness proves:
 *   A. hovering every sampled page (incl. touch-style synthetic moves) adds
 *      ZERO text to any editor (textContent equality before/after);
 *   B. no '⋮' glyph ever exists inside PM content (blocker);
 *   C. the handle, when visible, lives OUTSIDE .ProseMirror (overlay owner);
 *   D. hover does not mutate block styles (old code forced position:relative);
 *   E. hover does not pollute undo history (can().undo() stays false on a
 *      page with zero user edits);
 *   F. after a reload (mount/restore path) the document is still artifact-free.
 */
import { chromium } from 'playwright-core';

const VITE = process.argv[2] ?? 'http://localhost:5199';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto(VITE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
/* If a session from a prior run already authenticated us, /login may redirect
 * before the form paints — only fill it when the form is actually there. */
if (await page.$('input[type="email"]')) {
  await page.fill('input[type="email"]', 'demo@pernote.local');
  await page.fill('input[type="password"]', 'demo1234');
  await page.click('button[type="submit"]');
  await sleep(1500);
}
await page.goto(VITE + '/editor/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
await sleep(2000);

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
  ok ? pass++ : fail++;
};

/* PHASE 1 — VIRGIN EDITOR (zero user action so far). Hover-sweep the pages:
 * if the handle injected anything, text changes AND can().undo() flips true.
 * This is the strictest form of NO USER ACTION = NO NEW USER OBJECT. */
const editorHandle = await page.evaluateHandle(() => {
  const w = window;
  const ids = Object.keys(w.__pn?.editors ?? {});
  return w.__pn.editors[ids[0]];
});

const hoverEveryPage = async () => {
  const papers = await page.$$('.document-pages .page-paper');
  const sample = [0, 1, 6, 14].filter((i) => i < papers.length);
  for (const i of sample) {
    const paper = papers[i];
    await paper.scrollIntoViewIfNeeded();
    const boxes = await paper.$$('.ProseMirror > *');
    for (const b of boxes) {
      const box = await b.boundingBox();
      if (!box) continue;
      /* sweep horizontally across the left edge (the handle trigger zone),
       * like a real pointer path — several synthetic moves per block */
      for (let x = 2; x < 40; x += 12) {
        await page.mouse.move(box.x + x, box.y + box.height / 2);
        await sleep(15);
      }
    }
    await sleep(150);
  }
  return sample.length;
};

const virginText = await page.evaluate((ed) => ed.view.dom.textContent, editorHandle);
await hoverEveryPage();
await sleep(400);

const undoAfterHover = await page.evaluate((ed) => ed.can().undo(), editorHandle);
check('E. hover does not pollute undo history', undoAfterHover === false);
const virginTextAfter = await page.evaluate((ed) => ed.view.dom.textContent, editorHandle);
check('A0. hover on virgin editor adds ZERO text', virginText === virginTextAfter);

/* PHASE 2 — seed real user content: type آ, undo it (proves can().undo()
 * reflects real user edits), then type a PERMANENT seed ب so check G (restore
 * fidelity after reload) has legitimate content to look for. */
await page.evaluate((ed) => {
  ed.commands.focus('end');
  ed.commands.insertContent('آ');
}, editorHandle);
await sleep(150);
await page.evaluate((ed) => { ed.commands.undo(); }, editorHandle);
await sleep(150);
await page.evaluate((ed) => { ed.commands.insertContent('ب'); }, editorHandle);
/* wait past the autosave debounce so the seed is persisted before reload */
await sleep(3000);

/* Snapshot baseline: text of every page + full JSON of page 1 */
const snapTexts = () => page.evaluate(() => {
  const w = window;
  const out = { texts: {}, json: {}, undoable: {} };
  for (const [id, ed] of Object.entries(w.__pn?.editors ?? {})) {
    out.texts[id] = ed.view.dom.textContent;
    out.undoable[id] = ed.can().undo();
  }
  const first = Object.keys(w.__pn?.editors ?? {})[0];
  out.json[first] = JSON.stringify(w.__pn.editors[first].getJSON());
  return out;
});

const before = await snapTexts();

/* A+E: hover sweep with a MOUSE (deliberate pointer movement) */
const pagesHovered = await hoverEveryPage();
await sleep(400);
const afterHover = await snapTexts();

let textsEqual = true, textsDetail = '';
for (const id of Object.keys(before.texts)) {
  if (before.texts[id] !== afterHover.texts[id]) {
    textsEqual = false;
    textsDetail += ` page[${id}] "${before.texts[id]}" -> "${afterHover.texts[id]}"`;
  }
}
check(`A. mouse hover adds ZERO text (${pagesHovered} page(s) sampled)`, textsEqual, textsDetail);

/* C: handle may be visible after hover, but must live OUTSIDE .ProseMirror */
const dom = await page.evaluate(() => {
  const pm = document.querySelector('.document-pages .pn-editor-wrap .ProseMirror');
  const handleInPm = pm ? pm.querySelectorAll('.pn-drag-handle').length : -1;
  const overlayHandles = document.querySelectorAll('.pn-drag-overlay > .pn-drag-handle').length;
  return { handleInPm, overlayHandles };
});
check('C. handle lives in overlay, never inside ProseMirror content', dom.handleInPm === 0, `inPm=${dom.handleInPm} overlay=${dom.overlayHandles}`);

/* D: hovered blocks must not get style mutations from hover */
const blockStyles = await page.evaluate(() => {
  const pm = document.querySelector('.document-pages .pn-editor-wrap .ProseMirror');
  const touched = [];
  pm.querySelectorAll(':scope > *').forEach((b) => {
    if (b.getAttribute('style') && b.getAttribute('style').includes('position')) touched.push(b.getAttribute('style'));
  });
  return touched;
});
check('D. hover does not mutate block styles', blockStyles.length === 0, blockStyles.join(' | ').slice(0, 120));

/* B: blocker — no six-dot glyph anywhere in serialized PM content of ALL pages */
const sixInJson = await page.evaluate(() => {
  let count = 0, where = '';
  for (const [id, ed] of Object.entries(window.__pn?.editors ?? {})) {
    const s = JSON.stringify(ed.getJSON());
    if (s.includes('⋮')) { count++; where += ` page[${id}]`; }
  }
  return { count, where };
});
check('B. zero six-dot glyphs in TipTap JSON (all pages)', sixInJson.count === 0, sixInJson.where);

/* Touch-style: synthetic mousemove with NO prior mousedown/click (tap emulate) */
await page.touchscreen.tap(200, 200).catch(() => {
  /* headless Chrome without touch — emulate via a lone mousemove burst */
  return page.mouse.move(200, 200);
});
await sleep(200);
await hoverEveryPage();
await sleep(300);
const afterTap = await snapTexts();
let tapClean = true;
for (const id of Object.keys(before.texts)) {
  if (before.texts[id] !== afterTap.texts[id]) tapClean = false;
}
check('A2. touch-tap + synthetic moves add ZERO text', tapClean);

/* F: reload — mount/restore path must not resurrect the artifact */
const firstJsonBefore = Object.values(afterTap.json)[0];
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
await sleep(2500);
const sixAfterReload = await page.evaluate(() => {
  let found = false;
  for (const ed of Object.values(window.__pn?.editors ?? {})) {
    if (JSON.stringify(ed.getJSON()).includes('⋮')) found = true;
  }
  const pmText = document.querySelector('.document-pages .pn-editor-wrap .ProseMirror')?.textContent ?? '';
  return { found, pmHasGlyph: pmText.includes('⋮') };
});
check('F. reload/restore introduces no six-dot artifact', !sixAfterReload.found && !sixAfterReload.pmHasGlyph);

/* Integrity: the seeded user text must have SURVIVED reload (restore fidelity) */
const userTextSurvived = await page.evaluate(() => {
  const w = window;
  const first = Object.keys(w.__pn?.editors ?? {})[0];
  return (w.__pn.editors[first].view.dom.textContent ?? '').includes('ب');
});
check('G. legitimate user content survives reload', userTextSurvived);

/* H: the post-reload document must equal the pre-reload one (restore truth) */
const jsonAfterReload = await page.evaluate(() => {
  const w = window;
  const first = Object.keys(w.__pn?.editors ?? {})[0];
  return JSON.stringify(w.__pn.editors[first].getJSON());
});
check('H. document JSON identical before/after reload', jsonAfterReload === firstJsonBefore);

/* I: FUNCTIONAL — drag-to-reorder still works through the overlay handle.
 * Type two lines, hover line 2's left edge, grab the handle, drag above
 * line 1, drop, and verify the order swapped. */
/* the reload destroyed the page's previous JS context — re-acquire the handle */
const editorHandle2 = await page.evaluateHandle(() => {
  const w = window;
  const ids = Object.keys(w.__pn?.editors ?? {});
  return w.__pn.editors[ids[0]];
});
await page.evaluate((ed) => {
  ed.commands.focus('end');
  ed.commands.insertContent(' یک');
  ed.commands.enter();
  ed.commands.insertContent(' دو');
}, editorHandle2);
await sleep(400);
const lines = () => page.evaluate((ed) =>
  Array.from(ed.view.dom.querySelectorAll(':scope > p')).map((p) => p.textContent), editorHandle2);
const beforeDrag = await lines();
const secondLineBox = await page.evaluate((ed) => {
  const ps = Array.from(ed.view.dom.querySelectorAll(':scope > p'));
  const r = ps[ps.length - 1].getBoundingClientRect();
  return { x: r.left + 8, y: r.top + r.height / 2 };
}, editorHandle2);
await page.mouse.move(secondLineBox.x, secondLineBox.y);
await sleep(150); // handle appears
const handleBox = await page.evaluate(() => {
  const h = document.querySelector('.pn-drag-overlay > .pn-drag-handle');
  if (!h || getComputedStyle(h).display === 'none') return null;
  const r = h.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
if (handleBox) {
  const firstLineY = await page.evaluate((ed) => {
    const p = ed.view.dom.querySelector(':scope > p');
    return p.getBoundingClientRect().top + 2;
  }, editorHandle2);
  await page.mouse.move(handleBox.x, handleBox.y);
  await page.mouse.down();
  await page.mouse.move(handleBox.x, firstLineY, { steps: 8 });
  await sleep(80);
  await page.mouse.up();
  await sleep(300);
  const afterDrag = await lines();
  const swapped = afterDrag[afterDrag.length - 2] === beforeDrag[beforeDrag.length - 1] &&
                  afterDrag[afterDrag.length - 1] === beforeDrag[beforeDrag.length - 2];
  check('I. drag-to-reorder via handle still works', swapped,
    `before=${JSON.stringify(beforeDrag.slice(-2))} after=${JSON.stringify(afterDrag.slice(-2))}`);

  /* J: the reorder is ONE undoable user action — a single undo restores
   * the pre-drag order (no history pollution from hover/handle machinery). */
  await page.evaluate((ed) => { ed.commands.undo(); }, editorHandle2);
  await sleep(300);
  const afterUndo = await lines();
  check('J. single undo restores pre-drag order',
    JSON.stringify(afterUndo.slice(-2)) === JSON.stringify(beforeDrag.slice(-2)),
    `after=${JSON.stringify(afterUndo.slice(-2))}`);
} else {
  check('I. drag-to-reorder via handle still works', false, 'handle never became visible');
}

console.log(`\n${pass} pass, ${fail} fail`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
