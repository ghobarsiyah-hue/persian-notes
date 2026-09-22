import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * LeftDock — the ONE docked overlay on the editor's left side (RTL page:
 * the right column is the sheet workspace, the left side hosts secondary
 * panels). Both the AI result flow and the print/PDF preview dock here so
 * they feel like the same surface: a full-height column next to the sheets
 * with a quiet header and its content — no center-modal wall, no cards.
 *
 * Shell only: header (title + close), optional actions row, body.
 */
export function LeftDock({
  open,
  onClose,
  title,
  subtitle,
  actions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** one-line context under the title (e.g. page count / action label) */
  subtitle?: string;
  /** right-aligned action cluster in the header (primary export buttons) */
  actions?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-y-0 left-0 z-40 flex w-[min(480px,92vw)] flex-col border-l border-ink-100 bg-white dark:border-ink-800 dark:bg-[#141414]"
      style={{ animation: 'pn-dock-in 0.18s ease-out', boxShadow: '8px 0 24px rgba(0,0,0,0.10)' }}
      role="complementary"
      aria-label={title}
    >
      {/* header — title + subtitle on one side, actions on the other */}
      <div className="shrink-0 border-b border-ink-100 px-4 py-3 dark:border-ink-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-bold tracking-[-0.01em] text-ink-900 dark:text-ink-100">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-[11.5px] text-ink-500 dark:text-ink-400">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {actions}
            <button
              type="button"
              onClick={onClose}
              aria-label="بستن"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800 dark:hover:text-ink-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* body — scrollable panel content */}
      <div className="grow overflow-y-auto overscroll-behavior-contain">{children}</div>
    </div>
  );
}
