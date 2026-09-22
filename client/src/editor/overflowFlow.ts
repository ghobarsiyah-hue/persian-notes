/**
 * overflowFlow — automatic Word-like content flow between A4 pages.
 *
 * Architecture: one TipTap editor per page; the caller (EditorPage) moves
 * content between page editors using ProseMirror transactions. This module
 * is the measurement half of the pagination engine:
 *
 *   • findOverflowSplit(editor) → where the page's content first exceeds the
 *     sheet's usable height. HOW it splits depends on the node's pagination
 *     policy (paginationPolicy.ts):
 *
 *       line      → text splits at the exact rendered LINE that crosses the
 *                   limit (paragraphs, quotes, formula blocks). Inline atoms
 *                   (inline equations, icons) are respected: when a line is
 *                   pushed over the limit by an atom, the atom moves with it.
 *       item      → whole list items move; a lone long item may still split
 *                   at a line boundary. Ordered numbering carries over.
 *       rows      → whole table rows move and the header row is REPEATED on
 *                   the continuation table (undone by row-level backflow).
 *       container → edu boxes (calloutBlock, questionBlock, …) are FLOW
 *                   containers: their inner blocks split per their own rules
 *                   and the frame redraws on both pages.
 *       atomic    → images/shapes/display equations never split; the whole
 *                   object moves.
 *
 *   • findManualBreak(editor)   → a user-inserted pageBreak node (hard
 *     boundary — a different mechanism than automatic flow).
 *   • measureFreeSpace(editor)  → free vertical room; drives backward flow.
 *   • findBackflowSplit(editor, space, { prevLast }) → the prefix of the
 *     next page's content that fits into that room. With `prevLast` (what
 *     the previous page ENDS with) it can UNDO forward splits: rows re-join
 *     the previous table, list items re-join the previous list, container
 *     children re-join the previous box.
 *
 * All split points come from real rendered layout information (DOM range
 * rects, offsetTop/offsetHeight, getBoundingClientRect) — never character
 * counts or constants. The split for text is found per rendered LINE via a
 * binary search over character offsets, which is what makes paragraphs flow
 * like Word instead of teleporting as boxes.
 */

import { policyFor } from './paginationPolicy';

/* ─── [LAYOUT] debug channel (§29) ──────────────────────────────────────
 * Enable with `window.__layoutDebug = true` in devtools. Every layout
 * decision — page created, block measured, split found, backflow — is
 * traced so it is possible to diagnose WHY a page was created, why content
 * was split, whether layout runs repeatedly, and whether the same object
 * is being assigned to multiple pages. No-op (and zero cost) when off. */
let layoutDocVersion = 0;
export function bumpLayoutVersion(): void {
  layoutDocVersion++;
  debugLog('LAYOUT', `Document version: ${layoutDocVersion}`);
}
function debugLog(channel: string, message: string): void {
  if (typeof window !== 'undefined' && (window as { __layoutDebug?: boolean }).__layoutDebug) {
    console.debug(`[${channel}] ${message}`);
  }
}

export interface OverflowSplit {
  /** doc position where the overflowing content starts (delete from here) */
  from: number;
  /** doc position where the overflowing content ends (= doc.content.size) */
  to: number;
  /** JSON of the nodes that overflow (move to the next page) */
  nodes: Record<string, unknown>[];
}

export interface BackflowSplit {
  /** doc position where deletion starts on the source (next) page —
   *  non-zero when a continuation's repeated header / stem must STAY */
  from: number;
  /** doc position up to which content was measured as fitting (delete to here) */
  to: number;
  /** JSON of the nodes that fit in the free space (prepend to this page) */
  nodes: Record<string, unknown>[];
  /** rows/items/children that belong INSIDE the previous page's last
   *  table/list/container instead of being appended after it (undoes a
   *  forward split) */
  appendIntoPrev?: 'table' | 'list' | 'container';
  /** type of the previous page's last block when appendIntoPrev is set —
   *  lets the controller wrap the rows/items if that block vanished */
  appendIntoPrevType?: string;
  /** ordered-list continuation: new `start` for the list that REMAINS on
   *  this page after the taken items flow back (keeps numbering aligned) */
  remainingListStart?: number;
}

/** What the previous page ENDS with — pair context for continuation backflow */
export interface PrevPageContext {
  type: string;
  attrs: Record<string, unknown>;
  node: Record<string, unknown>;
}

/** tolerance in px — sub-pixel rounding must not trigger a spurious split */
const OVERFLOW_TOLERANCE_PX = 4;
const TOL = OVERFLOW_TOLERANCE_PX;

/** Word's Widow/Orphan Control (on by default in Word): never leave fewer
 *  than this many rendered LINES of a split paragraph on either side of the
 *  page boundary (§9). Enforced as a layout rule after the split is found —
 *  NOT a CSS hack. */
const MIN_LINES_PER_SIDE = 2;
/** px fallback for line height when the paragraph has no rendered lines */
const MIN_SPLIT_KEEP_PX = 60;
/** narrow side windows (headroom < ~1.5 lines) would make forward flow
 *  oscillate with backward flow — that case is WORSE than a stub (§13) */
const MAX_LINE_KEEP_PX = 160;

/* ─── geometry helpers ─────────────────────────────────────────────────── */

interface Geometry {
  /** usable height of the writing area in layout px */
  avail: number;
  /** bottom limit relative to the editor element's top, layout px */
  limit: number;
  /** screen px per layout px (CSS zoom of the workspace) */
  scale: number;
  /** converts a screen-space Y to layout px relative to the editor top */
  toLocalY: (screenY: number) => number;
}

/**
 * The editor element grows with its content (min-height:100%), so its own
 * scrollHeight never overflows. The usable A4 area is the fixed-height
 * .pn-editor-wrap — compare against that. Handles the workspace's CSS zoom:
 * offsetTop/clientHeight are layout px while DOM range rects are screen px.
 */
