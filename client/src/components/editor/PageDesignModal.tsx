import { useMemo } from 'react';
import { SidePanel, Button } from '@/components/ui';
import { faDigits } from '@/utils/fa';
import type { BorderStyle, BorderSettings, PageKind } from '@/types';
import { pageBorderSvgString, bookletSvgString } from '@/components/border/PageBorder';
import { Palette, Minus, Plus, Images, Copy, Type as TypeIcon } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────
   مودال «طراحی صفحه» — بازطراحی اساسی تب طراحی (user request)

   BEFORE: a long flat ribbon row where every control fought for attention,
   classic-only controls sat greyed-out next to live ones, and the template
   picker was a bare <select> with no visual idea of what it produces.

   NOW: one comfortable surface with a clear spatial grammar (RTL):
     RIGHT  → قالب‌ها: a visual gallery — every template shows its real
              rendered SVG on a mini A4, so picking is seeing, not guessing.
     CENTER → پیش‌نمایش: a live A4 sheet of the ACTIVE page's chrome with
              the CURRENT settings (colors, thickness, سربرگ) as you edit.
     LEFT   → تنظیمات: only the sections that apply to the selected
              template — nothing greyed out, nothing irrelevant shown.
   Advanced/low-frequency actions (بازه‌ای، جلد/فهرست) live at the bottom
   of the settings rail, visually quieter than the daily controls.

   Single source of truth is untouched: every edit writes through the SAME
   onBorderChange / onChangePageKind paths the ribbon used — autosave,
   collab announce and PDF export behave identically.
   ──────────────────────────────────────────────────────────────────────── */

const FRAME_COLORS = [
  { label: 'سرمه‌ای/طلایی', primary: '#1e3a5f', secondary: '#c5a24d' },
  { label: 'آبی نفتی', primary: '#175e7d', secondary: '#4490ad' },
  { label: 'بنفش', primary: '#6d28d9', secondary: '#c4b5fd' },
  { label: 'قرمز', primary: '#b91c1c', secondary: '#f59e0b' },
  { label: 'خاکستری', primary: '#343434', secondary: '#a3a3a3' },
];

const BAND_COLORS: Array<{ value: string; label: string }> = [
  { value: '#b8d8e8', label: 'آبی یخی' },
  { value: '#cfe3ec', label: 'نفتی ملایم' },
  { value: '#f2d4dc', label: 'صورتی' },
  { value: '#f2e3b3', label: 'زرد' },
  { value: '#dcd3ee', label: 'بنفش' },
  { value: '#e0e0e0', label: 'خاکستری' },
  { value: 'none', label: 'بدون رنگ' },
];

/** which template family the ACTIVE page currently renders */
type ActiveTemplate = 'classic' | 'booklet' | 'notebook' | 'none';

function resolveActive(activePageKind: PageKind | undefined, border: BorderSettings): ActiveTemplate {
  if (activePageKind === 'booklet') return 'booklet';
  if (activePageKind === 'notebook') return 'notebook';
  if (activePageKind === 'blank' || activePageKind === 'cover' || activePageKind === 'toc') return 'none';
  if (!border.enabled || border.style === 'none') return 'none';
  return 'classic';
}

