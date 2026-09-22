import {
  useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────
   SelectPopover — in-app replacement for native <select> dropdowns.

   WHY: native select popups are drawn by the OS — the app cannot style,
   position or clamp them, and in this project they repeatedly failed to
   open (they also render inconsistently under the CSS-zoom page wrapper).
   Every dropdown that must "just work" is now an in-app panel, exactly
   like the color palette:

   - renders through a PORTAL into document.body → immune to transformed
     or CSS-zoomed ancestors, never clipped by the ribbon's scroll row;
   - fixed-position geometry clamped to the viewport with automatic
     flip-up ('auto') so the panel can never open off-screen;
   - click-outside / Escape / re-clicking the trigger closes it;
   - stays open after picking (keepOpen) so several values can be tried
     in a row — the same UX as the color palette;
   - keyboard support: ↑/↓ move focus, Enter/Space pick, Esc closes.

   The root carries `data-select-popover` so outside-click handlers
   (e.g. the floating layer's deselect-on-mousedown) can ignore it.
   ──────────────────────────────────────────────────────────────────────── */

export interface SelectPopoverOption {
  value: string;
  label: ReactNode;
  /** optional inline style for the row (e.g. render each font in its own face) */
  style?: CSSProperties;
}

const DEFAULT_TRIGGER =
  'flex h-8 cursor-pointer select-none items-center justify-between gap-1 rounded-md border border-ink-200 bg-white px-2 text-[12px] font-medium text-ink-700 outline-none transition-colors hover:border-ink-300 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:hover:border-ink-600 dark:hover:bg-ink-800';

export function SelectPopover({
  title,
  value,
  options,
  onChange,
  width = 180,
  buttonWidth,
  buttonClassName = DEFAULT_TRIGGER,
  placement = 'auto',
  keepOpen = true,
  disabled = false,
}: {
  title: string;
  /** current value (string or number) */
  value: string | number;
  options: SelectPopoverOption[];
  onChange: (v: string) => void;
  /** panel width */
  width?: number;
  /** closed-trigger width (defaults to auto) */
  buttonWidth?: number;
  buttonClassName?: string;
  placement?: 'bottom' | 'top' | 'auto';
  /** keep the panel open after picking — like the color palette */
  keepOpen?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(() => ({ position: 'fixed', width, top: -9999, right: -9999 }));

  const current = options.find((o) => o.value === String(value));

  /* click-outside + Escape */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /* fixed positioning clamped to the viewport, with flip support; follows
     scroll (the ribbon tool row is overflow-x-auto) and resize. The panel
     mounts together with this effect (off-screen first paint), so its
     measured height is available before the browser paints. */
  useLayoutEffect(() => {
    if (!open) return;
    const compute = () => {
      const anchor = ref.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const margin = 8;
      const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
      const panelH = panelRef.current?.offsetHeight ?? 0;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      /* pick the side: explicit hint first, then whichever side fits */
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
  }, [open, width, placement]);

  /* focus the selected row when the panel opens (keyboard support) */
  useLayoutEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector<HTMLButtonElement>('[data-selected="true"]')
      ?.focus({ preventScroll: true });
  }, [open]);

  const moveFocus = (dir: 1 | -1) => {
    const buttons = panelRef.current?.querySelectorAll<HTMLButtonElement>('[data-opt]');
    if (!buttons || buttons.length === 0) return;
    const list = Array.from(buttons);
    const idx = list.indexOf(document.activeElement as HTMLButtonElement);
    (list[(idx + dir + list.length) % list.length] ?? list[0]).focus({ preventScroll: true });
  };

  const pick = (v: string) => {
    onChange(v);
    if (!keepOpen) setOpen(false);
  };

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={buttonWidth ? { width: buttonWidth } : undefined}
        className={`${buttonClassName} ${open ? 'ring-2 ring-[#0070f3]/30' : ''}`}
      >
        <span className="truncate">{current?.label ?? String(value)}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          data-select-popover
          dir="rtl"
          role="listbox"
          aria-label={title}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
          }}
          className="z-[500] max-h-[60vh] overflow-y-auto rounded-xl border border-ink-200 pn-glass-panel p-1 shadow-popover dark:border-ink-700 dark:bg-[#1a1a1a]"
          style={{ ...style, animation: 'pn-scale-in 0.1s ease-out' }}
        >
          {options.map((o) => {
            const selected = o.value === String(value);
            return (
              <button
                key={o.value}
                type="button"
                data-opt
                data-selected={selected || undefined}
                role="option"
                aria-selected={selected}
                onClick={() => pick(o.value)}
                style={o.style}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-right text-[12.5px] transition-colors ${
                  selected
                    ? 'bg-accent-50 font-bold text-accent-800 dark:bg-accent-900/40 dark:text-accent-200'
                    : 'font-medium text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800'
                }`}
              >
                <span className="grow truncate">{o.label}</span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
