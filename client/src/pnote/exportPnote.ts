/* ═══════════════════════════════════════════════════════════════════════
   pnote/exportPnote — .pnote SERIALIZER (Part A).

   NATIVE pipeline:
     TipTap/Note document (§4 shape) → Pnote Serializer → .pnote package

   The package contains exactly:
     manifest.json   — format identity + version + asset manifest
     document.json   — the §4 document with data-URLs swapped for
                       `pnote-asset:<id>` package-relative references
     assets/<id>.<ext> — the extracted binary image payloads

   What is packaged (§1 of the task — everything the §4 contract holds):
   the TipTap JSON (paragraphs, headings, formatting, alignment, lists,
   tables + design attrs, structured equation ASTs, Edu Blocks with their
   persisted attrs, pageBreak nodes), page ids/order/kind/auto, the
   floatingElements (types, geometry, text, image objects) and the
   per-note noteDesign. What is NEVER packaged (§22): auth state, JWTs,
   session/collab ids, server internals, user ids, group ownership —
   a .pnote carries document data only, and importing it can never grant
   access to another user's resources.
   ═══════════════════════════════════════════════════════════════════════ */

import { PNOTE_FORMAT, PNOTE_FORMAT_VERSION, PNOTE_LIMITS } from './format';
import { buildZip, type ZipEntry } from './zip';
import { extractAssetsFromDocument } from './assets';
import { pnoteValidateDocument } from './validate';

/** portable random id (crypto when available) */
function randomId(): string {
  try {
    const b = new Uint8Array(8);
    (globalThis.crypto ?? { getRandomValues: () => b } as never).getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  } catch {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
}

/** input accepted by the exporter: the §4 stored content object
 *  ({ type:'doc', …, floatingElements?, noteDesign? }) */
export interface PnoteExportInput {
  /** the §4 stored content (merged document, exactly what autosave saves) */
  content: Record<string, unknown>;
  /** informational title (document title, NOT persisted as identity) */
  title?: string;
}

export interface PnoteExportResult {
  bytes: Uint8Array;
  /** suggested file name (title-based, .pnote) */
  fileName: string;
  pageCount: number;
  assetCount: number;
}

/** safe file-name slug from a Persian title */
function slugify(title: string): string {
  const clean = (title || 'note').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 60);
  return clean || 'note';
}

/**
 * Serialize the current document into a .pnote package.
 * Runs ONCE per export (§23): validate once, extract assets once, build
 * the ZIP once. Throws only on impossible states (the document being
 * exported always comes from the editor and is valid by construction —
 * validation here is the §21 gate for the EXPORT payload too).
 */
export async function exportPnote(input: PnoteExportInput): Promise<PnoteExportResult> {
  /* the exported document is validated with the SAME §4 validator the
     import path uses — one document contract, both directions */
  const check = pnoteValidateDocument(input.content);
  if (!check.ok) throw new Error(`pnote export: document invalid (${check.reason})`);

  /* extract binary assets ONCE and swap in package-relative references */
  const { document: packedDoc, assets } = extractAssetsFromDocument(input.content, PNOTE_LIMITS.assetBytes);

  const manifest = {
    format: PNOTE_FORMAT,
    formatVersion: PNOTE_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    app: 'Persian Notes',
    documentId: randomId(),
    title: input.title ?? '',
    assets: assets.map((a) => ({ id: a.id, file: `assets/${a.file}`, bytes: a.bytes.length })),
  };

  const docJson = JSON.stringify(packedDoc);
  const manifestJson = JSON.stringify(manifest, null, 2);

  const entries: ZipEntry[] = [
    { name: 'manifest.json', data: new TextEncoder().encode(manifestJson) },
    { name: 'document.json', data: new TextEncoder().encode(docJson) },
  ];
  for (const a of assets) entries.push({ name: `assets/${a.file}`, data: a.bytes, deflate: true });

  const bytes = await buildZip(entries);
  return {
    bytes,
    fileName: `${slugify(input.title ?? '')}.pnote`,
    pageCount: 1 + (Array.isArray(input.content.content) ? (input.content.content as Array<{ type?: string }>).filter((b) => b?.type === 'pageBreak').length : 0),
    assetCount: assets.length,
  };
}