/** data-uri of an inline SVG for CSS background-image */
const svgUri = (svg: string) => `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;

export interface PageDesignModalProps {
  open: boolean;
  onClose: () => void;
  /** document-level border settings (single source of truth) */
  border: BorderSettings;
  onBorderChange: (patch: Partial<BorderSettings>) => void;
  /** the ACTIVE page's template kind — drives which sections are shown */
  activePageKind?: PageKind;
  /** convert the ACTIVE page to a page-kind template (خیلی سبز/نوت‌بوکی/قاب‌دار) */
  onChangePageKind: (kind: PageKind) => void;
  /** open the smart range modal (سربرگ/قالب روی ۱-۱۰، ۱۸-۳۱، فرد/زوج) */
  onOpenPageRange?: (mode: 'header' | 'kind') => void;
  /** open the جلد/فهرست insert modal */
  onOpenCoverInsert?: () => void;
}

export function PageDesignModal({
  open, onClose, border, onBorderChange, activePageKind, onChangePageKind,
  onOpenPageRange, onOpenCoverInsert,
}: PageDesignModalProps) {
  const active = resolveActive(activePageKind, border);
  const showFrameDecor = active === 'classic';
  const showHeader = active === 'classic' || active === 'booklet';

  /* ── gallery: every card renders its REAL chrome (no fake thumbnails) ── */
  const gallery = useMemo(() => {
    const classicSet: Array<{ value: BorderStyle; label: string }> = [
      { value: 'classic', label: 'کلاسیک (موجی)' },
      { value: 'double', label: 'دوردیف' },
      { value: 'ornate', label: 'تزئینی' },
      { value: 'minimal', label: 'مینیمال' },
    ];
    return [
      ...classicSet.map((s) => ({
        key: s.value,
        label: s.label,
        isActive: active === 'classic' && border.enabled && border.style === s.value,
        uri: svgUri(pageBorderSvgString({ ...border, enabled: true, style: s.value }, undefined, undefined, 1, 1)),
        /* the ACTIVE page may render a page-kind template (خیلی سبز/نوت‌بوکی/
           بلنک/جلد/فهرست) whose chrome IGNORES border.style — picking a
           classic card must therefore FIRST return the page to the framed
           kind, then apply the style; otherwise the click visibly does
           nothing (the «گزینه‌ها کار نمی‌کنند» report) */
        pick: () => {
          if (activePageKind && activePageKind !== 'framed' && activePageKind !== 'cover' && activePageKind !== 'toc') {
            onChangePageKind('framed');
          }
          onBorderChange({ style: s.value, enabled: true });
        },
      })),
      {
        key: 'booklet', label: 'خیلی سبز',
        isActive: active === 'booklet',
        uri: svgUri(bookletSvgString(border, 1)),
        pick: () => onChangePageKind('booklet'),
      },
      {
        key: 'notebook', label: 'نوت‌بوکی',
        isActive: active === 'notebook',
        uri: '',
        pick: () => onChangePageKind('notebook'),
      },
      {
        key: 'none', label: 'بدون قاب',
        isActive: active === 'none',
        uri: '',
        pick: () => {
          if (activePageKind && activePageKind !== 'framed' && activePageKind !== 'cover' && activePageKind !== 'toc') {
            onChangePageKind('framed');
          }
          onBorderChange({ style: 'none', enabled: false });
        },
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [border, active, activePageKind]);

  /* ── live center preview: the ACTIVE page's chrome with CURRENT settings ── */
  const previewUri = useMemo(() => {
    if (!open) return '';
    if (active === 'booklet') return svgUri(bookletSvgString(border, 1));
    if (active === 'classic') return svgUri(pageBorderSvgString(border, undefined, undefined, 1, 1));
    return '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, border, active]);

  if (!open) return null;

  return (
    <SidePanel open={open} onClose={onClose} title="طراحی صفحه">
      <div className="grid gap-4 md:grid-cols-[132px_104px_1fr]">
        {/* ── RIGHT rail: قالب‌ها (visual gallery) ── */}
        <div className="order-1">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-ink-700 dark:text-ink-200">
            <Palette className="h-3.5 w-3.5" />
            قالب صفحه
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {gallery.map((g) => (
              <button
                key={g.key}
                type="button"
                title={g.label}
                onClick={g.pick}
                className={`group flex flex-col items-center gap-1 rounded-lg border p-1.5 transition-colors ${
                  g.isActive
                    ? 'border-[#0070f3] bg-accent-50/70 dark:bg-accent-900/20'
                    : 'border-ink-100 hover:border-ink-300 hover:bg-ink-50 dark:border-ink-800 dark:hover:border-ink-600 dark:hover:bg-ink-800/50'
                }`}
              >
                <span
                  className="block w-full rounded-sm border border-ink-100 bg-white dark:border-ink-700 dark:bg-[#fdfdfb]"
                  style={{
                    aspectRatio: '3/4',
                    backgroundImage: g.key === 'notebook'
                      ? 'repeating-linear-gradient(transparent 0, transparent 13px, rgba(0,0,0,0.10) 13px, rgba(0,0,0,0.10) 14px)'
                      : g.uri || undefined,
                    backgroundSize: '100% 100%',
                  }}
                />
                <span className={`text-[10px] leading-3 ${g.isActive ? 'font-bold text-accent-700 dark:text-accent-300' : 'text-ink-500 dark:text-ink-400'}`}>
                  {g.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── CENTER: live A4 preview ── */}
        <div className="order-2 hidden flex-col items-center md:flex">
          <div className="mb-2 text-[12px] font-bold text-ink-700 dark:text-ink-200">پیش‌نمایش زنده</div>
          <div
            className="relative w-full max-w-[300px] overflow-hidden rounded-md border border-ink-200 bg-white shadow-sm dark:border-ink-700 dark:bg-[#fdfdfb]"
            style={{ aspectRatio: '210/297' }}
          >
            {active === 'notebook' && (
              <div
                className="absolute inset-x-4 bottom-3 top-8"
                style={{ backgroundImage: 'repeating-linear-gradient(transparent 0, transparent 25px, rgba(0,0,0,0.10) 25px, rgba(0,0,0,0.10) 26px)' }}
              />
            )}
            {previewUri && (
              <div className="absolute inset-0" style={{ backgroundImage: previewUri, backgroundSize: '100% 100%' }} />
            )}
            {/* a ghost text block so the user sees how content sits inside the frame */}
            <div className="absolute inset-x-8 top-[9%] space-y-2 opacity-30">
              <div className="h-2 w-3/4 rounded bg-ink-300 dark:bg-ink-600" />
              <div className="h-2 w-full rounded bg-ink-200 dark:bg-ink-700" />
              <div className="h-2 w-5/6 rounded bg-ink-200 dark:bg-ink-700" />
              <div className="h-2 w-2/3 rounded bg-ink-200 dark:bg-ink-700" />
            </div>
          </div>
          <div className="mt-2 text-center text-[11px] leading-4 text-ink-400">
            قالب «{gallery.find((g) => g.isActive)?.label ?? '—'}» · صفحهٔ {faDigits(1)}
          </div>
        </div>

        {/* ── LEFT rail: تنظیمات — only what applies to the active template ── */}
        <div className="order-3 space-y-4 pe-1">
          {showFrameDecor && (
            <section className="space-y-2.5">
              <div className="text-[12px] font-bold text-ink-700 dark:text-ink-200">تزئین قاب</div>
              <div>
                <div className="mb-1 text-[11px] text-ink-500 dark:text-ink-400">رنگ قاب</div>
                <div className="flex flex-wrap gap-1.5">
                  {FRAME_COLORS.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      title={c.label}
                      onClick={() => onBorderChange({ primaryColor: c.primary, secondaryColor: c.secondary, enabled: true })}
                      className={`h-6 w-9 overflow-hidden rounded-md border transition-transform hover:scale-105 ${
                        border.primaryColor?.toLowerCase() === c.primary ? 'border-[#0070f3] ring-1 ring-[#0070f3]' : 'border-ink-200 dark:border-ink-700'
                      }`}
                    >
                      <span className="block h-1/2 w-full" style={{ background: c.primary }} />
                      <span className="block h-1/2 w-full" style={{ background: c.secondary }} />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] text-ink-500 dark:text-ink-400">رنگ خط میانی</div>
                <div className="flex flex-wrap gap-1.5">
                  {BAND_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      title={c.label}
                      onClick={() => onBorderChange({ fillColor: c.value })}
                      className={`h-6 w-6 rounded-md border transition-transform hover:scale-105 ${
                        (border.fillColor || 'none') === c.value ? 'border-[#0070f3] ring-1 ring-[#0070f3]' : 'border-ink-200 dark:border-ink-700'
                      }`}
                      style={{
                        background: c.value === 'none' ? 'transparent' : c.value,
                        boxShadow: c.value === 'none' ? 'inset 0 0 0 1px rgba(0,0,0,0.2)' : undefined,
                      }}
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] text-ink-500 dark:text-ink-400">ضخامت خطوط</div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onBorderChange({ thickness: Math.max(0.5, border.thickness - 0.5) })}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-ink-200 text-ink-600 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
                    aria-label="ضخامت کمتر"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-12 text-center text-[12px] font-semibold tabular-nums text-ink-700 dark:text-ink-200">
                    {faDigits(border.thickness)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onBorderChange({ thickness: Math.min(3, border.thickness + 0.5) })}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-ink-200 text-ink-600 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
                    aria-label="ضخامت بیشتر"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <label className="block">
                <div className="mb-1 flex items-center gap-1 text-[11px] text-ink-500 dark:text-ink-400">
                  <TypeIcon className="h-3 w-3" />
                  متن عمودی قاب
                </div>
                <input
                  type="text"
                  value={border.sideLabel ?? ''}
                  placeholder="پیش‌فرض"
                  dir="rtl"
                  onChange={(e) => onBorderChange({ sideLabel: e.target.value })}
                  className="h-8 w-full rounded-lg border border-ink-200 bg-transparent px-2.5 text-[12px] outline-none placeholder:text-ink-400 focus:border-[#0070f3] dark:border-ink-700"
                />
              </label>
            </section>
          )}

          {showHeader && (
            <section className="space-y-2">
              <div className="text-[12px] font-bold text-ink-700 dark:text-ink-200">سربرگ درس</div>
              <label className="block">
                <input
                  type="text"
                  value={border.headerLabel ?? ''}
                  placeholder="مثلاً: فصل ۳ — سیستم‌های دیجیتال"
                  dir="rtl"
                  onChange={(e) => onBorderChange({ headerLabel: e.target.value })}
                  className="h-8 w-full rounded-lg border border-ink-200 bg-transparent px-2.5 text-[12px] outline-none placeholder:text-ink-400 focus:border-[#0070f3] dark:border-ink-700"
                />
              </label>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10.5px] leading-4 text-ink-400">در شکاف بالای قاب می‌نشیند.</span>
                {onOpenPageRange && (
                  <button
                    type="button"
                    onClick={() => { onOpenPageRange('header'); }}
                    className="flex h-7 shrink-0 items-center rounded-md border border-ink-200 px-2 text-[11px] font-medium text-ink-600 transition-colors hover:border-[#0070f3] hover:text-[#0070f3] dark:border-ink-700 dark:text-ink-300 dark:hover:text-accent-300"
                  >
                    بازه‌ای…
                  </button>
                )}
              </div>
            </section>
          )}

          {active === 'notebook' && (
            <p className="rounded-lg bg-ink-50 px-3 py-2 text-[11px] leading-5 text-ink-500 dark:bg-ink-900 dark:text-ink-400">
              قالب نوت‌بوکی فقط خطوط دفترچه دارد؛ رنگ و تزئین قاب به آن اعمال نمی‌شود. برای تزئین، قالب کلاسیک یا خیلی سبز را انتخاب کنید.
            </p>
          )}
          {active === 'none' && (
            <p className="rounded-lg bg-ink-50 px-3 py-2 text-[11px] leading-5 text-ink-500 dark:bg-ink-900 dark:text-ink-400">
              این صفحه بدون قاب است. یکی از قالب‌های ستون «قالب صفحه» را انتخاب کنید تا تزئین و سربرگ فعال شود.
            </p>
          )}

          {/* ── quieter, low-frequency actions ── */}
          <section className="space-y-1.5 border-t border-ink-100 pt-3 dark:border-ink-800">
            {onOpenPageRange && (
              <button
                type="button"
                onClick={() => { onOpenPageRange('kind'); }}
                className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12px] font-medium text-ink-600 transition-colors hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
              >
                <Copy className="h-3.5 w-3.5" />
                قالب یا سربرگ بازه‌ای…
              </button>
            )}
            {onOpenCoverInsert && (
              <button
                type="button"
                onClick={onOpenCoverInsert}
                className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12px] font-medium text-ink-600 transition-colors hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
              >
                <Images className="h-3.5 w-3.5" />
                جلد اول/دوم/آخر یا فهرست…
              </button>
            )}
          </section>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end border-t border-ink-100 pt-3 dark:border-ink-800">
        <Button onClick={onClose}>اتمام</Button>
      </div>
    </SidePanel>
  );
}
