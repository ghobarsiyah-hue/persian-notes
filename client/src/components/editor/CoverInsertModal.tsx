import { useEffect, useMemo, useState } from 'react';
import { SidePanel, Button, ErrorText } from '@/components/ui';
import { useApp } from '@/store/AppProvider';
import { faDigits } from '@/utils/fa';
import { loadImageFile, type LoadedImage } from '@/utils/imageFile';
import type { CoverSlot } from '@/types';

/* ────────────────────────────────────────────────────────────────────────
   افزودن صفحهٔ خاص (item ۱۵) — جلد اول / جلد دوم / جلد آخر / صفحهٔ فهرست.

   ONE modal, four entries. Cover entries accept an uploaded image (no size
   limit — loadImageFile auto-fits it) plus optional title/subtitle; the
   preview shows the sheet EXACTLY as it will render (editor + PDF share the
   same layout code path via .pn-sheet cover rules). فهرست needs no image —
   it renders the ruled index sheet.
   ──────────────────────────────────────────────────────────────────────── */

export type SpecialPageKind = 'coverFirst' | 'coverSecond' | 'coverLast' | 'toc';

export interface SpecialPageSpec {
  /** the actual PageKind created ('cover' | 'toc') */
  kind: 'cover' | 'toc';
  /** for covers: slot + artwork + captions — SAME field names as
   *  PageCoverAttrs (coverSrc/coverFit/…) so the payload flows through
   *  createPage → pageBreak attr → editor/PDF/sidebar unchanged */
  cover?: {
    slot: CoverSlot;
    coverSrc?: string;
    coverFit?: 'cover' | 'contain';
    coverTitle?: string;
    coverSubtitle?: string;
  };
}

/** A4 preview box (scaled like PageTypePicker's minis) */
const PW = 132;
const PH = Math.round((PW * 1123) / 794); // ≈ 187

interface Entry {
  id: SpecialPageKind;
  label: string;
  desc: string;
  needsImage: boolean;
}

const ENTRIES: Entry[] = [
  { id: 'coverFirst', label: 'جلد اول', desc: 'جلد آغازین جزوه — عکس + عنوان', needsImage: true },
  { id: 'coverSecond', label: 'صفحه دوم (جلد داخلی)', desc: 'صفحه عنوانِ داخلی', needsImage: true },
  { id: 'coverLast', label: 'جلد آخر', desc: 'جلد پایانی — عکس + عنوان', needsImage: true },
  { id: 'toc', label: 'صفحه فهرست', desc: 'فهرست مطالب با خطوط راهنما', needsImage: false },
];

