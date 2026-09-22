import {
  useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type ReactNode, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { loadRecentColors, rememberColor } from '@/utils/recentColors';

/* theme palette — the same swatches the Ribbon color buttons always offered */
const THEME_COLORS = [
  '#171717', '#4b5563', '#9ca3af', '#ffffff',
  '#b91c1c', '#ea580c', '#d97706', '#ca8a04',
  '#1f7396', '#175e7d', '#2563eb', '#7c3aed',
  '#db2777', '#e11d48', '#0ea5e9', '#114b64',
];

/**
 * Shared color-palette popover — the ONE color menu used everywhere
 * (Ribbon color buttons AND the floating-layer properties bar).
 *
 * Sections, in order:
 *  1. «اخیر» — recently used colors (shared memory, last-used first), so the
 *     color you used before is always the default suggestion at the top.
 *  2. «رنگ‌ها» — fixed theme palette.
 *  3. «رنگ دلخواه…» — OS custom picker, opens pre-set to the last-used color.
 *  4. optional clear row (حذف رنگ / شفاف / پیش‌فرض …).
 *
 * The panel stays open after picking so several colors can be tried without
 * reopening; Escape / click-outside closes it. `placement` hints which side
 * of the anchor opens toward the viewport interior: 'top' opens ABOVE the
 * anchor (needed for the props bar pinned to the bottom of the screen),
 * 'bottom' below, 'auto' picks whichever side actually fits.
 *
 * The panel is rendered through a PORTAL into document.body: some hosts
 * (the floating props bar used `transform` for centering; pages live under
 * a CSS `zoom` wrapper) turn `position: fixed` children into coordinates
 * relative to THAT ancestor, which threw the panel far off-screen — the
 * menu "never opened". Portaling keeps every coordinate viewport-based.
 * The root also carries `data-color-palette` so outside-click handlers
 * (e.g. the floating layer's deselect-on-mousedown) can ignore it.
 */
export function ColorPalette({
  anchorRef, open, onClose, value, onPick,
  onClear, clearLabel = 'حذف رنگ', clearIcon,
  placement = 'auto', width = 208,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** current effective color (used for the highlight ring); '' allowed */
  value: string;
  onPick: (c: string) => void;
  onClear?: () => void;
  clearLabel?: string;
  clearIcon?: ReactNode;
  placement?: 'bottom' | 'top' | 'auto';
  width?: number;
}) {
  const [recent, setRecent] = useState<string[]>(loadRecentColors);
  const [style, setStyle] = useState<CSSProperties>(() => ({ position: 'fixed', width, top: -9999, right: -9999 }));
  const panelRef = useRef<HTMLDivElement>(null);

  /* re-read the SHARED recents every time the menu opens — another picker
     may have written to localStorage since this one mounted */
  useEffect(() => {
    if (open) setRecent(loadRecentColors());
  }, [open]);

  /* click-outside + Escape */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchorRef, onClose]);

  /* fixed positioning clamped to the viewport; follows tool-row scroll.
     The panel mounts together with this effect (off-screen first paint),
     so its measured height is available before the browser paints. */
  useLayoutEffect(() => {
    if (!open) return;
    const compute = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const margin = 8;
      const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
      const panelH = panelRef.current?.offsetHeight ?? 0;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      /* pick the side: explicit hint first, then fall back to whichever
         side actually fits so the panel can never open off-screen */
      let above = placement === 'top';
      if (placement === 'auto' && panelH > 0) {
        above = spaceBelow < panelH + margin && spaceAbove > spaceBelow;
      }
      if (panelH > 0) {
        if (above && spaceAbove < panelH + margin && spaceBelow >= panelH + margin) above = false;
        else if (!above && spaceBelow < panelH + margin && spaceAbove >= panelH + margin) above = true;
      }

      setStyle(above
        ? { position: 'fixed', width, left, bottom: Math.max(margin, window.innerHeight - rect.top + 6) }
        : { position: 'fixed', width, left, top: Math.max(margin, Math.min(rect.bottom + 6, window.innerHeight - panelH - margin)) },
      );
    };
    compute();
    window.addEventListener('resize', compute);
    document.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      document.removeEventListener('scroll', compute, true);
    };
  }, [open, width, placement, anchorRef]);

  if (!open) return null;

  const pick = (c: string) => {
    setRecent(rememberColor(c));
    onPick(c);
  };

  const swatch = (c: string, key: string) => (
    <button
      key={key}
      type="button"
      title={c}
      aria-label={c}
      onClick={() => pick(c)}
      className={`h-6 w-6 rounded-md border transition-transform hover:scale-110 ${
        value.toLowerCase() === c.toLowerCase()
          ? 'border-accent-500 ring-2 ring-accent-500/40'
          : 'border-ink-200 dark:border-ink-700'
      }`}
      style={{ background: c }}
    />
  );

  /* the OS custom dialog opens pre-set to the last-used color when the
     selection itself has none — the "default suggestion" */
  const customDefault = value || recent[0] || THEME_COLORS[0];

  return createPortal(
    <div
      ref={panelRef}
      data-color-palette
      className="z-[500] rounded-xl border border-ink-200 pn-glass-panel p-2.5 shadow-popover dark:border-ink-700 dark:bg-[#1a1a1a]"
      style={{ ...style, animation: 'pn-scale-in 0.1s ease-out' }}
    >
      {recent.length > 0 && (
        <>
          <div className="mb-1 px-0.5 text-[9px] font-bold uppercase tracking-widest text-ink-400">اخیر</div>
          {/* RTL grid: recent[0] — the last-used color — renders first (top-right) */}
          <div className="grid grid-cols-8 gap-1">{recent.map((c) => swatch(c, `recent-${c}`))}</div>
          <div className="mb-1 mt-2.5 px-0.5 text-[9px] font-bold uppercase tracking-widest text-ink-400">رنگ‌ها</div>
        </>
      )}
      {recent.length === 0 && (
        <div className="mb-1 px-0.5 text-[9px] font-bold uppercase tracking-widest text-ink-400">رنگ‌ها</div>
      )}
      <div className="grid grid-cols-8 gap-1">{THEME_COLORS.map((c) => swatch(c, c))}</div>
      <label className="mt-2.5 flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-[12px] font-medium text-ink-700 transition-colors hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800">
        <span
          className="h-5 w-5 rounded-md border border-ink-200 dark:border-ink-700"
          style={{ background: customDefault }}
        />
        رنگ دلخواه…
        <input
          type="color"
          className="sr-only"
          value={customDefault}
          onChange={(e) => pick(e.target.value)}
        />
      </label>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-0.5 flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-[12px] font-medium text-ink-700 transition-colors hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800"
        >
          {clearIcon ?? (
            <span className="flex h-5 w-5 items-center justify-center rounded-md border border-ink-200 text-[11px] text-ink-400 dark:border-ink-700">⃠</span>
          )}
          {clearLabel}
        </button>
      )}
    </div>,
    document.body,
  );
}
