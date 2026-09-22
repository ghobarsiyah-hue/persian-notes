/**
 * FixedPageGuard — the «fit-or-reject» enforcement of the CURRENT pagination
 * policy (ManualFixedPagePolicy, see paginationMode.ts).
 *
 * The rule: a transaction whose RENDERED result would exceed the sheet's
 * usable A4 area is rejected — ONLY that transaction; nothing else changes:
 *
 *   • no automatic page is created
 *   • no content moves, splits or backflows
 *   • the caret never jumps
 *   • the page NEVER becomes read-only (§5): selection, deletion,
 *     replacement and shortening all keep working — the capacity rule
 *     applies to the RESULT of an operation, never to the user's
 *     permission to edit.
 *
 * HOW the verdict is computed: the transaction is applied to a CLONE of the
 * current state and the proposed document is measured in a hidden scratch
 * EditorView that mirrors the real editor's metrics (same schema, same
 * `.pn-editor` class + the page's CSS variables for font-size/line-height,
 * same usable width) — real rendered geometry, never character counts. The
 * scratch view lives in a detached, off-screen container; measurement is
 * synchronous and runs only when a transaction actually changes the
 * document (and only when it does not strictly shrink it — see below).
 *
 * This is a POLICY plugin: it reads `currentPaginationMode()`. When the
 * future SmartPaginationPolicy becomes active, `rejectOverflow` turns off
 * and this plugin becomes a no-op — without touching any node or the flow
 * engine.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, EditorState } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { ReplaceStep } from '@tiptap/pm/transform';
import type { Transaction } from 'prosemirror-state';
import { flowEngineActiveRef } from '../flowEngineState';
import { currentPaginationMode, emitCapacityRejectThrottled } from '../paginationMode';
import { A4_H_PX, FRAMED_PADDING } from '../pageCapacity';

const guardKey = new PluginKey('fixedPageGuard');

/** tolerance in px — matches overflowFlow's OVERFLOW_TOLERANCE_PX */
const TOL = 4;
/** minimum height a scratch measurement must report to be trusted (an
 *  unrendered/fallback-font doc can measure near zero). Absolute floor for
 *  big docs; small docs (a single line: content.size ≤ ~30) are judged
 *  against `ONE_LINE + TOL` instead — an empty/one-line doc measured far
 *  below a line can only be an unrendered scratch pass, never an overflow,
 *  and a trusted measurement of a one-line doc (≈one line + margins) would
 *  be wrongfully rejected. Enter on a fresh page hit exactly that: the
 *  empty+line doc measured ~72px against the 200px floor → untrusted →
 *  one wasted scratch render per Enter (benign but measurable). */
const MIN_TRUSTED_HEIGHT = 200;
const ONE_LINE_TRUST_PX = 40; // above unrendered noise (~0–20), below one real line (~32+)

/* QA/validation diagnostics (§16 of the validation protocol): cheap integer
   counters, traced only when `window.__layoutDebug` is on (same channel as
   the rest of the layout debug tooling). Zero cost otherwise. */
function guardStat(kind: 'fastShrink' | 'fastHeadroom' | 'measured' | 'rejected' | 'scratchBuilt' | 'measureFailed' | 'skip:engineActive' | 'skip:noHistory' | 'skip:noDocChange' | 'skip:noView' | 'skip:noLimit' | 'skip:pageBreak' | 'skip:untrusted' | 'skip:fits' | 'skip:prevalidated' | 'pretextRejected' | 'pretextMeasured'): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __layoutDebug?: boolean; __pnGuardStats?: Record<string, number> };
  if (!w.__layoutDebug) return;
  w.__pnGuardStats = w.__pnGuardStats ?? {};
  w.__pnGuardStats[kind] = (w.__pnGuardStats[kind] ?? 0) + 1;
}

/** last measured verdict detail (debug-gated): the scratch height vs the
 *  page limit for the most recent measured transaction — lets QA probes
 *  answer «what did the guard compute?» without guessing. */
function guardLast(detail: { h: number; limit: number; size: number } | null): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __layoutDebug?: boolean; __pnGuardLast?: unknown };
  if (!w.__layoutDebug) return;
  w.__pnGuardLast = detail;
}

/* ── scratch measurement view (one per page editor) ────────────────────────
   Created lazily on the first measured transaction of ITS page editor and
   destroyed with it. Per-editor (not module-level) because every TipTap
   editor owns a distinct schema — a shared view would be rebuilt on every
   transaction that touched a different page. */