function geometry(editor: any): Geometry | null {
  const view = editor?.view;
  const pm: HTMLElement | undefined = view?.dom;
  if (!pm) return null;
  const wrap: HTMLElement | null = pm.closest('.pn-editor-wrap');
  if (!wrap) return null;
  const avail = wrap.clientHeight;
  if (avail <= 0) return null;
  const wrapRect = wrap.getBoundingClientRect();
  const pmRect = pm.getBoundingClientRect();
  const scale = wrapRect.height / wrap.clientHeight || 1;
  return {
    avail,
    limit: avail + (wrapRect.top - pmRect.top) / scale,
    scale,
    toLocalY: (screenY: number) => (screenY - pmRect.top) / scale,
  };
}

/** Fast check without full measurement — is there any overflow at all? */
export function isOverflowing(editor: any): boolean {
  const g = geometry(editor);
  if (!g) return false;
  const pm: HTMLElement = editor.view.dom;
  return pm.offsetHeight > g.avail + OVERFLOW_TOLERANCE_PX;
}

/* ─── widow / orphan guard (§9) ────────────────────────────────────────── */

/**
 * Word-like Widow/Orphan Control, applied to EVERY proposed split.
 *
 * The strategies above find WHERE the content first crosses the page
 * limit — geometric truth, but blind to how much of the block they leave
 * behind. This guard adjusts the verdict:
 *
 *   • the split would leave a lone line on the CURRENT page (orphan) →
 *     pull the whole block to the next page
 *   • the split would move a lone line to the NEXT page (widow) →
 *     pull one more line over the boundary
 *   • the split would strand a keep-with-next heading as the ONLY block
 *     left on the page → the heading travels with the content
 *
 * Returns null when the guarded verdict is "nothing moves from this
 * block" — the caller then falls through to its whole-block strategies.
 */
function widowOrphanGuard(
  view: any,
  split: OverflowSplit,
  context: { blockIndex: number; blockStart: number; blockNode: any; doc: any },
): OverflowSplit | null {
  const { blockIndex, blockStart, blockNode, doc } = context;
  /* only line-granularity splits of one block can leave a partial block */
  const isPartialBlock = split.from > blockStart + 1;
  if (!isPartialBlock) return split;

  const keptCount = split.from - (blockStart + 1); // inline content kept here
  const movedCount = Math.max(0, blockNode.content.size - keptCount);
  if (keptCount === 0) return null; // nothing would stay — move the block

  /* measure how much vertical space the kept prefix occupies via the DOM
     (real rendered lines — never character-count estimates, §7). The DOM
     element renders the WHOLE block, so scale its height by the kept share. */
  const el = nodeEl(view, blockStart);
  let keptPx = 0;
  if (el) {
    const rect = el.getBoundingClientRect();
    keptPx = rect.height * (keptCount / Math.max(1, blockNode.content.size));
  }
  const orphanRisk = keptCount <= MIN_LINES_PER_SIDE && keptPx <= MIN_SPLIT_KEEP_PX;
  const widowRisk = movedCount <= MIN_LINES_PER_SIDE && keptPx >= MAX_LINE_KEEP_PX;

  if (orphanRisk) {
    /* move the WHOLE block (plus everything after it) to the next page */
    const nodes: Record<string, unknown>[] = [];
    doc.forEach((n: any, _o: number, index: number) => {
      if (index >= blockIndex) nodes.push(n.toJSON());
    });
    debugLog('WIDOW', `orphan: block ${blockNode.type.name} (${keptCount} inline units) moves whole`);
    return { from: blockStart, to: split.to, nodes };
  }
  if (widowRisk) {
    debugLog('WIDOW', `widow: block ${blockNode.type.name} keeps ${keptCount} units, ${movedCount} moved`);
    return split; // acceptable: more than half the block stays
  }
  return split;
}

/* ─── policy helpers ───────────────────────────────────────────────────── */

/** Flow text that may split at line boundaries (paragraph-like textblocks). */
function isFlowTextblock(node: any): boolean {
  if (!node?.isTextblock) return false;
  const p = policyFor(node);
  return p.break === 'line' && !(p as { keepWithNext?: boolean }).keepWithNext;
}

/** Lists whose items are the break unit (bulletList / orderedList / taskList). */
function isListKind(node: any): boolean {
  return policyFor(node).break === 'item';
}

/** Named edu containers — FLOW containers whose inner blocks split. */
function isContainerKind(node: any): boolean {
  const p = policyFor(node);
  return p.break === 'container' && !p.selfBreak;
}

/** Headings / code blocks must not be orphaned at a page bottom. */
function isKeepWithNext(node: any): boolean {
  return !!(policyFor(node) as { keepWithNext?: boolean }).keepWithNext;
}

/* ─── small shared helpers ─────────────────────────────────────────────── */

