/* ═══════════════════════════════════════════════════════════════════════
   ImportFileModal — «وارد کردن فایل» (§10/§19).

   ONE modal, TWO clearly separated pipelines:
     • .pnote → «در حال بازیابی جزوه…»  (بازیابی کامل با حفظ ساختار)
     • .pdf   → «در حال استخراج محتوای PDF…» (تبدیل به محتوای قابل ویرایش)

   The modal OWNS the whole flow so EditorPage stays thin:
     1. file pick (accept=.pnote,.pdf) + extension/MIME gates
     2. parse/validate (importPnote / importPdf)
     3. destination choice when the current note already has content —
        REPLACING existing content requires EXPLICIT confirmation (§7/§24);
        the default is a NEW note
     4. onApply(document, { asNewNote }) — EditorPage commits the result
        through the EXISTING page model, autosave and collab ops

   Product contract (§29): .pnote is described as the lossless native
   format; PDF import is described as best-effort conversion. Neither
   message overpromises.
   ═══════════════════════════════════════════════════════════════════════ */

import { useRef, useState } from 'react';
import { Modal } from '@/components/ui';
import { importPnote, pnotePageCount } from '@/pnote/importPnote';
import { PnoteError, pnoteUserMessage } from '@/pnote/format';
import { importPdf, pdfUserMessage } from '@/pnote/pdf/importPdf';
import { pnoteValidateDocument } from '@/pnote/validate';

export interface ImportApplyInfo {
  /** the validated §4 stored document ({type:'doc',…,floatingElements?}) */
  document: Record<string, unknown>;
  /** user's destination choice: a NEW note, or REPLACE this note's content */
  asNewNote: boolean;
  /** what the user picked (for the toast) */
  kind: 'pnote' | 'pdf';
  title?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** true when the currently open note already has meaningful content —
     the replace-confirmation branch only appears then */
  currentNoteHasContent: boolean;
  currentNoteTitle: string;
  onApply: (info: ImportApplyInfo) => void;
}

type Phase =
  | { s: 'pick' }
  | { s: 'working'; label: string; desc: string }
  | { s: 'confirm'; info: ImportApplyInfo; pageCount: number; partial?: string }
  | { s: 'error'; message: string };

/** does the §4 doc carry any real content? (empty-paragraph-only = no) */
function docLooksEmpty(doc: Record<string, unknown>): boolean {
  const content = doc.content;
  if (!Array.isArray(content) || content.length === 0) return true;
  return content.every((b) => {
    const t = (b as { type?: string })?.type;
    if (t === 'pageBreak') return true;
    if (t === 'paragraph') {
      const c = (b as { content?: unknown[] }).content;
      return !Array.isArray(c) || c.length === 0;
    }
    return false;
  });
}

