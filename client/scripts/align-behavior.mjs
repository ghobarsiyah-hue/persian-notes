/**
 * Behavior probe for setTextAlignSmart (client/src/editor/ribbon/ribbonCommands.tsx)
 * Mirrors the EXACT implementation (explicit nodesBetween + setNodeMarkup) and
 * the exact schema (Document/Paragraph/Text + TextAlign on heading/paragraph):
 *   A/B/C  selection inside paragraph 2 → only that paragraph changes
 *   D      selection spanning 2..3 → only those two change
 *   E2     collapsed caret in paragraph 2 → ONLY paragraph 2 changes
 *   F      only textAlign attrs differ — dir/structure untouched
 *   G      selection ending exactly at a block boundary does NOT leak
 *   H      sequential ops: unrelated paragraphs keep their alignment
 * Run: node client/scripts/align-behavior.mjs
 */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.document = dom.window.document;
globalThis.window = dom.window;
try { Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true }); } catch { /* Node ≥21 has a read-only navigator */ }
const { Editor } = await import('@tiptap/core');
import StarterKit from '@tiptap/starter-kit';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import TextAlign from '@tiptap/extension-text-align';

function makeDoc() {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Paragraph 1' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Paragraph 2' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Paragraph 3' }] },
    ],
  };
}

const editor = new Editor({
  extensions: [
    Document, Paragraph, Text,
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, history: { depth: 200 }, document: false, paragraph: false, text: false, blockquote: false, bulletList: false, orderedList: false, listItem: false, codeBlock: false, horizontalRule: false }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ],
  content: makeDoc(),
});

/** ── verbatim logic of setTextAlignSmart (ribbonCommands.tsx) ────────────── */
function setTextAlignSmart(editor, align) {
  const { state, view } = editor;
  const { from, to } = state.selection;
  const tr = state.tr;
  const blockTypes = ['paragraph', 'heading'];
  let changed = false;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!blockTypes.includes(node.type.name)) return true;
    const nodeStart = pos;
    const nodeEnd = pos + node.nodeSize;
    if (nodeStart < to && nodeEnd > from) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, textAlign: align });
      changed = true;
    }
    return false;
  });
  if (changed) {
    tr.setMeta('addToHistory', true);
    view.dispatch(tr);
  }
}

const aligns = (ed) => ed.state.doc.content.content.map((n) => n.attrs.textAlign ?? null);
let failures = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
  if (!cond) failures++;
};

const posOf = (ed, paraIndex, offsetInText) => {
  let pos = 0;
  ed.state.doc.forEach((node, offset, i) => {
    if (i === paraIndex) pos = offset + 1 + offsetInText;
  });
  return pos;
};
const select = (ed, from, to) => ed.commands.setTextSelection(to == null ? from : { from, to });

console.log('doc text:', editor.state.doc.content.content.map((n) => n.textContent).join(' | '));

// ── A/B/C: select chars 0..5 inside Paragraph 2 ─────────────────────────────
for (const [label, cmd] of [['Center', 'center'], ['Right', 'right'], ['Left', 'left']]) {
  editor.commands.setContent(makeDoc());
  select(editor, posOf(editor, 1, 0), posOf(editor, 1, 5));
  setTextAlignSmart(editor, cmd);
  const a = aligns(editor);
  check(`${label}: only P2 aligned (A/B/C)`,
    a[0] === null && a[1] === cmd && a[2] === null, `aligns=[${a}]`);
}

// ── D: select across P2 and P3 ──────────────────────────────────────────────
editor.commands.setContent(makeDoc());
select(editor, posOf(editor, 1, 0), posOf(editor, 2, 5));
setTextAlignSmart(editor, 'center');
{
  const a = aligns(editor);
  check('Center across P2..P3: only P2+P3 aligned (D)',
    a[0] === null && a[1] === 'center' && a[2] === 'center', `aligns=[${a}]`);
}

// ── E2: collapsed caret in P2 ───────────────────────────────────────────────
editor.commands.setContent(makeDoc());
select(editor, posOf(editor, 1, 3));
setTextAlignSmart(editor, 'center');
{
  const a = aligns(editor);
  check('Collapsed caret in P2: ONLY P2 aligned',
    a[0] === null && a[1] === 'center' && a[2] === null, `aligns=[${a}]`);
}

// ── F: only textAlign attrs differ — structure/direction untouched ─────────
{
  editor.commands.setContent(makeDoc());
  const before = JSON.stringify(editor.getJSON());
  select(editor, posOf(editor, 1, 2));
  setTextAlignSmart(editor, 'right');
  const after = JSON.stringify(editor.getJSON());
  const strip = (s) => JSON.stringify(JSON.parse(s), (k, v) => (k === 'textAlign' ? undefined : v));
  check('Only textAlign attrs differ (dir untouched, F)', strip(before) === strip(after));
}

// ── G: selection ending exactly at P2's end must NOT leak into P3 ──────────
editor.commands.setContent(makeDoc());
{
  // P2 text spans (start+1) .. (start+1+len); its END boundary is start+1+len
  let p2end = 0;
  editor.state.doc.forEach((node, offset, i) => { if (i === 1) p2end = offset + 1 + node.content.size; });
  select(editor, posOf(editor, 1, 0), p2end);
  setTextAlignSmart(editor, 'center');
  const a = aligns(editor);
  check('Selection ending at P2 boundary: P3 untouched (G)',
    a[0] === null && a[1] === 'center' && a[2] === null, `aligns=[${a}]`);
}

// ── H: repeated ops — unrelated paragraphs never inherit ───────────────────
editor.commands.setContent(makeDoc());
{
  const c = posOf(editor, 0, 0);
  select(editor, c, c + 4); setTextAlignSmart(editor, 'center');   // P1 center
  select(editor, posOf(editor, 1, 0)); setTextAlignSmart(editor, 'right'); // caret P2 right
  const a = aligns(editor);
  check('Sequential ops: P1 center, P2 right, P3 null (H)',
    a[0] === 'center' && a[1] === 'right' && a[2] === null, `aligns=[${a}]`);
}

// ── selection preserved after the command (no caret jump) ──────────────────
editor.commands.setContent(makeDoc());
{
  const from = posOf(editor, 1, 0), to = posOf(editor, 1, 5);
  select(editor, from, to);
  setTextAlignSmart(editor, 'center');
  const sel = editor.state.selection;
  check('Selection preserved after command', sel.from === from && sel.to === to,
    `from=${sel.from} to=${sel.to} (expected ${from}..${to})`);
}

editor.destroy();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