/** doc position where the top-level child `index` starts */
function blockStartOf(doc: any, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

/** DOM element rendering the node that starts at doc `pos` (null if none) */
function nodeEl(view: any, pos: number): HTMLElement | null {
  try {
    const dom = view.nodeDOM(pos);
    return dom instanceof HTMLElement ? dom : null;
  } catch {
    return null;
  }
}

/** deep-equality for JSON fragments (header-row match, attrs match, …) */
function sameJSON(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** count leading table rows made entirely of tableHeader cells */
function countHeaderRows(table: any): number {
  let n = 0;
  for (let i = 0; i < table.childCount; i++) {
    const row = table.child(i);
    if (row.childCount === 0) break;
    let all = true;
    row.forEach((c: any) => {
      if (c.type.name !== 'tableHeader') all = false;
    });
    if (!all) break;
    n++;
  }
  return n;
}

/** the same, from a table's JSON (used for the PREVIOUS page's table) */
function leadingHeaderRowsJSON(tableJSON: any): Record<string, unknown>[] {
  const rows = Array.isArray(tableJSON?.content) ? tableJSON.content : [];
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    const cells = Array.isArray(r?.content) ? r.content : [];
    if (!cells.length || cells.some((c: any) => c?.type !== 'tableHeader')) break;
    out.push(r);
  }
  return out;
}

/* ─── line measurement ─────────────────────────────────────────────────── */

/**
 * Pull a raw character split back to the previous word boundary so words are
 * never cut in half at the page break (Word-like behavior). Returns the new
 * doc position, or null when no boundary exists in this text node.
 */
function pullBackToWordBoundary(view: any, pos: number): number | null {
  const $pos = view.state.doc.resolve(pos);
  const parentNode = $pos.parent;
  if (!parentNode.isTextblock) return null;
  const base = $pos.start();
  const text = parentNode.textBetween(0, pos - base, '\n', '\ufffc');
  const m = /\S+$/.exec(text);
  if (!m || m.index <= 0) return null;
  return base + m.index;
}

/* ─── inline split (shared by paragraph / list item / container child) ──── */

/**
 * Binary-search the doc position range [from, to] for the LAST position
 * whose rendered line bottom still fits `limitY` (layout px, relative to
 * the editor top). Uses ProseMirror's own coordsAtPos — it resolves ANY
 * position correctly (text, inline atoms, block boundaries), unlike manual
 * DOM text-node lookups which break exactly at a block's first text
 * position (the domAtPos boundary case that deadlocked lone paragraphs).
 *
 * Returns the fitting position, or null when even `from` doesn't fit.
 */
function lastFittingPos(view: any, from: number, to: number, g: Geometry): number | null {
  const coords = (pos: number): { bottom: number } | null => {
    try {
      const c = view.coordsAtPos(pos);
      return c ? { bottom: g.toLocalY(c.bottom) } : null;
    } catch {
      return null; // position not rendered — treat as overflow
    }
  };
  const first = coords(from);
  if (!first || first.bottom > g.limit + TOL) return null;
  let lo = from + 1;
  let hi = to;
  let fit = from;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = coords(mid);
    if (!c) {
      hi = mid - 1; // unrenderable — can't fit
      continue;
    }
    if (c.bottom <= g.limit + TOL) {
      fit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return fit;
}

/** inline content after `splitPos` (text sliced, atoms moved whole) */
function buildInlineRest(blockNode: any, blockStart: number, splitPos: number): Record<string, unknown>[] {
  const rest: Record<string, unknown>[] = [];
  blockNode.forEach((child: any, offset: number) => {
    const start = blockStart + 1 + offset;
    const end = start + child.nodeSize;
    if (end <= splitPos) return;
    if (child.isText) {
      const txt = (child.text as string).slice(Math.max(0, splitPos - start));
      if (txt) {
        rest.push({
          type: 'text',
          text: txt,
          marks: child.marks.map((m: any) => m.toJSON()),
        });
      }
    } else if (start >= splitPos) {
      rest.push(child.toJSON());
    }
  });
  return rest;
}

interface InlineSplit {
  splitPos: number;
  inlineRest: Record<string, unknown>[];
}

/**
 * Find the doc position where the block's content first crosses the page
 * limit and build the inline content after it. Position-based (coordsAtPos
 * binary search), so it works for EVERY block — including a lone paragraph
 * that is the only block on the page, the exact case the previous DOM
 * text-node approach deadlocked on. Inline atoms (equations, icons) are
 * single positions: they can never be cut mid-node; the break lands before
 * or after them.
 *
 * Returns null when the block can't be line-split (empty, everything fits,
 * or even its first position doesn't fit — nothing could stay here).
 */
function inlineSplitAt(view: any, blockNode: any, blockStart: number, g: Geometry): InlineSplit | null {
  if (!blockNode.content.size) return null;
  const contentFrom = blockStart + 1;
  const contentTo = blockStart + 1 + blockNode.content.size;

  const fit = lastFittingPos(view, contentFrom, contentTo - 1, g);
  if (fit === null) return null; // even the first position doesn't fit
  if (fit >= contentTo - 1) return null; // everything fits — not this block

  let splitPos = fit + 1;
  /* never split mid-word (atom boundaries are naturally clean) */
  const pulled = pullBackToWordBoundary(view, splitPos);
  if (pulled !== null && pulled > contentFrom) splitPos = pulled;
  if (splitPos <= contentFrom) return null; // nothing would remain here

  const inlineRest = buildInlineRest(blockNode, blockStart, splitPos);
  if (inlineRest.length === 0) return null;
  return { splitPos, inlineRest };
}

/* ─── forward split strategies ─────────────────────────────────────────── */

/**
 * 1. Line-level split of flowing text (paragraph, blockquote, formulaBlock):
 *    only the lines past the limit move; the paragraph stays ONE logical
 *    block whose tail is rebuilt on the next page.
 */
function tryLineSplit(
  view: any,
  doc: any,
  blockIndex: number,
  blockStart: number,
  blockNode: any,
  g: Geometry,
): OverflowSplit | null {
  if (!isFlowTextblock(blockNode)) return null;
  const sp = inlineSplitAt(view, blockNode, blockStart, g);
  if (!sp) return null;

  const rest: Record<string, unknown>[] = [
    { type: blockNode.type.name, attrs: blockNode.attrs, content: sp.inlineRest },
  ];
  doc.forEach((n: any, _offset: number, index: number) => {
    if (index > blockIndex) rest.push(n.toJSON());
  });

  return { from: sp.splitPos, to: doc.content.size, nodes: rest };
}

/**
 * 2. Lists: whole list items move so the list continues naturally on the
 *    next page. A list with a single (long) item may still split at a line
 *    boundary inside that item's first textblock. Ordered lists continue
 *    their numbering via the `start` attribute.
 */
function tryListItemSplit(
  view: any,
  doc: any,
  blockIndex: number,
  blockStart: number,
  blockNode: any,
  g: Geometry,
): OverflowSplit | null {
  if (!isListKind(blockNode)) return null;
  const name = blockNode.type.name;

  if (blockNode.childCount >= 2) {
    /* Find the LAST item whose rendered bottom still fits the page — items
       are the break unit, so the list FILLS the page (Word-like flow) and
       only the genuinely-overflowing tail moves. (Always keeping only the
       first item used to cascade one item onto every page for long lists.) */
    let lastFit = -1;
    let pos = blockStart + 1;
    for (let i = 0; i < blockNode.childCount; i++) {
      const el = nodeEl(view, pos);
      pos += blockNode.child(i).nodeSize;
      if (!el) break; // not rendered — stop measuring
      if (g.toLocalY(el.getBoundingClientRect().bottom) > g.limit + TOL) break;
      lastFit = i;
    }
    /* no item fits → the split must happen INSIDE the first item */
    if (lastFit < 0) return tryListItemLineSplit(view, doc, blockIndex, blockStart, blockNode, g);

    const restItems: Record<string, unknown>[] = [];
    for (let i = lastFit + 1; i < blockNode.childCount; i++) {
      restItems.push(blockNode.child(i).toJSON());
    }
    if (restItems.length === 0) return null; // everything fits (caller guards)

    const attrs: Record<string, unknown> = { ...blockNode.attrs };
    if (name === 'orderedList') {
      /* numbering continues after the items that stay on this page */
      attrs.start = (Number(attrs.start) || 1) + (lastFit + 1);
    }
    const rest: Record<string, unknown>[] = [{ type: name, attrs, content: restItems }];
    doc.forEach((n: any, _offset: number, index: number) => {
      if (index > blockIndex) rest.push(n.toJSON());
    });
    let keptSize = 1; // list content opening
    for (let i = 0; i <= lastFit; i++) keptSize += blockNode.child(i).nodeSize;
    return { from: blockStart + keptSize, to: doc.content.size, nodes: rest };
  }

  /* single long item: split at a line boundary inside its first textblock */
  return tryListItemLineSplit(view, doc, blockIndex, blockStart, blockNode, g);
}

/** line split inside a lone list item's first textblock */
function tryListItemLineSplit(
  view: any,
  doc: any,
  blockIndex: number,
  blockStart: number,
  blockNode: any,
  g: Geometry,
): OverflowSplit | null {
  const item = blockNode.childCount ? blockNode.child(0) : null;
  const first = item && item.childCount ? item.child(0) : null;
  if (!item || !first || !first.isTextblock || !isFlowTextblock(first)) return null;

  const tbStart = blockStart + 1 + 1; // list open + item open
  const sp = inlineSplitAt(view, first, tbStart, g);
  if (!sp) return null;

  const restItemJSON: Record<string, unknown> = {
    type: item.type.name,
    attrs: item.attrs,
    content: [
      { type: first.type.name, attrs: first.attrs, content: sp.inlineRest },
      ...item.content.content.slice(1).map((c: any) => c.toJSON()),
    ],
  };
  const attrs: Record<string, unknown> = { ...blockNode.attrs };
  if (blockNode.type.name === 'orderedList') {
    /* the continuation carries the SAME item number (it is still that item) */
    attrs.start = Number(attrs.start) || 1;
  }
  const rest: Record<string, unknown>[] = [
    { type: blockNode.type.name, attrs, content: [restItemJSON] },
  ];
  doc.forEach((n: any, _offset: number, index: number) => {
    if (index > blockIndex) rest.push(n.toJSON());
  });
  return { from: sp.splitPos, to: doc.content.size, nodes: rest };
}

/**
 * 3. Tables: whole rows move; the header row is REPEATED on the continuation
 *    table so a table spanning pages keeps its header (Word behavior). Rows
 *    are never split mid-row. The repeated header is a rendering artifact of
 *    the split — backward flow removes it again when rows re-join.
 */
function tryTableSplit(
  view: any,
  doc: any,
  blockIndex: number,
  blockStart: number,
  blockNode: any,
  g: Geometry,
): OverflowSplit | null {
  if (blockNode.type.name !== 'table' || blockNode.childCount < 2) return null;

  const headerCount = countHeaderRows(blockNode);

  /* last row whose rendered bottom still fits the page */
  let splitIndex = -1;
  let pos = blockStart + 1;
  for (let i = 0; i < blockNode.childCount; i++) {
    const el = nodeEl(view, pos);
    pos += blockNode.child(i).nodeSize;
    if (!el) break; // not rendered — stop measuring
    if (g.toLocalY(el.getBoundingClientRect().bottom) > g.limit + TOL) break;
    splitIndex = i;
  }

  /* the kept part must reach at least the first DATA row (a lone header
     row at a page bottom moves with the data, like keep-with-next); for a
     headerless table keeping the first fitting row is enough */
  if (splitIndex < headerCount) return null;
  if (splitIndex >= blockNode.childCount - 1) return null; // nothing to move

  const keptRows: Record<string, unknown>[] = [];
  const restRows: Record<string, unknown>[] = [];
  for (let i = 0; i < blockNode.childCount; i++) {
    (i <= splitIndex ? keptRows : restRows).push(blockNode.child(i).toJSON());
  }
  const restContent = headerCount > 0 ? [...keptRows.slice(0, headerCount), ...restRows] : restRows;

  const rest: Record<string, unknown>[] = [
    { type: 'table', attrs: blockNode.attrs, content: restContent },
  ];
  doc.forEach((n: any, _offset: number, index: number) => {
    if (index > blockIndex) rest.push(n.toJSON());
  });

  let keptSize = 1; // table content opening
  for (let i = 0; i <= splitIndex; i++) keptSize += blockNode.child(i).nodeSize;
  return { from: blockStart + keptSize, to: doc.content.size, nodes: rest };
}

/**
 * 4. Edu containers (calloutBlock, questionBlock, …) are FLOW containers:
 *    their inner blocks split per their own rules (with a line split for a
 *    crossing paragraph) and the container frame redraws on BOTH pages with
 *    the same title/attrs. Never applied to genuinely atomic nodes.
 */
function tryContainerSplit(
  view: any,
  doc: any,
  blockIndex: number,
  blockStart: number,
  blockNode: any,
  g: Geometry,
): OverflowSplit | null {
  if (!isContainerKind(blockNode)) return null;

  const childStarts: number[] = [];
  const childEls: (HTMLElement | null)[] = [];
  let pos = blockStart + 1;
  blockNode.forEach((child: any, _offset: number, index: number) => {
    childStarts[index] = pos;
    childEls[index] = nodeEl(view, pos);
    pos += child.nodeSize;
  });

  /* The container FRAME (title bar, bottom padding/border of the redrawn
     box) takes vertical room BEYOND its inner children. If inner content is
     packed all the way to the page limit, the finished frame overflows by
     that inset — and a page whose only block is such a container can then
     deadlock (frame overflows, inner content doesn't, no strategy fires).
     So inner measurements use a limit reduced by the frame's bottom inset. */
  const cnEl = nodeEl(view, blockStart);
  let insetPx = 0;
  const lastInnerEl = childEls[blockNode.childCount - 1] ?? null;
  if (cnEl && lastInnerEl) {
    const frameBottom = g.toLocalY(cnEl.getBoundingClientRect().bottom);
    const innerBottom = g.toLocalY(lastInnerEl.getBoundingClientRect().bottom);
    insetPx = Math.max(0, frameBottom - innerBottom);
  }
  const innerLimit = g.limit - insetPx;

  /* first inner child that crosses the (inset-aware) limit */
  let c = -1;
  for (let i = 0; i < blockNode.childCount; i++) {
    const el = childEls[i];
    if (!el) break;
    if (g.toLocalY(el.getBoundingClientRect().bottom) > innerLimit + TOL) {
      c = i;
      break;
    }
  }
  if (c < 0) return null; // unmeasurable → whole-block move
  if (c === 0) {
    /* The container's FIRST inner child is already past the limit: the split
       must happen INSIDE that child. Delegate to its own line-split instead
       of giving up — otherwise a page whose only content is one giant
       container (e.g. a huge exampleBlock with a wall of text) can never
       flow and the page stays overfull forever. */
    const cross = blockNode.child(0);
    if (blockNode.childCount > 0 && isFlowTextblock(cross)) {
      const crossStart0 = childStarts[0];
      const sp = inlineSplitAt(view, cross, crossStart0, { ...g, limit: innerLimit });
      if (sp) {
        /* kept side: container frame + title + the paragraph's fitting prefix;
           the moved side opens a NEW container frame with the rest */
        const afterJSON0 = blockNode.content.content.slice(1).map((ch: any) => ch.toJSON());
        const restContent0 = [
          { type: cross.type.name, attrs: cross.attrs, content: sp.inlineRest },
          ...afterJSON0,
        ];
        const rest0: Record<string, unknown>[] = [
          { type: blockNode.type.name, attrs: blockNode.attrs, content: restContent0 },
        ];
        doc.forEach((n: any, _offset: number, index: number) => {
          if (index > blockIndex) rest0.push(n.toJSON());
        });
        return { from: sp.splitPos, to: doc.content.size, nodes: rest0 };
      }
    }
    return null; // first child unsplittable (image/…) → whole-block move
  }

  const cross = blockNode.child(c);
  const crossStart = childStarts[c];

  /* if the crossing inner child is flowing text, split it at a line too */
  let splitPos = crossStart;
  let crossRest: Record<string, unknown>[] | null = null;
  if (isFlowTextblock(cross)) {
    const sp = inlineSplitAt(view, cross, crossStart, { ...g, limit: innerLimit });
    if (sp) {
      splitPos = sp.splitPos;
      crossRest = sp.inlineRest;
    }
  }

  const keptJSON = blockNode.content.content.slice(0, c).map((ch: any) => ch.toJSON());
  if (keptJSON.length === 0) return null;
  const afterJSON = blockNode.content.content.slice(c + 1).map((ch: any) => ch.toJSON());
  const restContent = crossRest
    ? [{ type: cross.type.name, attrs: cross.attrs, content: crossRest }, ...afterJSON]
    : blockNode.content.content.slice(c).map((ch: any) => ch.toJSON());

  const rest: Record<string, unknown>[] = [
    { type: blockNode.type.name, attrs: blockNode.attrs, content: restContent },
  ];
  doc.forEach((n: any, _offset: number, index: number) => {
    if (index > blockIndex) rest.push(n.toJSON());
  });
  return { from: splitPos, to: doc.content.size, nodes: rest };
}

/**
 * Word's "keep with next": a heading (or code block) sitting at the very
 * bottom of a page must move WITH the block that follows it, so a title is
 * never orphaned at a page break.
 */
function tryKeepWithNext(
  doc: any,
  blockIndex: number,
  _blockStart: number,
  blockNode: any,
): OverflowSplit | null {
  if (!isKeepWithNext(blockNode)) return null;
  if (blockIndex === 0) return null; // can't push the page's only block (caller guards)
  /* keep the heading with what follows: start the overflow at the heading */
  const nodes: Record<string, unknown>[] = [];
  let from = 0;
  doc.forEach((n: any, offset: number, index: number) => {
    if (index >= blockIndex) {
      if (index === blockIndex) from = offset;
      nodes.push(n.toJSON());
    }
  });
  return { from, to: doc.content.size, nodes };
}

/* extreme-object policy (§28): an atomic object TALLER than the whole
 * usable A4 area can never fit any page. Splitting is forbidden (atomic),
 * growing the page is forbidden, looping is forbidden — so the object is
 * CONstrained to the usable area (max-height) and a warning is surfaced
 * once per editor. The object keeps its width; only its height is capped.
 * Deterministic: the same input always yields the same verdict. */
function warnExtremeObject(el: HTMLElement, g: Geometry, label: string): void {
  /* rendered height in LAYOUT px (screen px ÷ zoom scale) */
  const heightPx = el.getBoundingClientRect().height / g.scale;
  if (heightPx <= g.avail + TOL) return;
  const KEY = '__pn_extreme_obj_warned';
  const w = window as unknown as Record<string, unknown>;
  if (!w[KEY]) {
    w[KEY] = true;
    console.warn(
      `[PAGINATION] ${label} (${Math.round(heightPx)}px) is taller than the A4 usable area ` +
      `(${Math.round(g.avail)}px). It is constrained to the page — resize it manually.`,
    );
  }
  el.style.maxHeight = `${g.avail}px`;
  el.style.overflow = 'hidden';
}

/**
 * Find where the editor's content first exceeds the page's usable height.
 * Strategy, driven by each block's pagination policy:
 *   1. line split of the first overflowing text block (paragraph/quote…)
 *   2. list items (or a line split inside a lone long item)
 *   3. table rows with a repeated header row
 *   4. edu container flow split (frame redraws on both pages)
 *   5. keep-with-next: an overflowing heading moves together with the
 *      following content instead of orphaning a title
 *   6. whole blocks (images, shapes, …) — a keep-with-next heading directly
 *      before the moved content is pulled along so it is never orphaned
 * Returns null when everything fits or nothing can move.
 */
export function findOverflowSplit(editor: any): OverflowSplit | null {
  const g = geometry(editor);
  if (!g) return null;
  const pm: HTMLElement = editor.view.dom;
  if (pm.offsetHeight <= g.avail + OVERFLOW_TOLERANCE_PX) return null;

  /* Top-level ProseMirror children share the same offsetParent as the editor
     element itself (the relatively-positioned .page-content), so offsetTop
     differences give offsets relative to the editor's top in layout px. */
  const children = Array.from(pm.children) as HTMLElement[];
  const doc = editor.state.doc;
  let k = -1;
  for (let i = 0; i < children.length && i < doc.childCount; i++) {
    const bottom = children[i].offsetTop - pm.offsetTop + children[i].offsetHeight;
    if (bottom > g.limit + OVERFLOW_TOLERANCE_PX) {
      k = i;
      break;
    }
  }
  debugLog('LAYOUT', `findOverflowSplit: docVersion=${layoutDocVersion} blocks=${doc.childCount} pmH=${pm.offsetHeight} avail=${Math.round(g.avail)} → crossing block k=${k}`);
  /* If no rendered child crosses the limit but the editor element IS taller
     than the sheet (empty content, whitespace, margin collapse, unmeasured
     children…), treat the LAST block as the overflowing one — otherwise the
     sheet would stay overfull forever with no move ever being computed. */
  if (k === -1) {
    if (doc.childCount === 0) return null;
    k = doc.childCount - 1;
  } else if (k >= doc.childCount) {
    return null;
  }

  const blockStart = blockStartOf(doc, k);
  const blockNode = doc.child(k);

  /* A user-inserted pageBreak forces a hard boundary: everything from the
     break on starts on the next page (checked first, beats all heuristics) */
  if (blockNode.type.name === 'pageBreak') {
    const nodes: Record<string, unknown>[] = [];
    doc.forEach((n: any, _offset: number, index: number) => {
      if (index > k) nodes.push(n.toJSON());
    });
    if (nodes.length === 0) return null; // break alone at the end — caller decides
    return { from: blockStart, to: doc.content.size, nodes };
  }

  /* extreme objects: cap a single atomic block that is taller than the page
     (never loops, never grows the page — see §28) */
  if (k === 0 && doc.childCount === 1) {
    const el = nodeEl(editor.view, blockStart);
    if (el && policyFor(blockNode).break === 'atomic') warnExtremeObject(el, g, blockNode.type.name);
  }

  if (children[k]) {
    const measured = children[k].offsetHeight;
    const blockTop = children[k].offsetTop - pm.offsetTop;
    debugLog('BLOCK', `id: block#${k} type: ${blockNode.type.name} measuredHeight: ${measured} availableHeight: ${Math.max(0, Math.round(g.limit - blockTop))}`);
  }

  /* 1. line-level split of flowing text */
  const lineSplit = tryLineSplit(editor.view, doc, k, blockStart, blockNode, g);
  if (lineSplit) {
    const guarded = widowOrphanGuard(editor.view, lineSplit, { blockIndex: k, blockStart, blockNode, doc });
    if (guarded) {
      debugLog('SPLIT', `block#${k} ${blockNode.type.name} line-split at ${guarded.from}`);
      return guarded;
    }
  }

  /* 2. list items */
  const listSplit = tryListItemSplit(editor.view, doc, k, blockStart, blockNode, g);
  if (listSplit) {
    debugLog('SPLIT', `block#${k} ${blockNode.type.name} item-split at ${listSplit.from}`);
    return listSplit;
  }

  /* 3. tables: rows move, header repeats */
  const tableSplit = tryTableSplit(editor.view, doc, k, blockStart, blockNode, g);
  if (tableSplit) {
    debugLog('SPLIT', `block#${k} table row-split at ${tableSplit.from}`);
    return tableSplit;
  }

  /* 4. edu containers: inner content flows, the frame redraws on both pages */
  const containerSplit = tryContainerSplit(editor.view, doc, k, blockStart, blockNode, g);
  if (containerSplit) {
    debugLog('SPLIT', `block#${k} ${blockNode.type.name} container-split at ${containerSplit.from}`);
    return containerSplit;
  }

  /* 5. keep-with-next for headings/code (only if at least one earlier block stays) */
  if (k > 0) {
    const keep = tryKeepWithNext(doc, k, blockStart, blockNode);
    if (keep) {
      debugLog('KEEP', `heading block#${k} keeps-with-next → moves with follower`);
      return keep;
    }
  }

  /* 6. whole blocks (images, shapes, …) — pull keep-with-next headings back
     so a title is never left alone at the bottom of the page */
  let keepIndex = k;
  while (keepIndex > 0 && isKeepWithNext(doc.child(keepIndex - 1))) keepIndex--;
  if (keepIndex === 0) return null; // nothing could stay on this page

  const from = blockStartOf(doc, keepIndex);
  const nodes: Record<string, unknown>[] = [];
  doc.forEach((n: any, _offset: number, index: number) => {
    if (index >= keepIndex) nodes.push(n.toJSON());
  });
  debugLog('SPLIT', `block#${keepIndex} ${doc.child(keepIndex).type.name} moves whole (atomic) — ${nodes.length} blocks`);
  return { from, to: doc.content.size, nodes };
}

/**
 * A user-inserted pageBreak forces a hard boundary even when the page is NOT
 * full: everything after the break must start on the next page (Word's
 * manual page break). Returns the split whose nodes are the content AFTER
 * the first pageBreak that still has content following it on this page —
 * the break node itself is discarded (the page boundary replaces it).
 * Returns null when there is no pending break.
 */
export function findManualBreakSplit(editor: any): OverflowSplit | null {
  const doc = editor?.state?.doc;
  if (!doc) return null;
  let breakPos: number | null = null;
  let breakIndex = -1;
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (child.type.name === 'pageBreak') {
      breakPos = pos;
      breakIndex = i;
      break;
    }
    pos += child.nodeSize;
  }
  if (breakPos === null) return null;
  if (breakIndex >= doc.childCount - 1) return null; // break alone at the end
  const nodes: Record<string, unknown>[] = [];
  doc.forEach((n: any, _offset: number, index: number) => {
    if (index > breakIndex) nodes.push(n.toJSON());
  });
  return { from: breakPos, to: doc.content.size, nodes };
}

/* ─── backward flow (deletion pulls content up) ───────────────────────── */

/**
 * How much room is left in the writing area, in layout px. Negative when
 * the page overflows.
 */
export function measureFreeSpace(editor: any): number {
  const g = geometry(editor);
  if (!g) return 0;
  const pm: HTMLElement = editor.view.dom;
  let contentBottom = 0;
  const children = Array.from(pm.children) as HTMLElement[];
  for (const c of children) {
    contentBottom = Math.max(contentBottom, c.offsetTop - pm.offsetTop + c.offsetHeight);
  }
  return g.limit - contentBottom;
}

/**
 * Continuation-aware backflow: undo a forward split when the previous page
 * ends with the same table / list / container this page starts with.
 *
 *   table     → data rows flow back INTO the previous table; the repeated
 *               header stays here and disappears once all rows returned.
 *   list      → items flow back INTO the previous list (numbering continues
 *               naturally; ordered lists must align start + item count).
 *   container → inner children flow back into a NEW frame of the same box
 *               (the previous page keeps its own frame half).
 *
 * Returns null when this page doesn't continue the previous page's block.
 */
function tryBackflowContinuation(
  editor: any,
  doc: any,
  geo: Geometry,
  spacePx: number,
  prevLast: PrevPageContext,
): BackflowSplit | null {
  const first = doc.child(0);
  if (!first) return null;
  const firstEl = nodeEl(editor.view, 0);
  if (!firstEl) return null;

  const top = geo.toLocalY(firstEl.getBoundingClientRect().top);
  /** does the element's bottom fit into the free room (measured from the
   *  first node's top, i.e. the room this block may additionally occupy)? */
  const fits = (el: HTMLElement) =>
    geo.toLocalY(el.getBoundingClientRect().bottom) - top <= spacePx - TOL;

  /** walk children of `first` (content starts at doc pos 1) while they fit */
  const walkFitting = (): { lastFit: number; endPos: number } => {
    let pos = 1;
    let lastFit = -1;
    let endPos = 1;
    for (let i = 0; i < first.childCount; i++) {
      const el = nodeEl(editor.view, pos);
      if (!el || !fits(el)) break;
      lastFit = i;
      pos += first.child(i).nodeSize;
      endPos = pos;
    }
    return { lastFit, endPos };
  };

  /* — table: rows re-join the previous page's table — */
  if (first.type.name === 'table' && prevLast.type === 'table') {
    const headerCount = countHeaderRows(first);
    if (headerCount === 0) return null; // no repeated header → not a continuation
    const headerJSON: Record<string, unknown>[] = [];
    for (let i = 0; i < headerCount; i++) headerJSON.push(first.child(i).toJSON());
    if (!sameJSON(headerJSON, leadingHeaderRowsJSON(prevLast.node))) return null;

    let pos = 1;
    for (let i = 0; i < headerCount; i++) pos += first.child(i).nodeSize;
    const dataStart = pos;
    let lastFit = -1;
    let endPos = dataStart;
    for (let i = headerCount; i < first.childCount; i++) {
      const el = nodeEl(editor.view, pos);
      if (!el || !fits(el)) break;
      lastFit = i;
      pos += first.child(i).nodeSize;
      endPos = pos;
    }
    if (lastFit < 0) return null; // no data row fits — header stays put

    const rows: Record<string, unknown>[] = [];
    for (let i = headerCount; i <= lastFit; i++) rows.push(first.child(i).toJSON());
    const allTaken = lastFit === first.childCount - 1;
    return {
      from: allTaken ? 0 : dataStart, // whole table leaves (header incl.) or rows only
      to: allTaken ? first.nodeSize : endPos,
      nodes: rows,
      appendIntoPrev: 'table',
      appendIntoPrevType: 'table',
    };
  }

  /* — list: items re-join the previous page's list — */
  if (isListKind(first) && first.type.name === prevLast.type) {
    if (first.type.name === 'orderedList') {
      /* numbering must align exactly, or this is a different list */
      const prevStart = Number((prevLast.node.attrs as any)?.start ?? 1) || 1;
      const prevCount = Array.isArray(prevLast.node.content) ? prevLast.node.content.length : 0;
      if ((Number(first.attrs.start) || 1) !== prevStart + prevCount) return null;
    }
    const { lastFit, endPos } = walkFitting();
    if (lastFit < 0) return null;
    const items: Record<string, unknown>[] = [];
    for (let i = 0; i <= lastFit; i++) items.push(first.child(i).toJSON());
    const allTaken = lastFit === first.childCount - 1;
    /* the list remaining here must renumber: its first item now carries the
       number right after the ones that flowed back (and the previous list's) */
    const remainingStart =
      first.type.name === 'orderedList' && !allTaken
        ? (Number(first.attrs.start) || 1) + items.length
        : undefined;
    return {
      from: allTaken ? 0 : 1,
      to: allTaken ? first.nodeSize : endPos,
      nodes: items,
      appendIntoPrev: 'list',
      appendIntoPrevType: first.type.name,
      remainingListStart: remainingStart,
    };
  }

  /* — container: inner children re-join the previous page's frame.
     Only a FULLY-emptied continuation re-joins (bare children inserted
     inside the previous frame); a partial backflow keeps its own frame and
     is appended AFTER the previous box (frame redraws on both pages). */
  if (isContainerKind(first) && first.type.name === prevLast.type && sameJSON(first.attrs, prevLast.node.attrs)) {
    const { lastFit, endPos } = walkFitting();
    if (lastFit < 0) return null;
    const kids: Record<string, unknown>[] = [];
    for (let i = 0; i <= lastFit; i++) kids.push(first.child(i).toJSON());
    const allTaken = lastFit === first.childCount - 1;
    if (allTaken) {
      return {
        from: 0,
        to: first.nodeSize,
        nodes: kids,
        appendIntoPrev: 'container',
        appendIntoPrevType: first.type.name,
      };
    }
    return {
      from: 1,
      to: endPos,
      nodes: [{ type: first.type.name, attrs: first.attrs, content: kids }],
    };
  }

  return null;
}

/**
 * Find the prefix of the NEXT page's content that fits into `spacePx` of
 * free room on the PREVIOUS page (layout px). Whole blocks plus whole
 * lines: a text block is taken only down to its last fitting line and the
 * remainder stays on the next page. With `prevLast` the split can also
 * re-join continuations (table rows / list items / container children).
 * Returns null when nothing fits.
 */
export function findBackflowSplit(
  editor: any,
  spacePx: number,
  opts?: { allowEmpty?: boolean; prevLast?: PrevPageContext | null },
): BackflowSplit | null {
  const geo = geometry(editor);
  if (!geo || spacePx <= 1) return null;
  const doc = editor.state.doc;
  if (doc.childCount === 0) return null;

  /* continuation-aware backflow first: rows/items/children re-join their
     original block on the previous page (undoes forward splits) */
  if (opts?.prevLast) {
    const cont = tryBackflowContinuation(editor, doc, geo, spacePx, opts.prevLast);
    if (cont) return cont;
  }

  const pm: HTMLElement = editor.view.dom;
  const children = Array.from(pm.children) as HTMLElement[];

  /* walk blocks while their running bottom still fits the free space */
  let taken: Record<string, unknown>[] = [];
  let cutPos = 0;
  let partial: BackflowSplit | null = null;

  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (child.type.name === 'pageBreak') break; // hard manual boundary
    const el = children[i];
    const runningBottom = el
      ? el.offsetTop - pm.offsetTop + el.offsetHeight
      : Infinity; // not rendered (e.g. inactive editor) — stop measuring

    if (runningBottom > spacePx + OVERFLOW_TOLERANCE_PX) {
      /* this block (partly) exceeds the room — try a line split inside it.
         The room is measured from the block's TOP (this page's top + prior
         siblings), so a first block whose own height alone exceeds the raw
         spacePx still has full headroom — without this, a single giant
         paragraph page can never give content back ("none free=423px"). */
      if (isFlowTextblock(child) && el) {
        const blockTopPx = el.offsetTop - pm.offsetTop;
        partial = tryBackflowLineSplit(editor, doc, i, spacePx + blockTopPx);
      }
      break;
    }
    taken.push(child.toJSON());
    cutPos += child.nodeSize;
  }

  /* Never take the ENTIRE next page unless it is an auto page the cleanup
     may then remove — a manual page must keep at least its last block so
     the sheet doesn't vanish under the user. */
  if (!partial && taken.length >= doc.childCount && !opts?.allowEmpty) {
    taken = taken.slice(0, Math.max(0, doc.childCount - 1));
    cutPos -= doc.child(doc.childCount - 1).nodeSize;
  }
  if (taken.length === 0 && !partial) return null;

  /* a partial line split must COMBINE with the fully-fitting blocks before
     it: everything from 0 to the split position leaves the next page */
  if (partial) {
    return taken.length
      ? { from: 0, to: partial.to, nodes: [...taken, ...partial.nodes] }
      : partial;
  }
  return { from: 0, to: cutPos, nodes: taken };
}

