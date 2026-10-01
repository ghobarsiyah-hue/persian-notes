/* ═══════════════════════════════════════════════════════════════════════
   pnote/importPnote — .pnote PARSER/VALIDATOR (Part A).

   NATIVE pipeline (reverse direction):
     .pnote package → Pnote Parser/Validator → the EXISTING §4 document

   Import order (§21 — validate BEFORE anything reaches the editor):
     1. ZIP structure  — safe entries only, bounded counts/sizes (zip.ts)
     2. manifest.json  — strict shape + format + formatVersion gate
     3. document.json  — §4 validator (client twin of validateDoc.ts)
     4. asset references — every `pnote-asset:<id>` must exist in the
        package; assets decode back into data-URLs

   The result is the EXISTING document shape (the same object autosave
   persists). The applier (ImportFileModal → EditorPage) then commits it
   through the normal save/collab paths — the binary package itself NEVER
   travels through yjs (§8). Parsed once, validated once (§23).
   ═══════════════════════════════════════════════════════════════════════ */

import {
  PNOTE_FORMAT,
  PNOTE_FORMAT_VERSION,
  PNOTE_LIMITS,
  PnoteError,
  type PnoteManifest,
  type PnotePackage,
} from './format';
import { readZip, hasZipEOCD } from './zip';
import { restoreAssetsIntoDocument, assetToDataUrl } from './assets';
import { pnoteValidateDocument } from './validate';

/** strict manifest gate — required keys, types and bounds (§3/§20) */
function validateManifest(raw: unknown): PnoteManifest {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PnoteError('bad-manifest', 'manifest is not an object');
  }
  const m = raw as Record<string, unknown>;
  if (m.format !== PNOTE_FORMAT) throw new PnoteError('bad-manifest', 'manifest.format mismatch');
  const version = m.formatVersion;
  if (typeof version !== 'number' || !Number.isFinite(version) || version < 1 || !Number.isInteger(version)) {
    throw new PnoteError('bad-manifest', 'manifest.formatVersion invalid');
  }
  if (version > PNOTE_FORMAT_VERSION) {
    /* never silently reinterpret an incompatible package (§3) */
    throw new PnoteError('unsupported-version', `formatVersion ${version} > ${PNOTE_FORMAT_VERSION}`);
  }
  if (m.createdAt !== undefined && typeof m.createdAt !== 'string') throw new PnoteError('bad-manifest', 'createdAt invalid');
  if (m.title !== undefined && typeof m.title !== 'string') throw new PnoteError('bad-manifest', 'title invalid');
  const assets = m.assets;
  if (!Array.isArray(assets) || assets.length > PNOTE_LIMITS.maxManifestAssets) {
    throw new PnoteError('bad-manifest', 'manifest.assets invalid');
  }
  const seenIds = new Set<string>();
  const cleanAssets = assets.map((a) => {
    if (a === null || typeof a !== 'object' || Array.isArray(a)) throw new PnoteError('bad-manifest', 'asset entry invalid');
    const e = a as Record<string, unknown>;
    if (typeof e.id !== 'string' || !e.id || e.id.length > 64 || !/^[A-Za-z0-9_\-]+$/.test(e.id)) throw new PnoteError('bad-manifest', 'asset id invalid');
    if (seenIds.has(e.id)) throw new PnoteError('bad-manifest', 'duplicate asset id');
    seenIds.add(e.id);
    if (typeof e.file !== 'string' || !e.file.startsWith('assets/')) throw new PnoteError('bad-manifest', 'asset file must live under assets/');
    if (typeof e.bytes !== 'number' || e.bytes < 0 || e.bytes > PNOTE_LIMITS.assetBytes) throw new PnoteError('bad-manifest', 'asset bytes invalid');
    return { id: e.id, file: e.file, bytes: e.bytes };
  });
  return {
    format: PNOTE_FORMAT,
    formatVersion: version,
    createdAt: typeof m.createdAt === 'string' ? m.createdAt : undefined,
    app: typeof m.app === 'string' ? m.app : undefined,
    documentId: typeof m.documentId === 'string' ? m.documentId : undefined,
    title: typeof m.title === 'string' ? m.title : undefined,
    assets: cleanAssets,
  };
}

function decodeJsonEntry(bytes: Uint8Array, limitBytes: number): unknown {
  if (bytes.length > limitBytes) throw new PnoteError('too-large', 'json entry oversized');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new PnoteError('corrupt', 'entry is not valid UTF-8'); }
  try { return JSON.parse(text); }
  catch { throw new PnoteError('corrupt', 'entry is not valid JSON'); }
}