interface ScratchView {
  view: EditorView;
  container: HTMLDivElement;
  inner: HTMLDivElement;
}

function buildScratchView(realView: EditorView): ScratchView | null {
  try {
    /* mirror the framed sheet's box so text wraps where the real page wraps
       (blank/notebook differ by 6 px per side — the guard checks HEIGHT) */
    const pad = FRAMED_PADDING;
    const container = document.createElement('div');
    container.setAttribute('aria-hidden', 'true');
    container.style.cssText = [
      'position:fixed', 'left:-10000px', 'top:0',
      'width:794px', `height:${A4_H_PX}px`, 'overflow:hidden',
      `padding:${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px`,
      'box-sizing:border-box',
      'visibility:hidden', 'pointer-events:none',
    ].join(';');
    const inner = document.createElement('div');
    inner.className = 'pn-editor-wrap';
    inner.style.cssText = `height:${A4_H_PX - pad.top - pad.bottom}px;overflow:hidden;`;
    container.appendChild(inner);
    document.body.appendChild(container);
    const view = new EditorView(inner, {
      /* plugin-less state FROM THE START: the scratch view renders geometry
         only (no decorations, no plugin views). Swapping FROM a decorated
         state TO a plugin-less one corrupts PM's view-desc tree mid-update
         (null `matchesNode` on every later updateState) — starting clean
         avoids that class of bug entirely. */
      state: EditorState.create({ doc: realView.state.doc, plugins: [] }),
      attributes: { dir: 'rtl', class: 'pn-editor focus:outline-none' },
    });
    return { view, container, inner };
  } catch {
    return null;
  }
}

function destroyScratch(s: ScratchView | null): void {
  if (!s) return;
  try { s.view.destroy(); } catch { /* noop */ }
  s.container.remove();
}

/* Rendered content bottom of `pm` in LAYOUT px (CSS-zoom independent),
 * measured relative to the PM element itself — NOT via offsetTop/offsetParent
 * arithmetic.
 *
 * WHY: offsetTop is relative to each node's offsetParent, and the real
 * editor and the scratch view have DIFFERENT offsetParent topologies (real:
 * PM sits at its positioned ancestor's top → pm.offsetTop = 0; scratch: the
 * PM is offset by the container's 30px padding-top while its children are
 * PM-relative). The previous `c.offsetTop − pm.offsetTop` walk therefore
 * under-measured EVERY scratch doc by exactly 30px — the guard accepted
 * documents whose real bottom was a full caret line below the usable
 * boundary (the «content renders below the page» bug). getBoundingClientRect
 * pairs have no such ambiguity: both sides are visual px, and dividing by
 * the wrap's CSS zoom converts back to layout px, the same unit as
 * wrap.clientHeight. All reads are batched → one forced layout per measure. */
function contentBottomLayoutPx(pm: HTMLElement, zoom: number): number {
  const pmTop = pm.getBoundingClientRect().top;
  let bottom = 0;
  for (const c of Array.from(pm.children) as HTMLElement[]) {
    const b = (c.getBoundingClientRect().bottom - pmTop) / zoom;
    if (b > bottom) bottom = b;
  }
  return bottom;
}

/** CSS zoom in effect for `el` (zoom inherits down the tree; the workspace
 *  zoom is set on an ancestor of the pages). */
function zoomOf(el: HTMLElement): number {
  return parseFloat(getComputedStyle(el).zoom || '1') || 1;
}

/** true when the proposed document still contains a manual pageBreak node —
 *  a transient state the HOST consumes into a real new page, so capacity
 *  must not be judged on it (§27: the user's break must never be vetoed). */
function containsPageBreak(doc: EditorState['doc']): boolean {
  let found = false;
  doc.descendants((n) => {
    if (found) return false;
    if (n.type.name === 'pageBreak') found = true;
    return !found;
  });
  return found;
}

/** cheap real-DOM headroom probe: content bottom vs the usable limit.
 *  NO re-render, NO state clone — one batched read pass. */
function realFreePx(view: EditorView, limit: number): number {
  const pm = view.dom;
  return limit - contentBottomLayoutPx(pm, zoomOf(pm));
}

