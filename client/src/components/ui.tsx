import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useApp } from '@/store/AppProvider';

/* =============================================================
   Vercel-inspired design system primitives for the Persian notes app.
   RTL + Vazirmatn kept. Animations, glass morphism, and improved spacing.
   ============================================================= */

const BTN =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium ' +
  'transition-[box-shadow,opacity,transform] duration-100 focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]';

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}) {
  const sizes: Record<string, string> = {
    sm: 'px-2.5 h-8 text-xs',
    md: 'px-4 h-9 text-sm',
  };
  const variants: Record<string, string> = {
    primary:
      'bg-ink-900 text-white pn-shadow-border hover:bg-ink-700 dark:bg-white dark:text-ink-900 dark:hover:bg-gray-200',
    secondary:
      'pn-glass-panel text-ink-900 pn-shadow-border hover:bg-white/70 dark:text-ink-100 dark:hover:bg-white/10',
    ghost:
      'text-ink-600 hover:bg-gray-100 hover:text-ink-900 dark:text-gray-400 dark:hover:bg-[#222]',
    danger:
      'bg-white text-red-600 pn-shadow-border hover:bg-red-50 dark:bg-[#1a1a1a] dark:text-red-400 dark:hover:bg-red-950',
  };
  return <button type="button" className={`${BTN} ${sizes[size]} ${variants[variant]} ${className}`} {...props} />;
}


export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      role="status"
      aria-label="در حال بارگذاری"
    />
  );
}

export function ButtonWithSpinner({ loading, children, ...props }: { loading: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button disabled={props.disabled || loading} {...props}>
      {loading && <Spinner />}
      {children}
    </Button>
  );
}

