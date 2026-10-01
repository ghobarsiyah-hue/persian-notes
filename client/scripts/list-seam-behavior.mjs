/**
 * Behavior probe for the edu-box list seam (client/src/editor/listCommands.ts)
 * — imports the REAL module (tsx), drives a REAL TipTap editor in jsdom.
 *
 * Bug pinned: a selection spanning plain lines AND a کادر آموزشی made the
 * stock toggleBulletList wrap the WHOLE BOX as a list item — the box was
 * glued under a bullet and plain text became its list siblings
 * («متن‌های عادی بزور مینداخت تو باکس کادر اموزشی و سوال»).
 *
 * Checks:
 *   A  bullet across plain+box: box untouched, plain lines listed
 *   B  ordered across plain+box: box untouched
 *   C  bullet over TWO boxes + plain between: BOTH boxes untouched
 *   D  selection fully inside ONE box: lists the box's own paragraphs
 *   E  plain-only selection: unchanged stock semantics (one list)
 *   F  toggle-off: lists created by the seam toggle off cleanly
 *
 * Run: cd client && npx tsx scripts/list-seam-behavior.mjs
 */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.document = dom.window.document;
globalThis.window = dom.window;
try {
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
} catch { /* Node ≥21 has a read-only navigator */ }

const { Editor } = await import('@tiptap/core');
/* jsdom has no scheduler — the stock commands' .focus() uses rAF */
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
import StarterKit from '@tiptap/starter-kit';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';

/* a minimal stand-in for the edu-box family: block* container — the exact
   schema shape the seam keys on (name matched by EDU_BOX_RE) */
const QuestionBlock = (await import('@tiptap/core')).Node.create({
  name: 'questionBlock',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return { question: { default: '' } };
  },
  parseHTML() { return [{ tag: 'div[data-type="question"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-type': 'question', ...HTMLAttributes }, 0];
  },
});

const editor = new Editor({
  extensions: [
    Document, Paragraph, Text, TaskList, TaskItem,
    QuestionBlock,
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      document: false, paragraph: false, text: false,
      blockquote: false, codeBlock: false,
      horizontalRule: false, dropcursor: false,
      /* bulletList/orderedList/listItem MUST stay enabled — they are the
         engine under test (unlike align-behavior.mjs which disables them) */
    }),
  ],
  content: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'plain one' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'plain two' }] },
      {
        type: 'questionBlock',
        attrs: { question: 'سوال نمونه' },
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'inside box' }] },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'plain three' }] },
      {
        type: 'questionBlock',
        attrs: { question: 'سوال دوم' },
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'box two' }] },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'plain four' }] },
    ],
  },
});

const { applyBulletList, applyOrderedList, applyTaskList } = await import('../src/editor/listCommands.ts');

let failures = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
  if (!cond) failures++;
};

const json = () => editor.getJSON();
const topLevel = () => json().content.map((n) => `${n.type}:${(n.content ?? []).map((c) => c.type).join('+')}`);
const blocksText = (node, acc = []) => {
  if (node.type === 'text') acc.push(node.text ?? '');
  if (Array.isArray(node.content)) node.content.forEach((c) => blocksText(c, acc));
  return acc;
};
const hasText = (t) => blocksText(json()).includes(t);
const plainListsCount = (doc) => (doc.content ?? []).filter((n) => n.type === 'bulletList').length;

/* doc position of the character at `off` inside text node `t` (a valid
   TextSelection endpoint: strictly INSIDE the text) */
function posOfText(t, off = 0) {
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isText && node.text === t) { found = pos + off; return false; }
    return true;
  });
  if (found == null) throw new Error(`text not found: ${t}`);
  return found;
}

/* positions: find the doc positions of each top-level block's inner start */
function positions() {
  const out = {};
  let pos = 0;
  editor.state.doc.forEach((node, offset, i) => {
    out[`b${i}`] = offset + 1;
    pos = offset + node.nodeSize;
  });
  return out;
}

/* ── A: bullet across plain(0,1) + box(2) + plain(3) ───────────────────── */
{
  const p = positions();
  /* select from inside 'plain one' to inside 'plain three' — spans the box */
  editor.commands.setTextSelection({ from: p.b0, to: p.b3 + 4 });
  applyBulletList(editor);
  const doc = json();
  const types = doc.content.map((n) => n.type);
  check('A: box NOT wrapped into a list', !types.includes('bulletList') || doc.content.every((n) => n.type !== 'bulletList' || (n.content ?? []).every((it) => !(it.content ?? []).some((c) => c.type === 'questionBlock'))),
    JSON.stringify(types));
  check('A: question box intact (question attr preserved)',
    doc.content.some((n) => n.type === 'questionBlock' && n.attrs?.question === 'سوال نمونه'));
  check('A: plain lines became list items',
    (doc.content.filter((n) => n.type === 'bulletList').reduce((a, l) => a + (l.content?.length ?? 0), 0)) >= 2);
  check('A: no text lost', ['plain one', 'plain two', 'inside box', 'plain three'].every((t) => hasText(t)));
}

/* ── reset ──────────────────────────────────────────────────────────────── */
editor.commands.setContent({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'plain one' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'plain two' }] },
    { type: 'questionBlock', attrs: { question: 'سوال نمونه' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inside box' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'plain three' }] },
    { type: 'questionBlock', attrs: { question: 'سوال دوم' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'box two' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'plain four' }] },
  ],
});

