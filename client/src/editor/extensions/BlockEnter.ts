/**
 * BlockEnter — the ONE Enter/Shift+Enter contract for the whole editor.
 *
 * THE CONTRACT (applies everywhere the user is "inside a box" — edu blocks,
 * callouts, blockquotes, list items — and in plain paragraphs):
 *
 *   Enter          → a NEW LINE (new paragraph) INSIDE the same box.
 *                    Never an accidental structural change: the box is
 *                    never deleted, split into two boxes, or escaped from
 *                    by a plain Enter. (Root cause of the old complaints —
 *                    "Enter deleted the question box" — was stock SplitBlock
 *                    climbing out of these custom nodes; `defining: true`
 *                    already prevents the split-merge artifacts, this
 *                    extension closes the remaining escape paths.)
 *   Shift+Enter    → EXIT the box: the caret moves BELOW the box into the
 *                    document flow (a paragraph is created there when the
 *                    next position is not already a textblock).
 *                    Word/Notion call this "exit at end"; here it is the
 *                    deliberate complement so the two keys never fight.
 *   Shift+Enter in PLAIN text (not inside any box) → the classic soft line
 *                    break (<br>) so a single paragraph can keep two lines.
 *
 * Box detection: the depth chain from the caret is climbed to the innermost
 * ancestor that IS a box (custom edu block nodes, blockquote, list item).
 * Empty-tail optimization: when the caret already sits in the box's EMPTY
 * last paragraph, Shift+Enter just moves the caret out WITHOUT growing the
 * box — the same convention the TableEscape extension established for
 * tables (second Enter leaves, without leaving residue behind).
 *
 * Lists get a special case (prosemirror-schema-list semantics, confirmed
 * against the upstream discussion "Lists: paragraph inside li instead of
 * new list item"): a plain Enter on an EMPTY list item lifts the item —
 * the universal "Enter twice ends the list" reflex; on a non-empty item
 * it splits the item. Shift+Enter inside a list item lifts it out of the
 * list entirely (the complement of Enter, mirroring the box rule).
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, Selection, type Command } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { liftListItem } from 'prosemirror-schema-list';

const key = new PluginKey('blockEnter');

/** node types that behave as "a box the user is inside" for this contract */
export const BOX_NODES = new Set([
  // edu/custom blocks (all share one NodeView family with a title + body)
  'calloutBlock', 'questionBlock', 'exampleBlock', 'keyTermBlock',
  'formulaBlock', 'comparisonTable', 'timeline', 'footnoteBlock',
  'longAnswerBlock', 'highlightBox', 'referenceBlock', 'proConBlock',
  'codeOutputBlock', 'trueFalseBlock', 'mcqBlock',
  'matrixCompareBlock', 'orderStepsBlock',
  // stock wrappers that read as "inside a box"
  'blockquote', 'listItem',
]);

/** Is this node one of the box types? */
function isBoxNode(n: PMNode): boolean {
  return BOX_NODES.has(n.type.name);
}

/**
 * Find the innermost box ancestor containing $pos (and its doc depth).
 * Returns null when the caret is not inside any box — plain body text.
 */
function innermostBox($pos: ResolvedPos): { node: PMNode; depth: number; end: number } | null {
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d);
    if (isBoxNode(n)) {
      return { node: n, depth: d, end: $pos.after(d) };
    }
  }
  return null;
}

/** is the parent textblock completely empty? */
function isEmptyTextblock(node: PMNode): boolean {
  return node.isTextblock && node.content.size === 0;
}

/**
 * Move the caret to a textblock AFTER `endPos` (doc-level). Creates an
 * empty paragraph there when the next node is not already a textblock —
 * the exact move the table-escape and the edu-title handlers use.
 */
