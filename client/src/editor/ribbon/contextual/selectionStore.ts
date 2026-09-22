import type { SelectableObject, SelectionSource } from './types';

/* ══════════════════════════════════════════════════════════════════════════
   Selection store — the bridge between the selection surfaces and the
   Ribbon. The TipTap document selection is derived directly from the live
   editor instance on each transaction (no duplicate state to keep in sync);
   only the floating layer — which lives in ordinary React state inside each
   Page — publishes its selection here through a tiny external store.

   Subscribers (the Ribbon's context resolver) re-render on change while the
   editors and pages do not: selection changes never re-render the document.
   ══════════════════════════════════════════════════════════════════════════ */

type Listener = () => void;

const listeners = new Set<Listener>();

/** selected objects per selection source (currently: floating layer) */
let sourceSelections: Partial<Record<SelectionSource, SelectableObject[]>> = {};

function emit() {
  listeners.forEach((l) => l());
}

/** Replace the selection of one source (empty array = deselect). */
export function setSourceSelection(source: SelectionSource, selection: SelectableObject[]) {
  const prev = sourceSelections[source] ?? [];
  if (prev.length === selection.length && prev.every((p, i) => p === selection[i])) return;
  sourceSelections = { ...sourceSelections, [source]: selection };
  emit();
}

/** Snapshot of all source selections — used by the context resolver. */
export function getSourceSelections(): Partial<Record<SelectionSource, SelectableObject[]>> {
  return sourceSelections;
}

/** Subscribe to floating (non-document) selection changes. Returns unsubscribe. */
export function subscribeToSelectionStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read the snapshot inside useSyncExternalStore without recreating it. */
export function getSelectionSnapshot() {
  return sourceSelections;
}
