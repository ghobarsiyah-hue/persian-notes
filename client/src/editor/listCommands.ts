import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from 'prosemirror-model';

/* ══════════════════════════════════════════════════════════════════════════
   listCommands — SELECTION-AWARE list conversion seam.

   WHY THIS EXISTS (items 5/6/11/12 of the list spec):
   The stock TipTap commands (toggleBulletList / toggleOrderedList) already
   implement every required list semantic correctly — ONE container, one
   listItem per selected block, toggle-off of existing items, joining with
   adjacent lists, partial selection → whole block (blockRange wrapping).
   They must remain the ONLY list engine (no second system).

   Gap 1: lines separated by hardBreak (Shift+Enter, or a plain-text
   paste where "\n" maps to <br>) live INSIDE ONE paragraph. Stock wrapping
   then yields a single list item whose visual lines share one marker —
   the user sees «فقط خط اول گلوله گرفت». Word converts each line to its
   own item; splitHardBreaksInSelection pre-normalizes the selection the
   same way, then hands the ORIGINAL stock command the normalized extent.

   Gap 2 (edu boxes): a selection spanning ordinary lines AND (part of) a
   کادر آموزشی made the stock toggle wrap the WHOLE BOX as one giant list
   item — the box was glued under a bullet, its title swallowed, and the
   surrounding plain text became its list siblings (bug report: «متن‌های
   عادی بزور مینداخت تو باکس کادر اموزشی و سوال… وقتی از فهرست استفاده
   می‌کردم»). toggleListAroundBoxes runs the stock toggle per top-level
   PLAIN block and SKIPS boxes entirely — the corruption is structurally
   impossible. A selection FULLY inside ONE box is stock territory (the
   desired «فهرست داخل کادر»: the box's own paragraphs get listed).

   RTL is untouched everywhere: only node structure changes, never dir,
   never global CSS (item 10).
   ══════════════════════════════════════════════════════════════════════════ */

/** textblocks eligible for list conversion (same block family as TextAlign) */
const LISTABLE_BLOCKS = ['paragraph', 'heading'];

/**
 * Edu-box family — the ONE shape stock list toggling corrupts.
 * These are `block*` flow containers with editable titles; wrapping one
 * inside a listItem destroys its title/NodeView contract and (for quiz
 * boxes) the answer policy UI.
 */
const EDU_BOX_RE =
  /^(calloutBlock|questionBlock|exampleBlock|keyTermBlock|longAnswerBlock|footnoteBlock|highlightBox|referenceBlock|trueFalseBlock|mcqBlock|matrixCompareBlock|orderStepsBlock)$/;

function isEduBoxName(name: string): boolean {
  return EDU_BOX_RE.test(name);
}

/** does the [from, to) range touch (intersect) an edu box anywhere? */
function touchesEduBox(doc: PMNode, from: number, to: number): boolean {
  let hit = false;
  doc.nodesBetween(from, to, (node) => {
    if (hit) return false;
    if (isEduBoxName(node.type.name)) hit = true;
    return !hit;
  });
  return hit;
}

/**
 * EXCLUDE edu boxes from a cross-boundary list toggle — BOTTOM-UP.
 *
 * The stock toggle is run once per top-level block the selection touches:
 *   • plain textblock (paragraph/heading) → stock toggle on that block;
 *   • edu box (or any other container: table, blockquote, pageBreak…) →
 *     SKIPPED — never wrapped, its inner structure preserved verbatim.
 * Bottom-up order keeps every not-yet-processed position valid while the
 * doc grows. The original selection is restored at the end so active
 * states and the next gesture see the original extent.
 *
 * Returns true when it handled the gesture (the caller must NOT run the
 * stock toggle again); false → stock territory:
 *   • no box intersected → stock on the whole selection (unchanged);
 *   • empty selection → stock (caret also covers «فهرست داخل کادر»);
 *   • a selection fully inside ONE box → the box's own paragraphs get
 *     listed — desired, stock does it correctly, no interception.
 */
