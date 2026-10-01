import { useEffect, useMemo, useState } from 'react';
import { SidePanel, Button } from '@/components/ui';
import { useApp } from '@/store/AppProvider';
import type { EduBlocksSettings } from '@/types';
import {
  FAMILY_TINT_DEFAULT,
  FAMILY_TITLE_DEFAULT,
  tintHex,
} from '@/utils/eduBlocks';
import {
  CALLOUT_KINDS,
  type CalloutKind,
} from '@/editor/extensions/blocks';

/* ────────────────────────────────────────────────────────────────────────
   درج کادر آموزشی / سوال — the redesigned insert modal.

   Two modes share ONE shell:
     • 'edu'    — callout-family boxes (تعریف، نکته، توجه، …)
     • 'question' — the four question families (کوتاه، تشریحی، در/نادرست، چهارگزینه‌ای)

   Layout: a slim scrollable list on the right (RTL first column), a LIVE
   PREVIEW of the selected item on the left, rendered with the SAME markup
   and current user edu-style as the editor — what you see is what gets
   inserted. Enter/double-click inserts; everything is keyboard reachable.
   ──────────────────────────────────────────────────────────────────────── */

export type InsertKind =
  | { mode: 'edu'; kind: CalloutKind }
  | { mode: 'question'; kind: 'short' | 'long' | 'truefalse' | 'mcq' }
  | { mode: 'compare'; kind: 'matrix' };

interface InsertEntry {
  id: string;
  label: string;
  desc: string;
  /** small tint used by the list chip */
  tint: string;
}

/* NOTE: EDU_DESC must be declared BEFORE EDU_ENTRIES — the entries array
   is evaluated at module load and reads EDU_DESC inside .map(); a later
   const binding is a temporal-dead-zone ReferenceError that white-screens
   the whole app. */
const EDU_DESC: Record<string, string> = {
  definition: 'مفهوم یا اصطلاح با توضیح',
  important: 'نکته‌ای که نباید از دست برود',
  exam: 'نکته‌ای که در امتحان می‌آید',
  warning: 'اشتباه رایج یا هشدار',
  summary: 'جمع‌بندی یک بخش',
  highlight: 'متن برجسته‌شده در جعبه',
  reference: 'منبع یا ارجاع',
};

const EDU_ENTRIES: InsertEntry[] = (Object.keys(CALLOUT_KINDS) as CalloutKind[])
  .filter((k) => k !== 'comparison' && k !== 'timeline' && k !== 'procon' && k !== 'footnote' && k !== 'longanswer')
  .map((k) => ({
    id: k,
    label: CALLOUT_KINDS[k].label,
    desc: EDU_DESC[k] ?? '',
    tint: FAMILY_TITLE_DEFAULT[k as keyof typeof FAMILY_TITLE_DEFAULT] ?? '#0070f3',
  }));

const QUESTION_ENTRIES: InsertEntry[] = [
  { id: 'short', label: 'سوال کوتاه', desc: 'پاسخ کوتاه در همان کادر', tint: '#7928ca' },
  { id: 'long', label: 'سوال تشریحی', desc: 'با فضای پاسخ بلند', tint: '#175e7d' },
  { id: 'truefalse', label: 'درست / نادرست', desc: 'دو دکمه انتخاب', tint: '#0a7d4f' },
  { id: 'mcq', label: 'چهارگزینه‌ای', desc: '۴ گزینه زیر هم یا دو ستون', tint: '#b45309' },
];

/* مقایسه بین دو یا چند چیز — the matrix-compare block surfaced in the
   کادر آموزشی modal (its own entry with a live preview; Enter adds a new
   «چیز» column up to ۴ inside the block itself). */
const COMPARE_ENTRY: InsertEntry = {
  id: 'matrix', label: 'مقایسه بین دو یا چند چیز',
  desc: 'جدول ویژگی‌ها برای ۲ تا ۴ مورد', tint: '#0070f3',
};

/** title colors for question families map onto edu families */
const QUESTION_TINT: Record<string, string> = {
  short: '#7928ca',
  long: '#175e7d',
  truefalse: FAMILY_TITLE_DEFAULT.truefalse,
  mcq: FAMILY_TITLE_DEFAULT.mcq,
};

/* ── live preview — the SAME .edu-block markup the editor renders, tinted
   with the user's current edu settings so the preview matches the page ── */

function ComparePreview({ settings }: { settings: EduBlocksSettings }) {
  const c = FAMILY_TITLE_DEFAULT.definition ?? '#0070f3';
  const th = (label: string, w?: string) => (
    <th style={{ padding: '4px 6px', borderBottom: '1.5px solid rgba(0,112,243,0.35)', fontSize: 11.5, fontWeight: 700, color: c, width: w }}>{label}</th>
  );
  const td = (label: string) => (
    <td style={{ padding: '4px 6px', borderBottom: '1px solid rgba(0,0,0,0.06)', fontSize: 11.5, color: 'inherit' }}>{label}</td>
  );
  return (
    <PreviewFrame settings={settings}>
      <PreviewTitle settings={settings} color={c} label="مقایسهٔ چندگانه" />
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ width: '26%' }} />
            {th('چیز ۱')}{th('چیز ۲')}
          </tr>
        </thead>
        <tbody>
          <tr>{td('ویژگی اول')}{td('…')}{td('…')}</tr>
          <tr>{td('ویژگی دوم')}{td('…')}{td('…')}</tr>
        </tbody>
      </table>
      <div className="mt-1 text-[10.5px] text-ink-400">+ افزودن ویژگی — و Enter روی نام چیز، ستون جدید (تا ۴)</div>
    </PreviewFrame>
  );
}