function caretAfter(view: EditorView, endPos: number): boolean {
  const { state } = view;
  const tr = state.tr;
  try {
    const after = state.doc.nodeAt(endPos);
    if (after && after.isTextblock) {
      tr.setSelection(TextSelection.create(state.doc, endPos + 1));
    } else {
      const para = state.schema.nodes.paragraph.create();
      tr.insert(endPos, para);
      tr.setSelection(TextSelection.create(tr.doc, endPos + 1));
    }
    tr.scrollIntoView();
    view.dispatch(tr);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lift the caret out of the box at `$pos` (the innermost box wins, lists
 * use liftListItem semantics). Returns true when a box was exited.
 * Built as a Command so the stock chain helpers run inside the SAME
 * transaction history step (undo removes the whole move, not fragments).
 */
function exitBox(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { $from } = state.selection;

  // list item → lift it (stock schema-list semantics)
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'listItem') {
      const itemType = state.schema.nodes.listItem;
      if (itemType) {
        const cmd: Command = (st2, dispatch2) => liftListItem(itemType)(st2, dispatch2);
        return cmd(state, dispatch, view);
      }
    }
  }

  const box = innermostBox($from);
  if (!box) return false;
  return caretAfter(view, box.end);
}

export const BlockEnter = Extension.create({
  name: 'blockEnter',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        props: {
          handleKeyDown: (view, event) => {
            const { state } = view;
            const { $from, empty } = state.selection;

            const isEnter = event.key === 'Enter';

            if (!isEnter) return false;

            /* ────────────────────────────────────────────────────────────
               SHIFT+ENTER — the complement key
               • inside a box  → EXIT the box (caret below it)
               • plain text    → soft line break (<br>, stock behavior)
               ──────────────────────────────────────────────────────────── */
            if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
              if (!empty) return false; // ranges keep stock behavior
              const box = innermostBox($from);
              if (!box) return false; // plain paragraph → stock soft-break
              return exitBox(view);
            }

            /* ────────────────────────────────────────────────────────────
               PLAIN ENTER — new line INSIDE the box; the one exception is
               the universal «empty tail» reflex:
               • list item: an empty item LIFTS (Enter ends the list)
               • other boxes: an empty last paragraph inside the box EXITS
                 (second Enter leaves the box — no residue, no trap)
               ──────────────────────────────────────────────────────────── */
            if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
            if (!empty) return false; // range selection keeps stock behavior

            // list: empty item ends the list (upstream schema-list convention)
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type.name === 'listItem') {
                if (isEmptyTextblock($from.parent)) {
                  const itemType = state.schema.nodes.listItem;
                  if (itemType) {
                    return liftListItem(itemType)(state, view.dispatch, view);
                  }
                }
                return false; // non-empty item → stock splitListItem
              }
            }

            const box = innermostBox($from);
            if (!box) return false; // plain paragraph → stock split

            // caret in the box's EMPTY LAST paragraph → exit (reflex)
            const isLastBlockOfBox =
              $from.index(box.depth) === box.node.childCount - 1;
            if (isEmptyTextblock($from.parent) && isLastBlockOfBox) {
              return caretAfter(view, box.end);
            }

            // otherwise: Enter stays INSIDE the box as a new paragraph.
            // Stock SplitBlock already does exactly this for `block*`
            // content with defining:true — let it run untouched.
            return false;
          },
        },
      }),
    ];
  },
});

/* ═══════════════════════════════════════════════════════════════════════
   BlockBoundaryGuard — Backspace at the START of a plain paragraph that
   FOLLOWS a box (user report: «حذف متنِ بعد کادر، متن عادی می‌رود تو باکس
   سوال تشریحی»). Stock joinBackward merges that paragraph INTO the box's
   last body paragraph — the plain text lands inside the question/callout
   box without any visible boundary. Word-like rule instead: the FIRST
   Backspace is a boundary HOP (caret → end of the box's last body
   paragraph, where the next Backspace deletes real content instead of
   structurally merging); the plain text is never pulled into the box.

   Registered FIRST in buildEditorExtensions — ProseMirror consults
   handleKeyDown props in plugin order and the stock keymap (StarterKit's
   baseKeymap) already handles Backspace, so a guard registered later would
   never run.
   ═══════════════════════════════════════════════════════════════════ */
