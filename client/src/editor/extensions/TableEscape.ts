/**
 * TableEscape — Word-like «خروج از جدول» behavior around tables.
 *
 * Two reported bugs, one root cause: TipTap's stock table keymap has NO way
 * to leave a table with the keyboard (Enter inside the last cell only ever
 * creates a paragraph INSIDE that cell, and Gapcursor does not react to
 * Enter). A user whose document ends with a table is trapped; and the
 * workaround — Enter to get a line after the table — grows the table itself,
 * which the pagination engine may then move to the next page WHOLE (atomic
 * fallback when no row can stay), making the table jump to the next page
 * instead of a new paragraph flowing after it.
 *
 * Word/Google-Docs behavior implemented here:
 *
 *   • Enter when the caret sits in the EMPTY last paragraph of the last cell
 *     of the last row (the second Enter at the cell's end) → new empty
 *     paragraph AFTER the table, caret inside it. That paragraph is ordinary
 *     flowing text: if the table sits at the page bottom, IT overflows to
 *     the next page alone — the table never teleports (the engine's
 *     line-split moves just the paragraph; the table stays put).
 *   • Space+Enter (Word behavior) ANYWHERE in the last cell's last block —
 *     including after a full line of text — leaves the table immediately:
 *     the user just pasted an AI table, the caret sits in its last cell,
 *     and «یک خط پایین‌ترش اسپیس بخوره تا متن ادامه پیدا کنه» must not
 *     require an extra empty paragraph first.
 *   • ArrowDown with the caret at the end of the last cell's last block →
 *     same escape, without needing the extra empty paragraph first.
 *   • Backspace at the START of the empty paragraph right after a table →
 *     caret returns INSIDE the table's last cell (the inverse escape).
 *
 * Ordering: this extension is registered LAST, so its handleKeyDown runs
 * after the stock table plugins (which return false for a plain-caret
 * Enter/ArrowDown/Backspace) and BEFORE ProseMirror's captureKeyDown fallback
 * (SplitBlock) — returning true intercepts exactly these escape cases and
 * leaves every other key behavior untouched.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';

const key = new PluginKey('tableEscape');

/** Is the textblock `node` empty (no inline content at all)? */
function isEmptyTextblock(node: PMNode): boolean {
  return node.isTextblock && node.content.size === 0;
}

interface TableContext {
  /** the table node containing $pos */
  table: PMNode;
  /** doc position right AFTER the table */
  tableEnd: number;
}

/**
 * Resolve the table context when $pos sits in the LAST block of the LAST
 * cell of the LAST row: doc > table > row > cell > … > textblock (the
 * textblock may be nested inside the cell, e.g. a list — depth is climbed
 * generically). Returns null in every other position.
 */
function lastCellContext($pos: ResolvedPos): TableContext | null {
  // climb to the innermost table ancestor
  let tableDepth = $pos.depth;
  while (tableDepth > 0 && $pos.node(tableDepth).type.name !== 'table') tableDepth--;
  if (tableDepth === 0) return null;

  // the direct chain below the table must be row > cell
  const rowDepth = tableDepth + 1;
  const cellDepth = tableDepth + 2;
  if ($pos.depth < cellDepth) return null;
  const row = $pos.node(rowDepth);
  const cell = $pos.node(cellDepth);
  if (row.type.name !== 'tableRow') return null;
  if (cell.type.name !== 'tableCell' && cell.type.name !== 'tableHeader') return null;

  const table = $pos.node(tableDepth);
  // last row of the table, last cell of that row, last block of that cell
  if ($pos.index(tableDepth) !== table.childCount - 1) return null;
  if ($pos.index(rowDepth) !== row.childCount - 1) return null;
  if ($pos.index(cellDepth) !== cell.childCount - 1) return null;

  return { table, tableEnd: $pos.after(tableDepth) };
}

