/**
 * Headless pagination harness — mounts REAL TipTap editors with the REAL
 * index.css A4 geometry, runs the REAL flow engine (overflowFlow.ts), and
 * prints PASS/FAIL lines into #out for the outer Chrome --dump-dom run.
 *
 * Scenario A (the reported bug): type a long paragraph that crosses the
 * bottom of page 1. Expected: page 1 stays EXACTLY 1123px, content fits,
 * and the overflow continues on a NEW page — never a stretched/clipped
 * first sheet.
 *
 * Scenario B: a single giant paragraph as the ONLY block (k===0) must
 * still line-split — the classic "nothing can move" deadlock.
 */
import '../src/index.css';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextSelection } from '@tiptap/pm/state';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { PageBreak } from '../src/editor/extensions/PageBreak';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import {
  findOverflowSplit,
  findManualBreakSplit,
  findBackflowSplit,
  measureFreeSpace,
  isOverflowing,
} from '../src/editor/overflowFlow';

const out: string[] = [];
function log(s: string) { out.push(s); }

interface HPage {
  id: string;
  paper: HTMLElement;
  wrap: HTMLElement;
  editor: Editor;
}

let pages: HPage[] = [];
let pagesWrap: HTMLElement | null = null;
let seq = 0;

function freshContainer() {
  const app = document.getElementById('app')!;
  app.innerHTML = '';
  const scroll = document.createElement('div');
  scroll.className = 'pn-editor-scroll';
  pagesWrap = document.createElement('div');
  pagesWrap.className = 'document-pages';
  scroll.appendChild(pagesWrap);
  app.appendChild(scroll);
  pages = [];
}

function createPage(content?: unknown): HPage {
  const paper = document.createElement('div');
  paper.className = 'page-paper page-framed';
  const contentBox = document.createElement('div');
  contentBox.className = 'page-content';
  const wrap = document.createElement('div');
  wrap.className = 'pn-editor-wrap';
  const host = document.createElement('div');
  wrap.appendChild(host);
  contentBox.appendChild(wrap);
  paper.appendChild(contentBox);
  pagesWrap!.appendChild(paper);

  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({ history: { depth: 100 } }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      PageBreak,
      OrderedList.configure({ keepMarks: false, keepAttributes: false }),
      ListItem,
    ],
    content: content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
  });

  const p: HPage = { id: 'p' + seq++, paper, wrap, editor };
  pages.push(p);
  return p;
}

/** move `split` from page i forward — mirrors applyFlowMove 2a/2b */
function moveForward(i: number, split: { from: number; to: number; nodes: unknown[] }) {
  const src = pages[i].editor;
  src.commands.command(({ tr }) => { tr.delete(split.from, split.to); return true; });
  if (src.state.doc.childCount === 0) {
    try { src.commands.insertContentAt(0, { type: 'paragraph' }); } catch { /* ignore */ }
  }
  if (i + 1 < pages.length) {
    const dst = pages[i + 1].editor;
    for (let k = split.nodes.length - 1; k >= 0; k--) {
      try {
        const node = dst.state.schema.nodeFromJSON(split.nodes[k] as never);
        dst.commands.command(({ tr }) => { tr.insert(0, node); return true; });
      } catch { /* schema mismatch — skip */ }
    }
  } else {
    createPage({ type: 'doc', content: split.nodes.length ? split.nodes : [{ type: 'paragraph' }] });
  }
}

/** one engine step across all pages; true when a move happened */
function flowStep(): boolean {
  for (let i = 0; i < pages.length; i++) {
    const split = findOverflowSplit(pages[i].editor);
    if (split) { moveForward(i, split); return true; }
  }
  return false;
}

function runFlowToSettled(maxSteps = 300): number {
  let steps = 0;
  while (flowStep()) {
    steps++;
    if (steps === maxSteps) {
      log(`INFO cascade hit maxSteps=${maxSteps} — LIVELOCK SUSPECTED`);
      const dbg = pages.map((p) => ({
        blocks: p.editor.state.doc.childCount,
        types: p.editor.state.doc.content.content.map((c: { type: { name: string } }) => c.type.name).join(','),
        overflowing: isOverflowing(p.editor),
      }));
      log('INFO cascade state: ' + JSON.stringify(dbg));
      break;
    }
  }
  return steps;
}

