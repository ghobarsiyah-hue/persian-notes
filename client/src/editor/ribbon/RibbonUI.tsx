import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, PanelRightClose, UserRound } from 'lucide-react';
import { ColorPalette } from '@/components/editor/ColorPalette';
import { SelectPopover, type SelectPopoverOption } from '@/components/editor/SelectPopover';
import { AccountPanel } from './AccountPanel';
import { BotAvatar } from '@/components/BotAvatar';

/* ────────────────────────────────────────────────────────────────────────
   Ribbon presentational primitives.
   Pure UI: no editor logic lives here — commands come from ribbonCommands
   and are executed by the parent. Designed for Persian RTL, compact heights
   (tab bar ~36px + tool row ~64px) and the app's neutral ink visual system.
   ──────────────────────────────────────────────────────────────────────── */

/** horizontal tab strip — RTL order comes from the tabs array itself */
export function RibbonTabs({
  tabs, active, onChange, trailing,
}: {
  tabs: Array<{ id: string; label: string; icon?: ReactNode; badge?: boolean }>;
  active: string;
  onChange: (id: string) => void;
  trailing?: ReactNode;
}) {
  return (
    <div
      className="flex items-end gap-0.5 overflow-x-auto px-3 pt-1.5"
      style={{ scrollbarWidth: 'none' }}
      role="tablist"
    >
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg px-3.5 pb-2 pt-1.5 text-[12.5px] transition-colors ${
              isActive
                ? 'font-bold text-ink-900 dark:text-ink-100'
                : 'font-medium text-ink-500 hover:bg-ink-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800/70 dark:hover:text-ink-200'
            }`}
          >
            {t.icon}
            {t.label}
            {t.badge && <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden="true" />}
            {isActive && (
              <span
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent-500"
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
      {trailing && <div className="mr-auto flex items-center pb-1.5 ltr:ml-auto">{trailing}</div>}
    </div>
  );
}

/** compact tool group — thin separators between groups, subtle label at the bottom */
export function RibbonGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col items-stretch gap-0.5 px-2 py-1">
      <div className="flex flex-1 flex-wrap items-center justify-center gap-0.5">{children}</div>
      {label && (
        <span className="select-none text-center text-[9px] leading-3 text-ink-400 dark:text-ink-600">
          {label}
        </span>
      )}
    </div>
  );
}

/** thin vertical separator between groups */
export function RibbonSeparator() {
  return <div className="my-1.5 w-px shrink-0 self-stretch bg-ink-200 dark:bg-ink-800" aria-hidden="true" />;
}

const BTN_BASE =
  'flex h-8 min-w-8 select-none items-center justify-center gap-1 rounded-md px-1.5 text-[12px] font-medium transition-[background,color] duration-100 disabled:cursor-not-allowed disabled:opacity-40';

/** compact icon button (32px) with active state + tooltip */
export function RibbonButton({
  icon, label, title, active, disabled, onClick,
}: {
  icon?: ReactNode;
  label?: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={label ?? title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`${BTN_BASE} ${
        active
          ? 'bg-accent-100 text-accent-800 dark:bg-accent-900/40 dark:text-accent-200'
          : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-100'
      }`}
    >
      {icon}
      {label && <span className="whitespace-nowrap">{label}</span>}
    </button>
  );
}

/**
 * Word-style color control: opens the shared in-app palette dropdown
 * (recent colors first — last-used at the top — then theme swatches, then
 * the custom picker pre-set to the last-used color) instead of the bare OS
 * color dialog. The «اخیر» memory is shared with every other color picker
 * in the app via utils/recentColors.
 */
export function RibbonColorButton({
  title, icon, value, onChange,
}: {
  title: string;
  icon: ReactNode;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div ref={ref} className="relative">
      <RibbonButton
        title={title}
        active={open}
        icon={
          <span className="flex flex-col items-center leading-none">
            {icon}
            <span className="mt-0.5 h-[3px] w-3.5 rounded-full border border-black/10" style={{ background: value }} />
          </span>
        }
        onClick={() => setOpen((v) => !v)}
      />
      <ColorPalette
        anchorRef={ref}
        open={open}
        onClose={() => setOpen(false)}
        value={value}
        onPick={onChange}
        onClear={() => { onChange(''); setOpen(false); }}
      />
    </div>
  );
}

/** compact dropdown select (font family / size / border style / …).
 *  Rendered as the familiar bordered box + chevron, but the popup itself is
 *  an IN-APP panel (SelectPopover) instead of a native <select> — OS-drawn
 *  native popups repeatedly failed to open in this app and cannot be
 *  styled, positioned or clamped. The in-app panel behaves exactly like the
 *  color palettes: stays open after picking so several values can be tried,
 *  closes via Escape / click-outside / re-clicking the control. */
export function RibbonSelect({
  title, value, onChange, options, width, buttonWidth,
}: {
  title: string;
  value: string | number;
  onChange: (v: string) => void;
  options: SelectPopoverOption[];
  /** trigger width; the panel is at least this wide */
  width?: number;
  /** trigger width override (defaults to `width`) */
  buttonWidth?: number;
}) {
  return (
    <SelectPopover
      title={title}
      value={value}
      options={options}
      onChange={onChange}
      width={Math.max(width ?? 140, 120)}
      buttonWidth={buttonWidth ?? width}
    />
  );
}

/**
 * Font-size combo input: an editable field that also opens a dropdown
 * with preset sizes. The user can type any value and press Enter/blur,
 * or pick from the dropdown list.
 */
export function FontSizeCombo({
  title, value, onChange, options, width = 64,
}: {
  title: string;
  value: number;
  onChange: (v: number) => void;
  options: Array<{ value: string; label: string }>;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [style, setStyle] = useState<CSSProperties>(() => ({ position: 'fixed', width, top: -9999, right: -9999 }));

  /* sync draft when the editor selection changes externally */
  useEffect(() => { setDraft(String(value)); }, [value]);

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

  /* fixed positioning for the dropdown panel */
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
      let above = spaceBelow < panelH + margin && spaceAbove > spaceBelow;
      if (above && spaceAbove < panelH + margin && spaceBelow >= panelH + margin) above = false;
      else if (!above && spaceBelow < panelH + margin && spaceAbove >= panelH + margin) above = true;
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
  }, [open, width]);

  const commit = () => {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n) && n >= 6 && n <= 96) {
      onChange(n);
    } else {
      setDraft(String(value)); // revert to last valid
    }
  };

  return (
    <div ref={ref} className="relative inline-flex">
      <input
        ref={inputRef}
        type="text"
        title={title}
        aria-label={title}
        value={draft}
        onChange={(e) => {
          /* allow only digits — strip non-numeric chars */
          const raw = e.target.value.replace(/[^0-9]/g, '');
          setDraft(raw);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen((v) => !v)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            inputRef.current?.blur();
          }
        }}
        className={`flex h-8 cursor-text items-center rounded-md border border-ink-200 bg-white px-2 text-center text-[12px] font-medium text-ink-700 outline-none transition-colors hover:border-ink-300 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:hover:border-ink-600 dark:hover:bg-ink-800 ${open ? 'ring-2 ring-[#0070f3]/30' : ''}`}
        style={{ width, direction: 'ltr', textAlign: 'center' }}
      />
      {open && createPortal(
        <div
          ref={panelRef}
          data-select-popover
          dir="rtl"
          role="listbox"
          aria-label={title}
          className="z-[500] max-h-[240px] overflow-y-auto rounded-xl border border-ink-200 pn-glass-panel p-1 shadow-popover dark:border-ink-700 dark:bg-[#1a1a1a]"
          style={{ ...style, animation: 'pn-scale-in 0.1s ease-out' }}
        >
          {options.map((o) => {
            const selected = o.value === String(value);
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(Number(o.value));
                  setDraft(o.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-right text-[12.5px] transition-colors ${
                  selected
                    ? 'bg-accent-50 font-bold text-accent-800 dark:bg-accent-900/40 dark:text-accent-200'
                    : 'font-medium text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800'
                }`}
              >
                <span className="grow truncate text-center" dir="ltr">{o.label}</span>
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

interface PanelGeometry {
  top: number;
  right: number | null;
  left: number | null;
}

/**
 * Compute a fixed-position geometry for a dropdown panel anchored to
 * `anchor`: aligned to the anchor's right edge (RTL), then CLAMPED so the
 * panel is always fully inside the viewport — even when the anchor button is
 * half-scrolled out of the tool row (the row is overflow-x-auto, and a
 * clipped anchor used to produce panels rendering off-screen).
 */
function computePanelGeometry(anchor: HTMLElement, width: number): PanelGeometry {
  const rect = anchor.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const margin = 8;
  // desired: panel's right edge == anchor's right edge
  let left = rect.right - width;
  // clamp both edges
  left = Math.max(margin, Math.min(left, viewportW - width - margin));
  return { top: Math.max(margin, rect.bottom + 6), right: viewportW - left - width, left: null };
}

/**
 * Shared panel geometry hook: measures on open and KEEPS the panel anchored
 * while the tool row scrolls or the window resizes (previously a scrolled
 * ribbon left the panel floating in the wrong place, or off-screen).
 */
function usePanelGeometry(ref: RefObject<HTMLElement | null>, open: boolean, width: number) {
  const [geom, setGeom] = useState<PanelGeometry | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setGeom(null);
      return;
    }
    if (ref.current) setGeom(computePanelGeometry(ref.current, width));
    const reposition = () => { if (ref.current) setGeom(computePanelGeometry(ref.current, width)); };
    window.addEventListener('resize', reposition);
    // capture: catches horizontal scrolls of the tool row too
    document.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
    };
  }, [open, width, ref]);

  return geom;
}

