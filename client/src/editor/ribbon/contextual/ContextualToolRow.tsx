import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { RibbonGroup, RibbonSeparator, RibbonButton, usePanelOpenToken } from '@/editor/ribbon/RibbonUI';
import type { ContextualTab, ContextualTool } from './types';

/* ══════════════════════════════════════════════════════════════════════════
   ContextualToolRow — renders one resolved contextual tab's groups with the
   SAME visual primitives as the standard tool rows (RibbonGroup/Button/
   Separator), so contextual tabs are visually native to the app. Rendering
   only — every tool carries its own run() against the resolved selection.

   Dropdown tools open an in-app panel anchored below the button, clamped to
   the viewport. PERSISTENT panels (equation symbols/structures) do NOT
   close on outside clicks — Word-style: pick a fraction, click into the
   formula, pick a radical, keep editing. They close only via the toggle
   button, Escape, or when the tab/selection changes. The panel content
   re-renders live (React state survives), so pickers reflect fresh state.
   ══════════════════════════════════════════════════════════════════════════ */

export function ContextualToolRow({ tab }: { tab: ContextualTab }) {
  return (
    <>
      {tab.groups.map((g, gi) => (
        <span key={g.key} className="contents">
          {gi > 0 && <RibbonSeparator />}
          <RibbonGroup label={g.label}>
            {g.tools.map((t) => (
              <ToolButton key={t.key} tool={t} />
            ))}
          </RibbonGroup>
        </span>
      ))}
    </>
  );
}

function ToolButton({ tool }: { tool: ContextualTool }) {
  if ('separator' in tool) return <RibbonSeparator />;
  if ('dropdown' in tool) return <DropdownButton tool={tool} />;
  return (
    <RibbonButton
      title={tool.title}
      icon={tool.icon}
      label={tool.label}
      active={tool.active}
      disabled={tool.disabled}
      onClick={tool.run}
    />
  );
}

/** panel geometry: below the anchor, right-aligned (RTL), viewport-clamped */
function computeGeom(anchor: HTMLElement, width: number) {
  const rect = anchor.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const margin = 8;
  let left = rect.right - width;
  left = Math.max(margin, Math.min(left, viewportW - width - margin));
  return { top: Math.max(margin, rect.bottom + 6), left };
}

function DropdownButton({ tool }: { tool: Extract<ContextualTool, { dropdown: unknown }> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<{ top: number; left: number } | null>(null);
  const persistent = (tool.dropdown as { persistent?: boolean }).persistent === true;
  /* live formatting panels re-render from the CURRENT selection — they must
     not freeze the resolved context while open (§2/§3 root cause). The flag
     travels to the open-panel registry so the resolver can exempt them. */
  const live = (tool.dropdown as { live?: boolean }).live === true;
  /* an open picker registers in the ribbon's open-panel registry so the
     context resolver never auto-switches the tab (and unmounts us) while
     the user inserts symbol after symbol */
  usePanelOpenToken(open, live);

  useLayoutEffect(() => {
    if (!open) { setGeom(null); return; }
    if (ref.current) setGeom(computeGeom(ref.current, tool.dropdown.width));
    const reposition = () => { if (ref.current) setGeom(computeGeom(ref.current, tool.dropdown.width)); };
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
    };
  }, [open, tool.dropdown.width]);

  useEffect(() => {
    if (!open) return;
    /* persistent panels ignore outside clicks — only Escape closes them
       (and the toggle button / tab switch below). Clicks INSIDE the math
       surface also keep the panel open: editing the equation between picks
       is the whole point of persistent pickers (10–20 symbols in a row). */
    const onDown = persistent ? null : (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !panelRef.current?.contains(t) && !t.closest('[data-keep-open]') && !t.closest('.mq-equation')) setOpen(false);
    };
    /* persistent panels still reposition themselves while open — and their
       anchor may scroll away with the page, so keep the geometry live */
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    if (onDown) document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      if (onDown) document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, persistent]);

  const panelStyle: CSSProperties | undefined = open
    ? geom
      ? { top: geom.top, left: geom.left, position: 'fixed', width: tool.dropdown.width }
      : { top: -9999, left: -9999, position: 'fixed', width: tool.dropdown.width }
    : undefined;

  return (
    <div ref={ref} className="relative">
      <RibbonButton
        title={tool.title}
        icon={tool.icon}
        label={tool.label}
        active={open}
        disabled={tool.disabled}
        onClick={() => setOpen((v) => !v)}
      />
      {open && createPortal(
        <div ref={panelRef} dir="rtl" data-keep-open
          className="mq-picker-panel z-[300] max-h-[70vh] overflow-y-auto rounded-xl border border-ink-200 bg-white p-1.5 shadow-popover dark:border-ink-700 dark:bg-[#1a1a1a]"
          style={{ ...panelStyle, animation: 'pn-scale-in 0.1s ease-out' }}
        >
          {tool.dropdown.render(() => setOpen(false))}
        </div>,
        document.body,
      )}
    </div>
  );
}
