import { useEffect, useMemo, useRef, useState } from 'react';
import { SidePanel, Button, ErrorText } from '@/components/ui';
import { faDigits } from '@/utils/fa';
import type { PageKind, BorderSettings } from '@/types';
import { bookletSvgString } from '@/components/border/PageBorder';
import { DEFAULT_BORDER_SETTINGS } from '@/types';

/* ────────────────────────────────────────────────────────────────────────
   مودال هوشمند بازه‌ی صفحات (v2 — پیشرفته‌تر و دسترس‌پذیرتر)

   Applies a header label (سربرگ درس) or a page template (قالب) to a RANGE
   of pages in ONE action: «۱-۱۰» یا «۱۸-۳۱» یا «۱-۵، ۸، ۱۲-۲۰».

   Range input — THREE interchangeable ways, all always live:
     1. متن بازه:  a single forgiving text field that accepts Persian or
        Latin digits, «تا»/«-»/«–» separators and «،»/«,»-joined lists
     2. از/تا:  the classic two numeric fields (kept for muscle memory)
     3. انتخاب با کلیک:  a chip grid of the real pages — click to toggle,
        Shift-click to select a span, current page pre-highlighted

   Selected count + a mini preview of the target page chrome (for 'kind')
   or the header slot (for 'header') update live as you edit the range.
   Accessibility: everything is a labelled control, the chip grid is a
   real listbox with aria-selected, Enter submits, Esc closes, focus is
   restored to the range field on open.
   ──────────────────────────────────────────────────────────────────────── */

export type RangeApplyMode = 'header' | 'kind';

const KIND_OPTIONS: Array<{ value: PageKind; label: string; desc: string }> = [
  { value: 'framed', label: 'قاب‌دار', desc: 'قاب تزئینی + شماره صفحه' },
  { value: 'blank', label: 'ساده (بلنک)', desc: 'بدون قاب و خطوط' },
  { value: 'notebook', label: 'نوت‌بوکی', desc: 'خطوط دفترچه' },
  { value: 'booklet', label: 'خیلی سبز', desc: 'قاب ظریف با سربرگ درس و لوگو' },
];

/** «۳» → 3 (Persian/Arabic and Latin digits) */
function parseFaInt(raw: string): number | null {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  const normalized = raw.trim().replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)));
  if (!/^\d+$/.test(normalized)) return null;
  const n = parseInt(normalized, 10);
  return Number.isFinite(n) ? n : null;
}

/** Parse a forgiving range expression into 1-based page numbers:
 *  «۱-۱۰» «۱۸ تا ۳۱» «1–5, 8, 12-20» «فرد: ۱-۲۰» «زوج: ۳-۳۱»
 *  Returns numbers plus any out-of-range parts (surfaced as a soft warning). */
function parseRangeExpr(
  raw: string,
  total: number,
  parity: 'all' | 'odd' | 'even' = 'all',
): { pages: number[]; invalid: string[] } {
  const toFa = (r: string) => r.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  const pages = new Set<number>();
  const invalid: string[] = [];
  const parts = raw.split(/[،,;]+/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    /* a part may carry its own parity prefix: «فرد: ۱-۲۰» */
    let p: 'all' | 'odd' | 'even' = parity;
    let body = part;
    const pm = /^(فرد|زوج|odd|even)\s*[:：]\s*(.+)$/.exec(part);
    if (pm) {
      p = pm[1].startsWith('ز') || pm[1].startsWith('e') ? 'even' : 'odd';
      body = pm[2].trim();
    }
    /* range or single number — «تا» and dashes all mean a span */
    const m = /^(\d+)\s*(?:تا|-|–|—|\.\.)\s*(\d+)$/.exec(toFa(body));
    if (m) {
      let a = parseInt(m[1], 10); let b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      if (a < 1 || b > total) { invalid.push(part); continue; }
      for (let n = a; n <= b; n++) {
        if (p === 'odd' && n % 2 !== 1) continue;
        if (p === 'even' && n % 2 !== 0) continue;
        pages.add(n);
      }
      continue;
    }
    const single = parseFaInt(body);
    if (single == null || single < 1 || single > total) { invalid.push(part); continue; }
    if (p === 'odd' && single % 2 !== 1) continue;
    if (p === 'even' && single % 2 !== 0) continue;
    pages.add(single);
  }
  return { pages: [...pages].sort((x, y) => x - y), invalid };
}

/** [3,4,5,9,12] → «۳-۵، ۹، ۱۲» — compact Persian summary of a selection */
function summarize(nums: number[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < nums.length) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(i === j ? faDigits(nums[i]) : `${faDigits(nums[i])}-${faDigits(nums[j])}`);
    i = j + 1;
  }
  return out.join('، ');
}