export const TableEscape = Extension.create({
  name: 'tableEscape',

  addProseMirrorPlugins() {
    /* one-shot flag: the immediately-preceding keypress was a plain space —
       set in the Space branch of handleKeyDown, consumed by the Enter branch
       (Space+Enter = Word's «leave the table» escape). Cleared on every
       other key so a stale flag can never fire an escape later. */
    let spaceJustBefore = false;

    return [
      new Plugin({
        key,
        props: {
          handleKeyDown: (view, event) => {
            const { state } = view;
            const { $from, empty } = state.selection;
            if (!empty) return false;

            /* one-shot «the previous key was a plain Space» flag — set by the
               Space branch below, consumed/reset here on every other key. */
            if (event.key !== 'Enter') spaceJustBefore = false;
            if (event.key === ' ') {
              /* mark the space only when it actually lands at the caret
                 (empty selection) — the flag dies with any caret move */
              spaceJustBefore = true;
              return false; // the space types normally
            }

            /* ── Space+Enter: leave the table from the LAST cell's last block
               regardless of content — the Word escape for «بعد از جدول بنویس».
               Detection: the immediately-preceding keypress in this block was
               a plain space (tracked below in handleKeyDown via a one-shot
               flag) and the block ends with one — so Enter escapes instead of
               splitting. The flag lives on the PLUGIN PROPS closure, reset by
               every other key, and is the only reliable way to know Space
               preceded Enter (keydown for Enter carries no such history). ── */
            if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && spaceJustBefore) {
              spaceJustBefore = false;
              const block = $from.parent;
              const textBefore = block.isTextblock && $from.parentOffset >= 1
                ? block.textBetween($from.parentOffset - 1, $from.parentOffset)
                : '';
              if (textBefore === ' ' || textBefore === '\u00A0') {
                const ctx = lastCellContext($from);
                if (ctx) {
                  const tr = state.tr;
                  try {
                    const para = state.schema.nodes.paragraph.create();
                    tr.insert(ctx.tableEnd, para);
                    tr.setSelection(TextSelection.create(tr.doc, ctx.tableEnd + 1));
                    tr.scrollIntoView();
                    view.dispatch(tr);
                    return true;
                  } catch {
                    return false;
                  }
                }
              }
            }
            spaceJustBefore = false;

            /* ── Enter: caret in the empty last block of the last cell ── */
            if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
              const block = $from.parent;
              if (!isEmptyTextblock(block)) return false;
              const ctx = lastCellContext($from);
              if (!ctx) return false;

              const tr = state.tr;
              try {
                const para = state.schema.nodes.paragraph.create();
                tr.insert(ctx.tableEnd, para);
                tr.setSelection(TextSelection.create(tr.doc, ctx.tableEnd + 1));
                tr.scrollIntoView();
                view.dispatch(tr);
                return true;
              } catch {
                return false; // schema without a paragraph — keep default behavior
              }
            }

            /* ── ArrowDown: caret at the END of the last cell's last block —
               escape without requiring an empty paragraph first ── */
            if (event.key === 'ArrowDown' && !event.shiftKey) {
              const block = $from.parent;
              if ($from.parentOffset !== block.content.size) return false;
              if (isEmptyTextblock(block)) return false; // Enter already escaped
              const ctx = lastCellContext($from);
              if (!ctx) return false;

              const tr = state.tr;
              try {
                // a block right after the table? → move the caret into it
                const after = state.doc.nodeAt(ctx.tableEnd);
                if (after && after.isTextblock) {
                  tr.setSelection(TextSelection.create(state.doc, ctx.tableEnd + 1));
                } else {
                  const para = state.schema.nodes.paragraph.create();
                  tr.insert(ctx.tableEnd, para);
                  tr.setSelection(TextSelection.create(tr.doc, ctx.tableEnd + 1));
                }
                tr.scrollIntoView();
                view.dispatch(tr);
                return true;
              } catch {
                return false;
              }
            }

            /* ── Backspace: caret at the START of the empty paragraph right
               after a table → caret returns INSIDE the table's last cell ── */
            if (event.key === 'Backspace') {
              if ($from.parentOffset !== 0) return false;
              if (!isEmptyTextblock($from.parent)) return false;
              if ($from.depth < 1) return false;
              const beforePos = $from.before(); // start of the parent block
              const nodeBefore = state.doc.nodeAt(beforePos);
              if (!nodeBefore || nodeBefore.type.name !== 'table') return false;

              try {
                // just inside the table's end — near(…, -1) walks BACKWARD to
                // the nearest text-caret position = end of the last cell
                const $inside = state.doc.resolve(beforePos - 1);
                const tr = state.tr;
                tr.setSelection(TextSelection.near($inside, -1));
                tr.scrollIntoView();
                view.dispatch(tr);
                return true;
              } catch {
                return false;
              }
            }

            return false;
          },
        },
      }),
    ];
  },
});
