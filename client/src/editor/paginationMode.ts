/**
 * paginationMode — THE PAGINATION POLICY BOUNDARY.
 *
 * This module answers «WHAT SHOULD PAGINATION DO?» — the decision half of
 * the architecture. The measurement half («WHAT FITS?») lives in
 * pageCapacity.ts / overflowFlow.ts and is shared by every mode.
 *
 *   CURRENT: 'manualFixedPage' — the editor behaves like a fixed-page A4
 *   canvas editor:
 *     • every page is a finite A4 sheet
 *     • the user creates pages MANUALLY (Add Page / شکست صفحه)
 *     • content NEVER moves, splits or backflows automatically
 *     • a transaction whose rendered result would overflow the page is
 *       rejected (fit-or-reject) — the page itself stays fully editable
 *     • deleting content frees space again immediately
 *
 *   FUTURE: 'smart' — the automatic flow engine (overflowFlow.ts +
 *   EditorPage.runAutoFlow) is kept intact but bypassed. Switching the mode
 *   re-enables it with NO editor rewrite: the engine, the policy registry
 *   (paginationPolicy.ts) and the measurement layer are all untouched.
 *
 * The mode must NOT control editor editability — a full page is never
 * read-only. It only decides what happens to content that does not fit.
 */

import { findManualBreakSplit, type OverflowSplit } from './overflowFlow';

export type PaginationModeId = 'manualFixedPage' | 'smart';

export interface PaginationMode {
  id: PaginationModeId;
  /** run the automatic flow engine (overflow moves, backflow, auto pages) */
  autoFlow: boolean;
  /** reject transactions whose rendered result overflows the page
   *  (FixedPageGuard extension) — the "fit-or-reject" rule */
  rejectOverflow: boolean;
}

const MODES: Record<PaginationModeId, PaginationMode> = {
  manualFixedPage: { id: 'manualFixedPage', autoFlow: false, rejectOverflow: true },
  smart: { id: 'smart', autoFlow: true, rejectOverflow: false },
};

/** The active mode. Flipping this single constant re-enables the automatic
 *  flow engine and disables fit-or-reject (or vice versa). */
export const CURRENT_PAGINATION_MODE: PaginationModeId = 'manualFixedPage';

export function currentPaginationMode(): PaginationMode {
  return MODES[CURRENT_PAGINATION_MODE];
}

/* ── capacity-reject feedback channel ────────────────────────────────────
   The FixedPageGuard (a ProseMirror plugin inside each page editor) must
   not reach into React state. It emits a window event; the EditorPage host
   listens and surfaces ONE throttled toast. Decoupled on purpose: the
   future SmartPaginationPolicy replaces the guard's verdicts without any
   UI change. */

const CAPACITY_REJECT_EVENT = 'pn:capacity-reject';

export function emitCapacityReject(reason?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CAPACITY_REJECT_EVENT, { detail: { reason } }));
}

/** Subscribe to fit-or-reject verdicts. Returns an unsubscribe function. */
export function onCapacityReject(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => cb();
  window.addEventListener(CAPACITY_REJECT_EVENT, handler);
  return () => window.removeEventListener(CAPACITY_REJECT_EVENT, handler);
}

/** Throttled emitter for the guard — one toast per burst, not per keystroke. */
const lastEmitAt = new WeakMap<object, number>();
export function emitCapacityRejectThrottled(key: object, reason?: string, cooldownMs = 1600): void {
  const now = Date.now();
  const last = lastEmitAt.get(key) ?? 0;
  if (now - last < cooldownMs) return;
  lastEmitAt.set(key, now);
  emitCapacityReject(reason);
}

/* ── manual page breaks ────────────────────────────────────────────────────
   In manualFixedPage mode the flow engine is bypassed, but a manually
   inserted pageBreak must still work (§27): the EditorPage host consumes it
   here — the content AFTER the break moves onto a NEW manual page, exactly
   like the engine's findManualBreakSplit path, just without any overflow
   detection around it. */

export function runManualPageBreakSplit(editor: unknown): OverflowSplit | null {
  return findManualBreakSplit(editor);
}