/** true when EVERY step's inserted content is bounded to ~one text line of
 *  rendered height: plain text runs (ordinary typing) and EMPTY blocks —
 *  the Enter / split-block signature (`paragraph` with no content, created
 *  by SplitBlock; its child text stays in the transaction's other steps).
 *  Both can add at most one line + block margin, so measured headroom above
 *  a small multiple of one line proves they fit.
 *
 *  Everything else — pastes, ANY non-empty block (headings, lists, tables,
 *  edu containers), and above all ATOMS (image, display equation: ~1
 *  content-size growth, arbitrary rendered height) — returns false and MUST
 *  take the measured path. */
function isBoundedTextLikeGrowth(tr: Transaction): boolean {
  for (const step of tr.steps) {
    if (!(step instanceof ReplaceStep)) return false;
    const content = step.slice.content;
    if (!content.size) continue; // pure deletion — already handled by fastShrink
    /* ONE text insertion, OR an Enter-style split (TipTap inserts 1–2 EMPTY
       blocks: the measured ReplaceStep for a plain Enter carries two empty
       paragraphs). Empty blocks render at most ~one line each — bounded. */
    let ok = content.childCount <= 2;
    for (let i = 0; ok && i < content.childCount; i++) {
      const c = content.child(i);
      ok = c.isText || (c.isBlock && c.content.size === 0);
    }
    if (!ok) return false;
  }
  return true;
}

/** rendered height of ONE text line of this page (the most a single text
 *  keystroke can add — a wrap pushes exactly one line down). Read from the
 *  page's inline CSS variables with safe fallbacks; no style recalc. */
function oneLinePx(wrap: HTMLElement): number {
  const fs = parseFloat(wrap.style.getPropertyValue('--editor-font-size')) || 16;
  const lh = parseFloat(wrap.style.getPropertyValue('--editor-line-height')) || 2;
  return fs * lh + 8;
}

