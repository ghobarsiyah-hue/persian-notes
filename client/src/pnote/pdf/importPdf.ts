/* ═══════════════════════════════════════════════════════════════════════
   pnote/pdf/importPdf — the PDF IMPORT entry point (Part B).

   A SEPARATE pipeline from .pnote (§9 — never merge them):
     PDF (untrusted) → size/type gates → parsePdfText → reconstruct
       → { document (§4 merged), stats }

   The result rides the SAME commit path as .pnote import (the modal's
   applier): pages are built in MEMORY, committed in ONE bounded
   operation through the existing page model + autosave (§23). No fake
   OCR: a scanned PDF reports imageOnly pages and the UI shows the
   honest Persian message (§16).
   ═══════════════════════════════════════════════════════════════════════ */

import { parsePdfText, PdfParseError, PDF_LIMITS, type ParsedPdfResult } from './parsePdf';
import { reconstructDocument, reconstructStats } from './reconstruct';
import { pnoteValidateDocument } from '../validate';

/** the user-facing result of a PDF import attempt */
export interface PdfImportResult {
  /** §4 merged document ({type:'doc',content:[…]}) — validated */
  document: Record<string, unknown>;
  stats: ReturnType<typeof reconstructStats>;
  /** true when at least one page yielded no text (scanned pages) */
  partial: boolean;
}

/** Persian messages for each failure mode (§19 — no stack traces) */
export function pdfUserMessage(code: string): string {
  switch (code) {
    case 'not-pdf':
    case 'corrupt':
      return 'فایل PDF قابل خواندن نیست یا خراب شده است.';
    case 'encrypted':
      return 'این فایل PDF رمزگذاری شده است و قابل وارد کردن نیست.';
    case 'too-large':
      return 'حجم فایل PDF بیش از حد مجاز است.';
    case 'no-text':
      return 'در این PDF متنی برای استخراج پیدا نشد — به احتمال زیاد تصویری/اسکن‌شده است.';
    default:
      return 'وارد کردن PDF ناموفق بود.';
  }
}

/** MIME/extension sniff (never trust the extension alone — §20) */
function looksLikePdf(bytes: Uint8Array, fileName: string): boolean {
  const header = String.fromCharCode(...bytes.subarray(0, 5));
  if (header === '%PDF-') return true;
  /* tolerate a BOM/garbage prefix: search the first 4 KB for the header */
  const probe = String.fromCharCode(...bytes.subarray(0, Math.min(4096, bytes.length)));
  if (probe.includes('%PDF-')) return true;
  return /\.pdf$/i.test(fileName) && header !== '';
}

/**
 * Import a PDF: validate → parse → reconstruct → validate the result.
 * Throws PdfParseError (or pnote-style Error) on refusal; the modal maps
 * every failure to the Persian messages above.
 */
export async function importPdf(bytes: Uint8Array, fileName: string): Promise<PdfImportResult> {
  if (bytes.byteLength > PDF_LIMITS.fileBytes) throw new PdfParseError('too-large', 'pdf too large');
  if (!looksLikePdf(bytes, fileName)) throw new PdfParseError('corrupt', 'not a pdf');

  const parsed: ParsedPdfResult = await parsePdfText(bytes);
  if (parsed.pages.length === 0) throw new PdfParseError('corrupt', 'no pages');

  const document = reconstructDocument(parsed.pages);
  const check = pnoteValidateDocument(document);
  if (!check.ok) throw new PdfParseError('corrupt', `reconstructed document invalid: ${check.reason}`);

  const stats = reconstructStats(parsed.pages);
  if (stats.chars === 0) {
    /* nothing recoverable anywhere — the honest scanned-PDF outcome (§16) */
    throw new PdfParseError('no-text', 'pdf has no extractable text');
  }
  return {
    document,
    stats,
    partial: stats.imageOnlyPages > 0,
  };
}