/** mini A4 preview of the chosen entry, live from current inputs */
function MiniPreview({ entryId, src, fit, title, subtitle }: {
  entryId: SpecialPageKind;
  src?: string;
  fit: 'cover' | 'contain';
  title: string;
  subtitle: string;
}) {
  if (entryId === 'toc') {
    return (
      <div className="relative overflow-hidden rounded-[3px] border border-ink-200 bg-white dark:border-ink-600 dark:bg-[#242424]" style={{ width: PW, height: PH }}>
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-sm border border-ink-300 px-2 py-0.5 text-[7px] font-bold text-ink-600 dark:border-ink-500 dark:text-ink-300">فهرست مطالب</div>
        <div className="mt-9 space-y-1.5 px-3">
          {[0.95, 0.8, 0.88, 0.7, 0.9, 0.75].map((w, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="h-[2px] rounded bg-ink-300 dark:bg-ink-600" style={{ width: `${w * 60}%` }} />
              <span className="h-px grow border-b border-dotted border-ink-300 dark:border-ink-600" />
              <span className="text-[6px] tabular-nums text-ink-400">{faDigits(2 + i)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="relative overflow-hidden rounded-[3px] border border-ink-200 bg-white dark:border-ink-600 dark:bg-[#242424]" style={{ width: PW, height: PH }}>
      {src ? (
        <img src={src} alt="" className="absolute inset-0 h-full w-full" style={{ objectFit: fit === 'contain' ? 'contain' : 'cover' }} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-50 text-[8px] text-ink-300 dark:bg-ink-900 dark:text-ink-600">
          بدون تصویر
        </div>
      )}
      {(title || subtitle) && (
        <div className="absolute inset-x-0 bottom-2 text-center">
          <div className="mx-auto inline-block max-w-[85%] rounded bg-black/55 px-1.5 py-0.5">
            {title && <div className="truncate text-[8px] font-bold text-white">{title}</div>}
            {subtitle && <div className="truncate text-[6px] text-white/80">{subtitle}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function CoverInsertModal({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  /** the host creates the page (kind + cover attrs ride the spec) */
  onInsert: (spec: SpecialPageSpec) => void;
}) {
  const { toast } = useApp();
  const [entryId, setEntryId] = useState<SpecialPageKind>('coverFirst');
  const [src, setSrc] = useState<string | undefined>(undefined);
  const [fit, setFit] = useState<'cover' | 'contain'>('cover');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEntryId('coverFirst');
      setSrc(undefined);
      setFit('cover');
      setTitle('');
      setSubtitle('');
      setError(null);
    }
  }, [open]);

  const entry = useMemo(() => ENTRIES.find((e) => e.id === entryId)!, [entryId]);

  const pickImage = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = () => {
      const file = inp.files?.[0];
      if (!file) return;
      setLoading(true);
      setError(null);
      loadImageFile(file)
        .then((img: LoadedImage) => setSrc(img.src))
        .catch((e) => setError((e as Error).message))
        .finally(() => setLoading(false));
    };
    inp.click();
  };

  const insert = () => {
    /* slot map — 'coverFirst'.replace('cover','') produced 'First' (capital),
       which is NOT a valid CoverSlot and broke placement; map explicitly */
    const slotOf: Record<SpecialPageKind, CoverSlot | null> = {
      coverFirst: 'first',
      coverSecond: 'second',
      coverLast: 'last',
      toc: null,
    };
    /* field names MUST match every consumer (Page.tsx editor layer,
       pageModelExport PDF layer, EditorPage sidebar): coverSrc / coverFit /
       coverTitle / coverSubtitle — the previous { src, fit, title } shape
       silently dropped the artwork everywhere (typed as Record<string,
       unknown>, so tsc could not catch it) */
    onInsert({
      kind: entryId === 'toc' ? 'toc' : 'cover',
      cover: entryId === 'toc'
        ? undefined
        : {
            slot: slotOf[entryId] ?? 'first',
            coverSrc: src,
            coverFit: fit,
            coverTitle: title.trim() || undefined,
            coverSubtitle: subtitle.trim() || undefined,
          },
    });
    toast(
      entryId === 'toc' ? 'صفحه فهرست اضافه شد.' : 'صفحه جلد اضافه شد.',
      'success',
    );
    onClose();
  };

  return (
    <SidePanel open={open} onClose={onClose} title="افزودن جلد / فهرست">
      <div className="grid gap-5 md:grid-cols-[230px_1fr]">
        {/* entries */}
        <div className="space-y-1" role="listbox" aria-label="نوع صفحه">
          {ENTRIES.map((e) => {
            const active = entryId === e.id;
            return (
              <button
                key={e.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => setEntryId(e.id)}
                className={`w-full rounded-lg border p-2.5 text-right transition-colors ${
                  active
                    ? 'border-[#0070f3] bg-accent-50/60 dark:bg-accent-900/20'
                    : 'border-transparent hover:bg-ink-100 dark:hover:bg-ink-800'
                }`}
              >
                <span className={`block text-[13px] font-semibold ${active ? 'text-accent-700 dark:text-accent-300' : 'text-ink-800 dark:text-ink-200'}`}>{e.label}</span>
                <span className="mt-0.5 block text-[11px] leading-4 text-ink-400">{e.desc}</span>
              </button>
            );
          })}
        </div>

        {/* options + live preview */}
        <div>
          {entry.needsImage ? (
            <div className="space-y-3">
              <div>
                <span className="mb-1.5 block text-[13px] font-medium text-ink-700 dark:text-ink-300">تصویر جلد</span>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={pickImage} disabled={loading}>
                    {src ? 'تغییر تصویر' : 'انتخاب تصویر'}
                  </Button>
                  {src && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setSrc(undefined)}>
                      حذف تصویر
                    </Button>
                  )}
                  {loading && <span className="text-[12px] text-ink-400">در حال بارگذاری…</span>}
                </div>
                <p className="mt-1 text-[11px] text-ink-400">بدون محدودیت حجم — تصاویر بزرگ خودکار به کیفیت چاپ می‌رسند.</p>
              </div>

              <div>
                <span className="mb-1 block text-[13px] font-medium text-ink-700 dark:text-ink-300">نحوهٔ نمایش تصویر</span>
                <div className="flex gap-1 rounded-lg bg-ink-100 p-1 dark:bg-ink-800">
                  {([
                    { v: 'cover', l: 'پرکردن صفحه' },
                    { v: 'contain', l: 'کامل داخل صفحه' },
                  ] as const).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setFit(o.v)}
                      className={`min-h-7 flex-1 rounded-md px-2 text-[12px] font-medium transition-colors ${
                        fit === o.v
                          ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-950 dark:text-ink-100'
                          : 'text-ink-500 hover:text-ink-800 dark:text-ink-400'
                      }`}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-[13px] font-medium text-ink-700 dark:text-ink-300">عنوان (اختیاری)</span>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="مثلاً: فیزیولوژی ۱"
                    dir="rtl"
                    className="w-full min-h-9 rounded-lg border border-ink-200 bg-transparent px-2.5 text-[13px] outline-none placeholder:text-ink-400 focus:border-[#0070f3] dark:border-ink-700 dark:text-ink-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[13px] font-medium text-ink-700 dark:text-ink-300">زیرعنوان (اختیاری)</span>
                  <input
                    type="text"
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    placeholder="مثلاً: دکتر — نیم‌سال اول"
                    dir="rtl"
                    className="w-full min-h-9 rounded-lg border border-ink-200 bg-transparent px-2.5 text-[13px] outline-none placeholder:text-ink-400 focus:border-[#0070f3] dark:border-ink-700 dark:text-ink-100"
                  />
                </label>
              </div>
              {error && <ErrorText>{error}</ErrorText>}
            </div>
          ) : (
            <p className="text-[13px] leading-6 text-ink-500 dark:text-ink-400">
              صفحهٔ فهرست با خطوط راهنما و شمارهٔ صفحه ساخته می‌شود — عنوان هر فصل را داخل خطوط بنویسید.
            </p>
          )}

          {/* preview row */}
          <div className="mt-4 flex items-start gap-4 border-t border-ink-100 pt-4 dark:border-ink-800">
            <MiniPreview entryId={entryId} src={src} fit={fit} title={title.trim()} subtitle={subtitle.trim()} />
            <div className="min-w-0 grow self-center">
              <div className="text-[13px] font-medium text-ink-700 dark:text-ink-300">پیش‌نمایش</div>
              <p className="mt-1 text-[11.5px] leading-5 text-ink-400">
                {entry.desc}
                {entry.needsImage && !src && ' — بدون تصویر، جلد با پس‌زمینهٔ ساده و عنوان ساخته می‌شود.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-end gap-2 border-t border-ink-100 pt-4 dark:border-ink-800">
        <Button variant="secondary" onClick={onClose}>انصراف</Button>
        <Button onClick={insert} disabled={loading}>افزودن صفحه</Button>
      </div>
    </SidePanel>
  );
}