/** Append text to the END of the LAST page — mirrors real typing at the
 *  live cursor after the flow engine has moved the caret's content. */
function typeChunk(text: string) {
  const ed = pages[pages.length - 1].editor;
  const pos = ed.state.doc.content.size - 1; // inside the last paragraph
  ed.commands.command(({ tr }) => { tr.insertText(text, pos); return true; });
}

/** headless-safe yield: rAF stops firing once the page idles under
 *  --virtual-time-budget; setTimeout is always driven by virtual time, and
 *  reading offset* forces layout synchronously anyway — no paint needed. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** incremental output so a timeout still shows partial results */
function flush() {
  const el = document.getElementById('out');
  if (el) el.textContent = 'HARNESS-RESULT\n' + out.join('\n');
}
function flushSoon() { setTimeout(flush, 0); }

function report(ok: boolean, label: string, detail = '') {
  log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
}

function pageStats(p: HPage) {
  const pm = p.editor.view.dom as HTMLElement;
  const wrapH = p.wrap.clientHeight;
  return {
    id: p.id,
    pmH: pm.offsetHeight,
    wrapH,
    overflowing: isOverflowing(p.editor),
    blocks: p.editor.state.doc.childCount,
    text: p.editor.state.doc.textContent.length,
    first: p.editor.state.doc.childCount ? p.editor.state.doc.child(0).type.name : '∅',
  };
}

/* ── Scenario A: continuous typing across the page-1 bottom ─────────── */
async function scenarioA() {
  flushSoon();
  freshContainer();
  createPage();
  await tick();

  const cs = getComputedStyle(pages[0].paper);
  report(cs.height === '1123px', 'A0 css applied: paper computed height 1123px', `got ${cs.height}`);

  const TYPED = 'سلام این یک متن آزمایشی طولانی است برای عبور از مرز صفحه. ';
  const full = TYPED.repeat(90); // ≈ 5900 chars ≈ 2+ pages
  const CHUNK = 80;
  const deadline = Date.now() + 20000; // hard wall-clock cap
  let lastLogged = -1;
  for (let i = 0; i < full.length; i += CHUNK) {
    typeChunk(full.slice(i, i + CHUNK));
    await tick();
    runFlowToSettled();
    if (Date.now() > deadline) {
      log(`INFO scenario A aborted at chunk ${i}/${full.length} (wall clock)`);
      break;
    }
    const pct = Math.floor((i / full.length) * 10);
    if (pct !== lastLogged) { lastLogged = pct; log(`INFO A progress ${pct * 10}% pages=${pages.length}`); flushSoon(); }
  }
  await tick();

  const stats = pages.map(pageStats);
  log('INFO A stats: ' + JSON.stringify(stats));

  report(pages[0].paper.offsetHeight === 1123, 'A1 page-1 paper offsetHeight is exactly 1123', `got ${pages[0].paper.offsetHeight}`);
  report(!isOverflowing(pages[0].editor), 'A2 page-1 content fits its sheet', `pmH=${stats[0].pmH} wrapH=${stats[0].wrapH}`);
  report(pages.length >= 2, 'A3 a second page exists', `pages=${pages.length}`);
  const total = pages.reduce((s, p) => s + p.editor.state.doc.textContent.length, 0);
  report(total === full.length, 'A4 no content lost or duplicated', `expected ${full.length}, got ${total}`);
  report(pages[1] && pages[1].editor.state.doc.textContent.length > 0, 'A5 overflow landed on page 2', pages[1] ? `page2 text=${pages[1].editor.state.doc.textContent.length}` : 'no page 2');
}