export interface PageRangeModalProps {
  open: boolean;
  mode: RangeApplyMode;
  /** 1-based page numbers + ids of the real document pages */
  pages: Array<{ id: string; label: string }>;
  /** the document border — feeds the mini قاب preview for 'kind' mode */
  border?: BorderSettings;
  /** the page the modal opened from (pre-selected chip) */
  originPageNo?: number;
  onClose: () => void;
  /** called ONCE with every page id in the validated range */
  onApply: (pageIds: string[], payload: { headerLabel?: string; kind?: PageKind }) => void;
}

export function PageRangeModal({ open, mode, pages, border, originPageNo, onClose, onApply }: PageRangeModalProps) {
  const [expr, setExpr] = useState(mode === 'header' ? `1-${Math.min(pages.length, 10) || 1}` : '');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<PageKind>('framed');
  const [error, setError] = useState('');
  const [touchedPages, setTouchedPages] = useState<Set<number>>(new Set());
  const [chipAnchor, setChipAnchor] = useState<number | null>(null);
  const exprRef = useRef<HTMLInputElement>(null);

  /* chip grid state is the source when the user clicked; expr stays in sync */
  useEffect(() => {
    if (open) {
      setError('');
      setTouchedPages(new Set(mode === 'kind' && originPageNo ? [originPageNo] : []));
      setExpr(mode === 'header' ? `1-${Math.min(pages.length, 10) || 1}` : originPageNo ? String(originPageNo) : '');
      setChipAnchor(originPageNo ?? null);
      setTimeout(() => exprRef.current?.focus(), 30);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  const total = pages.length;

  /* live resolution: chips clicked → they win; else the text expr */
  const resolved = useMemo(() => {
    if (touchedPages.size > 0) return { pages: [...touchedPages].sort((a, b) => a - b), invalid: [] as string[] };
    if (expr.trim() === '') return { pages: [], invalid: [] as string[] };
    return parseRangeExpr(expr, total);
  }, [touchedPages, expr, total]);

  const selectedNums = resolved.pages;
  const invalidParts = resolved.invalid;
  const selectedIds = selectedNums
    .map((n) => pages[n - 1]?.id)
    .filter((id): id is string => !!id);

  /* keep the text expr mirroring chip clicks (one source of visible truth) */
  const toggleChip = (n: number, shift: boolean) => {
    setError('');
    const next = new Set(touchedPages);
    if (shift && chipAnchor != null) {
      const lo = Math.min(chipAnchor, n);
      const hi = Math.max(chipAnchor, n);
      for (let k = lo; k <= hi; k++) next.add(k);
    } else if (next.has(n)) next.delete(n);
    else next.add(n);
    setTouchedPages(next);
    setChipAnchor(n);
  };

  const clearSelection = () => { setTouchedPages(new Set()); setExpr(''); setChipAnchor(null); setError(''); };

  if (!open) return null;

  const submit = () => {
    if (selectedNums.length === 0) {
      setError('بازه‌ای انتخاب نشده — مثلاً «۱-۱۰» بنویسید یا صفحات را از جدول زیر انتخاب کنید.');
      return;
    }
    if (invalidParts.length > 0) {
      setError(`این بخش‌ها معتبر نیستند (سند ${faDigits(total)} صفحه دارد): ${invalidParts.join('، ')}`);
      return;
    }
    if (mode === 'header' && label.trim() === '') {
      setError('متن سربرگ را وارد کنید — برای حذف سربرگ، متن را «-» بگذارید.');
      return;
    }
    onApply(
      selectedIds,
      mode === 'header' ? { headerLabel: label.trim() } : { kind },
    );
    onClose();
  };

  const summaryText =
    selectedNums.length === 0
      ? 'بازه‌ای انتخاب نشده است.'
      : selectedNums.length === total
        ? `هر ${faDigits(total)} صفحه اعمال می‌شود.`
        : `${faDigits(selectedNums.length)} صفحه اعمال می‌شود: ${summarize(selectedNums)}`;

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={mode === 'header' ? 'سربرگ درس — بازه صفحات' : 'قالب صفحه — بازه صفحات'}
    >
      <div className="space-y-4">
        {/* ── range expression ── */}
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-300">
            بازهٔ صفحات
            <span className="ms-2 font-normal text-ink-400">مثلاً ۱-۱۰ یا ۱۸-۳۱ یا ۱-۵، ۸، ۱۲-۲۰ — فرد:/زوج: هم می‌شود</span>
          </span>
          <input
            ref={exprRef}
            type="text"
            value={expr}
            dir="rtl"
            onChange={(e) => { setExpr(e.target.value); setTouchedPages(new Set()); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className="h-9 w-full rounded-lg border border-ink-200 bg-transparent px-3 text-sm outline-none focus:border-[#0070f3] dark:border-ink-700"
            placeholder={mode === 'header' ? '۱-۱۰' : '۱۸-۳۱'}
          />
        </label>

        {/* ── page chip grid (click to toggle / shift-click span) ── */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[12px] font-medium text-ink-600 dark:text-ink-300">یا صفحات را انتخاب کنید</span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-[11px] text-ink-400 underline-offset-2 hover:text-ink-600 hover:underline dark:hover:text-ink-300"
            >
              پاک‌کردن انتخاب
            </button>
          </div>
          <div
            role="listbox"
            aria-multiselectable="true"
            aria-label="صفحات سند"
            className="flex flex-wrap gap-1 rounded-lg border border-ink-100 bg-ink-50/60 p-2 dark:border-ink-800 dark:bg-ink-900/60"
          >
            {pages.map((p, i) => {
              const n = i + 1;
              const sel = selectedNums.includes(n);
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  onClick={(e) => toggleChip(n, e.shiftKey)}
                  className={`h-7 min-w-8 rounded-md border px-1.5 text-[11px] tabular-nums transition-colors ${
                    sel
                      ? 'border-[#0070f3] bg-accent-50 font-bold text-accent-700 dark:bg-accent-900/40 dark:text-accent-300'
                      : 'border-ink-200 bg-white text-ink-500 hover:border-ink-300 hover:text-ink-700 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-400 dark:hover:text-ink-200'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── payload editor + live preview ── */}
        <div className="grid gap-4 md:grid-cols-[1fr_180px]">
          <div>
            {mode === 'header' ? (
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-300">متن سربرگ</span>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => { setLabel(e.target.value); setError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  className="h-9 w-full rounded-lg border border-ink-200 bg-transparent px-3 text-sm outline-none focus:border-[#0070f3] dark:border-ink-700"
                  placeholder="مثلاً: فصل ۳ — سیستم‌های دیجیتال"
                  dir="rtl"
                />
                <span className="mt-1 block text-[11px] leading-4 text-ink-400">
                  در شکاف بالای قاب هر صفحه‌ی بازه می‌نشیند. برای حذف سربرگ، متن را «-» بگذارید.
                </span>
              </label>
            ) : (
              <div className="space-y-1" role="radiogroup" aria-label="قالب صفحه">
                {KIND_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={kind === o.value}
                    onClick={() => setKind(o.value)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-right transition-colors ${
                      kind === o.value
                        ? 'border-[#0070f3] bg-accent-50/60 dark:bg-accent-900/20'
                        : 'border-ink-100 hover:bg-ink-100 dark:border-ink-800 dark:hover:bg-ink-800'
                    }`}
                  >
                    <span className="text-[13px] font-semibold text-ink-800 dark:text-ink-200">{o.label}</span>
                    <span className="text-[11px] text-ink-400">{o.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* live mini preview of the affected chrome */}
          <div className="hidden md:block">
            <div className="mb-1 text-[12px] font-medium text-ink-600 dark:text-ink-300">پیش‌نمایش</div>
            <div className="relative overflow-hidden rounded-lg border border-ink-100 bg-white dark:border-ink-800 dark:bg-ink-950" style={{ aspectRatio: '210/297' }}>
              {mode === 'kind' ? (
                <>
                  {kind === 'booklet' ? (
                    <div
                      className="absolute inset-0"
                      style={{
                        backgroundImage: `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(
                          bookletSvgString({ ...(border ?? DEFAULT_BORDER_SETTINGS), enabled: true }, 1).replace(/^[\s\S]*?<svg([^>]*)>/, '<svg$1').replace('</svg>', '') || bookletSvgString({ ...(border ?? DEFAULT_BORDER_SETTINGS), enabled: true }, 1),
                        )}")`,
                        backgroundSize: '100% 100%',
                      }}
                    />
                  ) : (
                    <div className="absolute inset-3 rounded-sm border border-dashed border-ink-200 dark:border-ink-700" />
                  )}
                  {kind === 'notebook' && (
                    <div
                      className="absolute inset-x-4 bottom-3 top-8"
                      style={{ backgroundImage: 'repeating-linear-gradient(transparent 0, transparent 21px, rgba(0,0,0,0.12) 21px, rgba(0,0,0,0.12) 22px)' }}
                    />
                  )}
                </>
              ) : (
                <div className="absolute inset-0 flex items-start justify-center">
                  <span
                    className="mt-[3.5%] max-w-[86%] truncate rounded-sm bg-[#eef3f8] px-2 py-0.5 text-[10px] font-bold text-[#17324a]"
                  >
                    {label.trim() === '-' ? '' : label.trim() || 'فصل ۳'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* selection summary */}
        <div className="rounded-lg bg-ink-50 px-3 py-2 text-[12px] leading-5 text-ink-600 dark:bg-ink-900 dark:text-ink-300">
          {summaryText}
          {invalidParts.length > 0 && (
            <span className="mt-1 block text-amber-600 dark:text-amber-400">
              نامعتبر: {invalidParts.join('، ')}
            </span>
          )}
        </div>

        {error && <ErrorText>{error}</ErrorText>}

        <div className="flex items-center justify-end gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
          <Button variant="secondary" onClick={onClose}>انصراف</Button>
          <Button onClick={submit}>
            {mode === 'header' ? 'اعمال سربرگ' : 'اعمال قالب'}
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}