/* ── open-panel registry ───────────────────────────────────────────────
   The contextual-ribbon resolver auto-switches the active tab when the
   selection's object family changes. That is correct for plain clicks but
   fatal for open modals: editing a symbol inside the equation surface (or
   any toolbar interaction that moves the selection) must NEVER unmount an
   open panel. Any host with an open panel registers itself here; the
   Ribbon defers context auto-switching while the set is non-empty. Panels
   close via their own toggle button, Escape, or a direct click on a
   different ribbon tab — as Word behaves. */
const openPanels = new Map<symbol, { live: boolean }>();
const panelListeners = new Set<() => void>();

/** true while ANY ribbon/contextual panel is open (anywhere in the app) */
export function anyPanelOpen(): boolean {
  return openPanels.size > 0;
}

/** true while at least one LIVE panel is open — and (equivalently) no panel
 *  NEEDS the context freeze: live panels (object formatting) re-render from
 *  the current selection on every change, so an open set containing only
 *  live panels must NOT freeze the resolved context. The registry tracks the
 *  panel kinds so the resolver can distinguish them. */
export function livePanelOpen(): boolean {
  for (const p of openPanels.values()) if (p.live) return true;
  return false;
}

/** a non-live panel is open → the context freeze the resolver applies stays
 *  active (equation pickers etc. — the original reason the freeze exists) */