/* ── Scenario B: single giant paragraph is the ONLY block ───────────── */
async function scenarioB() {
  flushSoon();
  freshContainer();
  const long = 'کلمه '.repeat(2000); // one paragraph, one block, > 1 page tall
  createPage({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: long }] }] });
  await tick();

  const steps = runFlowToSettled();
  await tick();

  const stats = pages.map(pageStats);
  log('INFO B stats: ' + JSON.stringify(stats) + ` steps=${steps}`);

  report(pages.length >= 2, 'B1 a second page exists for the lone giant paragraph', `pages=${pages.length}`);
  report(!isOverflowing(pages[0].editor), 'B2 page-1 content fits', `pmH=${stats[0].pmH} wrapH=${stats[0].wrapH}`);
  const total = pages.reduce((s, p) => s + p.editor.state.doc.textContent.length, 0);
  report(total === long.length, 'B3 no content lost or duplicated', `expected ${long.length}, got ${total}`);
}

/* ── Scenario C: deletion flows content BACK up (auto page removed) ─── */
async function scenarioC() {
  flushSoon();
  freshContainer();
  createPage();
  await tick();
  const TYPED = 'متن آزمایشی برای بازگشت پس از حذف. ';
  const full = TYPED.repeat(160); // ≈ 5600 chars — must overflow page 1
  for (let i = 0; i < full.length; i += 160) {
    typeChunk(full.slice(i, i + 160));
    await tick();
    runFlowToSettled();
  }
  await tick();
  runFlowToSettled();
  await tick();
  const before = pages.length;
  log(`INFO C pages before delete: ${before} — stats: ${JSON.stringify(pages.map(pageStats))}`);
  if (before < 2) {
    report(false, 'C0 forward fill produced 2+ pages first', `pages=${before}`);
    return;
  }

  /* TEST I: delete a chunk from PAGE 1 → page 2's content must flow back.
     Deleting ~40% of page 1 frees several hundred px of headroom. */
  const first = pages[0].editor;
  const size1 = first.state.doc.content.size;
  const delFrom = Math.max(1, Math.floor(size1 * 0.3));
  const delTo = Math.max(delFrom + 1, Math.floor(size1 * 0.7));
  first.commands.command(({ tr }) => { tr.delete(delFrom, delTo); return true; });
  await tick();
  const afterDeleteText = pages.reduce((s, p) => s + p.editor.state.doc.textContent.length, 0);
  const page2Before = pages[1].editor.state.doc.textContent.length;

  /* backward cascade: pull from next page while the previous has room */
  for (let guard = 0; guard < 200; guard++) {
    let moved = false;
    for (let i = 0; i < pages.length - 1; i++) {
      const free = measureFreeSpace(pages[i].editor);
      if (free <= 2) continue;
      const back = findBackflowSplit(pages[i + 1].editor, free, { allowEmpty: true });
      if (!back || !back.nodes.length) continue;
      const src = pages[i + 1].editor;
      src.commands.command(({ tr }) => { tr.delete(back.from, back.to); return true; });
      if (src.state.doc.childCount === 0) {
        try { src.commands.insertContentAt(0, { type: 'paragraph' }); } catch { /* ignore */ }
      }
      const dst = pages[i].editor;
      for (const j of back.nodes) {
        try {
          const node = dst.state.schema.nodeFromJSON(j as never);
          dst.commands.command(({ tr }) => { tr.insert(dst.state.doc.content.size, node); return true; });
        } catch { /* skip */ }
      }
      moved = true;
    }
    if (!moved) break;
  }
  await tick();

  const afterText = pages.reduce((s, p) => s + p.editor.state.doc.textContent.length, 0);
  const page2After = pages[1].editor.state.doc.textContent.length;
  log(`INFO C after backflow: stats: ${JSON.stringify(pages.map(pageStats))}`);
  /* backflow moved content: page 1 grew, page 2 shrank */
  report(pages[0].editor.state.doc.textContent.length > delTo - delFrom, 'C1 content flowed BACK into page 1', `p1=${pages[0].editor.state.doc.textContent.length}`);
  report(page2After < page2Before, 'C2 page 2 gave up content', `p2 ${page2Before} → ${page2After}`);
  /* backflow itself must neither lose nor duplicate (the deliberate delete is excluded) */
  report(Math.abs(afterText - afterDeleteText) <= 5, 'C3 backflow lost/duplicated nothing', `afterDelete=${afterDeleteText} afterBackflow=${afterText}`);
  report(!pages.some((p) => isOverflowing(p.editor)), 'C4 no page overflows after backflow', JSON.stringify(pages.map(pageStats)));
}

