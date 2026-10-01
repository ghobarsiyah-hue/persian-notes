/* ══════════════════════════════════════════════════════════════════════════
   footnoteRegistry — پاورقی‌های چندصفحه‌ای.

   A footnoteRef inserted on page 3 must number itself «۲» even though its
   footnoteSection lives on page 5 — numbering is a DOCUMENT property, and
   every page owns its OWN TipTap editor (one schema per sheet). The
   registry collects the mounted page editors so the two footnote nodes can:

   • renumber every ref whenever any page's doc changes (a deleted ref
     shifts all later numbers — the live view must follow)
   • find the INSERTION TARGET for a new footnote's section: the doc's
     existing footnoteSection (wherever it is), or the LAST page's doc end
     when none exists yet (the «پایین صفحه/آخرین صفحه» space the user
     asked for)

   Ordering = DOM order of the page sheets (pageEditorsMap iteration order
   follows the pages array passed to `register`), which matches the visual
   page sequence and therefore the reading order of the refs.
   ══════════════════════════════════════════════════════════════════════════ */

import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

/* ── registry state ──────────────────────────────────────────────────── */

const pageEditorsMap = new Map<string, Editor>();

/** subscribe (renumber hooks). Set = cheap add/remove, callers are few. */
const listeners = new Set<() => void>();

export function registerPageEditor(pageId: string, editor: Editor | null): void {
  if (editor) pageEditorsMap.set(pageId, editor);
  else pageEditorsMap.delete(pageId);
  notifyFootnoteListeners();
}

export function unregisterPageEditor(pageId: string): void {
  if (pageEditorsMap.delete(pageId)) notifyFootnoteListeners();
}

/** mounted page editors in VISUAL page order (Map preserves insertion order) */
export function listPageEditors(): Editor[] {
  return [...pageEditorsMap.values()];
}

export function onFootnotesChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function notifyFootnoteListeners(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* one broken listener never kills the rest */ }
  }
}

/* ── document scans ──────────────────────────────────────────────────── */

export interface FootnoteRefHit {
  editor: Editor;
  /** doc position of the footnoteRef node */
  pos: number;
  node: PMNode;
  /** the label the ref DISPLAYS: explicit label, else its computed number */
  label: string;
}

/** every footnoteRef in reading order (page order, then doc order) */
export function collectFootnoteRefs(): FootnoteRefHit[] {
  const out: FootnoteRefHit[] = [];
  for (const ed of listPageEditors()) {
    if (ed.isDestroyed) continue;
    let pos = 0;
    ed.state.doc.descendants((node, p) => {
      if (node.type.name === 'footnoteRef') {
        out.push({ editor: ed, pos: p, node, label: String(node.attrs.label || '') });
      }
      pos = p;
      return true;
    });
  }
  return out;
}

export interface FootnoteSectionHit {
  editor: Editor;
  /** doc position of the footnoteSection node */
  pos: number;
  node: PMNode;
}

/** the FIRST footnoteSection in reading order (in practice there is one) */
export function findFootnoteSection(): FootnoteSectionHit | null {
  for (const ed of listPageEditors()) {
    if (ed.isDestroyed) continue;
    let found: FootnoteSectionHit | null = null;
    ed.state.doc.descendants((node, p) => {
      if (!found && node.type.name === 'footnoteSection') found = { editor: ed, pos: p, node };
      return !found;
    });
    if (found) return found;
  }
  return null;
}

/* ── renumbering ─────────────────────────────────────────────────────── */

/** footnoteRef nodes mark themselves `data-live` while their label is
 *  computed (label=''). setNodeMarkup on the live editor re-renders the
 *  NodeView (DOM sync) without touching user content or history depth —
 *  doc content is unchanged, so no autosave churn, no undo step. */
export function renumberFootnotes(): void {
  const refs = collectFootnoteRefs();
  let n = 0;
  for (const ref of refs) {
    n += 1;
    const num = String(n);
    if (ref.node.attrs.label === num) continue;
    if (ref.node.attrs.label && ref.node.attrs.label !== num) continue; /* explicit label wins */
    try {
      const cur = ref.editor.state.doc.nodeAt(ref.pos);
      if (!cur || cur.type.name !== 'footnoteRef') continue;
      ref.editor.view.dispatch(ref.editor.state.tr.setNodeMarkup(ref.pos, undefined, { ...cur.attrs, label: num }));
    } catch { /* editor mid-teardown — skip */ }
  }
}

/** count of refs (the «(۲ یادداشت)» hint lives in the section title) */
export function footnoteCount(): number {
  return collectFootnoteRefs().length;
}
