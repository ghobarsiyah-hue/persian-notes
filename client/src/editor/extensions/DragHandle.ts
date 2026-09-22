import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/**
 * DragHandle extension — adds a small ⋮⋮ drag handle beside top-level blocks
 * so users can grab a block and drag it to reorder it within the document.
 *
 * SIX-DOT ARTIFACT FIX (invariant: NO USER ACTION = NO NEW USER OBJECT):
 * the handle is pure interaction UI and must NEVER live inside
 * ProseMirror's content DOM. It was previously appended INSIDE the hovered
 * block (`block.appendChild(handle)`), which PM's MutationObserver read back
 * as user input and parsed the '⋮⋮' text into the document — a six-dot
 * artifact inserted on mere pointer movement (a touch/pen tap fires a
 * synthetic mousemove, so it appeared with no deliberate action), undoable,
 * autosaved and persisted. The handle is now mounted ONCE in an overlay that
 * is a SIBLING of .ProseMirror (never a descendant of the content DOM) and
 * is only repositioned over the hovered block, so no DOM mutation ever
 * occurs inside editor content.
 *
 * Event plumbing (matches PM's model):
 *  - HOVER: window-level mousemove routed to the focused editor — PM's
 *    handleDOMEvents only sees events inside view.dom, and the handle no
 *    longer lives there.
 *  - GRAB: native mousedown listener on the handle (attached at creation
 *    time in ensureHandle — the handle is created lazily on first hover).
 *  - DRAG: window-level mousemove/mouseup while a drag is active, with a
 *    movement threshold so a touch tap (mousedown+mouseup in place) can
 *    never dispatch a reorder transaction.
 *
 * Position math: all drop targets are computed as DOC-LEVEL block
 * boundaries via posAtDOM + resolve().before(1)/after(1). The previous
 * implementation used posAtCoords (text-level positions) and read the node
 * with resolve(pos).nodeAfter — which is null at depth 1 and resolved to
 * the wrong (RTL left-edge = paragraph END) position, so reorders silently
 * never dispatched. Rects only — no clientX-dependent text probing — so
 * Persian RTL and LTR behave identically.
 */
