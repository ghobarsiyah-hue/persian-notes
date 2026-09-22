import { useState, useRef, useEffect, useMemo, useCallback, useLayoutEffect } from 'react';
import type { PageKind } from '@/types';
import { setSourceSelection } from '@/editor/ribbon/contextual/selectionStore';
import { setFloatingSelectionBridge } from '@/editor/ribbon/contextual/floatingSelectionBridge';
import { A4_W_PX, A4_H_PX, pagePadding, objectMaxArea } from '@/editor/pageCapacity';
import { floatElementStyle, floatImageStyle, floatTransform, SHAPE_TYPES, shapeGeometry, hasTextCapability } from '@/editor/floatStyle';

/* Text and Shapes are ONE object family: every shape carries optional text
   (§1 — the standalone TextBox was removed from the UX; legacy saved
   textBoxes keep rendering through the same unified branch). */
export type FloatingElementType =
  | 'textBox' | 'sticky' | 'image'                       // legacy + special
  | 'rect' | 'roundedRect' | 'circle' | 'ellipse'        // basic shapes
  | 'diamond' | 'arrow' | 'callout';                     // decorative

export interface FloatingElement {
  id: string;
  type: FloatingElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  bgColor: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  rotation: number;
  zIndex: number;
  /** image element only — data URI or URL of the picture */
  src?: string;
  /** image element only — natural aspect ratio (w/h) so corner-resize keeps proportions */
  aspectRatio?: number;
  /** insertion order — used only for stable placement of brand-new elements */
  order: number;
  /** briefly true after insert so the layer can flash/select the new element */
  isNew: boolean;
  /* ── rich formatting model (all OPTIONAL — legacy saved documents without
     these fields load unchanged and keep their exact current look) ── */
  /** whole-object opacity 0..1 (default 1) */
  opacity?: number;
  /** text line-height multiplier for textual objects (default 1.7) */
  lineHeight?: number;
  /** letter spacing in px (Persian: usually 0; Latin display text may want +) */
  letterSpacing?: number;
  /** drop shadow toggle (shadow palette is derived from the ink scale) */
  shadow?: boolean;
  /** border style — solid | dashed | dotted (default solid) */
  borderColorStyle?: 'solid' | 'dashed' | 'dotted';
  /** inner padding in px (textual objects; default derives from type) */
  padding?: number;
  /** image fit: contain | cover | fill (default fill = current behavior) */
  objectFit?: 'contain' | 'cover' | 'fill';
  /** CSS filter string for images (grayscale/blur/brightness…), '' = none */
  filter?: string;
  /** flip horizontal/vertical (images/shapes), '' = none */
  flip?: '' | 'h' | 'v' | 'hv';
  /** vertical text alignment for textual objects (default top) */
  vAlign?: 'top' | 'center' | 'bottom';
  /** horizontal text alignment (default right — Persian first) */
  hAlign?: 'right' | 'center' | 'left' | 'justify';
  /** text direction (default rtl — Persian is the primary language) */
  direction?: 'rtl' | 'ltr';
  /** font weight 400|500|600|700 (default 400) */
  fontWeight?: number;
  /** italic/underline toggles for textual objects */
  italic?: boolean;
  underline?: boolean;
}

interface Props {
  elements: FloatingElement[];
  /** commit a new list — OR a functional updater merged into the CURRENT
   *  list state (used by the contextual ribbon's patches so two changes in
   *  one React tick can never overwrite each other, §2/§3 live preview). */
  onChange: (els: FloatingElement[] | ((current: FloatingElement[]) => FloatingElement[])) => void;
  /** the hosting page's CONTENT BOX (.page-content) — the layer measures its
   *  real padding live, so object bounds always match the actual page kind */
  editorContainerRef: React.RefObject<HTMLDivElement | null>;
  /** visual kind of the hosting sheet — the usable box differs between
   *  framed (30/32) and blank/notebook (38) pages; bounds recompute on change */
  pageKind?: PageKind;
  /** owning A4 page — published with the selection so the contextual ribbon
   *  can identify the object (the object carries its page, but behavior is
   *  identical on every page) */
  pageId: string;
  /** LIVE geometry during drag/resize (pointermove — NOT committed to the
   *  page state). The contextual ribbon reads this so width/position tools
   *  track the object in real time without any state update in the hot path. */
  onLiveGeometry?: (pageId: string, id: string, g: { x: number; y: number; width: number; height: number } | null) => void;
}

let nextId = 1;
let nextOrder = 1;

/* interaction geometry limits (CSS px) — smallest object the layer allows */
const MIN_W = 60;
const MIN_H = 40;

/** pointer capture for a gesture — works for both Mouse and Pointer events
 *  (React MouseEvent typing predates pointerId; nativeEvent may carry it) */
function capturePointer(el: HTMLElement, e: React.MouseEvent) {
  const pid = (e.nativeEvent as PointerEvent).pointerId;
  if (typeof pid === 'number') el.setPointerCapture?.(pid);
}

/* the editor A4 sheet model (CSS px @96dpi) — from the SHARED geometry module
 * (pageCapacity.ts) so the object system can never drift from the page model */
export { A4_W_PX, A4_H_PX } from '@/editor/pageCapacity';