export function ImportFileModal({ open, onClose, currentNoteHasContent, currentNoteTitle, onApply }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ s: 'pick' });

  const reset = () => setPhase({ s: 'pick' });
  const close = () => { reset(); onClose(); };

  const handleFile = async (file: File) => {
    const name = file.name.toLowerCase();
    const isPnote = name.endsWith('.pnote');
    const isPdf = name.endsWith('.pdf') || file.type === 'application/pdf';
    if (!isPnote && !isPdf) {
      setPhase({ s: 'error', message: 'فرمت فایل پشتیبانی نمی‌شود. فقط Persian Notes (.pnote) و PDF (.pdf) قابل وارد کردن هستند.' });
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      if (isPnote) {
        if (bytes.byteLength > 128 * 1024 * 1024) throw new PnoteError('too-large', 'package too large');
        setPhase({ s: 'working', label: 'در حال بازیابی جزوه…', desc: 'بازیابی کامل جزوه با حفظ ساختار و ظاهر قابل ویرایش' });
        const pkg = await importPnote(bytes);
        const doc = pkg.document as Record<string, unknown>;
        const check = pnoteValidateDocument(doc);
        if (!check.ok) throw new PnoteError('bad-document', check.reason);
        const pageCount = pnotePageCount(pkg);
        const title = pkg.manifest.title || '';
        const info: ImportApplyInfo = { document: doc, asNewNote: true, kind: 'pnote', title };
        if (currentNoteHasContent && !docLooksEmpty(doc)) {
          setPhase({ s: 'confirm', info, pageCount });
        } else {
          onApply(info); close();
        }
      } else {
        setPhase({ s: 'working', label: 'در حال استخراج محتوای PDF…', desc: 'تبدیل محتوای PDF به محتوای قابل ویرایش' });
        const result = await importPdf(bytes, file.name);
        const doc = result.document;
        const partialNote = result.partial
          ? `${result.stats.imageOnlyPages} صفحه از PDF اسکن‌شده/تصویری بود و متنی از آن استخراج نشد.`
          : undefined;
        const info: ImportApplyInfo = { document: doc, asNewNote: true, kind: 'pdf' };
        if (currentNoteHasContent && !docLooksEmpty(doc)) {
          setPhase({ s: 'confirm', info, pageCount: result.stats.pages, partial: partialNote });
        } else {
          if (partialNote) setPhase({ s: 'confirm', info, pageCount: result.stats.pages, partial: partialNote });
          else { onApply(info); close(); }
        }
      }
    } catch (e) {
      if (e instanceof PnoteError) setPhase({ s: 'error', message: pnoteUserMessage(e.code) });
      else if (e instanceof Error && 'code' in e && typeof (e as { code?: unknown }).code === 'string') {
        setPhase({ s: 'error', message: pdfUserMessage((e as { code: string }).code) });
      } else setPhase({ s: 'error', message: 'وارد کردن فایل ناموفق بود. فایل معتبر نیست.' });
    }
  };

  return (
    <Modal open={open} onClose={close} title="وارد کردن فایل">
      <input
        ref={inputRef}
        type="file"
        accept=".pnote,.pdf,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void handleFile(f);
        }}
      />

      {phase.s === 'pick' && (
        <div className="space-y-3">
          <button type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full rounded-xl border border-ink-200 p-4 text-right transition-colors hover:bg-ink-50 dark:border-ink-800 dark:hover:bg-ink-900"
          >
            <div className="text-[14px] font-bold text-ink-900 dark:text-ink-100">Persian Notes (.pnote)</div>
            <div className="mt-1 text-[12px] text-ink-500 dark:text-ink-400">
              این فرمت مخصوص خود Persian Notes است و ساختار و ویرایش‌پذیری جزوه را حفظ می‌کند.
            </div>
          </button>
          <button type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full rounded-xl border border-ink-200 p-4 text-right transition-colors hover:bg-ink-50 dark:border-ink-800 dark:hover:bg-ink-900"
          >
            <div className="text-[14px] font-bold text-ink-900 dark:text-ink-100">PDF (.pdf)</div>
            <div className="mt-1 text-[12px] text-ink-500 dark:text-ink-400">
              این یک فرمت عمومی است و هنگام وارد کردن، محتوای آن تا حد امکان به ساختار قابل ویرایش تبدیل می‌شود.
            </div>
          </button>
          <p className="pt-1 text-center text-[11px] text-ink-400">برای انتخاب فایل کلیک کنید</p>
        </div>
      )}

      {phase.s === 'working' && (
        <div className="flex flex-col items-center gap-3 py-8">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-200 border-t-accent-600" />
          <div className="text-[14px] font-bold text-ink-900 dark:text-ink-100">{phase.label}</div>
          <div className="text-[12px] text-ink-500 dark:text-ink-400">{phase.desc}</div>
        </div>
      )}

      {phase.s === 'confirm' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-ink-200 p-3 text-[12.5px] dark:border-ink-800">
            {phase.info.kind === 'pnote'
              ? <span>جزوهٔ بازیابی‌شده شامل <b>{phase.pageCount}</b> صفحه است.</span>
              : <span>از این PDF <b>{phase.pageCount}</b> صفحه استخراج شد.</span>}
            {phase.partial && <div className="mt-2 rounded-lg bg-amber-50 p-2 text-[11.5px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{phase.partial}</div>}
          </div>
          {currentNoteHasContent && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-[12.5px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              جزوهٔ فعلی («{currentNoteTitle || 'بدون عنوان'}») محتوا دارد. جایگزینی محتوای فعلی قابل بازگشت نیست.
            </div>
          )}
          <div className="flex flex-col gap-2">
            <button type="button"
              className="rounded-lg bg-[#171717] px-4 py-2 text-[13px] font-medium text-white dark:bg-white dark:text-[#171717]"
              onClick={() => { onApply({ ...phase.info, asNewNote: true }); close(); }}
            >
              ایجاد جزوهٔ جدید
            </button>
            {currentNoteHasContent && (
              <button type="button"
                className="rounded-lg border border-[#ff5b4f] px-4 py-2 text-[13px] font-medium text-[#ff5b4f] hover:bg-[#ff5b4f]/5"
                onClick={() => { onApply({ ...phase.info, asNewNote: false }); close(); }}
              >
                جایگزینی محتوای همین جزوه
              </button>
            )}
          </div>
        </div>
      )}

      {phase.s === 'error' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#ff5b4f]/40 bg-[#ff5b4f]/5 p-3 text-[12.5px] text-[#c73c30] dark:text-[#ff8a80]">
            {phase.message}
          </div>
          <div className="flex justify-start gap-2">
            <button type="button" className="rounded-lg bg-[#171717] px-4 py-2 text-[13px] font-medium text-white dark:bg-white dark:text-[#171717]" onClick={reset}>
              تلاش دوباره
            </button>
            <button type="button" className="rounded-lg border border-ink-200 px-4 py-2 text-[13px] dark:border-ink-800" onClick={close}>
              بستن
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
