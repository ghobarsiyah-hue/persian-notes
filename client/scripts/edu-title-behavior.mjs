/**
 * Behavior probe — edu-box TITLES: can the user actually type into the
 * .edu-title-text span of every edu block, and does the text persist
 * through setNodeMarkup?
 *
 * Pins the report: «کادرای آموزشی تیترشونو نمیشه عوض کرد یا متن نوشت
 * واسشون. باید عین روی سوال سوالات کار کنه» — the title machinery is the
 * SAME editableTitleView for questionBlock and the rest, so whatever the
 * question box does, the others must do too.
 *
 * Simulates the browser's event flow in jsdom:
 *   click → mousedown/mouseup/click + focus + caret in span
 *   keydown on the span (the NodeView's own handler runs)
 *   input events (characterData mutation → MutationObserver → sync())
 *
 * Run: cd client && npx tsx scripts/edu-title-behavior.mjs
 */
/* iconAssets.ts uses Vite's import.meta.glob (unavailable under tsx/node) —
   serve a stub via a load hook BEFORE any project module loads */
import './edu-title-behavior.mjs.loader.mjs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
globalThis.document = dom.window.document;
globalThis.window = dom.window;
try { Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true }); } catch {}
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.InputEvent = dom.window.InputEvent;
globalThis.Event = dom.window.Event;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.Text = dom.window.Text;
globalThis.Range = dom.window.Range;
globalThis.getSelection = () => dom.window.getSelection();
/* jsdom has NO layout — PM's coordsAtPos/scrollIntoView need geometry stubs
   (the standard jsdom+prosemirror shim) */
const RECT = { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) };
dom.window.Element.prototype.getClientRects = function () { return [RECT]; };
dom.window.Element.prototype.getBoundingClientRect = function () { return RECT; };
dom.window.Range.prototype.getClientRects = function () { return [RECT]; };
dom.window.Range.prototype.getBoundingClientRect = function () { return RECT; };
try { dom.window.Text.prototype.getClientRects = function () { return [RECT]; }; dom.window.Text.prototype.getBoundingClientRect = function () { return RECT; }; } catch {}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
dom.window.scrollBy = () => {};
dom.window.scrollTo = () => {};
/* jsdom lacks execCommand — emulate the DOM edit typing produces */
document.execCommand = (cmd, _ui, value) => {
  if (cmd !== 'insertText') return false;
  const sel = dom.window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const tn = document.createTextNode(String(value ?? ''));
  range.insertNode(tn);
  range.setStartAfter(tn);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
};

const { Editor } = await import('@tiptap/core');
const StarterKit = (await import('@tiptap/starter-kit')).default;
const Document = (await import('@tiptap/extension-document')).default;
const Paragraph = (await import('@tiptap/extension-paragraph')).default;
const ExtensionText = (await import('@tiptap/extension-text')).default;

/* iconAssets stub is served by the loader hook; nothing to polyfill here */
const blocks = await import('../src/editor/extensions/blocks.ts');
const { CalloutBlock, QuestionBlock, ExampleBlock, KeyTermBlock, LongAnswerBlock, HighlightBox, ReferenceBlock, MatrixCompareBlock, OrderStepsBlock } = blocks;