export function createFloatingElement(
  type: FloatingElementType,
  x: number,
  y: number,
  init?: { src?: string; width?: number; height?: number; aspectRatio?: number }
): FloatingElement {
  const isText = type === 'textBox' || type === 'sticky';
  /* new shapes open in the calm «ساده» look: white fill, ink-line border,
     dark text — the petrol-blue accent stays reserved for hover/state */
  const isShape = (SHAPE_TYPES as readonly string[]).includes(type);
  const perType = (): Partial<FloatingElement> => {
    switch (type) {
      case 'rect': return { width: 160, height: 110, bgColor: '#ffffff', borderColor: '#64748b', borderWidth: 1.5 };
      case 'roundedRect': return { width: 170, height: 110, bgColor: '#ffffff', borderColor: '#64748b', borderWidth: 1.5, borderRadius: 12 };
      case 'circle': return { width: 140, height: 140, bgColor: '#ffffff', borderColor: '#64748b', borderWidth: 1.5, borderRadius: 999 };
      case 'ellipse': return { width: 170, height: 120, bgColor: '#ffffff', borderColor: '#64748b', borderWidth: 1.5, borderRadius: 999 };
      case 'diamond': return { width: 160, height: 160, bgColor: '#ffffff', borderColor: '#64748b', borderWidth: 1.5 };
      case 'arrow': return { width: 180, height: 70, bgColor: '#f1f5f9', borderColor: '#64748b', borderWidth: 0 };
      case 'callout': return { width: 200, height: 140, bgColor: '#ffffff', borderColor: '#64748b', borderWidth: 0, borderRadius: 10 };
      default: return {};
    }
  };
  const d = isShape ? perType() : {};
  return {
    id: `float-${nextId++}`,
    type,
    x,
    y,
    width: init?.width ?? d.width ?? (type === 'sticky' ? 220 : type === 'textBox' ? 220 : 140),
    height: init?.height ?? d.height ?? (type === 'sticky' ? 80 : type === 'textBox' ? 80 : 120),
    /* every object carries OPTIONAL text — shapes start empty (the user
       double-clicks / presses Enter to add text) */
    text: isShape ? '' : type === 'textBox' ? 'متن جدید' : type === 'sticky' ? 'یادداشت' : '',
    fontFamily: 'Sahel',
    fontSize: 14,
    fontColor: isShape ? '#171717' : '#171717',
    bgColor: d.bgColor ?? '#0070f3',
    borderColor: d.borderColor ?? '#0070f3',
    borderWidth: d.borderWidth ?? (isText ? 0 : 2),
    borderRadius: d.borderRadius ?? (type === 'ellipse' || type === 'circle' ? 999 : 0),
    rotation: 0,
    zIndex: 100,
    src: init?.src,
    aspectRatio: init?.aspectRatio,
    order: nextOrder++,
    isNew: true,
    /* shared defaults — richer formatting model (all optional/undefined so
       legacy saved documents load unchanged and keep their exact look) */
    opacity: 1,
    lineHeight: 1.7,
    letterSpacing: 0,
    shadow: false,
    borderColorStyle: 'solid',
  };
}
/**
 * FloatingLayer — positioned absolute OVER the editor paper.
 *
 * Selection lives in ONE place: this layer publishes its selection to the
 * contextual-ribbon selection store, and the ribbon resolves object context
 * from it. There is NO second toolbar — object tools live in the Ribbon's
 * contextual tab (قالب‌بندی شیء). Handles/outline remain here because they
 * are part of the editing surface, not a toolbar.
 *
 * Key design decisions to fix UX bugs:
 * 1. NO background overlay div — clicks pass through to editor naturally
 * 2. Wrapper has pointerEvents: 'none' — only individual elements intercept clicks
 * 3. Click-outside-to-deselect uses document-level mousedown listener
 * 4. Global keyboard delete handler checks isContentEditable directly (no async state)
 */
