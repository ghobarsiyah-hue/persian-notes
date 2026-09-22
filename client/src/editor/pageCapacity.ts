/**
 * pageCapacity — the GEOMETRY half of the pagination architecture.
 *
 * Answers «WHAT FITS?» from actual rendered layout — never character
 * counts, never constants. Kept deliberately separate from the policy
 * (paginationMode.ts) so the future SmartPaginationPolicy reuses the same
 * measurement layer with different verdicts.
 *
 * Reuses the SAME page geometry contract as the flow engine
 * (overflowFlow.ts): the fixed-height `.pn-editor-wrap` inside the
 * `.page-paper` sheet is the usable A4 area, and the CSS-zoom handling
 * mirrors overflowFlow.geometry(). The A4 sheet is 794×1123 CSS px with
 * `.page-paper` padding (30/32 framed, 38 blank & notebook) as the
 * writing-safe margin — identical to what the PDF exporter renders
 * (pageModelExport.ts), so editor and PDF stay one geometry.
 */

/** A4 @96dpi — same constants the editor CSS and PDF export use */
export const A4_W_PX = 794;
export const A4_H_PX = 1123;

/** framed (قاب‌دار) sheet padding — .page-paper in index.css */
export const FRAMED_PADDING = { top: 30, right: 32, bottom: 30, left: 32 } as const;
/** blank / notebook sheet padding — .page-blank / .page-notebook */
export const PLAIN_PADDING = { top: 38, right: 38, bottom: 38, left: 38 } as const;

import type { PageKind } from '@/types';

/** Usable content box of a sheet (CSS px) — the writable A4 area. */
export interface PageContentBounds {
  width: number;
  height: number;
}

export function pageContentBounds(kind: PageKind = 'framed'): PageContentBounds {
  const p = kind === 'framed' ? FRAMED_PADDING : PLAIN_PADDING;
  return {
    width: A4_W_PX - p.left - p.right,
    height: A4_H_PX - p.top - p.bottom,
  };
}

/** THE one authoritative inset policy per page kind — consumed by the
 *  floating-object layer (movement/resize bounds) and by any future surface
 *  that needs the usable box. Keep in sync with index.css `.page-*` padding:
 *  framed 30/32, blank 38, notebook 38. */
export function pagePadding(kind: PageKind = 'framed'): { top: number; right: number; bottom: number; left: number } {
  return kind === 'framed' ? { ...FRAMED_PADDING } : { ...PLAIN_PADDING };
}

/* ── object-area policy ─────────────────────────────────────────────────
   Objects (shapes, images, notes…) live in the usable box MINUS a small
   breathing inset on the page's right edge — about one index finger wide —
   so a shape can never visually fuse with the sheet's real right edge.
   The bottom keeps the full usable height (objects may end at the same
   boundary text does); left/top keep the usable box as-is. ONE constant,
   ONE function — drag, resize, placement, alignment and any future
   consumer all read from here. */
export const OBJECT_EDGE_INSET_PX = 24;

/** Largest object area (width×height) and origin offset for floating
 *  objects on a page kind. `x0` shifts the area's left edge (0 today); the
 *  right edge is inset by OBJECT_EDGE_INSET_PX. */
export function objectMaxArea(kind: PageKind = 'framed'): { x0: number; y0: number; w: number; h: number } {
  const b = pageContentBounds(kind);
  return {
    x0: 0,
    y0: 0,
    w: Math.max(0, b.width - OBJECT_EDGE_INSET_PX),
    h: Math.max(0, b.height),
  };
}

/* ─── live geometry (mirrors overflowFlow.geometry) ─────────────────────── */

export interface LiveGeometry {
  /** usable height of the writing area in layout px */
  avail: number;
  /** content bottom limit relative to the editor element's top, layout px */
  limit: number;
  /** screen px per layout px (CSS zoom of the workspace) */
  scale: number;
}

/** Accepts a TipTap `Editor` OR a raw ProseMirror `EditorView` — both are
 *  passed around the insertion flows. */
function pmDomOf(source: unknown): HTMLElement | undefined {
  const s = source as { view?: { dom?: HTMLElement }; dom?: HTMLElement } | null | undefined;
  return s?.view?.dom ?? s?.dom;
}

/** Live usable geometry of a page editor (null when not yet mounted). */
export function liveGeometry(editor: unknown): LiveGeometry | null {
  const pm: HTMLElement | undefined = pmDomOf(editor);
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
  };
}

