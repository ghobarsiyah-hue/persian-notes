/* ══════════════════════════════════════════════════════════════════════════
   importCapacity — the SINGLE SOURCE OF TRUTH for table capacity.
   One engine answers for:
     1. the Ribbon table picker (cells beyond real capacity are disabled),
     2. the final insert (clamps with the SAME numbers the user saw),
     3. page overflow validation (matches the FixedPageGuard's real sheet).
   Everything is computed from the REAL remaining space and the REAL table
   metrics — no hardcoded counts anywhere.
   ══════════════════════════════════════════════════════════════════════════ */

import type { Editor } from '@tiptap/core';
import type { PageKind } from '@/types';
import { A4_W_PX, A4_H_PX, pagePadding } from './pageCapacity';

/* ── shared table metrics ── */

export interface ImportMetrics {
  /** table: one text line at the editor font (16px × 2.0 line-height + padding 8+8) */
  rowH: number;
  /** table: header row uses a slightly smaller font (0.9em) */
  headerRowH: number;
  /** table: cell horizontal padding total (12+12) for min-width per column */
  cellPadX: number;
  /** table: 1px top+bottom border per row */
  rowBorder: number;
  /** table: block margin TOTAL (0.6em top + 0.6em bottom ≈ 20px at 16px) */
  tableMargin: number;
  /** table: minimum usable column width (padding + one wide glyph) */
  minCellW: number;
}

/* CALIBRATED against the FixedPageGuard's real scratch measurement
 * (qa-probe evidence: a 19×10 header table on an empty page measures
 * 1080px against a 1063px limit → rejected; the true max is 18 rows).
 * Per row: padding 8+8 + one 16px×2.0 line + cell-paragraph margins
 * + 1px borders ≈ 55px; header (0.9em font) ≈ 52px; table block margins
 * 0.6em top+bottom ≈ 20px. An OPTIMISTIC metric here recreates exactly
 * the mismatch (picker promises, guard rejects). */
export const DEFAULT_IMPORT_METRICS: ImportMetrics = {
  rowH: 55,
  headerRowH: 52,
  cellPadX: 24,
  rowBorder: 2,
  tableMargin: 20,
  minCellW: 72,
};

/** the FixedPageGuard accepts h ≤ limit + TOL(4) — plan against the same
 *  acceptance window so a planned insert can never cross the guard */
const GUARD_TOL = 4;

/* ── space report — ONE measurement, shared by all consumers ── */

export interface ImportSpace {
  /** remaining block-flow height at the insertion position (bottom of content) */
  freeH: number;
  /** rendered content bottom, usable-box-relative px */
  contentBottom: number;
  /** content width (usable, inside page padding) */
  contentW: number;
  /** page kind — notebook lines sit at z-index:1 and occupy no capacity */
  pageKind: PageKind;
  /** the sheet's usable box (inside page padding) — geometry truth */
  usable: { w: number; h: number };
  /** true when the measured editor has no live DOM (nothing can fit) */
  detached: boolean;
}

export function measureImportSpace(editor: Editor | null): ImportSpace {
  const pm = editor?.view?.dom as HTMLElement | undefined;
  const pageEl = pm?.closest('.page-paper') as HTMLElement | null;
  const kind = (pageEl?.className.match(/page-(framed|blank|notebook)/)?.[1] ?? 'framed') as ImportSpace['pageKind'];
  const pol = pagePadding(kind);
  const usable = { w: A4_W_PX - pol.left - pol.right, h: A4_H_PX - pol.top - pol.bottom };
  const contentW = pm ? pm.clientWidth : usable.w;
  /* Remaining height — measured EXACTLY like the FixedPageGuard measures:
     rect-based, zoom-normalized, PM-relative. The guard's limit is the
     wrap's clientHeight, so we derive the limit the same way and report
     both. The offsetTop walk the guard once rejected as 30px-short is
     deliberately NOT used here. */
  let freeH = usable.h;
  let contentBottom = 0;
  if (pm) {
    const wrap = pm.closest('.pn-editor-wrap') as HTMLElement | null;
    const zoom = parseFloat(getComputedStyle(wrap ?? pm).zoom || '1') || 1;
    const pmTop = pm.getBoundingClientRect().top;
    let bottom = 0;
    for (const c of Array.from(pm.children) as HTMLElement[]) {
      const b = (c.getBoundingClientRect().bottom - pmTop) / zoom;
      if (b > bottom) bottom = b;
    }
    contentBottom = bottom;
    freeH = usable.h - bottom;
  }
  return { freeH, contentBottom, contentW, pageKind: kind, usable, detached: !pm };
}

/* ── table planning ── */

export interface TablePlan {
  /** rows × cols the REAL remaining space can hold (no picker ceiling here) */
  rows: number;
  cols: number;
  /** true when nothing fits at all (picker must disable insert entirely) */
  none: boolean;
  /** true when the table exactly fills the page's remaining height */
  exact: boolean;
}

export function planTable(
  space: ImportSpace,
  metrics: ImportMetrics = DEFAULT_IMPORT_METRICS,
): TablePlan {
  const cols = Math.max(1, Math.floor(space.contentW / metrics.minCellW));
  /* withHeaderRow: first row is the (taller) header row. The budget is the
     guard's acceptance window: tableMargin + header + n×body ≤ freeH + TOL. */
  const budget = space.freeH + GUARD_TOL - metrics.tableMargin - metrics.headerRowH;
  const rows = budget >= 0 ? 1 + Math.floor(budget / metrics.rowH) : 0;
  return {
    rows,
    cols,
    none: rows < 1 || cols < 1,
    exact: rows >= 1 && budget - (rows - 1) * metrics.rowH < metrics.rowH * 0.5,
  };
}
