import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Check, ChevronLeft } from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   ContextMenu — the in-app right-click menu (راست‌کلیک سفارشی).

   The browser's native menu is suppressed over the workspace; this portal
   menu replaces it. Items are declarative data (built in contextMenuItems.tsx
   from the SAME resolved selection context the Ribbon uses — same tools, same
   capabilities, same live active-states).

   Behavior:
   • opens 6px from the pointer, RTL-anchored (menu's right edge at the
     cursor), clamped inside the viewport
   • one-level fly-out submenus: open on hover (desktop) or click (touch),
     flip to the side that actually fits, reposition when the parent scrolls
   • closes on outside mousedown / Escape / page scroll / resize / window blur
   • mousedown inside the menu is preventDefault-ed so the editor keeps its
     focus and selection — cut/copy act on exactly what was right-clicked
   • keyboard: ↑/↓ move, ← opens a submenu (RTL "into"), → closes it,
     Enter runs, Esc closes submenu first, then the menu

   Information architecture of the TEXT menus (contextMenuItems.tsx):
   clipboard → افزودن → find/replace/select-all → link/note →
   تنظیمات پاراگراف (fly-out) → حذف (danger, behind the last divider).
   Quick formatting lives only in the toolbar above — never here.
   ══════════════════════════════════════════════════════════════════════════ */

export interface MenuItemAction {
  kind: 'action';
  key: string;
  label: string;
  /** tooltip */
  title?: string;
  icon?: ReactNode;
  /** small color dot rendered instead of an icon (color pickers) */
  swatch?: string;
  /** hint rendered at the far end (e.g. Ctrl+Z) */
  shortcut?: string;
  /** destructive actions render in the danger color */
  danger?: boolean;
  disabled?: boolean;
  /** checkmark (a live state, e.g. the current image alignment) */
  active?: boolean;
  run: () => void;
}

export interface MenuItemSeparator {
  kind: 'separator';
  key: string;
}

/** Opens a ONE-LEVEL fly-out on hover/click. Nested submenus are not
 *  supported by design — the menu stays a quick-action tool, not a tree. */
export interface MenuItemSubmenu {
  kind: 'submenu';
  key: string;
  label: string;
  title?: string;
  icon?: ReactNode;
  disabled?: boolean;
  items: MenuItem[];
}

/** A compact inline ROW of color dots (رنگ‌های اخیر) — one menu row instead
 *  of a long list, like Word's recent-colors strip. */
export interface MenuItemSwatches {
  kind: 'swatches';
  key: string;
  colors: string[];
  onPick: (color: string) => void;
}

/** One icon-only button inside a MenuItemIconRow. */
export interface IconRowButton {
  key: string;
  /** tooltip — the label, since no text is rendered */
  title: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
}

export type MenuItem = MenuItemAction | MenuItemSeparator | MenuItemSubmenu | MenuItemSwatches;

const isSelectable = (it: MenuItem): boolean =>
  (it.kind === 'action' || it.kind === 'submenu') && !it.disabled;

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  /** optional horizontal quick-format card rendered DIRECTLY ABOVE the menu
   *  (SelectionToolbar) — part of the same floating unit: it closes with the
   *  menu, and its own clicks/popovers never dismiss the menu */
  toolbar?: ReactNode;
  onClose: () => void;
}

