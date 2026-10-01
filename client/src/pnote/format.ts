/* ═══════════════════════════════════════════════════════════════════════
   pnote/format — the .pnote PACKAGE CONTRACT (§18 HANDOFF).

   .pnote is the NATIVE, lossless, editable, portable Persian Notes format:

        Persian Notes document → exportPnote() → .pnote → importPnote()
        → the same editable document.

   It is NOT a new document model. The canonical content stays the existing
   §4 storage shape (one TipTap JSON + pageBreak separators +
   floatingElements + noteDesign) — the package simply serializes it, with
   binary assets extracted from data-URLs and referenced by
   package-relative ids. PDF import (pnote/pdf/) is a COMPLETELY SEPARATE
   best-effort pipeline and shares NOTHING with this format.

   Security posture: a .pnote is UNTRUSTED INPUT. Every import passes the
   archive boundaries (zip.ts), the manifest validation and the §4
   document validator (validate.ts) before anything touches the editor.
   Server-only/auth state is never serialized (§22).
   ═══════════════════════════════════════════════════════════════════════ */

/** format identity — a valid package MUST carry exactly these values */
export const PNOTE_FORMAT = 'persian-notes';

/** current format version. Import accepts ≤ this; anything newer is
 *  REJECTED (never silently reinterpreted — §3). */
export const PNOTE_FORMAT_VERSION = 1;

/** hard limits for untrusted packages (§20 — generous for real books,
 *  far below dangerous) */
export const PNOTE_LIMITS = {
  /** whole package file ≤ 128 MB */
  packageBytes: 128 * 1024 * 1024,
  /** document.json ≤ 32 MB — matches the server's express json limit and
   *  validateDoc.ts MAX_JSON_BYTES */
  documentBytes: 32 * 1024 * 1024,
  /** manifest.json ≤ 256 KB */
  manifestBytes: 256 * 1024,
  /** ≤ 512 binary assets per package */
  maxAssets: 512,
  /** each asset ≤ 16 MB (in-editor images auto-fit to 1600px edges) */
  assetBytes: 16 * 1024 * 1024,
  /** manifest may list at most this many entries */
  maxManifestAssets: 512,
} as const;

/** manifest.json — validated STRICTLY on import (unknown extra keys on the
 *  top level are tolerated for forward compatibility; required keys and
 *  types are not). */
export interface PnoteManifest {
  format: typeof PNOTE_FORMAT;
  formatVersion: number;
  /** ISO timestamp written at export time (informational only) */
  createdAt?: string;
  /** free-text app/version marker (informational only) */
  app?: string;
  /** portable doc id — NOT the Mongo _id (§22: no server identity leaks
   *  and importing must never grant access to another user's resources) */
  documentId?: string;
  /** document title (informational; the editor's title field wins) */
  title?: string;
  /** asset file list: entries must resolve inside assets/ of the package */
  assets: Array<{ id: string; file: string; bytes: number }>;
}

/** the parsed+validated package handed to the import applier */
export interface PnotePackage {
  manifest: PnoteManifest;
  /** the §4 document: { type:'doc', content:[…], floatingElements?… } —
   *  still untrusted-shaped until pnoteValidateDocument runs */
  document: Record<string, unknown>;
  /** decoded asset bytes keyed by the asset id declared in the manifest */
  assets: Map<string, Uint8Array>;
  /** asset id → declared MIME type (from the data-URL at export time) */
  assetMimes: Map<string, string>;
}

/* ── typed import failures → Persian UI messages (§19: never stack traces) ── */

export type PnoteErrorCode =
  | 'not-a-package'        /* not a ZIP / wrong structure */
  | 'corrupt'              /* ZIP broken, manifest unparseable, … */
  | 'unsupported-version'  /* formatVersion > current */
  | 'bad-manifest'         /* missing/invalid required manifest fields */
  | 'bad-document'         /* document.json fails the §4 validation */
  | 'missing-asset'        /* document references an asset not in the package */
  | 'unsafe-path'          /* path traversal / dangerous entry in the archive */
  | 'too-large';           /* package/asset limits exceeded */

export class PnoteError extends Error {
  code: PnoteErrorCode;
  constructor(code: PnoteErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'PnoteError';
  }
}

/** one Persian message per failure kind — the UI shows THIS, never details */
export function pnoteUserMessage(code: PnoteErrorCode): string {
  switch (code) {
    case 'not-a-package':
    case 'corrupt':
      return 'فایل جزوه قابل خواندن نیست یا خراب شده است.';
    case 'unsupported-version':
      return 'این فایل با نسخهٔ جدیدتری از Persian Notes ساخته شده است. لطفاً برنامه را به‌روزرسانی کنید.';
    case 'bad-manifest':
      return 'ساختار فایل جزوه معتبر نیست (manifest نامعتبر است).';
    case 'bad-document':
      return 'محتوای فایل جزوه معتبر نیست و قابل بازیابی نیست.';
    case 'missing-asset':
      return 'بخشی از تصاویر فایل جزوه یافت نشد — فایل ناقص است.';
    case 'unsafe-path':
      return 'فایل جزوه مسیرهای ناامن دارد و به دلایل امنیتی پذیرفته نشد.';
    case 'too-large':
      return 'حجم فایل جزوه بیش از حد مجاز است.';
  }
}