export function FloatingLayer({ elements, onChange, editorContainerRef, pageKind, pageId, onLiveGeometry }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  /* live geometry of the object being dragged/resized — component-local
     state so ONLY this layer re-renders during interaction (the page, the
     document state, autosave and all other pages are untouched until the
     pointer is released) */
  const [live, setLive] = useState<{ id: string; x: number; y: number; width: number; height: number } | null>(null);
  const liveRef = useRef<typeof live>(null);

  /* drag/resize interaction state — a START SNAPSHOT captured at pointerdown
     (object geometry + pointer page-local coordinates + the live usable box).
     pointermove math reads ONLY this snapshot + the event, so the hot path
     does zero DOM queries and zero array scans. */
  const dragRef = useRef<{
    id: string; type: FloatingElementType; moved: boolean;
    grabDX: number; grabDY: number; origX: number; origY: number;
    origW: number; origH: number; maxX: number; maxY: number; aspect: number | null;
  } | null>(null);
  const resizeRef = useRef<{
    id: string; type: FloatingElementType; edge: string;
    px: number; py: number; origX: number; origY: number; origW: number; origH: number;
    maxX: number; maxY: number; aspect: number | null;
  } | null>(null);
  const textRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  /* rotation gesture state — same snapshot discipline as drag/resize (§4):
     the DOM keeps its stale rotation-free box, the live rotation rides in
     layer state, and the pointermove math reads ONLY this snapshot. */
  const rotateRef = useRef<{
    id: string; cx: number; cy: number; startPointer: number; startAngle: number;
  } | null>(null);
  const [liveRotation, setLiveRotation] = useState<{ id: string; rotation: number } | null>(null);
  const liveRotationRef = useRef<typeof liveRotation>(null);

  /* Convert screen-space pointer coordinates to PAGE-LOCAL layer coordinates.
     The layer wrapper is position:absolute inside .page-content, so client
     coordinates minus the wrapper's client origin = page-local px. The
     workspace zoom is a pure CSS `zoom` (client rects are already scaled),
     so plain subtraction is exact at every zoom level — no manual division. */
  const pagePointOf = useCallback((e: { clientX: number; clientY: number }) => {
    const host = editorContainerRef.current?.getBoundingClientRect();
    if (!host) return { x: 0, y: 0 };
    return { x: e.clientX - host.left, y: e.clientY - host.top };
  }, [editorContainerRef]);

  /* The floating-layer wrapper must exactly cover the A4 OBJECT AREA inside
   * .page-paper: the page's usable content box MINUS the policy right-edge
   * breathing inset (pageCapacity.objectMaxArea — §2: objects never fuse
   * with the sheet's real right edge). BOUNDS come from the shared geometry
   * module — the single authoritative policy per page kind — and are
   * cross-checked against the live DOM so a future CSS change resurfaces
   * immediately instead of silently drifting. */
  const [paperStyle, setPaperStyle] = useState({ left: 0, top: 0, w: A4_W_PX - 64, h: A4_H_PX - 60 });
  useLayoutEffect(() => {
    const measure = () => {
      const node = editorContainerRef.current;
      if (!node) return;
      const cs = getComputedStyle(node);
      const pl = parseFloat(cs.paddingLeft) || 0;
      const pt = parseFloat(cs.paddingTop) || 0;
      /* policy bounds from pageCapacity (authoritative). The layer is mounted
         INSIDE .page-content, whose own box already starts at the paper's
         padding edge — so the layer origin is the area's x0/y0 offset (0/0
         today) and paperStyle.w/h are area-relative. Adding pagePadding()
         here would double-count the sheet padding (the historic left+32/top+30
         drift) and push the bottom 30px past the inner border. */
      const area = objectMaxArea(pageKind ?? 'framed');
      const next = {
        left: area.x0,
        top: area.y0,
        w: area.w,
        h: area.h,
      };
      /* … verified against the live DOM (dev diagnostics if they diverge):
         .page-content must stay a zero-padding box offset exactly by the
         sheet padding (framed 30/32, blank/notebook 38) */
      if (import.meta.env.DEV && (pl !== 0 || pt !== 0)) {
        console.warn(
          `[geometry] .page-content unexpectedly carries padding (${pt}/${pl}) — ` +
          'the object area assumes a padding-free content box; fix index.css',
        );
      }
      setPaperStyle((prev) =>
        prev.left === next.left && prev.top === next.top && prev.w === next.w && prev.h === next.h
          ? prev
          : next,
      );
    };
    measure();
    /* fonts/images loading can change the box; re-measure on resize too */
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && editorContainerRef.current) ro.observe(editorContainerRef.current);
    return () => ro?.disconnect();
  }, [editorContainerRef, pageKind]);

  /* place a brand-new element: keep it within the wrapper (wrapper-local).
     Scale-to-fit (ManualFixedPagePolicy §9/§13): an element LARGER than the
     usable A4 content box is scaled down proportionally on insert — the
     whole element stays visible, never cropped, never pushed to another
     page. Elements that fit are placed as-is. */
  useEffect(() => {
    const newestIdx = elements.findIndex((el) => el.isNew);
    if (newestIdx === -1) return;
    const newest = elements[newestIdx];
    /* shrink oversized inserts so width/height fit the content box */
    const scaleX = newest.width > paperStyle.w ? paperStyle.w / newest.width : 1;
    const scaleY = newest.height > paperStyle.h ? paperStyle.h / newest.height : 1;
    const scale = Math.min(scaleX, scaleY);
    const width = Math.max(40, Math.floor(newest.width * scale));
    const height = Math.max(30, Math.floor(newest.height * scale));
    /* images keep the natural aspect ratio after scaling */
    const aspect = newest.aspectRatio;
    const finalH = aspect ? Math.max(30, Math.round(width / aspect)) : height;
    /* placement clamp uses the POLICY area (right-edge inset included, §2) */
    const area = objectMaxArea(pageKind ?? 'framed');
    const maxX = Math.max(0, area.w - width);
    const maxY = Math.max(0, area.h - finalH);
    const x = Math.min(Math.max(0, newest.x), maxX);
    const y = Math.min(Math.max(0, newest.y), maxY);
    if (scale < 1 || x !== newest.x || y !== newest.y || finalH !== newest.height) {
      commitChange(elements.map((el) => (el.id === newest.id ? { ...el, x, y, width, height: finalH, isNew: false } : el)));
    } else {
      commitChange(elements.map((el) => (el.id === newest.id ? { ...el, isNew: false } : el)));
    }
  }, [elements, onChange, paperStyle]);

  /* auto-select a newly added element so the user immediately sees where it landed */
  useEffect(() => {
    const candidate = [...elements].sort((a, b) => a.order - b.order).pop();
    if (candidate?.isNew) {
      setSelectedId(candidate.id);
    }
  }, [elements]);

  /* ── Publish the selection to the contextual-ribbon selection store ──
     Every attribute the object tools need travels IN the object: the live
     element plus real list operations (patch/remove/duplicate/arrange) that
     write through the page's floating state. The Ribbon therefore executes
     commands against actual document state — no DOM scraping, no guessing.
     Extracted so the RIGHT-CLICK menu can publish synchronously (a
     contextmenu fires without a click — the setState-then-effect path would
     lag one event behind). */
  /* ═══ Float history (undo/redo) ═══
     Floating objects live OUTSIDE ProseMirror, so they need their own small
     history. Every layer-driven change goes through commitChange — ONE
     snapshot per logical operation (a whole drag gesture = one step, a
     formatting patch = one step). Ctrl+Z / Ctrl+Shift+Z undo/redo floats
     ONLY when no ProseMirror editor is focused, so text undo is untouched.
     History is per-layer = per page. */
  const pastRef = useRef<FloatingElement[][]>([]);
  const futureRef = useRef<FloatingElement[][]>([]);
  const commitChange = useCallback(
    (next: FloatingElement[]) => {
      pastRef.current.push(elements);
      if (pastRef.current.length > 50) pastRef.current.shift();
      futureRef.current = [];
      onChange(next);
    },
    [elements, onChange],
  );
  const undoFloat = useCallback(() => {
    const prev = pastRef.current.pop();
    if (!prev) return;
    futureRef.current.push(elements);
    onChange(prev);
    const valid = prev.some((e) => e.id === selectedIdRef.current);
    if (!valid) setSelectedId(null);
  }, [elements, onChange]);
  const redoFloat = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(elements);
    onChange(next);
    const valid = next.some((e) => e.id === selectedIdRef.current);
    if (!valid) setSelectedId(null);
  }, [elements, onChange]);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const publishSelection = useCallback((id: string | null) => {
    const el = id ? elements.find((e) => e.id === id) : null;
    if (!el) {
      setSourceSelection('floating', []);
      return;
    }
    setSourceSelection('floating', [
      {
        id: `float:${pageId}:${el.id}`,
        type: el.type,
        source: 'floating',
        ancestors: [],
        attrs: {
          element: el,
          pageId,
          usable: { w: paperStyle.w, h: paperStyle.h },
          patch: (patch: Partial<FloatingElement>) =>
            /* functional update — always merge into the CURRENT list state, so
               a patch issued while React has not yet re-rendered (two fast
               slider moves, or a patch during a live drag) can never overwrite
               an earlier one. The historic closure over `elements` let the
               second patch silently revert the first (§2/§3 root cause). */
            onChange((current) => current.map((x) => (x.id === el.id ? { ...x, ...patch } : x))),
          remove: () => {
            commitChange(elements.filter((x) => x.id !== el.id));
            setSelectedId(null);
          },
          duplicate: () => {
            const copy: FloatingElement = {
              ...el,
              id: `float-${nextId++}`,
              x: el.x + 16,
              y: el.y + 16,
              order: nextOrder++,
              isNew: false,
              zIndex: el.zIndex + 1,
            };
            commitChange([...elements, copy]);
            setSelectedId(copy.id);
          },
          bringToFront: () => {
            const top = Math.max(...elements.map((x) => x.zIndex));
            commitChange(elements.map((x) => (x.id === el.id ? { ...x, zIndex: top + 1 } : x)));
          },
          sendToBack: () => {
            const bottom = Math.min(...elements.map((x) => x.zIndex));
            commitChange(elements.map((x) => (x.id === el.id ? { ...x, zIndex: bottom - 1 } : x)));
          },
        },
        pageId,
      },
    ]);
  }, [elements, pageId, paperStyle.w, paperStyle.h, commitChange]);

  useEffect(() => { publishSelection(selectedId); }, [selectedId, publishSelection]);


  /* bridge for the right-click menu: select + publish in ONE synchronous step */
  useEffect(() => {
    setFloatingSelectionBridge({
      select: (id) => { setSelectedId(id); publishSelection(id); },
      selectedId: () => selectedIdRef.current,
    });
    return () => setFloatingSelectionBridge(null);
  }, [publishSelection]);

  /* ── Click-outside-to-deselect: document-level mousedown ──
     The Ribbon is excluded: clicking a contextual tool must keep the
     selection so the command lands on the object (like Office). */
  useEffect(() => {
    if (!elements.length) return;

    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // If clicking inside an element (handle or contentEditable), don't deselect
      if (target.closest('[data-float-id]')) return;

      // Ribbon (tabs, tool row, menus and portaled dropdown panels) — the
      // contextual tab belongs to the selected object; interacting with it
      // must not drop the selection. The formatting panels (متن/ظاهر/سبک)
      // PORTAL their content to document.body (.mq-picker-panel), so a
      // root-only check would deselect the object on the panel's very first
      // mousedown — the object, the tab and the panel would all vanish.
      // The [data-keep-open] exemption is the same escape hatch the
      // selection toolbar's dropdowns already use.
      if (target.closest('[data-ribbon-root]')) return;
      if (target.closest('.mq-picker-panel')) return;
      if (target.closest('[data-keep-open]')) return;

      // Otherwise, deselect
      setSelectedId(null);
      setEditingId(null);
    };

    document.addEventListener('mousedown', onDown, true); // capture phase
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [elements.length]);

  /* ── Select a box (click on it) ── */
  const handleSelect = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedId(id);
  };

  /* ── Drag start — from the handle bar, the object body, image or shape ──
     Captures a full START SNAPSHOT (object geometry + page-local grab point +
     live usable bounds). pointermove math never touches the DOM again. */
  const handleDragStart = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    const el = elements.find((x) => x.id === id);
    if (!el) return;
    setSelectedId(id);
    setEditingId(null);
    const p = pagePointOf(e);
    const area = objectMaxArea(pageKind ?? 'framed');
    dragRef.current = {
      id, type: el.type, moved: false,
      grabDX: p.x - el.x, grabDY: p.y - el.y,
      origX: el.x, origY: el.y, origW: el.width, origH: el.height,
      maxX: Math.max(0, paperStyle.w - el.width),
      maxY: Math.max(0, paperStyle.h - el.height),
      aspect: el.type === 'image' && el.aspectRatio ? el.aspectRatio : null,
    };
    void area;
    capturePointer(e.currentTarget as HTMLElement, e);
    const textNode = textRefs.current.get(id);
    if (textNode) textNode.blur();
  };

  /* ── Resize start — same snapshot discipline (edge + page-local anchor) ── */
  const handleResizeStart = (e: React.MouseEvent, id: string, edge: string) => {
    e.stopPropagation();
    e.preventDefault();
    const el = elements.find((x) => x.id === id);
    if (!el) return;
    const p = pagePointOf(e);
    resizeRef.current = {
      id, type: el.type, edge,
      px: p.x, py: p.y,
      origX: el.x, origY: el.y, origW: el.width, origH: el.height,
      maxX: Math.max(0, paperStyle.w), maxY: Math.max(0, paperStyle.h),
      aspect: el.type === 'image' && el.aspectRatio ? el.aspectRatio : null,
    };
    capturePointer(e.currentTarget as HTMLElement, e);
  };

  /* ── Rotation start (§4) — the Word-like handle above the selection ──
     Center is taken from the rotation-free page-local box; angles are
     computed relative to the angle at pointerdown so the gesture starts at
     delta 0° (no visual jump). Angle normalization happens on commit. */
  const handleRotateStart = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    const el = elements.find((x) => x.id === id);
    if (!el) return;
    setSelectedId(id);
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const p = pagePointOf(e);
    const startPointer = Math.atan2(p.y - cy, p.x - cx);
    rotateRef.current = { id, cx, cy, startPointer, startAngle: el.rotation || 0 };
    capturePointer(e.currentTarget as HTMLElement, e);
  };

  /* ── Global mouse move/up — the interaction hot path ──
     pointermove converts to PAGE-LOCAL coordinates, computes clamped geometry
     from the START SNAPSHOT (zero DOM reads, zero array scans), and stores it
     in the LAYER-LOCAL `live` state (rAF-coalesced): the object moves
     immediately while the page, the document state and autosave are
     untouched. pointerup COMMITS once through onChange — one React update for
     the whole gesture, one autosave via the page's float persistence path. */
  useEffect(() => {
    let raf = 0;
    let pending: MouseEvent | null = null;
    const computeLive = (e: MouseEvent) => {
      if (dragRef.current) {
        const d = dragRef.current;
        const host = editorContainerRef.current?.getBoundingClientRect();
        if (!host) return null;
        const px = e.clientX - host.left;
        const py = e.clientY - host.top;
        const nx = Math.min(d.maxX, Math.max(0, px - d.grabDX));
        const ny = Math.min(d.maxY, Math.max(0, py - d.grabDY));
        if (Math.abs(nx - d.origX) > 2 || Math.abs(ny - d.origY) > 2) d.moved = true;
        if (!d.moved) return null;
        return { id: d.id, x: nx, y: ny, width: d.origW, height: d.origH };
      }
      if (rotateRef.current) {
        const r = rotateRef.current;
        const host = editorContainerRef.current?.getBoundingClientRect();
        if (!host) return null;
        const p = { x: e.clientX - host.left, y: e.clientY - host.top };
        /* pointer angle → object angle: delta from gesture start, added to
           the start angle; center is preserved by construction (the rotation
           happens around the snapshot center, the box never moves) */
        const a = Math.atan2(p.y - r.cy, p.x - r.cx);
        let deg = r.startAngle + ((a - r.startPointer) * 180) / Math.PI;
        deg = ((deg % 360) + 360) % 360;
        return { id: r.id, rotation: deg };
      }
      if (resizeRef.current) {
        const r = resizeRef.current;
        const host = editorContainerRef.current?.getBoundingClientRect();
        if (!host) return null;
        const dx = (e.clientX - host.left) - r.px;
        const dy = (e.clientY - host.top) - r.py;
        let newX = r.origX, newY = r.origY, newW = r.origW, newH = r.origH;
        if (r.edge.includes('e')) newW = Math.max(MIN_W, r.origW + dx);
        if (r.edge.includes('w')) { newW = Math.max(MIN_W, r.origW - dx); newX = r.origX + (r.origW - newW); }
        if (r.edge.includes('s')) newH = Math.max(MIN_H, r.origH + dy);
        if (r.edge.includes('n')) { newH = Math.max(MIN_H, r.origH - dy); newY = r.origY + (r.origH - newH); }
        /* corner handles on images keep the natural aspect ratio — recompute
           height from width, re-anchoring on n/w edges */
        if (r.aspect && r.edge.length === 2) {
          newH = Math.max(MIN_H, Math.round(newW / r.aspect));
          if (r.edge.includes('n')) newY = r.origY + (r.origH - newH);
          if (r.edge.includes('w')) newX = r.origX + (r.origW - newW);
        }
        /* keep the resized element COMPLETELY inside the object area — the
           right boundary already carries the policy edge inset (paperStyle.w
           = objectMaxArea().w), so resize can never cross it either */
        newW = Math.min(newW, Math.max(MIN_W, r.maxX - newX));
        newH = Math.min(newH, Math.max(MIN_H, r.maxY - newY));
        newX = Math.min(Math.max(0, newX), Math.max(0, r.maxX - newW));
        newY = Math.min(Math.max(0, newY), Math.max(0, r.maxY - newH));
        return { id: r.id, x: newX, y: newY, width: newW, height: newH };
      }
      return null;
    };
    const flush = () => {
      raf = 0;
      if (!pending) return;
      const g = computeLive(pending);
      pending = null;
      if (!g) return;
      if ('rotation' in g) {
        /* rotation stream — separate live channel (box never changes) */
        const rot = g as { id: string; rotation: number };
        setLiveRotation(rot);
        liveRotationRef.current = rot;
      } else {
        setLive(g);
        liveRef.current = g;
        onLiveGeometry?.(pageId, g.id, g);
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current && !resizeRef.current && !rotateRef.current) return;
      pending = e; // latest event wins — rAF coalesces the burst
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const commit = () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      pending = null;
      const r = rotateRef.current;
      const rot = liveRotationRef.current;
      if (r) {
        rotateRef.current = null;
        const norm = Math.round(((rot?.rotation ?? r.startAngle) % 360 + 360) % 360);
        const el = elements.find((x) => x.id === r.id);
        if (el && norm !== (el.rotation || 0)) {
          commitChange(elements.map((x) => (x.id === r.id ? { ...x, rotation: norm } : x)));
        }
        setLiveRotation(null);
        liveRotationRef.current = null;
      }
      const g = liveRef.current;
      dragRef.current = null;
      resizeRef.current = null;
      if (g) {
        const el = elements.find((x) => x.id === g.id);
        if (el && (el.x !== g.x || el.y !== g.y || el.width !== g.width || el.height !== g.height)) {
          commitChange(elements.map((x) => (x.id === g.id ? { ...el, x: g.x, y: g.y, width: g.width, height: g.height } : x)));
        }
        setLive(null);
        liveRef.current = null;
        onLiveGeometry?.(pageId, g.id, null);
      }
    };
    const onMouseUp = () => { if (dragRef.current || resizeRef.current || rotateRef.current) commit(); };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', commit);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', commit);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [elements, onChange, editorContainerRef, pageId, onLiveGeometry]);

  /* a commit elsewhere (formatting patch while dragging — can't normally
     happen, but stay consistent) keeps the live overlay in sync */
  useEffect(() => {
    if (live && !elements.some((el) => el.id === live.id)) { setLive(null); liveRef.current = null; }
  }, [elements, live]);

  /* ── Unified shape text editing (§1): Enter on a selected object enters
     text editing; Escape leaves it (focus returns to the object so a
     following drag still moves the whole shape). ── */
  const enterTextEdit = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
    /* the editing surface mounts BECAUSE editingId just changed — any node
       in textRefs is a stale/unmounted node (its branch rendered only while
       isEd was already true). Focus is applied in the CE ref callback once
       the real node exists (shape text, §5: dblclick focus was silently
       lost and the first keystrokes fell through to the document). */
  }, []);

  /** focus + caret-to-end once the editing surface is in the DOM */
  const focusTextEdit = useCallback((node: HTMLElement) => {
    node.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);

  /* the editing surface exists only AFTER the isEd render commits — focus
     here (post-commit), guarded so re-renders during editing never reset
     the caret (§5: dblclick focus was silently lost before) */
  useEffect(() => {
    if (!editingId) return;
    const node = textRefs.current.get(editingId);
    if (node && document.activeElement !== node) focusTextEdit(node);
  }, [editingId, focusTextEdit]);

  /* ── Float keyboard: Delete/Backspace removes the selected object;
     Enter enters text editing; Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y) undo/redo
     float history — ONLY when no ProseMirror editor is focused and no text
     is being edited, so text undo, IME composition and contentEditable
     typing are untouched ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.isContentEditable) return; // Typing inside a text box
      if (target.closest('.ProseMirror')) return; // the document editor owns these keys
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedId) return;
        e.preventDefault();
        commitChange(elements.filter((el) => el.id !== selectedId));
        setSelectedId(null);
        return;
      }
      if (e.key === 'Enter' && selectedId && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        enterTextEdit(selectedId);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoFloat();
      } else if ((mod && e.shiftKey && e.key.toLowerCase() === 'z') || (mod && e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        redoFloat();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selectedId, elements, commitChange, undoFloat, redoFloat, enterTextEdit]);

  /* ── Sync text content to contentEditable when element text changes externally ── */
  useEffect(() => {
    elements.forEach((el) => {
      if (!hasTextCapability(el.type)) return;
      const node = textRefs.current.get(el.id);
      if (node && node.textContent !== el.text && document.activeElement !== node) {
        node.textContent = el.text;
      }
    });
  }, [elements]);

  const selectedEl = useMemo(() => elements.find((el) => el.id === selectedId) ?? null, [elements, selectedId]);
  const isText = (el: FloatingElement) => el.type === 'textBox' || el.type === 'sticky';
  const borderStyle = (el: FloatingElement) => el.borderWidth > 0 ? `${el.borderWidth}px ${el.borderColorStyle || 'solid'} ${el.borderColor}` : 'none';
  /* unified text surface: every object that can show its inner text —
     legacy textBox/sticky AND any shape (text is optional on shapes) */
  const hasText = (el: FloatingElement) => hasTextCapability(el.type) || SHAPE_TYPES.includes(el.type);

  /* shared selection chrome — one clean vocabulary for every object type:
     thin accent outline + soft glow (the old 0.25rem outline rendered as a
     4px bar and read as a crude browser artifact). Handles are small squared
     chips (Office-like) instead of oversized circles. */
  const selectionOutline: React.CSSProperties = {
    outline: '2px solid #0070f3',
    outlineOffset: 0,
  };
  const selectionGlow: React.CSSProperties = {
    boxShadow: '0 0.25rem 1.2rem rgba(0,112,243,0.18)',
  };

  return (
    <div
      className="pn-float-layer"
      style={{
        position: 'absolute',
        left: paperStyle.left,
        top: paperStyle.top,
        width: paperStyle.w,
        height: paperStyle.h,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 60,
      }}
    >
      {elements.map((el) => {
        const isSel = selectedId === el.id;
        const isEd = editingId === el.id;
        /* live geometry while dragging/resizing: the object tracks the
           pointer exactly; committed state stays untouched until pointerup */
        const gv = live && live.id === el.id ? live : el;
        const gx = gv.x, gy = gv.y, gw = gv.width, gh = gv.height;

        /* live rotation while the handle is being dragged (rotation rides a
           separate channel — the committed box stays put) */
        const rotVal = liveRotation && liveRotation.id === el.id ? liveRotation.rotation : el.rotation;
        const rotEl = { ...el, rotation: rotVal };

        /* ══ UNIFIED TEXT SURFACE (§1) ══
           One branch renders every text-bearing object: the legacy
           textBox/sticky (its own drag bar) AND any shape carrying optional
           text (text sits INSIDE the shape — no separate TextBox object).
           Double-click or Enter edits; Escape leaves editing; drag outside
           editing moves the whole shape. */
        if (hasText(el)) {
          const legacyBar = isText(el); /* only the old text objects keep the ⋮⋮ bar */
          const st = shapeGeometry(el);
          const textObjHasFace = el.bgColor !== 'transparent' || el.borderWidth > 0;
          return (
            <div
              key={el.id}
              data-float-id={el.id}
              style={{
                position: 'absolute',
                left: gx,
                top: gy,
                width: gw,
                minHeight: gh,
                transform: floatTransform(rotEl, st.extra),
                zIndex: el.zIndex + (isSel ? 20 : 0),
                ...floatElementStyle(el),
                display: 'flex',
                flexDirection: 'column',
                pointerEvents: 'auto',
                outline: isSel ? '2px solid #0070f3' : 'none',
                outlineOffset: isSel ? '2px' : '0px',
                boxShadow: isSel
                  ? '0 0.25rem 1.2rem rgba(0,112,243,0.18)'
                  : el.isNew
                    ? '0 0 0 3px rgba(0,112,243,0.45), 0 0.3rem 1rem rgba(0,0,0,0.12)'
                    : floatElementStyle(el).boxShadow,
                cursor: isEd ? 'text' : (textObjHasFace ? 'move' : 'grab'),
                transition: 'background 0.2s ease, outline 0.15s ease, box-shadow 0.2s ease',
              }}
              onMouseDown={(e) => {
                if (isEd) return; /* typing surface: no drag start while editing */
                handleSelect(e, el.id);
                e.stopPropagation();
                e.preventDefault();
                const p = pagePointOf(e);
                const area = objectMaxArea(pageKind ?? 'framed');
                void area.x0; void area.y0; /* inset lives in paperStyle bounds */
                dragRef.current = {
                  id: el.id, type: el.type, moved: false,
                  grabDX: p.x - el.x, grabDY: p.y - el.y,
                  origX: el.x, origY: el.y, origW: el.width, origH: el.height,
                  maxX: Math.max(0, paperStyle.w - el.width),
                  maxY: Math.max(0, paperStyle.h - el.height),
                  aspect: el.type === 'image' && el.aspectRatio ? el.aspectRatio : null,
                };
                capturePointer(e.currentTarget as HTMLElement, e);
              }}
              onDoubleClick={(e) => {
                if (isEd) return;
                e.stopPropagation();
                e.preventDefault();
                enterTextEdit(el.id);
              }}
            >
              {el.isNew && (
                <span
                  aria-hidden="true"
                  className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-ink-900 text-[9px] font-medium text-white px-1.5 py-0.5 shadow-sm"
                >
                  جدید
                </span>
              )}
              {/* Drag handle — legacy text objects only (§1: shapes drag from
                  their whole body; the bar would cover the shape's top) */}
              {legacyBar && (
              <div
                data-float-id={el.id}
                onMouseDown={(e) => handleDragStart(e, el.id)}
                style={{
                  height: 22,
                  flexShrink: 0,
                  background: isSel ? 'rgba(0,112,243,0.06)' : 'transparent',
                  borderBottom: isSel ? '1px solid rgba(0,0,0,0.06)' : 'none',
                  cursor: isSel ? 'grabbing' : 'grab',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  color: isSel ? '#999' : 'transparent',
                  letterSpacing: '0.15em',
                  userSelect: 'none',
                  transition: 'color 0.15s, background 0.15s',
                }}
              >
                ⋮⋮
              </div>
              )}
              {/* Editable inner text — optional on every shape */}
              <div
                contentEditable={isEd ? true : undefined}
                suppressContentEditableWarning
                ref={(node) => {
                  if (node) textRefs.current.set(el.id, node);
                  else textRefs.current.delete(el.id);
                }}
                data-float-id={el.id}
                style={{
                  flex: 1,
                  /* the box's padding lives on the wrapper (floatElementStyle);
                     the editable surface fills it and inherits typography */
                  padding: 0,
                  outline: 'none',
                  minHeight: '1.2em',
                  cursor: isEd ? 'text' : 'inherit',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  userSelect: isEd ? 'text' : 'none',
                }}
                onFocus={() => { setSelectedId(el.id); setEditingId(el.id); }}
                onBlur={(e) => {
                  setEditingId(null);
                  const newText = e.currentTarget.textContent || '';
                  if (newText !== el.text) {
                    commitChange(elements.map((x) => x.id === el.id ? { ...x, text: newText } : x));
                  }
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    /* deterministic exit: blur() alone relies on onBlur
                       firing, which never happens if the surface already
                       lost focus (§5 root cause of the stuck editing state) */
                    setEditingId(null);
                    e.currentTarget.blur();
                    setSelectedId(el.id);
                    /* focus the OBJECT (its outer root) so the next drag/keys
                       act on the shape — the inner text surface carries its
                       own data-float-id, so closest() must skip the surface
                       itself or it refocuses and restarts editing (N3b) */
                    (e.currentTarget.parentElement?.closest('[data-float-id]') as HTMLElement | null)?.focus?.();
                  }
                }}
              />
            </div>
          );
        }

        if (el.type === 'image') {
          return (
            <div
              key={el.id}
              data-float-id={el.id}
              style={{
                position: 'absolute',
                left: gx,
                top: gy,
                width: gw,
                height: gh,
                transform: floatTransform(el),
                zIndex: el.zIndex + (isSel ? 20 : 0),
                ...floatElementStyle(el),
                pointerEvents: 'auto',
                outline: isSel ? '2px solid #0070f3' : 'none',
                outlineOffset: isSel ? '2px' : '0px',
                boxShadow: isSel ? '0 0.25rem 1.2rem rgba(0,112,243,0.18)' : floatElementStyle(el).boxShadow,
                cursor: isSel ? 'grabbing' : 'move',
              }}
              onMouseDown={(e) => {
                handleSelect(e, el.id);
                e.stopPropagation();
                e.preventDefault();
                const p = pagePointOf(e);
                dragRef.current = {
                  id: el.id, type: 'image', moved: false,
                  grabDX: p.x - el.x, grabDY: p.y - el.y,
                  origX: el.x, origY: el.y, origW: el.width, origH: el.height,
                  maxX: Math.max(0, paperStyle.w - el.width),
                  maxY: Math.max(0, paperStyle.h - el.height),
                  aspect: el.aspectRatio ?? null,
                };
                capturePointer(e.currentTarget as HTMLElement, e);
              }}
            >
              {el.isNew && (
                <span
                  aria-hidden="true"
                  className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-ink-900 text-[9px] font-medium text-white px-1.5 py-0.5 shadow-sm"
                >
                  جدید
                </span>
              )}
              <img
                src={el.src}
                alt=""
                draggable={false}
                style={floatImageStyle(el)}
              />
            </div>
          );
        }

        // ══ SHAPES (§1: unified object family — text lives INSIDE the shape) ══
        const hasVisibleAppearance = el.bgColor !== 'transparent' || el.borderWidth > 0;
        if ((SHAPE_TYPES as readonly string[]).includes(el.type)) {
          const st = shapeGeometry(el);
          const showText = hasTextCapability(el.type) && !!el.text;
          return (
            <div
              key={el.id}
              data-float-id={el.id}
              tabIndex={-1}
              style={{
                position: 'absolute',
                left: gx,
                top: gy,
                width: gw,
                height: gh,
                transform: floatTransform(rotEl, st.extra),
                zIndex: el.zIndex + (isSel ? 20 : 0),
                pointerEvents: 'auto',
                outline: isSel ? selectionOutline.outline : (!hasVisibleAppearance ? '2px dashed rgba(0,112,243,0.5)' : 'none'),
                outlineOffset: '2px',
                boxShadow: isSel ? selectionGlow.boxShadow : floatElementStyle(el).boxShadow,
                cursor: isSel ? 'grabbing' : (hasVisibleAppearance ? 'move' : 'grab'),
                transition: 'box-shadow 0.15s, outline 0.15s',
              }}
              onMouseDown={(e) => {
                if (isEd) return;
                handleSelect(e, el.id);
                e.stopPropagation();
                e.preventDefault();
                const p = pagePointOf(e);
                dragRef.current = {
                  id: el.id, type: el.type, moved: false,
                  grabDX: p.x - el.x, grabDY: p.y - el.y,
                  origX: el.x, origY: el.y, origW: el.width, origH: el.height,
                  maxX: Math.max(0, paperStyle.w - el.width),
                  maxY: Math.max(0, paperStyle.h - el.height),
                  aspect: null,
                };
                capturePointer(e.currentTarget as HTMLElement, e);
              }}
              onDoubleClick={(e) => {
                if (isEd) return;
                e.stopPropagation();
                e.preventDefault();
                enterTextEdit(el.id);
              }}
            >
              {/* shape painting — one SVG per shape, pointer-transparent so
                  the wrapper owns drag/select; arrow/callout read the SAME
                  fill/border colors as every other object (one interpreter) */}
              <svg
                width={gw}
                height={gh}
                viewBox={`0 0 ${Math.max(1, gw)} ${Math.max(1, gh)}`}
                preserveAspectRatio="none"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                aria-hidden="true"
              >
                {st.paint(gw, gh, el)}
              </svg>
              {/* the shape's own text — optional, rendered above the paint,
                  positioned by the shared interpreter, hidden from interaction
                  until editing begins */}
              {showText && !isEd && (
                <div
                  style={{
                    position: 'absolute',
                    inset: el.padding != null ? el.padding : (el.type === 'callout' ? 12 : 10),
                    display: 'flex',
                    justifyContent:
                      (el.vAlign ?? 'top') === 'center' ? 'center' :
                      (el.vAlign ?? 'top') === 'bottom' ? 'flex-end' : 'flex-start',
                    pointerEvents: 'none',
                    cursor: 'inherit',
                    fontFamily: el.fontFamily,
                    fontSize: el.fontSize,
                    fontWeight: el.fontWeight ?? 400,
                    fontStyle: el.italic ? 'italic' : undefined,
                    textDecoration: el.underline ? 'underline' : undefined,
                    color: el.fontColor,
                    lineHeight: el.lineHeight ?? 1.7,
                    letterSpacing: (el.letterSpacing ?? 0) + 'px',
                    textAlign: el.hAlign ?? 'right',
                    direction: el.direction ?? 'rtl',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {el.text}
                </div>
              )}
              {isEd && (
                <div
                  contentEditable
                  suppressContentEditableWarning
                  ref={(node) => {
                    if (node) textRefs.current.set(el.id, node);
                    else textRefs.current.delete(el.id);
                  }}
                  data-float-id={el.id}
                  style={{
                    position: 'absolute',
                    inset: el.padding != null ? el.padding : (el.type === 'callout' ? 12 : 10),
                    outline: 'none',
                    pointerEvents: 'auto',
                    cursor: 'text',
                    fontFamily: el.fontFamily,
                    fontSize: el.fontSize,
                    fontWeight: el.fontWeight ?? 400,
                    fontStyle: el.italic ? 'italic' : undefined,
                    textDecoration: el.underline ? 'underline' : undefined,
                    color: el.fontColor,
                    lineHeight: el.lineHeight ?? 1.7,
                    letterSpacing: (el.letterSpacing ?? 0) + 'px',
                    textAlign: el.hAlign ?? 'right',
                    direction: el.direction ?? 'rtl',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                  onBlur={(e) => {
                    setEditingId(null);
                    const newText = e.currentTarget.textContent || '';
                    if (newText !== el.text) {
                      commitChange(elements.map((x) => x.id === el.id ? { ...x, text: newText } : x));
                    }
                  }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditingId(null);
                    e.currentTarget.blur();
                    setSelectedId(el.id);
                  }
                }}
                />
              )}
            </div>
          );
        }

        return null;
      })}

      {/* ── Resize handles + Word-like rotation handle ── */}
      {selectedEl && (() => {
        const s = live && live.id === selectedEl.id ? live : selectedEl;
        const handleSize = 10;
        const edges = [
          { edge: 'nw', cursor: 'nwse-resize', top: s.y - 5, left: s.x - 5 },
          { edge: 'ne', cursor: 'nesw-resize', top: s.y - 5, left: s.x + s.width - 5 },
          { edge: 'sw', cursor: 'nesw-resize', top: s.y + s.height - 5, left: s.x - 5 },
          { edge: 'se', cursor: 'nwse-resize', top: s.y + s.height - 5, left: s.x + s.width - 5 },
          { edge: 'n', cursor: 'ns-resize', top: s.y - 5, left: s.x + s.width / 2 - 5 },
          { edge: 's', cursor: 'ns-resize', top: s.y + s.height - 5, left: s.x + s.width / 2 - 5 },
          { edge: 'w', cursor: 'ew-resize', top: s.y + s.height / 2 - 5, left: s.x - 5 },
          { edge: 'e', cursor: 'ew-resize', top: s.y + s.height / 2 - 5, left: s.x + s.width - 5 },
        ];
        /* rotation stem + handle above the frame (Word-style, §4). It exists
           only while an object is selected and is never persisted. */
        const rotStemTop = s.y - 30;
        return (
          <>
            {edges.map(({ edge, cursor, top, left }) => (
              <div
                key={edge}
                data-float-id={s.id}
                style={{
                  position: 'absolute',
                  width: handleSize,
                  height: handleSize,
                  background: '#fff',
                  border: '2px solid #0070f3',
                  borderRadius: '50%',
                  cursor,
                  zIndex: 300,
                  pointerEvents: 'auto',
                  top,
                  left,
                  touchAction: 'none',
                  transition: 'transform 0.1s ease',
                }}
                onMouseDown={(e) => handleResizeStart(e, s.id, edge)}
              />
            ))}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: rotStemTop + 8,
                left: s.x + s.width / 2 - 1,
                width: 2,
                height: 22,
                background: 'rgba(0,112,243,0.45)',
                zIndex: 299,
                pointerEvents: 'none',
              }}
            />
            <div
              data-float-id={s.id}
              title="چرخش — برای چرخاندن بکشید"
              style={{
                position: 'absolute',
                top: rotStemTop,
                left: s.x + s.width / 2 - 8,
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: '#fff',
                border: '2px solid #0070f3',
                cursor: liveRotation ? 'grabbing' : 'grab',
                zIndex: 300,
                pointerEvents: 'auto',
                touchAction: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                lineHeight: 1,
                color: '#0070f3',
                userSelect: 'none',
              }}
              onMouseDown={(e) => handleRotateStart(e, s.id)}
            >
              ↻
            </div>
          </>
        );
      })()}
    </div>
  );
}