export function ContextMenu({ x, y, items, toolbar, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const closeTimer = useRef<number | null>(null);

  /* null until measured — hidden off-layout so the clamp below reads the
     real size (avoids a one-frame flash at 0,0 or off-screen overflow) */
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);
  const [selected, setSelected] = useState(() =>
    items.findIndex((it) => isSelectable(it)),
  );
  /* open fly-out: index into `items`, or null */
  const [openSub, setOpenSub] = useState<number | null>(null);
  const [subSelected, setSubSelected] = useState(0);
  const [subPos, setSubPos] = useState<{ top: number; left: number } | null>(null);
  const [subTick, setSubTick] = useState(0); // remeasure trigger (parent scroll)

  /* clamp to the viewport once the menu has its real dimensions.
     RTL: the menu's RIGHT edge sits 6px right of the cursor (labels are
     right-aligned, so the text the user clicked on stays next to the
     pointer); clamped when that would overflow either side. */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const m = 8;
    const gap = 6;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const top = Math.min(Math.max(m, y + gap), Math.max(m, window.innerHeight - h - m));
    const left = Math.min(
      Math.max(m, x + gap - w),
      Math.max(m, window.innerWidth - w - m),
    );
    setPos({ top, left });
    /* the toolbar card — centered above the menu, clamped; flips BELOW the
       menu when there is no room above (Word behavior) */
    const tb = toolbarRef.current;
    if (tb) {
      const tw = tb.offsetWidth;
      const th = tb.offsetHeight;
      const tLeft = Math.min(
        Math.max(m, left + w / 2 - tw / 2),
        Math.max(m, window.innerWidth - tw - m),
      );
      let tTop = top - th - gap;
      if (tTop < m) tTop = Math.min(top + h + gap, window.innerHeight - th - m);
      setToolbarPos({ top: tTop, left: tLeft });
    }
  }, [x, y, items, toolbar]);

  /* position the open submenu next to its parent item — prefers the LEFT
     side (RTL), flips right when the viewport edge is in the way */
  useLayoutEffect(() => {
    if (openSub == null) { setSubPos(null); return; }
    const itemEl = itemRefs.current.get(openSub);
    const subEl = subRef.current;
    if (!itemEl || !subEl) { setSubPos(null); return; }
    const m = 8;
    const gap = 6;
    const ir = itemEl.getBoundingClientRect();
    const sw = subEl.offsetWidth;
    const sh = subEl.offsetHeight;
    let left = ir.left - sw - gap; // RTL: fly out to the left of the menu
    if (left < m) left = ir.right + gap; // flip: not enough room on the left
    left = Math.min(Math.max(m, left), Math.max(m, window.innerWidth - sw - m));
    let top = ir.top - 4;
    top = Math.min(Math.max(m, top), Math.max(m, window.innerHeight - sh - m));
    setSubPos({ top, left });
  }, [openSub, subTick]);

  const cancelClose = () => {
    if (closeTimer.current != null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
  };
  const scheduleClose = (idx: number) => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      setOpenSub((cur) => (cur === idx ? null : cur));
    }, 160);
  };
  useEffect(() => cancelClose, []);

  /* keep a stable copy for the global listeners below */
  const stateRef = useRef({ items, selected, openSub, subSelected });
  stateRef.current = { items, selected, openSub, subSelected };

  /* dismiss + keyboard — one capture-phase listener set, cleaned on unmount */
  useEffect(() => {
    const insideMenu = (t: EventTarget | null): boolean => {
      if (!(t instanceof Node)) return false;
      const el = t as Element;
      /* the floating toolbar belongs to this floating unit; its dropdown
         panels (color palettes / select popovers) are portaled to body —
         exempt them so picking a color doesn't close the whole menu */
      return Boolean(
        ref.current?.contains(t) ||
        subRef.current?.contains(t) ||
        toolbarRef.current?.contains(t) ||
        (typeof el.closest === 'function' &&
          (el.closest('[data-color-palette]') || el.closest('[data-select-popover]'))),
      );
    };

    const onDown = (e: MouseEvent) => {
      if (!insideMenu(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      /* the horizontal toolbar's controls (font-size input, buttons) and its
         dropdown panels consume keys FIRST — arrows/Enter typed in the size
         field must never leak into the menu's keyboard navigation, and
         Escape closes the panel before it closes the menu */
      const kt = e.target;
      if (kt instanceof Element) {
        const inPanel = kt.closest('[data-select-popover]') != null || kt.closest('[data-color-palette]') != null;
        if (inPanel) return;
        const inToolbar = toolbarRef.current?.contains(kt) ?? false;
        if (inToolbar) {
          if (e.key !== 'Escape') return;
          const panelOpen = document.querySelector('[data-select-popover], [data-color-palette]') != null;
          if (panelOpen) return; // panel's own handler closes it; next Esc closes the menu
        }
      }
      const enabledIdxs = (list: MenuItem[]) =>
        list.map((it, i) => (isSelectable(it) ? i : -1)).filter((i) => i >= 0);

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (s.openSub != null) { setOpenSub(null); return; } // submenu first
        onClose();
        return;
      }

      /* ── navigating INSIDE the open submenu ── */
      if (s.openSub != null) {
        const parent = s.items[s.openSub];
        if (parent.kind !== 'submenu') return;
        const idxs = enabledIdxs(parent.items);
        if (!idxs.length) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          setSubSelected((cur) => {
            const at = idxs.indexOf(cur);
            if (at === -1) return e.key === 'ArrowDown' ? idxs[0] : idxs[idxs.length - 1];
            return idxs[(at + (e.key === 'ArrowDown' ? 1 : -1) + idxs.length) % idxs.length];
          });
          return;
        }
        if (e.key === 'ArrowRight') { // RTL "out of" the submenu
          e.preventDefault();
          e.stopPropagation();
          setOpenSub(null);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const it = parent.items[s.subSelected];
          if (it && it.kind === 'action' && !it.disabled) {
            onClose();
            it.run();
          }
        }
        return;
      }

      /* ── navigating the top-level menu ── */
      const idxs = enabledIdxs(s.items);
      if (!idxs.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelected((cur) => {
          const at = idxs.indexOf(cur);
          if (at === -1) return e.key === 'ArrowDown' ? idxs[0] : idxs[idxs.length - 1];
          const next = idxs[(at + (e.key === 'ArrowDown' ? 1 : -1) + idxs.length) % idxs.length];
          /* following the highlight: an open submenu tracks the hovered item */
          setOpenSub(s.items[next]?.kind === 'submenu' ? next : null);
          return next;
        });
        return;
      }
      if (e.key === 'ArrowLeft') { // RTL "into" a submenu
        e.preventDefault();
        e.stopPropagation();
        const it = s.items[s.selected];
        if (it && it.kind === 'submenu' && !it.disabled) {
          setOpenSub(s.selected);
          setSubSelected(idxs2First(it.items));
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const it = s.items[s.selected];
        if (!it) return;
        if (it.kind === 'action' && !it.disabled) { onClose(); it.run(); return; }
        if (it.kind === 'submenu' && !it.disabled) {
          setOpenSub(s.selected);
          setSubSelected(idxs2First(it.items));
        }
      }
    };
    const idxs2First = (list: MenuItem[]) => {
      const first = list.map((it, i) => (isSelectable(it) ? i : -1)).find((i) => i >= 0);
      return first ?? 0;
    };

    /* scrolling the page under a fixed menu leaves it pointing at nothing —
       close (the menu's own inner scroll is contained, so it never hits this) */
    const onWheel = (e: WheelEvent) => {
      if (!insideMenu(e.target)) onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  /* keep the highlighted item visible while navigating with the keyboard */
  useEffect(() => {
    if (selected < 0) return;
    ref.current?.querySelector(`[data-idx="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  useEffect(() => {
    if (openSub == null || subSelected < 0) return;
    subRef.current
      ?.querySelector(`[data-idx="${subSelected}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [subSelected, openSub]);

  if (!items.length) return null;

  const openSubItem = openSub != null ? items[openSub] : null;
  const subItems = openSubItem && openSubItem.kind === 'submenu' ? openSubItem.items : null;

  /* shared item renderer for the main menu and its fly-out */
  const renderItem = (it: MenuItem, i: number, inSub: boolean) => {
    if (it.kind === 'separator') {
      return <div key={it.key} role="separator" className="pn-ctxmenu-sep" onMouseEnter={inSub ? undefined : () => setOpenSub(null)} />;
    }
    if (it.kind === 'swatches') {
      return (
        <div
          key={it.key}
          className="pn-ctxmenu-swatchrow"
          data-selected={!inSub && selected === i}
          onMouseEnter={inSub ? undefined : () => { cancelClose(); setSelected(i); setOpenSub(null); }}
        >
          {it.colors.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              aria-label={c}
              className="pn-ctxmenu-swatchdot"
              style={{ background: c }}
              onClick={() => { onClose(); it.onPick(c); }}
            />
          ))}
        </div>
      );
    }
    const isSub = it.kind === 'submenu';
    const asAction = it as MenuItemAction; // rendering props live on actions only
    return (
      <button
        key={it.key}
        type="button"
        role="menuitem"
        data-idx={i}
        data-selected={!inSub && selected === i}
        data-sub-open={isSub && openSub === i ? 'true' : undefined}
        className={`pn-ctxmenu-item${asAction.danger ? ' danger' : ''}`}
        disabled={it.disabled}
        title={it.title}
        ref={inSub ? undefined : (el) => { if (el) itemRefs.current.set(i, el); else itemRefs.current.delete(i); }}
        onClick={() => {
          if (isSub) {
            const idx = i;
            cancelClose();
            setOpenSub((cur) => (cur === idx ? null : idx)); // touch/click toggle
            return;
          }
          onClose();
          (it as MenuItemAction).run();
        }}
        onMouseEnter={inSub ? undefined : () => {
          cancelClose();
          setSelected(i);
          if (isSub) {
            setOpenSub(i);
            setSubSelected(0);
          } else {
            setOpenSub(null);
          }
        }}
        onMouseLeave={inSub ? undefined : (isSub ? () => scheduleClose(i) : undefined)}
      >
        <span className="pn-ctxmenu-icon">
          {asAction.swatch ? <span className="pn-ctxmenu-swatch" style={{ background: asAction.swatch }} /> : it.icon}
        </span>
        <span className="pn-ctxmenu-label-text">{it.label}</span>
        {asAction.active && <Check className="pn-ctxmenu-check" size={13} strokeWidth={2.5} />}
        {isSub && <ChevronLeft className="pn-ctxmenu-chevron" size={13} strokeWidth={2.25} />}
        {!isSub && it.shortcut && <span className="pn-ctxmenu-kbd">{it.shortcut}</span>}
      </button>
    );
  };

  return createPortal(
    <>
      {toolbar && (
        <div
          ref={toolbarRef}
          className="pn-ctxmenu-toolbar"
          style={toolbarPos ? { top: toolbarPos.top, left: toolbarPos.left } : { top: -9999, left: -9999, visibility: 'hidden' }}
        >
          {toolbar}
        </div>
      )}
      <div
        ref={ref}
        className="pn-ctxmenu"
        role="menu"
        dir="rtl"
        /* keep the editor's focus/selection while clicking menu items —
           cut/copy must act on exactly what was right-clicked */
        onMouseDown={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
        onScroll={() => { if (openSub != null) setSubTick((t) => t + 1); }}
        style={pos ? { top: pos.top, left: pos.left } : { top: y, left: x, visibility: 'hidden' }}
      >
        {items.map((it, i) => renderItem(it, i, false))}
      </div>
      {subItems && (
        <div
          ref={subRef}
          className="pn-ctxmenu pn-ctxmenu-sub"
          role="menu"
          dir="rtl"
          onMouseDown={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
          onMouseEnter={cancelClose}
          onMouseLeave={() => scheduleClose(openSub as number)}
          style={subPos ? { top: subPos.top, left: subPos.left } : { top: -9999, left: -9999, visibility: 'hidden' }}
        >
          {subItems.map((it, i) => renderItem(it, i, true))}
        </div>
      )}
    </>,
    document.body,
  );
}
