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
import { Plugin, PluginKey, TextSelection, type Command } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { liftListItem } from 'prosemirror-schema-list';

const key = new PluginKey('blockEnter');

/** node types that behave as "a box the user is inside" for this contract */
const BOX_NODES = new Set([
  // edu/custom blocks (all share one NodeView family with a title + body)
  'calloutBlock', 'questionBlock', 'exampleBlock', 'keyTermBlock',
  'formulaBlock', 'comparisonTable', 'timeline', 'footnoteBlock',
  'longAnswerBlock', 'highlightBox', 'referenceBlock', 'proConBlock',
  'codeOutputBlock', 'trueFalseBlock', 'mcqBlock',
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