export function nonLivePanelOpen(): boolean {
  for (const p of openPanels.values()) if (!p.live) return true;
  return false;
}

/** subscribe to open/close transitions (used to re-run deferral effects) */
export function subscribePanels(listener: () => void): () => void {
  panelListeners.add(listener);
  return () => { panelListeners.delete(listener); };
}

function registerPanel(live: boolean): symbol {
  const token = Symbol('panel');
  openPanels.set(token, { live });
  panelListeners.forEach((l) => l());
  return token;
}

function unregisterPanel(token: symbol) {
  if (openPanels.delete(token)) panelListeners.forEach((l) => l());
}

/** register/unregister an open panel in the shared registry (see above).
 *  `live` marks formatting panels that always render fresh selection state —
 *  see livePanelOpen(). */
export function usePanelOpenToken(open: boolean, live = false) {
  const tokenRef = useRef<symbol | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  useEffect(() => {
    if (open) {
      if (!tokenRef.current) tokenRef.current = registerPanel(liveRef.current);
    } else if (tokenRef.current) {
      unregisterPanel(tokenRef.current);
      tokenRef.current = null;
    }
    return () => {
      if (tokenRef.current) {
        unregisterPanel(tokenRef.current);
        tokenRef.current = null;
      }
    };
  }, [open]);
}