/**
 * Parse + validate a .pnote package. Throws PnoteError with a stable
 * code for every rejection path; the UI maps codes to Persian messages
 * (format.ts pnoteUserMessage) — never stack traces (§19).
 */
export async function importPnote(bytes: Uint8Array): Promise<PnotePackage> {
  if (bytes.byteLength > PNOTE_LIMITS.packageBytes) throw new PnoteError('too-large', 'package too large');
  if (bytes.byteLength < 22) throw new PnoteError('not-a-package', 'too small to be a zip');
  /* a valid EOCD signature is the cheapest «is this even a zip» check —
     garbage files (wrong extension, truncated download) report honestly
     as corrupt/not-a-package, never as unsafe-path */
  if (!hasZipEOCD(bytes)) throw new PnoteError('not-a-package', 'not a zip archive');

  /* 1 — archive structure (unsafe names reject the WHOLE package).
     Distinguish the two null outcomes honestly (§19): no EOCD at all =
     not a package / corrupt; a real directory with hostile entries =
     unsafe-path. Both are safe rejections — the message differs. */
  const entries = await readZip(bytes, {
    maxEntries: 8 + PNOTE_LIMITS.maxAssets,
    maxEntryBytes: PNOTE_LIMITS.assetBytes,
    maxTotalBytes: PNOTE_LIMITS.packageBytes,
  });
  if (entries === null) {
    throw new PnoteError(hasZipEOCD(bytes) ? 'unsafe-path' : 'not-a-package', 'archive unreadable or unsafe');
  }

  /* 2 — manifest */
  const manifestBytes = entries.get('manifest.json');
  if (!manifestBytes) throw new PnoteError('not-a-package', 'manifest.json missing');
  const manifest = validateManifest(decodeJsonEntry(manifestBytes, PNOTE_LIMITS.manifestBytes));

  /* 3 — document */
  const docBytes = entries.get('document.json');
  if (!docBytes) throw new PnoteError('not-a-package', 'document.json missing');
  const rawDoc = decodeJsonEntry(docBytes, PNOTE_LIMITS.documentBytes);
  if (rawDoc === null || typeof rawDoc !== 'object' || Array.isArray(rawDoc)) {
    throw new PnoteError('bad-document', 'document.json is not an object');
  }
  const docCheck = pnoteValidateDocument(rawDoc);
  if (!docCheck.ok) throw new PnoteError('bad-document', `document failed §4 validation: ${docCheck.reason}`);

  /* decode assets (bounded, exact declared names only) */
  const assetMap = new Map<string, Uint8Array>();
  const mimes = new Map<string, string>();
  for (const a of manifest.assets) {
    const data = entries.get(a.file);
    if (!data) throw new PnoteError('missing-asset', `asset ${a.id} missing from package`);
    if (data.length > PNOTE_LIMITS.assetBytes) throw new PnoteError('too-large', `asset ${a.id} oversized`);
    assetMap.set(a.id, data);
    /* mime from the canonical extension (extOf inverse, allow-listed) */
    const ext = a.file.split('.').pop() ?? 'bin';
    const mime = ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'application/octet-stream';
    mimes.set(a.id, mime);
  }

  /* 4 — asset references resolve; data-URLs restored into the document */
  const { document: restored, missing } = restoreAssetsIntoDocument(rawDoc, (id) => {
    const bytes2 = assetMap.get(id);
    if (!bytes2) return null;
    return { mime: mimes.get(id) ?? 'application/octet-stream', bytes: bytes2 };
  });
  if (missing.size > 0) throw new PnoteError('missing-asset', `document references ${missing.size} missing asset(s)`);

  /* extra defensive pass on the restored document (data-URLs are big —
     still bounded by the same validator) */
  const finalCheck = pnoteValidateDocument(restored);
  if (!finalCheck.ok) throw new PnoteError('bad-document', `restored document failed validation: ${finalCheck.reason}`);

  return { manifest, document: restored as Record<string, unknown>, assets: assetMap, assetMimes: mimes };
}

/** informational: page count of a parsed package (1 + pageBreak nodes) */
export function pnotePageCount(pkg: PnotePackage): number {
  const content = pkg.document.content;
  return 1 + (Array.isArray(content) ? (content as Array<{ type?: string }>).filter((b) => b?.type === 'pageBreak').length : 0);
}

export { assetToDataUrl };