function PreviewFrame({ settings, children }: { settings: EduBlocksSettings; children: React.ReactNode }) {
  const radius = settings.radius ?? 6;
  const bw = settings.borderWidth ?? 1.5;
  const bs = settings.borderStyle ?? 'solid';
  const edge = settings.borderColor ? tintHex(settings.borderColor, 0.85) ?? 'rgba(0,0,0,0.14)' : 'rgba(0,0,0,0.14)';
  return (
    <div
      className="edu-block"
      style={{
        border: bw === 0 ? 'none' : `${bw}px ${bs} ${edge}`,
        borderRadius: radius,
        padding: '0.6em 0.9em',
        margin: 0,
        background: 'var(--page-surface, #fff)',
      }}
    >
      {children}
    </div>
  );
}

function PreviewTitle({ settings, color, label }: { settings: EduBlocksSettings; color: string; label: string }) {
  const bar = settings.titleBar && settings.titleBar !== 'none';
  return (
    <div
      className="edu-title"
      style={{
        color,
        fontWeight: settings.titleWeight ?? 600,
        fontSize: `${(settings.titleSize ?? 100) / 100}em`,
        ...(bar ? { background: tintHex(color, 0.08) ?? undefined, borderRadius: 3, padding: '2px 8px', margin: '-2px -4px 0.3em -4px' } : {}),
      }}
    >
      <span className="edu-title-text">{label}</span>
    </div>
  );
}

function QuestionPreview({ kind, settings }: { kind: 'short' | 'long' | 'truefalse' | 'mcq'; settings: EduBlocksSettings }) {
  if (kind === 'mcq') {
    const c = QUESTION_TINT.mcq;
    return (
      <PreviewFrame settings={settings}>
        <PreviewTitle settings={settings} color={c} label="سوال چهارگزینه‌ای" />
        <div className="text-[13px] leading-6 text-ink-600 dark:text-ink-300">صورت سوال این‌جا نوشته می‌شود…</div>
        <div className="mt-2 grid gap-1.5">
          {['۱', '۲', '۳', '۴'].map((n, i) => (
            <div key={n} className="flex items-center gap-2 text-[12.5px] text-ink-600 dark:text-ink-300">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px]" style={{ borderColor: c, color: c }}>{n}</span>
              {i === 0 ? 'گزینه اول' : 'گزینه…'}
            </div>
          ))}
        </div>
      </PreviewFrame>
    );
  }
  if (kind === 'truefalse') {
    const c = QUESTION_TINT.truefalse;
    return (
      <PreviewFrame settings={settings}>
        <PreviewTitle settings={settings} color={c} label="سوال درست / نادرست" />
        <div className="text-[13px] leading-6 text-ink-600 dark:text-ink-300">صورت سوال این‌جا نوشته می‌شود…</div>
        <div className="mt-2 flex gap-2">
          <span className="rounded-full border px-3 py-0.5 text-[12px]" style={{ borderColor: c, color: c }}>درست</span>
          <span className="rounded-full border border-ink-300 px-3 py-0.5 text-[12px] text-ink-500 dark:border-ink-600 dark:text-ink-400">نادرست</span>
        </div>
      </PreviewFrame>
    );
  }
  if (kind === 'long') {
    const c = QUESTION_TINT.long;
    return (
      <PreviewFrame settings={settings}>
        <PreviewTitle settings={settings} color={c} label="سوال تشریحی" />
        <div className="text-[13px] leading-6 text-ink-600 dark:text-ink-300">صورت سوال این‌جا نوشته می‌شود…</div>
        <div className="mt-2 space-y-2">
          <div className="border-b border-dashed border-ink-200 dark:border-ink-700" style={{ height: 18 }} />
          <div className="border-b border-dashed border-ink-200 dark:border-ink-700" style={{ height: 18 }} />
        </div>
      </PreviewFrame>
    );
  }
  const c = QUESTION_TINT.short;
  return (
    <PreviewFrame settings={settings}>
      <PreviewTitle settings={settings} color={c} label="سوال کوتاه" />
      <div className="text-[13px] leading-6 text-ink-600 dark:text-ink-300">صورت سوال این‌جا نوشته می‌شود…</div>
      <div className="mt-2 rounded-md bg-ink-100 px-2 py-1 text-[12px] text-ink-500 dark:bg-ink-800 dark:text-ink-400">پاسخ: …</div>
    </PreviewFrame>
  );
}