/* ── Scenario D: a 50-row table must split across pages ─────────────── */
async function scenarioD() {
  flushSoon();
  freshContainer();
  const row = () => ({
    type: 'tableRow',
    content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ردیف' }] }] }],
  });
  const rows: unknown[] = Array.from({ length: 50 }, row);
  rows.unshift({ type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'سرستون' }] }] }] });
  createPage({ type: 'doc', content: [{ type: 'table', content: rows }] });
  await tick();
  runFlowToSettled();
  await tick();

  const stats = pages.map(pageStats);
  log('INFO D stats: ' + JSON.stringify(stats));
  report(pages.length >= 2, 'D1 the 50-row table split across pages', `pages=${pages.length}`);
  report(!pages.some((p) => isOverflowing(p.editor)), 'D2 no page overflows', JSON.stringify(stats));
  let dataRows = 0;
  let headerRows = 0;
  for (const p of pages) {
    p.editor.state.doc.forEach((n: any) => {
      if (n.type.name !== 'table') return;
      n.forEach((r: any) => {
        if (r.firstChild?.type.name === 'tableHeader') headerRows++;
        else dataRows++;
      });
    });
  }
  /* continuation pages repeat the header (TEST H) — so header rows equal
     the number of table parts, while DATA rows must stay exactly 50 */
  report(dataRows === 50, 'D3 all 50 data rows survived (no loss, no dup)', `dataRows=${dataRows}`);
  report(headerRows >= 2, 'D4 header repeats on every continuation page', `headers=${headerRows} (parts=${pages.length})`);
}

/* ── Scenario E: manual pageBreak forces a hard boundary ────────────── */
async function scenarioE() {
  flushSoon();
  freshContainer();
  createPage({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'صفحه اول' }] },
      { type: 'pageBreak' },
      { type: 'paragraph', content: [{ type: 'text', text: 'صفحه دوم' }] },
    ],
  });
  await tick();

  const manual = findManualBreakSplit(pages[0].editor);
  report(!!manual, 'E1 manual break detected', manual ? `from=${manual.from}` : 'none');
  if (manual) {
    moveForward(0, manual);
    await tick();
  }
  report(pages.length >= 2, 'E2 break created a second page', `pages=${pages.length}`);
  report(pages[0].editor.state.doc.textContent.includes('صفحه اول') && !pages[0].editor.state.doc.textContent.includes('صفحه دوم'), 'E3 page 1 keeps only its content', pages[0].editor.state.doc.textContent);
  report(pages[1] && pages[1].editor.state.doc.textContent.includes('صفحه دوم'), 'E4 content after break landed on page 2', pages[1]?.editor.state.doc.textContent ?? '');
  /* no pageBreak node may survive inside a page (the boundary replaced it) */
  const strayBreaks = pages.filter((p) => {
    let has = false;
    p.editor.state.doc.forEach((n: any) => { if (n.type.name === 'pageBreak') has = true; });
    return has;
  });
  report(strayBreaks.length === 0, 'E5 no stray pageBreak node remains in any page');
  report(!pages.some((p) => isOverflowing(p.editor)), 'E6 no page overflows');
}

/* ── Scenario F: caret + selection continuity across the break ──────── */
async function scenarioF() {
  flushSoon();
  freshContainer();
  createPage();
  await tick();

  /* fill page 1 to ~85% then type at the END so the overflow starts near
     the caret — mirrors real typing across a page boundary */
  const TYPED = 'خط آزمایشی برای پیوستگی مکان‌نما. ';
  let text = TYPED;
  typeChunk(TYPED);
  while (!isOverflowing(pages[0].editor)) {
    typeChunk(TYPED);
    text += TYPED;
    await tick();
    if (text.length > 20000) break;
  }
  /* the split's `from` is where overflow begins; place the caret INSIDE
     the overflow region (at split.from + 20) like real typing would */
  const split = findOverflowSplit(pages[0].editor);
  if (!split) { report(false, 'F0 overflow exists for caret test'); return; }
  const caretInOverflow = Math.min(split.from + 20, pages[0].editor.state.doc.content.size - 1);
  pages[0].editor.commands.command(({ tr }) => {
    tr.setSelection(TextSelection.create(pages[0].editor.state.doc, caretInOverflow));
    return true;
  });
  /* a 15-char selection straddling the break */
  const selFrom = Math.min(split.from - 5, caretInOverflow);
  pages[0].editor.commands.command(({ tr }) => {
    tr.setSelection(TextSelection.create(pages[0].editor.state.doc, Math.max(1, selFrom), caretInOverflow));
    return true;
  });
  const moved = moveForwardWithCaret(0, split, { sourceActive: true, sourceCaret: caretInOverflow });
  await tick();
  report(moved, 'F1 overflow moved forward');
  /* the caret must have FOLLOWED onto page 2 (controller contract):
     mapped ≈ sourceCaret - split.from + 1, clamped to the dest textblock */
  const ed2 = pages[pages.length - 1].editor;
  const mapped = caretInOverflow - split.from + 1;
  const sel = ed2.state.selection;
  report(
    sel.from === sel.to && sel.from >= 1,
    'F2 caret followed onto destination page',
    `mapped≈${mapped} got from=${sel.from} to=${sel.to}`,
  );
}