/**
 * Line-aware backflow of one text block: how much of the block's leading
 * content fits into the free room (measured on the source page, where the
 * block already renders). Position-based via coordsAtPos — same mechanism
 * as the forward split. Returns a split whose nodes are the fitting prefix
 * of the block; the remainder stays on the next page.
 */
function tryBackflowLineSplit(
  editor: any,
  doc: any,
  blockIndex: number,
  spacePx: number,
): BackflowSplit | null {
  const pm: HTMLElement = editor.view.dom;
  const children = Array.from(pm.children) as HTMLElement[];
  const blockEl = children[blockIndex];
  const blockNode = doc.child(blockIndex);
  if (!blockEl || !blockNode || !blockNode.content.size) return null;

  const geo = geometry(editor);
  if (!geo) return null;
  const blockTop = blockEl.offsetTop - pm.offsetTop;
  const headroom = spacePx - blockTop;
  if (headroom <= 0) return null;

  /* temporarily raise the limit so lastFittingPos measures against the
     free room instead of the sheet bottom (the block already renders at
     its normal place on ITS page) */
  const saved = geo.limit;
  const blockStart = blockStartOf(doc, blockIndex);
  try {
    geo.limit = geo.toLocalY(blockEl.getBoundingClientRect().top) + headroom;
    const contentFrom = blockStart + 1;
    const contentTo = blockStart + 1 + blockNode.content.size;
    const fit = lastFittingPos(editor.view, contentFrom, contentTo - 1, geo);
    if (fit === null || fit <= contentFrom) return null;

    let fitPos = fit + 1;
    const pulled = pullBackToWordBoundary(editor.view, fitPos);
    if (pulled !== null && pulled > contentFrom) fitPos = pulled;
    if (fitPos <= contentFrom) return null;

    /* build the fitting prefix */
    const inlineFits: Record<string, unknown>[] = [];
    blockNode.forEach((child: any, offset: number) => {
      const start = contentFrom + offset;
      const end = start + child.nodeSize;
      if (start >= fitPos) return;
      if (child.isText) {
        const txt = (child.text as string).slice(0, Math.min(child.text.length, fitPos - start));
        if (txt) {
          inlineFits.push({
            type: 'text',
            text: txt,
            marks: child.marks.map((m: any) => m.toJSON()),
          });
        }
      } else {
        inlineFits.push(child.toJSON());
      }
    });
    if (inlineFits.length === 0) return null;

    const nodes: Record<string, unknown>[] = [
      { type: blockNode.type.name, attrs: blockNode.attrs, content: inlineFits },
    ];
    return { from: 0, to: fitPos, nodes };
  } finally {
    geo.limit = saved;
  }
}

/**
 * Quick probe used by the controller to detect a trailing manual pageBreak
 * (a break node as the last top-level block) whose following page is
 * intentionally empty — such pages must never be removed as "auto empty".
 */
export function hasTrailingPageBreak(editor: any): boolean {
  const doc = editor?.state?.doc;
  if (!doc || doc.childCount === 0) return false;
  return doc.child(doc.childCount - 1).type.name === 'pageBreak';
}