export const FixedPageGuard = Extension.create({
  name: 'fixedPageGuard',

  addProseMirrorPlugins() {
    /* one scratch view per page-editor instance */
    let scratch: ScratchView | null = null;
    /* Set while the guard measures the PROPOSED document. Measurement must
       never re-enter this plugin: a nested filterTransaction would apply
       the same tr again and recurse until the call stack overflows —
       thousands of scratch renders for a SINGLE keystroke (observed:
       ~2,700 measurements / 1.3 s per character on a full page). With the
       doc-swap below this cannot happen anymore; the flag is cheap
       insurance against any future path that re-enters during a measure. */
    let measuring = false;
    /* One-shot flag: handleTextInput validated THIS keystroke's insertion
       before the DOM mutated; the filterTransaction of the immediately
       following dispatch must not re-measure the identical document.
       handleTextInput and the dispatch run synchronously inside the same
       DOM event, so the flag cannot leak across unrelated transactions —
       every filterTransaction entry clears it first. */
    let preValidated = false;

    return [
      new Plugin({
        key: guardKey,
        props: {
          /* §13/§26 — typed text is validated BEFORE the browser mutates
             the DOM. handleTextInput runs before PM builds the insertion
             transaction, so a rejected character is simply swallowed:
             zero DOM divergence, zero re-parse loop (the post-reject
             redraw cascade is structurally gone for typing), and the
             caret/selection never move. filterTransaction below remains
             the safety net for every other doc-changing path (Enter,
             paste, input rules, drop, spellcheck…).

             Returning true = «handled» → PM inserts nothing (rejection).
             Returning false = default insertion proceeds. */
          handleTextInput: (view, from, to, text) => {
            const mode = currentPaginationMode();
            if (!mode.rejectOverflow) return false;
            if (flowEngineActiveRef.current) return false;
            const wrap: HTMLElement | null = view.dom.closest('.pn-editor-wrap');
            const limit = wrap ? wrap.clientHeight : 0;
            if (limit <= 0) return false;

            /* cheap gate: one batched real-DOM read. A character's worst
               growth is ONE line (wrap to the next line) — if that much
               headroom exists, the insertion cannot overflow. The threshold
               follows the page's own CSS variables (same source the scratch
               sync uses) — a getComputedStyle here would force style recalc
               on EVERY keystroke. */
            const free = realFreePx(view, limit);
            const linePx = wrap ? oneLinePx(wrap) : 32;
            if (free >= linePx + TOL + 2) { preValidated = true; return false; }

            /* near the boundary → measure the PROPOSED doc (with the
               insertion) in the scratch view, pre-DOM. */
            if (!scratch) { scratch = buildScratchView(view); guardStat('scratchBuilt'); }
            if (!scratch) return false; // cannot measure → never block the user
            if (wrap) {
              scratch.inner.style.setProperty('--editor-font-size', wrap.style.getPropertyValue('--editor-font-size') || '16px');
              scratch.inner.style.setProperty('--editor-line-height', wrap.style.getPropertyValue('--editor-line-height') || '2');
            }
            let doc = view.state.doc;
            try {
              doc = view.state.tr.insertText(text, from, to).doc;
            } catch { return false; }
            if (containsPageBreak(doc)) return false; // host consumes breaks
            guardStat('pretextMeasured');
            measuring = true;
            let h = 0;
            try {
              scratch.view.updateState(EditorState.create({ doc, plugins: [] }));
              h = contentBottomLayoutPx(scratch.view.dom, 1);
            } catch {
              measuring = false;
              guardStat('measureFailed');
              destroyScratch(scratch);
              scratch = null;
              return false; // cannot measure → never block the user
            }
            measuring = false;
            guardStat('measured');
            guardLast({ h, limit, size: doc.content.size });
            if (h < MIN_TRUSTED_HEIGHT) return false; // unrendered — don't guess
            if (h <= limit + TOL) { preValidated = true; return false; } // fits → insert normally
            guardStat('rejected');
            guardStat('pretextRejected');
            emitCapacityRejectThrottled(view.dom, 'صفحه پر است — فضای صفحه کافی نیست');
            /* Returning true stops PM from PARSING the insertion, but the
               browser has already typed it into the contenteditable — the
               DOM is now divergent from the doc. Left alone, PM's DOM
               observer re-reads the stray text and re-dispatches (a second
               rejected transaction per keystroke). REDRAW SYNCHRONOUSLY:
               the observer then diffs the already-restored DOM against the
               unchanged state → empty diff → no second transaction at all.
               (The queueMicrotask variant lost that race: MutationObserver
               callbacks run as microtasks queued before ours.) */
            if (!view.composing) {
              try { view.updateState(view.state); } catch { /* noop */ }
            }
            return true; // swallowed BEFORE the doc changed — nothing else to reconcile
          },
        },
        /* filterTransaction runs BEFORE the state changes: returning false
           silently drops the transaction — the editor keeps its previous
           (valid) state, focus and selection untouched. */
        filterTransaction: (tr: Transaction, state: EditorState) => {
          if (measuring) return true; // re-entrancy escape (see above)
          const wasPre = preValidated;
          preValidated = false;
          const mode = currentPaginationMode();
          if (!mode.rejectOverflow) return true;

          /* engine/host bookkeeping is never vetoed by the guard itself:
             the flow engine's moves, the manual-break consumer, the
             half-space fixer, programmatic setContent … all set
             addToHistory:false and are coordinated by the host. */
          if (flowEngineActiveRef.current) { guardStat('skip:engineActive'); return true; }
          if (tr.getMeta('addToHistory') === false) { guardStat('skip:noHistory'); return true; }
          if (!tr.docChanged) { guardStat('skip:noDocChange'); return true; // selection-only: free
          }

          /* this exact insertion was already validated pre-DOM by
             handleTextInput — do not measure the identical document twice */
          if (wasPre) { guardStat('skip:prevalidated'); return true; }

          /* fast path: content that strictly SHRANK (delete /
             replace-shorter) can never overflow a fixed-height sheet —
             allow without measuring, so Backspace/Delete stay instant even
             on a full page. EQUAL-size transactions (attribute changes like
             an image resize) and growth are still measured. */
          if (tr.doc.content.size < state.doc.content.size) {
            guardStat('fastShrink');
            return true;
          }

          const editor = this.editor as unknown as { view: EditorView };
          const view = editor?.view;
          if (!view?.dom) { guardStat('skip:noView'); return true; }
          const wrap: HTMLElement | null = view.dom.closest('.pn-editor-wrap');
          const limit = wrap ? wrap.clientHeight : 0;
          if (!wrap || limit <= 0) { guardStat('skip:noLimit'); return true; // not mounted — nothing to guard
          }

          /* measured fast path (§29 — no typing latency): a text keystroke
             adds at most ONE rendered line and an Enter adds one EMPTY
             block (≈ a line + margin) — while the page has more than a few
             lines of REAL measured headroom, neither can cross the limit,
             so skip the scratch render entirely. The transaction must be
             bounded (see isBoundedTextLikeGrowth): atoms and any non-empty
             block get arbitrary height from a tiny content-size growth and
             always take the measured path. Near the bottom (or for big
             inserts: paste, image, table, AI block) the full scratch
             measurement always runs. */
          const growth = tr.doc.content.size - state.doc.content.size;
          /* worst bounded growth: Enter ≈ 2 empty lines + paragraph margins */
          const boundedWorstPx = oneLinePx(wrap) * 2 + 32;
          if (growth >= 1 && growth <= 40 && isBoundedTextLikeGrowth(tr) && realFreePx(view, limit) > boundedWorstPx) {
            guardStat('fastHeadroom');
            return true;
          }

          if (containsPageBreak(tr.doc)) { guardStat('skip:pageBreak'); return true; // host consumes breaks
          }

          if (!scratch) {
            scratch = buildScratchView(view);
            guardStat('scratchBuilt');
          }
          if (!scratch) return true; // cannot measure → never block the user
          /* sync the page's typography rhythm so wrapping matches exactly
             (the vars live as inline style on the real .pn-editor-wrap) */
          if (wrap) {
            scratch.inner.style.setProperty('--editor-font-size', wrap.style.getPropertyValue('--editor-font-size') || '16px');
            scratch.inner.style.setProperty('--editor-line-height', wrap.style.getPropertyValue('--editor-line-height') || '2');
          }

          /* Measure the PROPOSED document directly (tr.doc) — NOT via
             state.apply(tr): applying through EditorState re-runs every
             plugin's filterTransaction (this one included) on the cloned
             state, recursing once per level until the stack blew. tr.doc
             is the identical result, computed without touching plugins;
             the scratch state carries no plugins at all (rendering only). */
          measuring = true;
          let h = 0;
          try {
            scratch.view.updateState(EditorState.create({ doc: tr.doc, plugins: [] }));
            /* zoom-aware PM-relative bottom (see contentBottomLayoutPx) —
               the offsetTop walk was 30px short (offsetParent topology) */
            h = contentBottomLayoutPx(scratch.view.dom, 1);
          } catch (e) {
            measuring = false;
            guardStat('measureFailed');
            /* self-heal: a failed update can leave the scratch view-desc
               tree inconsistent — rebuild from scratch on the next measure
               instead of failing forever. */
            destroyScratch(scratch);
            scratch = null;
            if (typeof window !== 'undefined' && (window as unknown as { __layoutDebug?: boolean }).__layoutDebug) {
              console.warn('[FixedPageGuard] measure failed:', e);
            }
            return true; // cannot measure → never block the user
          }
          measuring = false;
          guardStat('measured');
          guardLast({ h, limit, size: tr.doc.content.size });
          /* small docs (≤ ~2 short paragraphs) can legitimately render to a
             line or two — judge them against the render-noise floor; larger
             docs keep the absolute floor (a big doc measuring < 200px is an
             unrendered/partial scratch pass, never a real layout). */
          const trustFloor = tr.doc.content.size <= 300 ? ONE_LINE_TRUST_PX : MIN_TRUSTED_HEIGHT;
          if (h < trustFloor) { guardStat('skip:untrusted'); return true; // unrendered — don't guess
          }
          if (h <= limit + TOL) { guardStat('skip:fits'); return true; // fits → allow
          }

          /* the RESULT would overflow → reject ONLY this transaction.
             Non-disruptive by construction: no dispatch happened, so no
             focus loss, no selection change, no caret jump, no rerender. */
          guardStat('rejected');
          emitCapacityRejectThrottled(view.dom, 'صفحه پر است — فضای صفحه کافی نیست');
          /* The rejected keystroke already mutated the DOM (PM parses DOM
             events AFTER they happened). Left divergent, PM's observer
             re-parses the stray text on EVERY following mutation and each
             re-parse is rejected again — an O(n²) cascade. One queued
             redraw collapses the DOM back onto the unchanged state so the
             next keystroke starts clean (queueMicrotask runs before the
             next keystroke's task — no accumulation). IME composition is
             left to PM. */
          if (!view.composing) {
            queueMicrotask(() => {
              try { view.updateState(view.state); } catch { /* noop */ }
            });
          }
          return false;
        },
        view() {
          return {
            destroy: () => destroyScratch(scratch),
          };
        },
      }),
    ];
  },
});