/* ── B: ordered across the same span ───────────────────────────────────── */
{
  const p = positions();
  editor.commands.setTextSelection({ from: p.b0, to: p.b3 + 4 });
  applyOrderedList(editor);
  const doc = json();
  const ol = doc.content.filter((n) => n.type === 'orderedList');
  check('B: ordered lists created for plain lines', ol.reduce((a, l) => a + (l.content?.length ?? 0), 0) >= 2);
  check('B: boxes NOT inside any list item',
    !doc.content.some((n) => n.type === 'orderedList' && (n.content ?? []).some((it) => (it.content ?? []).some((c) => c.type === 'questionBlock'))));
  check('B: both boxes intact', doc.content.filter((n) => n.type === 'questionBlock').length === 2);
}

/* ── reset ──────────────────────────────────────────────────────────────── */
editor.commands.setContent({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'plain one' }] },
    { type: 'questionBlock', attrs: { question: 'سوال نمونه' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inside box' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'plain two' }] },
    { type: 'questionBlock', attrs: { question: 'سوال دوم' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'box two' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'plain three' }] },
  ],
});

/* ── C: bullet from first box THROUGH to last plain — both boxes skipped ── */
{
  const p = positions();
  /* from inside box1's paragraph to inside 'plain three' */
  const box1Inner = p.b1 + 1;
  editor.commands.setTextSelection({ from: box1Inner, to: p.b4 + 4 });
  applyBulletList(editor);
  const doc = json();
  check('C: BOTH boxes untouched',
    doc.content.filter((n) => n.type === 'questionBlock').length === 2
    && !doc.content.some((n) => n.type === 'bulletList' && (n.content ?? []).some((it) => (it.content ?? []).some((c) => c.type === 'questionBlock'))));
  check('C: the two PLAIN paragraphs outside boxes got listed',
    (doc.content.filter((n) => n.type === 'bulletList').reduce((a, l) => a + (l.content?.length ?? 0), 0)) >= 2);
}

/* ── reset ──────────────────────────────────────────────────────────────── */
editor.commands.setContent({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'plain one' }] },
    { type: 'questionBlock', attrs: { question: 'سوال نمونه' }, content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'box line 1' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'box line 2' }] },
    ] },
    { type: 'paragraph', content: [{ type: 'text', text: 'plain two' }] },
  ],
});

/* ── D: selection fully inside ONE box → box's own paragraphs listed ───── */
{
  editor.commands.setTextSelection({ from: posOfText('box line 1'), to: posOfText('box line 2') + 10 });
  applyBulletList(editor);
  const doc = json();
  const box = doc.content.find((n) => n.type === 'questionBlock');
  check('D: box still present', !!box);
  check('D: box INTERNAL list created', JSON.stringify(box?.content ?? []).includes('"bulletList"'),
    JSON.stringify((box?.content ?? []).map((c) => c.type)));
  check('D: plain paragraphs outside untouched',
    doc.content.some((n) => n.type === 'paragraph' && blocksText(n).join('') === 'plain one'));
}

/* ── reset ──────────────────────────────────────────────────────────────── */
editor.commands.setContent({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'plain one' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'plain two' }] },
    { type: 'questionBlock', attrs: { question: 'سوال نمونه' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inside box' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'plain three' }] },
  ],
});

/* ── E: plain-only selection → unchanged stock semantics ───────────────── */
{
  const p = positions();
  editor.commands.setTextSelection({ from: p.b0, to: p.b1 + 5 });
  applyBulletList(editor);
  const doc = json();
  const lists = doc.content.filter((n) => n.type === 'bulletList');
  check('E: plain-only → ONE list, both lines as items (stock)',
    lists.length === 1 && (lists[0].content ?? []).length === 2,
    JSON.stringify(types(doc)));
}

function types(d) { return d.content.map((n) => n.type); }

/* ── F: toggle-off after the seam ───────────────────────────────────────── */
{
  /* reset: test E left this doc LISTED — F must start from plain paragraphs */
  editor.commands.setContent({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'plain one' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'plain two' }] },
      { type: 'questionBlock', attrs: { question: 'سوال نمونه' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inside box' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'plain three' }] },
    ],
  });
  editor.commands.setTextSelection({ from: posOfText('plain one'), to: posOfText('plain two', 5) });
  applyBulletList(editor);
  const listed = json().content.some((n) => n.type === 'bulletList');
  /* select the text INSIDE the created list and toggle off via the seam */
  editor.commands.setTextSelection({ from: posOfText('plain one'), to: posOfText('plain two', 5) });
  applyBulletList(editor);
  const doc2 = json();
  check('F: toggle-off returns the plain paragraphs (stock semantics)',
    listed
    && doc2.content.filter((n) => n.type === 'bulletList').length === 0
    && doc2.content.filter((n) => n.type === 'paragraph').length >= 3,
    `listed=${listed} ${JSON.stringify(doc2.content.map((n) => n.type))}`);
}

/* ── G: task list through the seam (menu parity) ────────────────────────── */
{
  editor.commands.setTextSelection({ from: posOfText('plain one'), to: posOfText('plain two', 5) });
  applyTaskList(editor);
  const doc = json();
  check('G: taskList created (menu parity)', doc.content.some((n) => n.type === 'taskList'),
    JSON.stringify(doc.content.map((n) => n.type)));
}

editor.destroy();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