/** generic click-outside dropdown host with fixed positioning (clip-proof) */
function DropdownHost({ button, children, width = 220 }: { button: RibbonButtonProps; children: ReactNode; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const geom = usePanelGeometry(ref, open, width);
  usePanelOpenToken(open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const panelStyle: CSSProperties | undefined = open
    ? geom
      ? { top: geom.top, position: 'fixed', width, ...(geom.right !== null ? { right: geom.right } : { left: geom.left ?? 8 }) }
      : { top: -9999, right: -9999, position: 'fixed', width } // first paint before geometry is measured
    : undefined;

  return (
    <div ref={ref} className="relative">
      <RibbonButton {...button} active={button.active || open} onClick={() => setOpen((v) => !v)} />
      {open && createPortal(
        <div ref={panelRef} dir="rtl" className="z-[300] max-h-[70vh] overflow-y-auto rounded-xl border border-ink-200 pn-glass-panel p-1.5 shadow-popover dark:border-ink-700 dark:bg-[#1a1a1a]"  
          style={{ ...panelStyle, animation: 'pn-scale-in 0.1s ease-out' }}
          onClick={(e) => {
            /* sections marked data-keep-open (e.g. color palettes) survive
               clicks so the user can try several colors without reopening */
            if (!(e.target as HTMLElement).closest('[data-keep-open]')) setOpen(false);
          }}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  );
}

interface RibbonButtonProps {
  icon?: ReactNode;
  label?: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

/** dropdown wrapper: renders a RibbonButton that opens a small panel */
export function RibbonDropdown({ button, children, width }: { button: RibbonButtonProps; children: ReactNode; width?: number }) {
  /* width must be forwarded — it used to be dropped, so every dropdown
     rendered at the 220px default and cramped pickers (آیکون، نوع صفحه) */
  return <DropdownHost button={button} width={width}>{children}</DropdownHost>;
}

/** generic open-state host for custom dropdown panels (e.g. جستجو و جایگزینی) */
export function RibbonPanel({
  button, children, width, open, onOpen, onClose,
}: {
  button: RibbonButtonProps;
  children: ReactNode;
  width?: number;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const w = width ?? 220;
  const panelRef = useRef<HTMLDivElement>(null);
  const geom = usePanelGeometry(ref, open, w);
  usePanelOpenToken(open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !panelRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('mousedown', onDown); };
  }, [open, onClose]);

  const panelStyle: CSSProperties | undefined = open
    ? geom
      ? { top: geom.top, position: 'fixed', width: w, ...(geom.right !== null ? { right: geom.right } : { left: geom.left ?? 8 }) }
      : { top: -9999, right: -9999, position: 'fixed', width: w } // first paint before geometry is measured
    : undefined;

  return (
    <div ref={ref} className="relative">
      <RibbonButton {...button} active={button.active || open} onClick={() => (open ? onClose() : onOpen())} />
      {open && createPortal(
        <div ref={panelRef} dir="rtl"
          className="z-[300] rounded-xl border border-ink-200 pn-glass-panel p-1.5 shadow-popover dark:border-ink-700 dark:bg-[#1a1a1a]"
          style={{ ...panelStyle, animation: 'pn-scale-in 0.1s ease-out' }}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  );
}

export function RibbonMenuSection({ label }: { label: string }) {
  return <div className="px-2.5 pb-0.5 pt-2 text-[9px] font-bold uppercase tracking-widest text-ink-300 dark:text-ink-600">{label}</div>;
}

export function RibbonMenuItem({ icon, label, hint, active, disabled, onClick }: { icon?: ReactNode; label: string; hint?: string; active?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-right text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'bg-accent-50 font-bold text-accent-700 dark:bg-accent-500/10 dark:text-accent-300'
          : 'text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800'
      }`}
    >
      {icon && <span className="flex h-6 w-6 shrink-0 items-center justify-center text-ink-500 dark:text-ink-400">{icon}</span>}
      <span className="grow font-medium">{label}</span>
      {hint && <span className="shrink-0 text-[10px] tabular-nums text-ink-400">{hint}</span>}
      {active && <Check className="h-3.5 w-3.5 shrink-0 text-accent-600 dark:text-accent-400" />}
    </button>
  );
}

export function RibbonMenuDivider() {
  return <div className="my-1 h-px bg-ink-100 dark:bg-ink-800" aria-hidden="true" />;
}

/**
 * «بیشتر» (…) menu — hosts rarely-used commands so they never consume
 * permanent ribbon space.
 */
export function RibbonMoreMenu({ items }: { items: RibbonButtonProps[] }) {
  return (
    <RibbonDropdown
      button={{ icon: <span className="tracking-widest">⋯</span>, title: 'بیشتر' }}
      width={200}
    >
      {items.map((it) => (
        <RibbonMenuItem key={it.title} label={it.title} icon={it.icon} onClick={it.onClick} />
      ))}
    </RibbonDropdown>
  );
}

/**
 * فایل menu — opens downward from its tab-like button; a document menu,
 * not a formatting tool row.
 */
export function FileMenu({ items, open, onToggle, onClose }: {
  items: ReactNode;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const FILE_W = 240;
  const panelRef = useRef<HTMLDivElement>(null);
  const geom = usePanelGeometry(ref, open, FILE_W);
  usePanelOpenToken(open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !panelRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  const panelStyle: CSSProperties | undefined = open
    ? geom
      ? { top: geom.top, position: 'fixed', width: FILE_W, ...(geom.right !== null ? { right: geom.right } : { left: geom.left ?? 8 }) }
      : { top: -9999, right: -9999, position: 'fixed', width: FILE_W } // first paint before geometry is measured
    : undefined;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`flex h-7 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-bold transition-colors ${
          open
            ? 'bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900'
            : 'bg-ink-100 text-ink-800 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-100 dark:hover:bg-ink-700'
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
        فایل
      </button>
      {open && createPortal(
        <div ref={panelRef} dir="rtl" className="z-[300] max-h-[70vh] overflow-y-auto rounded-xl border border-ink-200 pn-glass-panel p-1.5 shadow-popover dark:border-ink-700 dark:bg-[#1a1a1a]"  
          style={{ ...panelStyle, animation: 'pn-scale-in 0.1s ease-out' }}
          onClick={onClose}
        >
          {items}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** contextual tab chip (ابزار جدول / ابزار تصویر / ابزار لینک) — clickable */
export function RibbonContextualTab({ label, icon, onClick }: { label: string; icon?: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="رفتن به ابزارها"
      className="relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg bg-accent-50 px-3 pb-2 pt-1.5 text-[12.5px] font-bold text-accent-800 dark:bg-accent-900/30 dark:text-accent-200"
    >
      {icon}
      {label}
      <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent-500" aria-hidden="true" />
    </button>
  );
}

/**
 * AccountChip — the signed-in user's avatar, circular, sitting beside the
 * فایل menu in the editor. Monochrome ring states (documented in the Wiki):
 *  - default:   hairline ring (0 0 0 1px @ 8% black)
 *  - hover:     2px neutral ring + opens the account menu
 *  - focus:     the app's standard focus ring (accent, keyboard only)
 *  - online:    a small petrol dot; offline turns red (same indicator the
 *               sidebar uses) — no color beyond the existing system
 */
export function AccountChip({
  name, email, avatar, online, onOpen, avatarPreset,
}: {
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
  online: boolean;
  onOpen: () => void;
  /** the user's chosen fallback-avatar preset (settings.avatarPreset) */
  avatarPreset?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  /* matches AccountPanel's own w-64 — a narrower wrapper here clipped the
     identity header and menu rows (content spilled out of the box) */
  const W = 264;
  const geom = usePanelGeometry(ref, open, W);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const panelStyle: CSSProperties | undefined = open
    ? geom
      ? { top: geom.top, position: 'fixed', width: W, ...(geom.right !== null ? { right: geom.right } : { left: geom.left ?? 8 }) }
      : { top: -9999, right: -9999, position: 'fixed', width: W }
    : undefined;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`حساب کاربری: ${name ?? ''}`}
        title={name ?? ''}
        onClick={() => setOpen((v) => !v)}
        className="group relative flex h-7 w-7 items-center justify-center rounded-full p-[2px] transition-[box-shadow] duration-100 focus-visible:shadow-focus hover:shadow-ring-strong"
      >
        <span
          className="flex h-full w-full items-center justify-center overflow-hidden rounded-full"
          aria-hidden="true"
        >
          {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <BotAvatar name={name} preset={avatarPreset} className="h-full w-full" />}
        </span>
        <span
          aria-hidden="true"
          className={`absolute -bottom-0.5 -left-0.5 h-2 w-2 rounded-full ring-2 ring-white dark:ring-[#1a1a1a] ${online ? 'bg-[#0070f3]' : 'bg-[#ff5b4f]'}`}
        />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          dir="rtl"
          role="menu"
          aria-label="منوی حساب"
          className="z-[300] overflow-hidden rounded-xl border border-ink-200 pn-glass-panel shadow-popover dark:border-ink-700 dark:bg-[#1a1a1a]"
          style={{ ...panelStyle, animation: 'pn-scale-in 0.1s ease-out' }}
          onClick={() => setOpen(false)}
        >
          <AccountPanel onNavigate={() => { setOpen(false); onOpen(); }} />
        </div>,
        document.body,
      )}
    </div>
  );
}

/** collapse/expand toggle for the right sidebar — sits at the far-left of the tab strip */
export function SidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={open ? 'بستن پنل کناری' : 'باز کردن پنل کناری'}
      aria-label={open ? 'بستن پنل کناری' : 'باز کردن پنل کناری'}
      aria-expanded={open}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-500 transition-[background,color] duration-100 hover:bg-ink-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-200"
    >
      <PanelRightClose className={`h-4 w-4 transition-transform duration-150 ${open ? '' : 'rotate-180'}`} />
    </button>
  );
}