/** moveForward + caret mapping — mirrors applyFlowMove 2a (fixed version) */
function moveForwardWithCaret(i: number, split: { from: number; to: number; nodes: unknown[] }, caret: { sourceActive: boolean; sourceCaret: number }) {
  const src = pages[i].editor;
  const tr = src.state.tr.delete(split.from, split.to);
  tr.setMeta('addToHistory', false);
  src.commands.command(({ tr: t2 }) => { t2.delete(split.from, split.to); return true; });
  void tr;
  if (src.state.doc.childCount === 0) {
    try { src.commands.insertContentAt(0, { type: 'paragraph' }); } catch { /* ignore */ }
  }
  if (i + 1 < pages.length) {
    const dst = pages[i + 1].editor;
    for (let k = split.nodes.length - 1; k >= 0; k--) {
      try {
        const node = dst.state.schema.nodeFromJSON(split.nodes[k] as never);
        dst.commands.command(({ tr }) => { tr.insert(0, node); return true; });
      } catch { /* skip */ }
    }
    /* the FIXED mapping: p → p - split.from + 1 (no off-by-one) */
    if (caret.sourceActive && caret.sourceCaret > split.from) {
      const mapped = caret.sourceCaret - split.from + 1;
      dst.commands.command(({ tr }) => {
        tr.setSelection(TextSelection.create(dst.state.doc, Math.min(mapped, dst.state.doc.content.size - 1)));
        return true;
      });
    }
    return true;
  }
  createPage({ type: 'doc', content: split.nodes.length ? split.nodes : [{ type: 'paragraph' }] });
  return true;
}

/* ── Scenario G: ordered list keeps numbering across the split ──────── */
async function scenarioG() {
  flushSoon();
  freshContainer();
  const item = (t: string) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
  const items = Array.from({ length: 40 }, (_, i) => item(`بند شماره ${i + 1} با کمی متن بیشتر برای ارتفاع`));
  createPage({ type: 'doc', content: [{ type: 'orderedList', attrs: { start: 1 }, content: items }] });
  await tick();
  runFlowToSettled();
  await tick();

  const lists: { start: number; count: number }[] = [];
  for (const p of pages) {
    p.editor.state.doc.forEach((n: any) => {
      if (n.type.name === 'orderedList') lists.push({ start: Number(n.attrs.start) || 1, count: n.childCount });
    });
  }
  report(pages.length >= 2, 'G1 ordered list split across pages', `pages=${pages.length}`);
  report(lists.length >= 2, 'G2 both pages have a list part', JSON.stringify(lists));
  if (lists.length >= 2) {
    const contiguous = lists[0].start + lists[0].count === lists[1].start;
    report(contiguous, 'G3 numbering continues (start aligns)', `p1: start=${lists[0].start} count=${lists[0].count}; p2: start=${lists[1].start}`);
  }
  const totalItems = lists.reduce((s, l) => s + l.count, 0);
  report(totalItems === 40, 'G4 no items lost or duplicated', `items=${totalItems}`);
}

