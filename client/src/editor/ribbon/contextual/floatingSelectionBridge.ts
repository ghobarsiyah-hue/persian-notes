/* ══════════════════════════════════════════════════════════════════════════
   FloatingSelectionBridge — a module-level registry so code OUTSIDE the
   FloatingLayer (the right-click menu) can publish a floating selection
   SYNCHRONOUSLY. A contextmenu event never goes through the layer's click
   handlers, so without this the published selection would lag one event
   behind (the menu would resolve the previously selected object — or none).

   One writer at a time: each mounted FloatingLayer registers on mount and
   clears itself on unmount. Only the ACTIVE page has a live layer, so the
   last registration is the right one.
   ══════════════════════════════════════════════════════════════════════════ */

export interface FloatingSelectionBridge {
  /** Publish the layer's selection for `id` NOW (also updates the layer's
   *  visual selection). null = deselect. */
  select: (id: string | null) => void;
  /** Currently selected floating id (null = none). */
  selectedId: () => string | null;
}

let bridge: FloatingSelectionBridge | null = null;

export function setFloatingSelectionBridge(b: FloatingSelectionBridge | null) {
  bridge = b;
}

export function getFloatingSelectionBridge(): FloatingSelectionBridge | null {
  return bridge;
}
