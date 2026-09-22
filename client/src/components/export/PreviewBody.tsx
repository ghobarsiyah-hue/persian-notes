import { useState } from 'react';
import { exportApi } from '@/api/endpoints';
import { useApp } from '@/store/AppProvider';
import { buildPagesHtml, buildPrintDocument, assertPageCount, type ExportPage } from '@/utils/pageModelExport';
import { printCss as printCssOf } from '@/utils/printCss';
import { prepareWordHtml, buildWordEduCss, buildWordHeaderFooter } from '@/utils/wordExport';
import { faDigits } from '@/utils/fa';
import type { PageSettings } from '@/utils/print';

interface Props {
  /** single-flow HTML — used only by the Word export fallback */
  html: string;
  /** the real page model: one ExportPage per editor page → one PDF page each */
  pages: ExportPage[];
  meta: { title: string; subject?: string; chapter?: string };
  pageSettings: PageSettings;
  preview: { html: string; count: number };
}

/**
 * Print preview body — a faithful replica of the editable sheets.
 * The preview pane renders the exact markup sent to the print window, scaled
 * to fit; no print-only options exist that could diverge from the editor.
 */
export function PreviewBody({ html, pages, meta, pageSettings, preview }: Props) {
  const { toast } = useApp();
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);

  const doPrint = () => {
    setPrinting(true);
    const { pagesHtml, pageCount } = buildPagesHtml(pages, meta, pageSettings);
    const doc = buildPrintDocument(pagesHtml, meta, pageSettings, printCssOf(pageSettings));
    const win = window.open('', '_blank');
    if (!win) {
      toast('پنجره چاپ باز نشد. مسدودکننده پاپ‌آپ را غیرفعال کنید.', 'error');
      setPrinting(false);
      return;
    }
    /* §42 — validate: layout pages === rendered sheets. The PDF pipeline
       must never paginate a second time; a mismatch is logged loudly. */
    win.addEventListener('load', () => assertPageCount(win, pageCount), { once: true });
    win.document.write(doc);
    win.document.close();
    win.focus();

    // Trigger the print dialog once the window has loaded the document (with a
    // fallback), and always release the button state afterwards.
    const release = () => {
      win.removeEventListener('afterprint', release);
      win.removeEventListener('pagehide', release);
      setPrinting(false);
    };
    win.addEventListener('afterprint', release);
    win.addEventListener('pagehide', release);
    const tryPrint = () => { try { win.print(); } catch { setTimeout(tryPrint, 300); } };
    win.addEventListener('load', () => setTimeout(tryPrint, 150));
    setTimeout(tryPrint, 1200); // fallback if the load event is flaky
    setTimeout(release, 20000); // never leave the button stuck
  };

  const doWord = async () => {
    setSaving(true);
    try {
      /* RAW editor HTML (LaTeX sources un-rendered) — prepareWordHtml turns
         every equation into native OMML Word rebuilds as editable math */
      const blob = await exportApi.docx({
        title: meta.title,
        html: prepareWordHtml(html),
        subject: meta.subject,
        chapter: meta.chapter,
        bodyFontFamily: pageSettings.fontFamily,
        fontSizePx: pageSettings.fontSize,
        lineHeight: pageSettings.lineHeight,
        eduCss: buildWordEduCss(pageSettings.eduBlocks, pageSettings.eduTinted),
        /* ornamental page frame (قاب) → VML in the Word page header */
        ...buildWordHeaderFooter(pageSettings.border, { subject: meta.subject, chapter: meta.chapter, title: meta.title }),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${meta.title || 'note'}.doc`;
      a.click();
      URL.revokeObjectURL(url);
      toast('فایل Word دانلود شد.', 'success');
    } catch (e) {
      toast('خروجی Word ناموفق بود: ' + (e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  /* scale the A4 sheet (210mm ≈ 794px editor units) to fit the preview pane */
  const scale = 0.62;
  /* `transform: scale()` never shrinks an element's LAYOUT box, only its
     paint — so the old wrapper declared a 794*scale-wide box while its
     child kept its real (unscaled) 794px width and full un-scaled height
     for every page. The browser reserved space for that real size, which
     is what made the modal look "too wide" and pushed the sheet out of
     place. Give the wrapper the real, POST-scale box (width AND height)
     with overflow hidden, and pin the still full-size child inside it. */
  const sheetW = 794 * scale;
  const sheetH = 1123 * Math.max(1, preview.count) * scale;

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_190px]">
      <div className="max-h-[65vh] overflow-auto rounded-lg bg-ink-100 p-4 dark:bg-ink-950">
        {preview.html ? (
          <div style={{ width: sheetW, height: sheetH, margin: '0 auto', overflow: 'hidden', position: 'relative' }}>
            <div
              style={{ width: 794, position: 'absolute', top: 0, right: 0, transform: `scale(${scale})`, transformOrigin: 'top right' }}
              dangerouslySetInnerHTML={{ __html: preview.html }}
            />
          </div>
        ) : (
          <p className="py-20 text-center text-sm text-ink-500">در حال ساخت پیش‌نمایش…</p>
        )}
      </div>

      <div className="flex flex-col gap-2 border-r border-ink-200 pr-4 dark:border-ink-800">
        <h4 className="text-xs font-semibold text-ink-500">خروجی</h4>
        <p className="text-[11px] leading-5 text-ink-500">
          خروجی دقیقاً همان صفحات قابل ویرایش است — قاب، خط‌های نوت‌بوکی، فونت و
          فاصله خطوط سند. تعداد صفحات: {faDigits(preview.count)}
        </p>
        <button
          type="button"
          onClick={doPrint}
          disabled={printing}
          aria-busy={printing}
          className="rounded-lg bg-ink-800 px-4 py-2 text-sm font-medium text-white hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-ink-200 dark:text-ink-900"
        >
          {printing ? 'در حال باز کردن پنجره چاپ…' : '⎙ چاپ / ذخیره PDF'}
        </button>
        <button
          type="button"
          onClick={() => void doWord()}
          disabled={saving}
          className="rounded-lg border border-ink-300 px-4 py-2 text-sm hover:bg-ink-100 disabled:opacity-60 dark:border-ink-700 dark:hover:bg-ink-800"
        >
          {saving ? 'در حال آماده‌سازی…' : '▬ خروجی Word (DOC)'}
        </button>
        <p className="mt-auto text-[11px] leading-5 text-ink-500">
          برای PDF در پنجره چاپ، «Save as PDF» را انتخاب کنید.
        </p>
      </div>
    </div>
  );
}