const FIELD =
  'w-full min-h-10 rounded-lg px-3 text-sm bg-white pn-shadow-input ' +
  'transition-[box-shadow] duration-100 focus-visible:pn-shadow-input-focus focus-visible:bg-white ' +
  'placeholder:text-gray-400 ' +
  'dark:bg-[#111] dark:text-gray-200 dark:placeholder:text-gray-600';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const { label, className = '', ...rest } = props;
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-ink-700 dark:text-ink-300">{label}</span>}
      <input className={`${FIELD} ${className}`} autoComplete="off" {...rest} />
    </label>
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const { label, className = '', ...rest } = props;
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-ink-700 dark:text-ink-300">{label}</span>}
      <select className={`${FIELD} cursor-pointer ${className}`} {...rest} />
    </label>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-700 dark:text-ink-300">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-500 dark:text-ink-400">{hint}</span>}
      {error && <span role="alert" className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span>}
    </label>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ship' | 'develop' | 'preview' }) {
  const tones: Record<string, string> = {
    neutral: 'bg-gray-100 text-gray-600 dark:bg-[#222] dark:text-gray-400',
    ship: 'bg-red-50 text-red-500 dark:bg-red-950 dark:text-red-400',
    develop: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
    preview: 'bg-pink-50 text-pink-500 dark:bg-pink-950 dark:text-pink-400',
  };
  return <span      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Card({ children, className = '', interactive = false, padded = true }: { children: ReactNode; className?: string; interactive?: boolean; padded?: boolean }) {
  return (
    <div
      className={`rounded-xl pn-shadow-card ${interactive ? 'transition-[box-shadow,transform] duration-150 hover:translate-y-[-1px]' : ''} ${padded ? 'p-4' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

export function Skeleton({ className = 'h-4' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-200 dark:bg-[#222] ${className}`} aria-hidden="true" />;
}

export function PageTitle({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 grow">
        <h1 className="text-xl font-extrabold tracking-tight text-ink-900 dark:text-ink-100">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  /* PORTAL to document.body — WITHOUT it a parent with `backdrop-filter`
     (the ribbon's pn-glass-panel, sidebars, cards…) becomes the containing
     block for position:fixed children, trapping the dialog inside that
     parent's box (the "modal opens squashed inside the ribbon" bug).
     Portalling skips every such ancestor; z-500 tops the ribbon panels. */
  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ animation: 'pn-fade-in 0.15s ease-out' }}
    >
      {/* آیتم ۱۰: مودال‌ها به حالت مات (سطح توپر) برگشتند — بدون شیشه */}
      <div
        className={`flex max-h-[90vh] w-full flex-col rounded-xl bg-white dark:bg-[#1a1a1a] ${wide ? 'max-w-4xl' : 'max-w-lg'} pn-shadow-popover`}
        style={{ animation: 'pn-scale-in 0.15s ease-out' }}
      >
        <div className="flex items-center justify-between px-6 py-4" style={{ boxShadow: 'inset 0 -1px 0 0 rgba(0,0,0,0.06)' }}>
          <h2 className="text-base font-bold text-ink-900 dark:text-ink-100">{title}</h2>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors" aria-label="بستن">
            ✕
          </button>
        </div>
        <div className="grow overflow-y-auto overscroll-behavior-contain p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** ── SidePanel — the Canva-style contextual panel (الگوی «رولی از چپ») ──
 *  A NON-MODAL editing surface that slides in from the LEFT edge. Unlike
 *  Modal there is NO backdrop and nothing is blocked: the editor underneath
 *  stays visible and interactive, because contextual editing is exactly the
 *  flow where the user reads/adjusts the live page while choosing values
 *  (چرا: modals break that loop — the user must close → select → reopen;
 *  the research pattern for secondary, ongoing, reversible tasks).
 *  ARIA: role="complementary" (not dialog — nothing is inert behind it);
 *  Escape closes; the close button returns focus to the opener when the
 *  caller passes onClose. */
export function SidePanel({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  /* PORTAL to body — same containing-block trap as Modal (backdrop-filter
     ancestors). Anchored to the LEFT edge, full height, no overlay: the page
     stays usable behind it; the shadow keeps the layer readable. */
  return createPortal(
    <aside
      className="fixed inset-y-0 left-0 z-[480] flex w-[min(660px,94vw)] flex-col border-r border-ink-100 bg-white dark:border-ink-800 dark:bg-[#161616]"
      style={{ animation: 'pn-side-in 0.18s ease-out', boxShadow: '10px 0 28px rgba(0,0,0,0.12)' }}
      role="complementary"
      aria-label={title}
    >
      <div className="flex shrink-0 items-center justify-between px-4 py-3" style={{ boxShadow: 'inset 0 -1px 0 0 rgba(0,0,0,0.06)' }}>
        <h2 className="text-[13.5px] font-bold tracking-[-0.01em] text-ink-900 dark:text-ink-100">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="بستن"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800 dark:hover:text-ink-200"
        >
          ✕
        </button>
      </div>
      {/* NO inner scroll of its own — the panels' content is designed to fit
          the viewport (wide two-column layouts instead of stacked lists).
          overflow-y-auto is only an emergency fallback for very short
          windows; the previous overflow-hidden silently CLIPPED content. */}
      <div className="grow overflow-y-auto p-3.5">{children}</div>
    </aside>,
    document.body,
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs text-red-600 dark:text-red-400">{children}</p>;
}

export function Toaster() {
  const { toasts, dismissToast, settings } = useApp();
  /* position comes from the user's ACCOUNT settings — no hardcoded corner */
  const pos = settings?.notifications?.position ?? 'bottom-left';
  const posCls =
    pos === 'top-right' ? 'top-4 right-4'
    : pos === 'top-left' ? 'top-4 left-4'
    : pos === 'bottom-right' ? 'bottom-4 right-4'
    : 'bottom-4 left-4';
  return (
    <div
      aria-live="polite"
      role="region"
      aria-label="اعلان‌ها"
      data-notification-layer=""
      className={`fixed ${posCls} z-[70] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2`}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          /* آیتم ۱۱ — flat, solid surface: no glass/blur/vibe — one quiet
             panel + a single status dot that carries the kind. Same language
             as the app's popovers (solid bg + shadow-popover). */
          className="pointer-events-auto flex items-start gap-2.5 rounded-lg bg-white px-3.5 py-2.5 text-sm font-medium text-gray-900 pn-shadow-popover dark:bg-[#1f1f1f] dark:text-gray-100"
          style={{ animation: 'pn-slide-up 0.1s ease-out' }}
        >
          <span
            aria-hidden="true"
            className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
              t.kind === 'error'
                ? 'bg-red-500'
                : t.kind === 'warning'
                ? 'bg-amber-500'
                : t.kind === 'success'
                ? 'bg-emerald-500'
                : 'bg-[#0070f3]'
            }`}
          />
          <span className="min-w-0 grow break-words leading-5">{t.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="بستن اعلان"
            className="-m-1 shrink-0 rounded-md p-1 text-current opacity-40 transition hover:opacity-100"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center" role="status">
      <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-gray-100 text-3xl dark:bg-[#222]">{icon}</span>
      <div>
        <h3 className="font-bold text-ink-900 dark:text-ink-100">{title}</h3>
        {description && <p className="mt-1 max-w-sm text-sm text-ink-500 dark:text-ink-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}