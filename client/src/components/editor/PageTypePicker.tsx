import { FileText, Minus, Notebook } from 'lucide-react';
import type { PageKind } from '@/types';

/* mini A4 preview of each page kind (794×1123 scaled down) */
const PW = 34;
const PH = Math.round((PW * 1123) / 794); // ≈ 48

function MiniPage({ kind }: { kind: PageKind }) {
  if (kind === 'blank') {
    return (
      <div
        className="rounded-[2px] border border-ink-200 bg-white dark:border-ink-600 dark:bg-[#242424]"
        style={{ width: PW, height: PH }}
      />
    );
  }
  if (kind === 'notebook') {
    return (
      <div
        className="relative overflow-hidden rounded-[2px] border border-ink-200 bg-white dark:border-ink-600 dark:bg-[#242424]"
        style={{ width: PW, height: PH }}
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(to bottom, transparent 0, transparent 5px, rgba(37,99,235,.35) 5px, rgba(37,99,235,.35) 6px), linear-gradient(to left, transparent 0, transparent 9px, rgba(225,29,72,.45) 9px, rgba(225,29,72,.45) 10px, transparent 10px)',
          }}
        />
      </div>
    );
  }
  /* framed — ornamental border hint */
  return (
    <div
      className="relative overflow-hidden rounded-[2px] bg-white dark:bg-[#242424]"
      style={{
        width: PW,
        height: PH,
        boxShadow: 'inset 0 0 0 1px #1e3a5f, inset 0 0 0 2.5px #c5a24d, inset 0 0 0 4px #1e3a5f',
      }}
    />
  );
}

const KIND_META: Array<{ kind: PageKind; label: string; desc: string; icon: typeof FileText }> = [
  { kind: 'framed', label: 'قاب‌دار', desc: 'با قاب تزئینی', icon: FileText },
  { kind: 'blank', label: 'بلنک (بدون قاب)', desc: 'برگه سفید ساده', icon: Minus },
  { kind: 'notebook', label: 'نوت‌بوکی (خط‌دار)', desc: 'مثل دفترچه خط‌دار', icon: Notebook },
];

export function PageTypePicker({ onPick }: { onPick: (kind: PageKind) => void }) {
  return (
    <div className="w-[248px] p-1">
      <div className="px-2 pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-widest text-ink-300 dark:text-ink-600">
        افزودن صفحه
      </div>
      <div className="space-y-0.5">
        {KIND_META.map(({ kind, label, desc, icon: Icon }) => (
          <button
            key={kind}
            type="button"
            onClick={() => onPick(kind)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-right transition-colors hover:bg-ink-100 dark:hover:bg-ink-800"
          >
            <MiniPage kind={kind} />
            <span className="grow leading-tight">
              <span className="block text-[12.5px] font-medium text-ink-700 dark:text-ink-200">{label}</span>
              <span className="block text-[10px] text-ink-400 dark:text-ink-500">{desc}</span>
            </span>
            <Icon className="h-3.5 w-3.5 shrink-0 text-ink-400 dark:text-ink-500" />
          </button>
        ))}
      </div>
    </div>
  );
}