function EduPreview({ kind, settings }: { kind: CalloutKind; settings: EduBlocksSettings }) {
  const meta = CALLOUT_KINDS[kind];
  const color = FAMILY_TITLE_DEFAULT[kind as keyof typeof FAMILY_TITLE_DEFAULT] ?? '#0070f3';
  return (
    <PreviewFrame settings={settings}>
      <PreviewTitle settings={settings} color={color} label={meta?.label ?? kind} />
      <div className="text-[13px] leading-6 text-ink-600 dark:text-ink-300">
        محتوای {meta?.label ?? 'کادر'} این‌جا نوشته می‌شود…
      </div>
    </PreviewFrame>
  );
}

/* ── the modal ───────────────────────────────────────────────────────── */

export function InsertBlockModal({
  open,
  mode,
  onClose,
  onInsert,
}: {
  open: boolean;
  mode: 'edu' | 'question';
  onClose: () => void;
  onInsert: (kind: InsertKind) => void;
}) {
  const { settings } = useApp();
  const eduSettings = settings?.editor.eduBlocks;
  const current = useMemo<EduBlocksSettings | null>(
    () => (eduSettings && typeof eduSettings === 'object' ? (eduSettings as EduBlocksSettings) : null),
    [eduSettings],
  );

  const entries = mode === 'edu' ? [...EDU_ENTRIES, COMPARE_ENTRY] : QUESTION_ENTRIES;
  const [selected, setSelected] = useState<string>(entries[0]?.id ?? '');

  /* the shared shell mounts ONCE for both modes — `selected` must follow the
     mode, or the question panel keeps the last edu id ('definition'), the
     highlight disappears, and «درج» ships an invalid kind that silently
     inserts nothing (the «پنل سوالات کار نمی‌کند» report). Reset to the
     mode's first entry whenever the panel opens or the mode flips. */
  useEffect(() => {
    if (open) setSelected(entries[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  const pick = (id: string) => {
    /* guard: fall back to the mode's first entry if the id is foreign */
    const safeId = entries.some((e) => e.id === id) ? id : (entries[0]?.id ?? id);
    setSelected(safeId);
    if (mode === 'edu' && safeId === 'matrix') onInsert({ mode: 'compare', kind: 'matrix' });
    else onInsert(mode === 'edu' ? { mode: 'edu', kind: safeId as CalloutKind } : { mode: 'question', kind: safeId as 'short' });
  };

  return (
    <SidePanel open={open} onClose={onClose} title={mode === 'edu' ? 'افزودن کادر آموزشی' : 'افزودن سوال'}>
      <div className="grid gap-5 md:grid-cols-[220px_1fr]">
        {/* list — right column in RTL */}
        <div className="space-y-1 pl-1" role="listbox" aria-label={mode === 'edu' ? 'انواع کادر' : 'انواع سوال'}>
          {entries.map((e) => {
            const active = selected === e.id;
            return (
              <button
                key={e.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => setSelected(e.id)}
                onDoubleClick={() => pick(e.id)}
                className={`w-full rounded-lg border p-2.5 text-right transition-colors ${
                  active
                    ? 'border-[#0070f3] bg-accent-50/60 dark:bg-accent-900/20'
                    : 'border-transparent hover:bg-ink-100 dark:hover:bg-ink-800'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: e.tint }} />
                  <span className={`text-[13px] font-semibold ${active ? 'text-accent-700 dark:text-accent-300' : 'text-ink-800 dark:text-ink-200'}`}>{e.label}</span>
                </span>
                <span className="mt-0.5 block pr-[18px] text-[11px] leading-4 text-ink-400">{e.desc}</span>
              </button>
            );
          })}
        </div>

        {/* preview */}
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink-700 dark:text-ink-300">پیش‌نمایش</div>
          <div className="rounded-xl bg-white p-4 shadow-inner ring-1 ring-ink-100 dark:bg-ink-950 dark:ring-ink-800" style={{ minHeight: 180 }}>
            {mode === 'question'
              ? <QuestionPreview kind={selected as 'short' | 'long' | 'truefalse' | 'mcq'} settings={current ?? ({} as EduBlocksSettings)} />
              : selected === 'matrix'
                ? <ComparePreview settings={current ?? ({} as EduBlocksSettings)} />
                : <EduPreview kind={selected as CalloutKind} settings={current ?? ({} as EduBlocksSettings)} />}
          </div>
          <p className="mt-2 text-[11px] leading-4 text-ink-400">
            پیش‌نمایش با استایل فعلی کادرهای شما رندر می‌شود — همین ظاهر در صفحه درج خواهد شد.
          </p>
        </div>
      </div>

      <div className="pn-side-footer mt-auto flex shrink-0 items-center justify-end gap-2 border-t border-ink-100 pt-4 dark:border-ink-800">
        <Button variant="secondary" onClick={onClose}>انصراف</Button>
        <Button onClick={() => pick(selected)}>درج</Button>
      </div>
    </SidePanel>
  );
}