export const DragHandle = Extension.create({
  name: 'dragHandle',

  addProseMirrorPlugins() {
    const editor = this.editor;
    let overlay: HTMLElement | null = null;
    let handle: HTMLDivElement | null = null;
    let handleAnchor: HTMLElement | null = null; // block the handle currently overlays
    let dragState: {
      nodeFrom: number; // doc position before the dragged top-level node
      nodeSize: number; // size of the dragged top-level node
      startX: number;
      startY: number;
    } | null = null;
    let dropIndicator: HTMLDivElement | null = null;
    const teardownFns: Array<() => void> = [];

    /* Pointer movement (px) required before a grab is treated as a drag.
     * Below it, release cancels silently — a touch tap synthesizes
     * mousedown+mouseup with no movement and must NEVER reorder content. */
    const DRAG_THRESHOLD_PX = 4;

    /** Overlay hosting the handle: a sibling of .ProseMirror, NEVER a
     *  descendant of the content DOM (see class doc). pointer-events:none
     *  except on the handle itself, so text interaction is unaffected. */
    function ensureOverlay(view: EditorView): HTMLElement | null {
      if (overlay && overlay.isConnected) return overlay;
      const host = view.dom.parentElement;
      if (!host) return null; // detached/destroying editor — nowhere to mount
      overlay = host.querySelector<HTMLElement>(':scope > .pn-drag-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'pn-drag-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.cssText =
          'position:absolute;inset:0;pointer-events:none;z-index:50;overflow:hidden;';
        /* the host must be a positioning context for the absolute overlay */
        if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
        host.appendChild(overlay);
      }
      return overlay;
    }

    function ensureHandle(view: EditorView): HTMLDivElement | null {
      const o = ensureOverlay(view);
      if (!o) return null;
      if (!handle) {
        handle = document.createElement('div');
        handle.className = 'pn-drag-handle';
        handle.style.cssText =
          'position:absolute;pointer-events:auto;cursor:grab;display:none;align-items:center;justify-content:center;' +
          'color:#ccc;font-size:10px;border-radius:3px;transition:color 0.1s;background:transparent;user-select:none;';
        handle.textContent = '⋮⋮';
        handle.addEventListener('mouseenter', () => { if (handle) handle.style.color = '#666'; });
        handle.addEventListener('mouseleave', () => { if (handle) handle.style.color = '#ccc'; });
        /* the handle is created lazily (on first hover), so its grab listener
           must be attached HERE at creation — view() runs before it exists */
        handle.addEventListener('mousedown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          grabFromHandle(view, event);
        });
        o.appendChild(handle);
      }
      return handle;
    }

    function hideHandle() {
      if (handle) handle.style.display = 'none';
      handleAnchor = null;
    }

    /** Position the shared handle over `block`. Coordinates are normalized
     *  by the host's CSS zoom (pages scale via zoom, like the QA harness). */
    function showHandleFor(view: EditorView, block: HTMLElement) {
      const h = ensureHandle(view);
      if (!h) return;
      const host = view.dom.parentElement!;
      const hostRect = host.getBoundingClientRect();
      const rect = block.getBoundingClientRect();
      const zoom = parseFloat(getComputedStyle(host).zoom || '1') || 1;
      h.style.display = 'flex';
      h.style.width = '16px';
      h.style.height = '24px';
      h.style.left = `${(rect.left - hostRect.left + 4) / zoom}px`;
      h.style.top = `${(rect.top - hostRect.top + rect.height / 2 - 12) / zoom}px`;
      handleAnchor = block;
    }

    function createDropIndicator() {
      if (dropIndicator) return dropIndicator;
      dropIndicator = document.createElement('div');
      dropIndicator.style.cssText =
        'position:absolute;left:0;right:0;height:3px;background:#0070f3;border-radius:2px;z-index:100;pointer-events:none;display:none;transition:top 0.1s ease;';
      editor.view.dom.parentElement?.appendChild(dropIndicator);
      return dropIndicator;
    }

    /** Doc-level boundary (position before/after a top-level block) for the
     *  given block DOM element. Returns null when unresolvable. */
    function docBoundaryFor(block: HTMLElement, before: boolean): number | null {
      try {
        const view = editor.view;
        const inner = view.posAtDOM(block, 0, 0);
        const $inner = view.state.doc.resolve(inner);
        if ($inner.depth < 1) return null;
        return before ? $inner.before(1) : $inner.after(1);
      } catch {
        return null;
      }
    }

    /** Drop target for a pointer Y: the top-level block containing the
     *  pointer (nearest block when the pointer sits in a margin gap), plus
     *  whether the drop lands before it. Pure rect math — RTL-safe. */
    function findDropTarget(clientY: number): { block: HTMLElement; before: boolean } | null {
      let best: HTMLElement | null = null;
      let bestDist = Infinity;
      for (const block of Array.from(editor.view.dom.children) as HTMLElement[]) {
        const rect = block.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) { best = block; break; }
        const dist = Math.abs(clientY - (rect.top + rect.height / 2));
        if (dist < bestDist) { bestDist = dist; best = block; }
      }
      if (!best) return null;
      const rect = best.getBoundingClientRect();
      return { block: best, before: clientY < rect.top + rect.height / 2 };
    }

    function showDropIndicatorAt(clientY: number) {
      const target = findDropTarget(clientY);
      const indicator = dropIndicator;
      if (!target || !indicator) return;
      const rect = target.block.getBoundingClientRect();
      const containerRect = editor.view.dom.parentElement!.getBoundingClientRect();
      indicator.style.display = 'block';
      indicator.style.top = target.before
        ? `${rect.top - containerRect.top - 2}px`
        : `${rect.bottom - containerRect.top + 2}px`;
      indicator.style.left = '0';
      indicator.style.right = '0';
    }

    /** Route a window mousemove to the focused editor's hover logic. */
    function onWindowMouseMove(event: MouseEvent) {
      if (dragState) return; // drag lifecycle handled by its own listener
      if (editor.isDestroyed) return;
      const view = editor.view;
      const domRect = view.dom.getBoundingClientRect();
      /* only react when the pointer is actually over this page's editor */
      if (event.clientX < domRect.left || event.clientX > domRect.right ||
          event.clientY < domRect.top || event.clientY > domRect.bottom) {
        if (handleAnchor) hideHandle();
        return;
      }
      let hovered: HTMLElement | null = null;
      const allBlocks = view.dom.children;
      for (const block of Array.from(allBlocks) as HTMLElement[]) {
        const rect = block.getBoundingClientRect();
        if (event.clientY >= rect.top && event.clientY <= rect.bottom && event.clientX < rect.left + 24) {
          hovered = block;
          break;
        }
      }
      if (hovered) showHandleFor(view, hovered);
      else if (handleAnchor) hideHandle();
    }

    function grabFromHandle(view: EditorView, event: MouseEvent): boolean {
      if (!handleAnchor) return false;
      /* capture the dragged top-level node via doc-level boundaries */
      try {
        const inner = view.posAtDOM(handleAnchor, 0, 0);
        const $inner = view.state.doc.resolve(inner);
        if ($inner.depth < 1) return false;
        const nodeFrom = $inner.before(1);
        const node = view.state.doc.nodeAt(nodeFrom);
        if (!node) return false;
        dragState = {
          nodeFrom,
          nodeSize: node.nodeSize,
          startX: event.clientX,
          startY: event.clientY,
        };
      } catch {
        return false;
      }

      const movedEnough = (e: MouseEvent) =>
        Math.hypot(e.clientX - dragState!.startX, e.clientY - dragState!.startY) >= DRAG_THRESHOLD_PX;

      const onMove = (e: MouseEvent) => {
        if (editor.isDestroyed || !dragState) return cleanup();
        if (movedEnough(e)) showDropIndicatorAt(e.clientY);
      };
      const onUp = (e: MouseEvent) => {
        cleanup();
        /* A release without real movement is a tap/click, NOT a drag:
         * cancel without touching the document (touch taps synthesize
         * mousedown+mouseup in place — dispatching here mutated content
         * with no deliberate user gesture). */
        if (dragState && movedEnough(e)) finishDrag(view, e.clientY);
        dragState = null;
      };
      const cleanup = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (dropIndicator) dropIndicator.style.display = 'none';
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return true;
    }

    function finishDrag(view: EditorView, clientY: number) {
      if (!dragState) return;
      const target = findDropTarget(clientY);
      if (!target) return;
      const boundary = docBoundaryFor(target.block, target.before);
      if (boundary == null) return;
      const { nodeFrom, nodeSize } = dragState;
      /* dropping exactly before or after the dragged block = no-op */
      if (boundary === nodeFrom || boundary === nodeFrom + nodeSize) return;

      const { state, dispatch } = view;
      /* move the CLOSED node (doc.nodeAt), not an open slice — a whole-block
       * slice has open depth 1 and cannot be inserted at the doc root
       * (RangeError: Can not convert <paragraph> to a Fragment). */
      const node = state.doc.nodeAt(nodeFrom);
      if (!node) return;
      const tr = state.tr;
      tr.delete(nodeFrom, nodeFrom + nodeSize);
      /* positions after the deleted range shift left by the node size */
      let insertPos = boundary > nodeFrom ? boundary - nodeSize : boundary;
      insertPos = Math.max(1, Math.min(insertPos, tr.doc.content.size - 1));
      tr.insert(insertPos, node);
      dispatch(tr.scrollIntoView());
    }

    return [
      new Plugin({
        key: new PluginKey('dragHandle'),
        view() {
          /* Hover affordance rides a window-level mousemove (PM's
             handleDOMEvents never sees events outside view.dom, where the
             handle now lives). The grab listener is attached to the handle
             element itself at creation time (see ensureHandle). */
          window.addEventListener('mousemove', onWindowMouseMove);

          teardownFns.push(() => {
            window.removeEventListener('mousemove', onWindowMouseMove);
          });

          return {
            destroy() {
              for (const fn of teardownFns) fn();
              teardownFns.length = 0;
              handle?.remove();
              overlay?.remove();
              dropIndicator?.remove();
              handle = null;
              overlay = null;
              handleAnchor = null;
              dropIndicator = null;
              dragState = null;
            },
          };
        },
      }),
    ];
  },
});