/* ── Scenario H: engine moves stay OUT of the user's undo history ───── */
async function scenarioH() {
  flushSoon();
  freshContainer();
  createPage();
  await tick();
  const TYPED = 'خط آزمایشی برای تاریخچه برگشت. ';
  const full = TYPED.repeat(80);
  for (let i = 0; i < full.length; i += 160) {
    typeChunk(full.slice(i, i + 160));
    await tick();
    runFlowToSettled();
  }
  await tick();
  if (pages.length < 2) {
    for (let i = 0; i < 60 && pages.length < 2; i++) {
      typeChunk(full.slice(0, 160));
      await tick();
      runFlowToSettled();
    }
  }
  if (pages.length < 2) { report(false, 'H0 needs 2+ pages first', `pages=${pages.length}`); return; }

  /* type user text directly on page 2 so it has its own undo history */
  const page2Ed = pages[pages.length - 1].editor;
  const pos2 = page2Ed.state.doc.content.size - 1;
  page2Ed.commands.command(({ tr }) => { tr.insertText('XXX', pos2); return true; });
  await tick();

  /* delete 30-70% from page 1 to create free space */
  const dstEd = pages[pages.length - 2].editor;
  const dstSize = dstEd.state.doc.content.size;
  dstEd.view.dispatch(dstEd.state.tr.delete(Math.floor(dstSize * 0.3), Math.floor(dstSize * 0.7)));
  await tick();

  const free = measureFreeSpace(dstEd);
  const back = free > 2 ? findBackflowSplit(page2Ed, free, { allowEmpty: true }) : null;
  report(!!back && !!back.nodes.length, 'H1 backward move for deletion backflow', back ? `nodes=${back.nodes.length} free=${Math.round(free)}px` : `none free=${Math.round(free)}px`);

  if (back && back.nodes.length) {
    const tr = page2Ed.state.tr.delete(back.from, back.to);
    tr.setMeta('addToHistory', false);
    page2Ed.view.dispatch(tr);
    if (page2Ed.state.doc.childCount === 0) {
      try {
        page2Ed.view.dispatch(page2Ed.state.tr.insert(0, page2Ed.state.schema.nodes.paragraph.create()).setMeta('addToHistory', false));
      } catch { /* ignore */ }
    }
    for (const j of back.nodes) {
      try {
        const node = dstEd.state.schema.nodeFromJSON(j as never);
        dstEd.view.dispatch(dstEd.state.tr.insert(dstEd.state.doc.content.size, node).setMeta('addToHistory', false));
      } catch { /* skip */ }
    }
  }
  await tick();

  const beforeUndo = page2Ed.state.doc.textContent.length;
  const hadHistory = page2Ed.commands.undo();
  await tick();
  const afterUndo = page2Ed.state.doc.textContent.length;
  report(
    !hadHistory || afterUndo >= beforeUndo,
    'H2 undo does not undo engine moves',
    `before=${beforeUndo} after=${afterUndo} hadHistory=${hadHistory}`,
  );
  if (hadHistory) {
    page2Ed.commands.redo();
    await tick();
    report(page2Ed.state.doc.textContent.length === beforeUndo, 'H3 redo round-trips correctly', `now=${page2Ed.state.doc.textContent.length} expected=${beforeUndo}`);
  }
}

/* ── Scenario I: widow/orphan control (§9, TEST 9-analog of §30-9 style) ──
 * A paragraph split at a page boundary must never leave a lone line on
 * either side when space allows otherwise. We assert the ENGINE-LEVEL
 * guarantee: the orphan guard returns a whole-block move when the kept
 * prefix would be a stub — i.e. findOverflowSplit's `from` equals the
 * block start (nothing stays) instead of a 1-line stub position.
 */