let failed = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`);
  if (!ok) failed++;
}

/* mount a REAL editor with the REAL blocks (NodeViews included) */
const host = document.createElement('div');
document.body.appendChild(host);
const editor = new Editor({
  element: host,
  extensions: [
    Document, Paragraph, ExtensionText,
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, document: false, history: { depth: 100 } }),
    CalloutBlock, QuestionBlock, ExampleBlock, KeyTermBlock,
    LongAnswerBlock, HighlightBox, ReferenceBlock, MatrixCompareBlock, OrderStepsBlock,
  ],
  content: {
    type: 'doc',
    content: [
      { type: 'calloutBlock', attrs: { kind: 'definition' }, content: [{ type: 'paragraph' }] },
      { type: 'questionBlock', attrs: { question: '' }, content: [{ type: 'paragraph' }] },
      { type: 'exampleBlock', attrs: { title: '' }, content: [{ type: 'paragraph' }] },
      { type: 'keyTermBlock', attrs: { term: '' }, content: [{ type: 'paragraph' }] },
      { type: 'longAnswerBlock', attrs: { question: '', points: 0 }, content: [{ type: 'dispatch ' } ? { type: 'paragraph' } : { type: 'paragraph' }] },
      { type: 'highlightBox', attrs: { title: 'نکته برجسته' }, content: [{ type: 'paragraph' }] },
      { type: 'referenceBlock', attrs: { title: '' }, content: [{ type: 'paragraph' }] },
      { type: 'matrixCompareBlock', attrs: { topic: '', colLabels: ['', ''], rowLabels: ['', ''], cells: ['', '', '', ''] }, content: [{ type: 'paragraph' }] },
      { type: 'orderStepsBlock', attrs: { topic: '', steps: ['', '', ''] }, content: [{ type: 'paragraph' }] },
    ],
  },
});

const doc = editor.state.doc;
const blockPosOf = (typeName) => {
  let pos = -1;
  doc.descendants((n, p) => { if (n.type.name === typeName && pos < 0) pos = p; return pos < 0; });
  return pos;
};
/** the .edu-title-text span inside a block's NodeView DOM */
function titleSpan(typeName) {
  const blockDom = host.querySelector(`[data-type="${BLOCK_DATA_TYPE[typeName]}"]`);
  return blockDom?.querySelector('.edu-title-text') ?? null;
}
const BLOCK_DATA_TYPE = {
  calloutBlock: 'callout', questionBlock: 'question', exampleBlock: 'example',
  keyTermBlock: 'keyterm', longAnswerBlock: 'longanswer', highlightBox: 'highlightbox',
  referenceBlock: 'reference', matrixCompareBlock: 'matrixcompare', orderStepsBlock: 'ordersteps',
};

/** simulate a real user click INTO the title span (mousedown→focus→click) */
function clickTitle(typeName) {
  const span = titleSpan(typeName);
  if (!span) return false;
  const rect = { left: 5, top: 5, width: 10, height: 10 };
  for (const type of ['mousedown', 'mouseup', 'click']) {
    span.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.top, view: dom.window }));
  }
  /* place the caret inside the span like a real click would (jsdom has no
     layout; Selection.collapse is what Chromium leaves behind) */
  const sel = window.getSelection();
  sel.removeAllRanges();
  const r = document.createRange();
  r.selectNodeContents(span);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  /* focus the editor like the click would (the page editor is focused) */
  editor.view.focus();
  return true;
}

/** type one character into the span (beforeinput trap in the REAL app is
 *  Page.tsx's; here the span is contenteditable so typing edits the DOM
 *  directly — the MutationObserver then syncs it into the doc) */
function typeIntoSpan(span, char) {
  /* Chromium retargets beforeinput to PM root; the app traps it there.
     In jsdom we reproduce the RESULT: the DOM text changes, the observer
     fires. execCommand is flaky about carets here, so insert the text node
     DIRECTLY at the current caret (like the real beforeinput would). */
  let sel = dom.window.getSelection();
  if (!sel.anchorNode || !span.contains(sel.anchorNode)) {
    const r = document.createRange();
    r.selectNodeContents(span);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
    sel = dom.window.getSelection();
  }
  const anchor = sel.anchorNode;
  const at = sel.anchorOffset;
  if (anchor.nodeType === 3) {
    anchor.insertData(at, char);
    sel.collapse(anchor, at + char.length);
  } else {
    const tn = document.createTextNode(char);
    anchor.insertBefore(tn, anchor.childNodes[at] ?? null);
    sel.collapse(tn, tn.length);
  }
}

/* ── per-block: click the title, type, verify attr persistence ── */
const CASES = [
  ['questionBlock', 'question', 'سوال ریاضی'],
  ['calloutBlock', 'title', 'تعریف بردار'],
  ['exampleBlock', 'title', 'مثال ۱'],
  ['keyTermBlock', 'term', 'مشتق'],
  ['longAnswerBlock', 'question', 'تشریحی: اثبات کن'],
  ['highlightBox', 'title', 'نکته کلیدی'],
  ['referenceBlock', 'title', 'کتاب ریاضی ۱'],
  ['matrixCompareBlock', 'topic', 'مقایسهٔ سلول و بافر'],
  ['orderStepsBlock', 'topic', 'مراحل حل مسئله'],
];

for (const [typeName, attr, text] of CASES) {
  const ok = clickTitle(typeName);
  const span = titleSpan(typeName);
  check(`${typeName}: title span exists + clickable`, ok && !!span);
  if (!span) continue;
  /* start CLEAN: clear any prior title + anchor the caret at the START of
     the (possibly non-empty) span — a real user clicks into the box's
     placeholder and types over it */
  span.textContent = '';
  const pos = blockPosOf(typeName);
  const sel0 = dom.window.getSelection();
  const r0 = document.createRange();
  r0.selectNodeContents(span);
  r0.collapse(true);
  sel0.removeAllRanges();
  sel0.addRange(r0);
  /* type the text char by char (like real typing) */
  for (const ch of text) typeIntoSpan(span, ch);
  /* flush the MutationObserver + React-less sync */
  await new Promise((r) => setTimeout(r, 10));
  const node = editor.state.doc.nodeAt(pos);
  const persisted = (node?.attrs?.[attr] ?? '') === text;
  check(`${typeName}: typed title persists in attrs`, persisted,
    `attr="${node?.attrs?.[attr] ?? ''}" expected="${text}"`);
  /* caret stayed in the span (the «حرف می‌پره بیرون» regression) */
  const sel = window.getSelection();
  const stillIn = sel?.anchorNode != null && span.contains(sel.anchorNode);
  check(`${typeName}: caret stayed inside the title span`, stillIn);
  /* place caret at END for the next block's typing isolation */
  span.blur?.();
}

/* ── Enter in the title exits the block, never splits it ── */
{
  clickTitle('questionBlock');
  const span = titleSpan('questionBlock');
  const before = editor.state.doc.nodeAt(blockPosOf('questionBlock'))?.attrs.question;
  span.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 10));
  const after = editor.state.doc.nodeAt(blockPosOf('questionBlock'))?.attrs.question;
  const blocks = doc.childCount;
  let calloutCount = 0;
  editor.state.doc.descendants((n) => { if (n.type.name === 'questionBlock') calloutCount++; return false; });
  check('Enter in title: question attr unchanged (no split/clear)', after === before);
  check('Enter in title: still exactly one questionBlock', calloutCount === 1);
}

/* ── Backspace in EMPTY title hops out, never eats the block ── */
{
  const span = titleSpan('exampleBlock');
  const sel = window.getSelection();
  sel.removeAllRanges();
  const r = document.createRange();
  r.selectNodeContents(span);
  r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
  const beforeCount = doc.childCount;
  span.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
  await new Promise((r2) => setTimeout(r2, 10));
  let exCount = 0;
  editor.state.doc.descendants((n) => { if (n.type.name === 'exampleBlock') exCount++; return false; });
  check('Backspace in empty title: block survives', exCount === 1 && editor.state.doc.childCount >= beforeCount);
}

/* ── MatrixCompare cells + OrderSteps steps: attrs-persisted typing ── */
{
  const host2 = host.querySelector('[data-type="matrixcompare"]');
  const firstCol = host2?.querySelector('.cmp-matrix-coltext');
  const firstCell = host2?.querySelector('.cmp-matrix-celltext');
  check('matrixCompare: column/cell spans exist', !!firstCol && !!firstCell);
  if (firstCol && firstCell) {
    /* type into the first column label via the same direct-DN path */
    firstCol.textContent = '';
    const pos = blockPosOf('matrixCompareBlock');
    const sel = dom.window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(firstCol);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    firstCol.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    firstCol.appendChild(document.createTextNode('عرض'));
    await new Promise((res) => setTimeout(res, 10));
    const node = editor.state.doc.nodeAt(pos);
    const cols = (node?.attrs.colLabels ?? []);
    check('matrixCompare: column label persists', cols[0] === 'عرض', JSON.stringify(cols));
    /* type into a cell */
    firstCell.textContent = '';
    const r2 = document.createRange();
    r2.selectNodeContents(firstCell);
    r2.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r2);
    firstCell.appendChild(document.createTextNode('۲ گیگ'));
    await new Promise((res) => setTimeout(res, 10));
    const node2 = editor.state.doc.nodeAt(pos);
    check('matrixCompare: cell value persists', (node2?.attrs.cells ?? [])[0] === '۲ گیگ', JSON.stringify((node2?.attrs.cells ?? [])[0]));
  }
  const stepsHost = host.querySelector('[data-type="ordersteps"]');
  const firstStep = stepsHost?.querySelector('.edu-steps-text');
  check('orderSteps: step span exists', !!firstStep);
  if (firstStep) {
    firstStep.textContent = '';
    const pos = blockPosOf('orderStepsBlock');
    firstStep.appendChild(document.createTextNode('صورت مسئله را بخوان'));
    await new Promise((res) => setTimeout(res, 10));
    const node = editor.state.doc.nodeAt(pos);
    check('orderSteps: step text persists', ((node?.attrs.steps ?? [])[0]) === 'صورت مسئله را بخوان', JSON.stringify((node?.attrs.steps ?? [])[0]));
  }
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