export const BlockBoundaryGuard = Extension.create({
  name: 'blockBoundaryGuard',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockBoundaryGuard'),
        props: {
          handleKeyDown: (view, event) => {
            if (event.key !== 'Backspace') return false;
            const { state } = view;
            const { $from, empty } = state.selection;
            if (!empty) return false; // ranges keep stock behavior
            /* only the doc-level START of a textblock — the exact boundary
               spot where stock Backspace does joinBackward */
            if ($from.parentOffset !== 0 || $from.depth !== 1) return false;
            const nodeBefore = $from.nodeBefore; // the box we'd merge INTO

            /* CASE 2 — «فاصله بین دو باکس رو حذف می‌کنم، دوتا باکس ادغام
               میشه» (user report): TWO BOXES separated by one paragraph.
               Stock Backspace at the START of the LOWER box (or inside the
               gap paragraph) pulls the boxes together — the SECOND press
               then JOINS the two box NODES: borders fuse, content
               interleaves. Word-like rule instead:
               • Backspace 1 (caret in the EMPTY gap paragraph): the gap
                 itself is deleted — boxes stay SEPARATE, caret lands after
                 the upper box.
               • Backspace 2 (caret now at the doc boundary where the gap
                 was, box below, box above): HOP into the upper box's last
                 body paragraph — the next Backspace deletes real CONTENT,
                 never the border.
               The lower box NEVER merges into the upper one. */
            /* CASE 2b — the deeper click boundary: the caret can land inside
               the lower BOX WRAPPER itself ($parent = the box node, offset
               0 — PM clicks resolving to the edge put the selection in the
               box, not in a child textblock). Stock Backspace there joins
               the WHOLE BOX backward into the node above: the upper box and
               its title are destroyed outright — visually «two boxes fused
               into one». Box wrapper = never a merge source. */
            if (isBoxNode($from.parent) && nodeBefore && isBoxNode(nodeBefore)) {
              try {
                const end = $from.pos - 1; // boundary between the two boxes → inside the upper box
                const target = Selection.near(state.doc.resolve(end), -1);
                view.dispatch(state.tr.setSelection(target).scrollIntoView());
                view.focus();
                return true;
              } catch {
                return true; // swallow rather than ever merging two boxes
              }
            }
            if (nodeBefore && isBoxNode(nodeBefore)) {
              /* empty paragraph right after a box: the gap case — delete the
                 gap, keep the boxes apart (stock would join it INTO the box
                 above, pulling the next box one step closer). */
              if (isEmptyTextblock($from.parent)) {
                try {
                  const gapFrom = $from.before();
                  const tr = state.tr.delete(gapFrom, $from.after());
                  view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(gapFrom), -1)).scrollIntoView());
                  view.focus();
                  return true;
                } catch {
                  return false;
                }
              }
              /* non-empty textblock after a box: hop instead of merge —
                 covers BOTH «plain paragraph after a box» (never pull plain
                 text into the box) AND «lower box after an upper box»
                 (never fuse the two borders). */
              try {
                const end = $from.pos - 1; // just before this textblock = inside the box
                const $end = state.doc.resolve(end);
                const target = Selection.near($end, -1);
                view.dispatch(state.tr.setSelection(target).scrollIntoView());
                view.focus();
                return true; // the join never happens
              } catch {
                return false;
              }
            }

            /* CASE 3 — «بک‌اسپیس توی باکس، کل باکس رو پاک می‌کنه» (user
               report, the STEP-2 crash behind the same complaint): with the
               caret at the doc-level END of a box's EMPTY body paragraph,
               `$from.nodeBefore` is the INNER paragraph — isBoxNode is
               false — so the guard above lets the STOCK chain run, and
               stock joinBackward lifts the empty paragraph OUT and DELETES
               THE WHOLE BOX NODE (a box with an empty body IS just its
               wrapper). Word-like rule: Backspace inside a box never
               deletes the box — it empties nothing (already empty) and
               simply holds; content deletion happens while there IS
               content, and the box is removed via the حذف menu, not by
               accident at its boundary. */
            const nodeAfter = $from.nodeAfter;
            if (
              nodeAfter && isBoxNode(nodeAfter) &&
              isEmptyTextblock($from.parent) &&
              $from.parent.type.name === 'paragraph'
            ) {
              return true; // swallow: caret stays, box stays
            }
            /* CASE 3b — wrapper-internal: caret sits INSIDE the box node
               itself ($parent = box, offset 0) with the box's own body below
               — stock Backspace here can also lift/drop the box structure.
               Swallow: nothing above the caret to delete that isn't the
               box. */
            if (isBoxNode($from.parent)) {
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

/* guard bust: re-trigger module graph invalidation */
