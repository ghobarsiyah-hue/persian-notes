import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import { registerBuiltinContexts, resolveSelectionContext } from './registry';
import { getSelectionSnapshot, subscribeToSelectionStore } from './selectionStore';

/* ══════════════════════════════════════════════════════════════════════════
   useContextualRibbon — the context resolver's React surface.

   Re-derives the ResolvedSelectionContext whenever:
   • the editor emits ANY transaction (selection moved, object edited,
     created, deleted, converted — the document model is the source of
     truth, no parallel state to keep in sync), or
   • the floating layer publishes a different selection.

   The hook lives ONLY in the Ribbon. It never re-renders pages or editors:
   a selection change re-renders the Ribbon strip/tool-row and nothing else.

   Tab auto-activation (Word behavior): the first resolved contextual tab
   becomes active when the selection gains a context, and the previous
   standard tab is restored when the context disappears.
   ══════════════════════════════════════════════════════════════════════════ */

export interface ContextualRibbonState {
  /** resolved context — null when the plain document is "selected" */
  ctx: ReturnType<typeof resolveSelectionContext>;
  /** ids of tabs that should render in the strip (contextual ones) */
  contextualTabIds: string[];
  /** id of the contextual tab to auto-activate (empty = none) */
  autoTabId: string;
}

export function useContextualRibbon(editor: Editor | null): ContextualRibbonState {
  /* bump on every editor transaction so the resolver re-derives */
  const [, bump] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const h = () => bump((n) => n + 1);
    editor.on('transaction', h);
    return () => { editor.off('transaction', h); };
  }, [editor]);

  /* floating-selection store subscription (external store = no extra state) */
  useSyncExternalStore(subscribeToSelectionStore, getSelectionSnapshot, getSelectionSnapshot);

  /* register built-in providers once (open registry — future types append) */
  useEffect(() => { registerBuiltinContexts(); }, []);

  /* the resolver must never break the Ribbon — a probe/resolution error
     degrades to the normal Ribbon (no contextual tabs), never a crash */
  let ctx = null as ReturnType<typeof resolveSelectionContext>;
  try {
    ctx = resolveSelectionContext(editor);
  } catch {
    ctx = null;
  }

  const contextualTabIds = (ctx?.tabs ?? [])
    .filter((t) => !t.mergesWith)
    .map((t) => t.id);
  const autoTabId = contextualTabIds[0] ?? '';

  return { ctx, contextualTabIds, autoTabId };
}