function toggleListAroundBoxes(editor: Editor, kind: 'bullet' | 'ordered' | 'task'): boolean {
  const { state } = editor;
  const sel = state.selection;
  if (sel.empty) return false; // caret → stock (also the inside-a-box caret case)
  const { from, to } = sel;
  if (!touchesEduBox(state.doc, from, to)) return false; // plain-only → stock

  /* a selection fully inside one box (top level): desired inner listing —
     stock does it correctly, no interception */
  let contained = false;
  state.doc.forEach((child: PMNode, offset: number) => {
    if (isEduBoxName(child.type.name) && from >= offset && to <= offset + child.nodeSize) {
      contained = true;
    }
  });
  if (contained) return false;

  const toggle = (rf: number, rt: number): boolean => {
    /* deliberately NO .focus(): the seam runs several toggles in sequence
       and must not re-grab focus/scroll between them (the caller — the
       ribbon/menu handler — already owns the focus; re-focusing also
       pulls requestAnimationFrame into headless QA runs). */
    const chain = editor.chain().setTextSelection({ from: rf, to: rt });
    if (kind === 'bullet') return chain.toggleBulletList().run();
    if (kind === 'ordered') return chain.toggleOrderedList().run();
    return chain.toggleTaskList().run();
  };

  /* the top-level blocks the selection touches, then processed BOTTOM-UP
     so earlier positions stay valid across the growing doc */
  const touched: Array<{ start: number; end: number; name: string }> = [];
  state.doc.forEach((child: PMNode, offset: number) => {
    const end = offset + child.nodeSize;
    if (end > from && offset < to) touched.push({ start: offset, end, name: child.type.name });
  });

  let ok = true;
  for (let i = touched.length - 1; i >= 0; i--) {
    const b = touched[i];
    if (isEduBoxName(b.name)) continue; // THE FIX: the box keeps its shape
    /* clamp to the real selection: a partially selected edge block still
       resolves to whole textblocks (stock list wrapping takes the block
       range covering from..to) */
    const rf = Math.max(b.start + 1, Math.min(from, b.end - 1));
    const rt = Math.max(b.start + 1, Math.min(to, b.end - 1));
    if (rt <= rf) continue;
    if (!toggle(rf, rt)) ok = false;
  }

  /* restore the user's selection — active states and the next gesture must
     see the original extent, not the last processed block */
  editor.chain().setTextSelection({ from, to }).run();
  return ok;
}

/** does this textblock contain at least one hardBreak child? */
function hasHardBreak(node: PMNode): boolean {
  let found = false;
  node.forEach((child) => {
    if (child.type.name === 'hardBreak') found = true;
  });
  return found;
}

/**
 * Split hardBreak lines of every selected textblock into real paragraphs.
 * Returns true when the document was modified (the selection is re-mapped
 * over the normalized extent inside the SAME transaction); false → the
 * caller runs the stock command on the untouched selection as-is.
 */
function splitHardBreaksInSelection(editor: Editor): boolean {
  const { state, view } = editor;
  const { from, to } = state.selection;
  if (state.selection.empty) return false; // caret → stock behavior (item 4)

  const paraType = state.schema.nodes.paragraph;
  if (!paraType) return false;

  /* collect affected textblocks first (top-down), then replace BOTTOM-UP
     so every earlier position stays valid while the transaction grows */
  const blocks: Array<{ pos: number; node: PMNode }> = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock && LISTABLE_BLOCKS.includes(node.type.name) && hasHardBreak(node)) {
      blocks.push({ pos, node });
    }
    return true; // descend — nested textblocks (lists, boxes) matter too
  });
  if (blocks.length === 0) return false;

  const tr = state.tr;
  /* selection-extent bookkeeping — BOTH anchors must span every created
     paragraph of the WHOLE selection, in the FINAL doc's coordinates:
       firstNewStart ← the TOPMOST block's first paragraph inner start
         (topPos + 1). The topmost round is the LAST one, so no step runs
         after it — the value is already final, never re-mapped.
       bottomEndRaw ← the BOTTOMMOST block's last paragraph inner end,
         measured right after ITS replacement (pos + insertedTotal − 1 is a
         valid position in the doc AS IT IS THEN). Each LATER round replaces
         a block ABOVE it and shifts every lower position by
         (insertedTotal − oldSize) — always negative (the <br> tokens
         vanish). That drift is accumulated and applied arithmetically.
     WHY NOT tr.mapping: the anchor is measured in POST-step coordinates;
     feeding it back through the same step's mapping double-shifts it
     (observed: 23 → 25 on a 3-line split → clamped to the doc-end BLOCK
     boundary → TextSelection resolves outside inlineContent → the
     selection silently collapses to a caret → the stock toggle wrapped
     only the LAST line: «فهرست روی آیتم‌های هایلایت اعمال نمی‌شود»).
     (The original bookkeeping also froze firstNewStart on the bottommost
     block and lastNewEnd on the topmost one — the anchors crossed.) */
  let firstNewStart = -1;
  let bottomEndRaw = -1;
  let drift = 0;

  for (const { pos, node } of blocks.slice().reverse()) {
    /* slice the block's inline content at each hardBreak */
    const runs: PMNode[][] = [[]];
    node.forEach((child) => {
      if (child.type.name === 'hardBreak') runs.push([]);
      else runs[runs.length - 1].push(child);
    });
    const created = runs.map((kids) => paraType.create(node.attrs, kids.length ? kids : null));
    const insertedTotal = created.reduce((acc, p) => acc + p.nodeSize, 0);
    tr.replaceWith(pos, pos + node.nodeSize, created);
    if (bottomEndRaw < 0) {
      bottomEndRaw = pos + insertedTotal - 1; // first round = bottommost block
    } else {
      drift += insertedTotal - node.nodeSize; // a later round sat ABOVE the bottom anchor
    }
    firstNewStart = pos + 1; // last round = topmost block wins
  }

  /* keep the user's intent: the whole normalized extent stays selected so
     the stock command wraps EVERY created line (items 5/6). Both anchors
     are inner text positions of real paragraphs — resolvable, never a
     block boundary. */
  const selFrom = Math.max(1, firstNewStart);
  const selTo = Math.max(selFrom, Math.min(bottomEndRaw + drift, tr.doc.content.size - 1));
  tr.setSelection(TextSelection.create(tr.doc, selFrom, selTo));
  view.dispatch(tr);
  return true;
}