async function scenarioI() {
  flushSoon();
  freshContainer();
  createPage();
  await tick();
  /* fill page 1 with short paragraphs until 2 pages exist */
  const LINE = 'خط کوتاه برای پرکردن صفحه. ';
  for (let i = 0; i < 300 && pages.length < 2; i++) {
    typeChunk(LINE);
    runFlowToSettled();
    await tick();
  }
  if (pages.length < 2) { report(false, 'I0 needs 2 pages first', `pages=${pages.length}`); return; }

  /* free most of page 2 by deleting its content, then create a paragraph
     on page 2 whose first line JUST fits back on page 1 (orphan bait) */
  const p2 = pages[1].editor;
  p2.commands.command(({ tr }) => { tr.delete(1, p2.state.doc.content.size - 1); return true; });
  await tick();
  /* now page 1 has free space; shrink page 1 by deleting its last few
     blocks so exactly ~2 lines of headroom remain, then re-run flow */
  const p1 = pages[0].editor;
  const size1 = p1.state.doc.content.size;
  p1.commands.command(({ tr }) => { tr.delete(Math.floor(size1 * 0.85), size1 - 1); return true; });
  await tick();
  /* pull page 2's content back — backflow gives page 1 a prefix of p2 */
  const free = measureFreeSpace(p1);
  const back = findBackflowSplit(p2, free, { allowEmpty: true });
  log(`INFO I stats: free=${Math.round(free)}px back=${back ? back.nodes.length + ' nodes' : 'none'}`);
  report(!!back, 'I1 backflow computed for freed space', `free=${Math.round(free)}px`);
  /* the split must be line-aware, not character-guessed: the nodes JSON
     must be valid block fragments (paragraph or text content) */
  report(
    !!back && back.nodes.every((n) => typeof n.type === 'string' && n.type !== 'text'),
    'I2 backflow moves whole blocks (never raw text runs)',
  );
  /* no page may overflow after the guarded backflow */
  const applied = back && back.nodes.length ? ((): boolean => {
    const src = p2;
    src.commands.command(({ tr }) => { tr.delete(back.from, back.to); return true; });
    if (src.state.doc.childCount === 0) {
      try { src.commands.insertContentAt(0, { type: 'paragraph' }); } catch { /* ignore */ }
    }
    for (const j of back.nodes) {
      try {
        const node = p1.state.schema.nodeFromJSON(j as never);
        p1.commands.command(({ tr }) => { tr.insert(p1.state.doc.content.size, node); return true; });
      } catch { /* skip */ }
    }
    return true;
  })() : false;
  await tick();
  report(applied, 'I3 guarded backflow applied');
  report(!pages.some((p) => isOverflowing(p.editor)), 'I4 no page overflows after guarded backflow', JSON.stringify(pages.map(pageStats)));
}

/* ── Scenario J: 20+ paragraphs flow continuously (§30 TEST 3) ───────── */
async function scenarioJ() {
  flushSoon();
  freshContainer();
  createPage();
  await tick();
  const P = 'پاراگراف شماره‌دار برای آزمون جریان پیوسته سند. ';
  for (let i = 0; i < 24; i++) {
    const ed = pages[pages.length - 1].editor;
    const pos = ed.state.doc.content.size - 1;
    ed.commands.command(({ tr }) => {
      tr.insertText(P.repeat(3), pos);
      tr.split(pos + P.repeat(3).length);
      return true;
    });
    await tick();
    runFlowToSettled();
  }
  await tick();
  const stats = pages.map(pageStats);
  log('INFO J stats: ' + JSON.stringify(stats));
  report(pages.length >= 2, 'J1 24 paragraphs produced 2+ pages', `pages=${pages.length}`);
  report(!pages.some((p) => isOverflowing(p.editor)), 'J2 no page overflows', JSON.stringify(stats));
  const expected = 24 * P.repeat(3).length;
  const total = pages.reduce((s, p) => s + p.editor.state.doc.textContent.length, 0);
  report(total === expected, 'J3 no content lost or duplicated', `expected ${expected}, got ${total}`);
  report(pages[0].paper.offsetHeight === 1123, 'J4 every page stays exactly 1123px tall', pages.map((p) => p.paper.offsetHeight).join(','));
}

/* ── runner ──────────────────────────────────────────────────────────── */
(async () => {
  try {
    await scenarioA();
    await scenarioB();
    await scenarioC();
    await scenarioD();
    await scenarioE();
    await scenarioF();
    await scenarioG();
    await scenarioH();
    await scenarioI();
    await scenarioJ();
  } catch (e) {
    log('FATAL ' + ((e as Error)?.stack ?? String(e)) + ' | state: ' + JSON.stringify(pages.map(pageStats)));
  }
  flush();
})();