/**
 * Vertical room left in the writing area, layout px. Measures the live DOM
 * (offsetTop/offsetHeight of the editor's children) — the same measurement
 * the flow engine uses, just without pagination decisions attached.
 */
export function measureFreeHeight(editor: unknown): number {
  const pm: HTMLElement | undefined = pmDomOf(editor);
  const g = liveGeometry(editor);
  if (!pm || !g) return 0;
  let contentBottom = 0;
  for (const c of Array.from(pm.children) as HTMLElement[]) {
    contentBottom = Math.max(contentBottom, c.offsetTop - pm.offsetTop + c.offsetHeight);
  }
  return g.limit - contentBottom;
}

/* ─── scale-to-fit (images / shapes) ────────────────────────────────────── */

export interface FitBox {
  width: number;
  height: number;
  /** true when the element had to shrink from its natural size */
  scaled: boolean;
  /** false when even the minimum size cannot fit the free area */
  fits: boolean;
}

/**
 * Largest proportional size that fits into `availW × availH`, preserving
 * the natural aspect ratio. Never crops, never upscales past `maxW`.
 *
 *   scale = min(1, availW / w, availH / h)  →  (w × scale, h × scale)
 */
export function scaleToFit(
  naturalW: number,
  naturalH: number,
  availW: number,
  availH: number,
  opts?: { maxW?: number; minW?: number },
): FitBox {
  const w0 = Math.max(1, naturalW);
  const h0 = Math.max(1, naturalH);
  const cap = opts?.maxW ?? availW;
  const scale = Math.min(1, availW / w0, availH / h0, cap / w0);
  let width = Math.floor(w0 * scale);
  let height = Math.ceil(h0 * scale);
  const minW = opts?.minW ?? 60;
  /* reject only when SCALING had to shrink below the usable floor (§10:
     «cannot reasonably fit even at its minimum valid size»). An image whose
     NATURAL size is already tiny fits as-is — never reject it. */
  if (scale < 1 && (width < minW || height < 20)) return { width, height, scaled: true, fits: false };
  /* clamp the final box to the available area after rounding */
  if (width > availW) { height = Math.floor(height * (availW / width)); width = Math.floor(availW); }
  if (height > availH) { width = Math.floor(width * (availH / height)); height = Math.floor(availH); }
  return { width, height, scaled: scale < 1, fits: width > 0 && height > 0 };
}

/**
 * Free area the cursor's insertion point can use: remaining height at the
 * caret + the content width. Used before inserting images/shapes so the
 * element is scaled to what is ACTUALLY left on the sheet.
 */
export function insertionArea(editor: unknown): { width: number; height: number } {
  const pm: HTMLElement | undefined = pmDomOf(editor);
  const free = measureFreeHeight(editor);
  const g = liveGeometry(editor);
  const width = pm ? pm.clientWidth : pageContentBounds().width;
  return { width, height: Math.max(0, Math.min(free, g?.avail ?? free)) };
}

/* ─── table capacity ────────────────────────────────────────────────────── */

/** Conservative per-cell metrics derived from the app's table styling
 *  (padding 8px 12px + 1px borders + one text line at the editor font). */
export interface TableMetrics {
  /** minimum usable cell width (padding + one wide glyph) */
  minCellW: number;
  /** minimum usable row height (padding + one text line) */
  rowH: number;
  /** spacing the table block itself adds around its rows (margins) */
  tableMargin: number;
}

export const DEFAULT_TABLE_METRICS: TableMetrics = {
  minCellW: 72,
  rowH: 44,
  tableMargin: 8,
};

/**
 * Maximum table dimensions that fit into the given free area.
 * Conservative on purpose: prevents OBVIOUS insertion-time overflow and
 * powers the modal's visual limit — not a mathematical guarantee for all
 * future cell content.
 */
export function maxFittingTable(
  availW: number,
  availH: number,
  metrics: TableMetrics = DEFAULT_TABLE_METRICS,
): { rows: number; cols: number } {
  const usableH = Math.max(0, availH - metrics.tableMargin);
  const cols = Math.max(1, Math.floor(availW / metrics.minCellW));
  const rows = Math.max(1, Math.floor(usableH / metrics.rowH));
  /* the picker grid is 10×8; values beyond it cannot be selected anyway */
  return { rows: Math.min(rows, 8), cols: Math.min(cols, 10) };
}