/** Bullet List — selection-aware; the stock engine does the real work */
export function applyBulletList(editor: Editor): void {
  if (toggleListAroundBoxes(editor, 'bullet')) return;
  splitHardBreaksInSelection(editor);
  editor.chain().focus().toggleBulletList().run();
}

/** Ordered List — identical path; only the list type differs (item 7) */
export function applyOrderedList(editor: Editor): void {
  if (toggleListAroundBoxes(editor, 'ordered')) return;
  splitHardBreaksInSelection(editor);
  editor.chain().focus().toggleOrderedList().run();
}

/** Task List (چک‌لیست) — the same box-exclusion seam; stock otherwise */
export function applyTaskList(editor: Editor): void {
  if (toggleListAroundBoxes(editor, 'task')) return;
  editor.chain().focus().toggleTaskList().run();
}

/**
 * Split-align seam for hardBreak lines — the TEXT-ALIGN twin of the list
 * seam above. When the caret/selection lives inside ONE paragraph/heading
 * that carries Shift+Enter lines, CSS can NEVER align those visual lines
 * independently (text-align paints the whole block). This normalizes the
 * block EXACTLY like the list path — split into real paragraphs, one
 * transaction, selection mapped through — then aligns ONLY the runs the
 * selection touches (textAlign rides the created nodes' attrs).
 *
 * Returns true when it dispatched (the caller must NOT align again);
 * false → no hardBreaks here, or the selection covers EVERY line (intent
 * = the whole block → the caller's whole-block markup keeps the <br>
 * structure untouched).
 */
export function alignHardBreakLines(editor: Editor, align: string): boolean {
  const { state, view } = editor;
  const sel = state.selection;
  const { from, to } = sel;
  if (!sel.$from.sameParent(sel.$to)) return false; // spans blocks → whole-block walk
  const parent = sel.$from.parent;
  if (parent.type.name !== 'paragraph' && parent.type.name !== 'heading') return false;

  let hasBreak = false;
  parent.forEach((child) => {
    if (child.type.name === 'hardBreak') hasBreak = true;
  });
  if (!hasBreak) return false;

  const blockStart = sel.$from.before();
  const contentStart = blockStart + 1;
  const selStart = from - contentStart;
  const selEnd = to - contentStart;

  /* slice the inline content at each hardBreak (same slicing as above) */
  const runs: PMNode[][] = [[]];
  parent.forEach((child) => {
    if (child.type.name === 'hardBreak') runs.push([]);
    else runs[runs.length - 1].push(child);
  });

  /* content offset where each run starts — a hardBreak occupies ONE
     position between consecutive runs */
  const starts: number[] = [];
  let acc = 0;
  for (let i = 0; i < runs.length; i++) {
    starts.push(acc);
    acc += runs[i].reduce((a, c) => a + c.nodeSize, 0) + 1;
  }

  /* which runs does the selection touch?
     • real overlap (s < selEnd && e > selStart) — same pos < to rule as
       the whole-block walk, no leak past a boundary;
     • collapsed caret sitting EXACTLY on a run boundary → the line that
       starts there (the caret renders at that line's start). */
  const touched: boolean[] = runs.map((_, i) => {
    const s = starts[i];
    const e = s + runs[i].reduce((a, c) => a + c.nodeSize, 0);
    if (s < selEnd && e > selStart) return true;
    if (from === to && s <= selStart && selStart <= e) return true;
    return false;
  });
  const touchedCount = touched.filter(Boolean).length;
  if (touchedCount === 0 || touchedCount === runs.length) return false;

  const created = runs.map((kids, i) =>
    parent.type.create(
      touched[i] ? { ...parent.attrs, textAlign: align } : parent.attrs,
      kids.length ? kids : null,
    ),
  );
  const tr = state.tr;
  tr.replaceWith(blockStart, blockStart + parent.nodeSize, created);
  tr.setMeta('addToHistory', true);
  view.dispatch(tr); // the selection maps through the split automatically
  return true;
}
