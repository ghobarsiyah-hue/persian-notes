import type { Editor } from '@tiptap/core';
import type {
  SelectableObject,
} from './types';

/* ══════════════════════════════════════════════════════════════════════════
   Document probe — adapts the LIVE TipTap selection into generic
   SelectableObjects. Runs on every editor transaction (already subscribed
   by the Ribbon for active states) and on floating-selection changes, so
   the context always reflects real editor state — never polled, never
   scanned ahead of an actual selection event.

   Nested objects: the probe walks up $from depth and emits the deepest
   object first (image → cell → table), so context priority falls out of
   the resolver naturally.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Probe the editor selection. Returns SelectableObjects most-specific
 * first. The FIRST entry of the returned array becomes the primary context.
 */
export function probeDocumentSelection(editor: Editor): SelectableObject[] {
  const out: SelectableObject[] = [];
  const pageId = currentProbePageId ?? derivePageId(editor);

  /* Node selection (image, formula block, inline icon… clicked as a whole) */
  const sel = editor.state.selection as { node?: { type: { name: string } }; from: number; to: number };
  if (sel.node) {
    const chain: SelectableObject[] = [];
    editor.state.doc.nodesBetween(sel.from, sel.to, (node, pos) => {
      if (node.type.name === 'doc') return true; // doc is not a selectable object
      if (node === sel.node || node.isBlock) {
        chain.push({
          id: `node@${pos}`,
          type: node.type.name,
          source: 'document',
          ancestors: [],
          attrs: { ...node.attrs, editor },
          pageId,
        });
      }
      return true;
    });
    /* nodesBetween yields outer→inner; deepest (the selected node) last —
       reverse so the selected node comes first and ancestors follow */
    chain.reverse();
    for (let i = 0; i < chain.length; i++) {
      chain[i].ancestors = chain.slice(i + 1).map((a) => ({ id: a.id, type: a.type }));
    }
    out.push(...chain);
    return out;
  }

  /* Text/cursor selection — walk up from $from and emit every object-level
     ancestor (deepest first): link mark → text-in-cell → cell → table.
     d stops at 1: the top-level doc is not a selectable object (a plain
     caret must resolve to the normal Ribbon), and ResolvedPos.before(0)
     throws "no position before the top-level node". */
  const $from = editor.state.selection.$from;
  const depth = $from.depth;
  const chain: SelectableObject[] = [];
  for (let d = depth; d >= 1; d--) {
    const node = $from.node(d);
    if (!OBJECT_NODE_TYPES.has(node.type.name)) continue;
    chain.push({
      id: `node@${$from.before(d)}`,
      type: node.type.name,
      source: 'document',
      ancestors: [],
      attrs: { ...node.attrs, editor },
      pageId,
    });
  }
  for (let i = 0; i < chain.length; i++) {
    chain[i].ancestors = chain.slice(i + 1).map((a) => ({ id: a.id, type: a.type }));
  }
  out.push(...chain);

  /* link MARK on the selection is an object-level context (link tools) —
     emitted BEFORE the deepest node so link context wins over text context */
  if (editor.isActive('link')) {
    out.unshift({
      id: 'mark@link',
      type: 'link',
      source: 'document',
      ancestors: [],
      attrs: { ...editor.getAttributes('link'), editor },
      pageId,
    });
  }

  return out;
}

/** Node types that participate as selectable objects when the cursor/selection is inside them. */
const OBJECT_NODE_TYPES = new Set([
  'image', 'table', 'tableCell', 'tableHeader',
  'calloutBlock', 'questionBlock', 'exampleBlock', 'keyTermBlock', 'formulaBlock',
  'comparisonTable', 'timeline', 'footnoteBlock', 'longAnswerBlock', 'highlightBox',
  'referenceBlock', 'proConBlock', 'codeOutputBlock', 'trueFalseBlock', 'mcqBlock',
  'blockquote', 'codeBlock', 'equation', 'equationInline',
]);

/** pageId of the editor being probed (set by the Ribbon before probing). */
let currentProbePageId: string | null = null;
export function setProbePageId(pageId: string | null) {
  currentProbePageId = pageId;
}

/** Fallback: the active page's editor container sits inside [data-page-id]. */
function derivePageId(editor: Editor): string {
  const dom = editor.view?.dom as HTMLElement | undefined;
  const page = dom?.closest?.('[data-page-id]');
  return page?.getAttribute('data-page-id') ?? '';
}
