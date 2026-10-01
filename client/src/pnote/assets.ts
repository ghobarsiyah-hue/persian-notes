/* ═══════════════════════════════════════════════════════════════════════
   pnote/assets — data-URL ↔ package-asset handling (§4 of the task).

   In the EXISTING architecture every image (floating objects, cover
   artwork) is stored as a data-URL INSIDE the note document — there is
   no upload pipeline and no server asset store. The .pnote package
   therefore treats data-URLs as the "asset references": at EXPORT time
   each unique data-URL is extracted into assets/<id>.<ext> and replaced
   by a stable package-relative reference `pnote-asset:<id>`; at IMPORT
   time the bytes are decoded back into data-URLs and the references are
   rewritten, so the document the editor receives looks EXACTLY like one
   saved by the normal pipeline.

   No local filesystem paths, no temporary browser URLs — the package is
   self-contained and portable (§4/§22).
   ═══════════════════════════════════════════════════════════════════════ */

/** a data-URL with the shape `data:<mime>;base64,<payload>` */
const DATA_URL_RE = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/;

/** `pnote-asset:<id>` — the package-relative reference that replaces a
 *  data-URL inside document.json while it lives in the package. */
export const ASSET_SCHEME = 'pnote-asset:';

export interface ExtractedAsset {
  id: string;
  /** declared MIME type (kept in the manifest) */
  mime: string;
  bytes: Uint8Array;
  /** canonical file name inside the package's assets/ folder */
  file: string;
}

/** MIME → canonical extension (small allow-list; unknown → .bin) */
function extOf(mime: string): string {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    case 'image/svg+xml': return 'svg';
    default: return 'bin';
  }
}

/** base64 (with optional whitespace) → bytes */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** bytes → base64 (chunked to avoid call-stack limits on big images) */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

/**
 * EXPORT side: walk the whole document, replace every base64 data-URL
 * found in `src`-like string fields with `pnote-asset:<id>` references,
 * and collect the extracted binary assets. Deterministic: identical
 * data-URLs map to ONE asset (deduplicated by content hash of the
 * base64 payload), so round-trips are byte-stable.
 *
 * The walk is bounded (the §4 validator bounds documents far harder);
 * unknown node shapes pass through untouched — this never mutates
 * anything but src-like string fields.
 */
export function extractAssetsFromDocument(
  doc: unknown,
  dataUrlBytesLimit: number,
): { document: unknown; assets: ExtractedAsset[] } {
  const byPayload = new Map<string, ExtractedAsset>();
  const assets: ExtractedAsset[] = [];
  let counter = 0;

  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (node === null || typeof node !== 'object') return node;
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && (k === 'src' || k === 'coverSrc')) {
        const m = DATA_URL_RE.exec(v);
        if (m) {
          const bytes = base64ToBytes(m[2]);
          if (bytes.length <= dataUrlBytesLimit) {
            const key = m[1] + ':' + m[2];
            let asset = byPayload.get(key);
            if (!asset) {
              counter += 1;
              asset = { id: `a${counter}`, mime: m[1], bytes, file: `a${counter}.${extOf(m[1])}` };
              byPayload.set(key, asset);
              assets.push(asset);
            }
            out[k] = ASSET_SCHEME + asset.id;
            continue;
          }
        }
      }
      out[k] = visit(v);
    }
    return out;
  };

  return { document: visit(doc), assets };
}

/** decode one package asset back to a data-URL */
export function assetToDataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/**
 * IMPORT side: walk the document and rewrite every
 * `pnote-asset:<id>` reference back into a data-URL using the decoded
 * package assets. Returns the set of referenced ids — the caller rejects
 * the import when a reference has no matching asset in the package
 * (missing-asset; §21 "validate asset references").
 */
export function restoreAssetsIntoDocument(
  doc: unknown,
  resolve: (id: string) => { mime: string; bytes: Uint8Array } | null,
): { document: unknown; missing: Set<string> } {
  const missing = new Set<string>();
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (node === null || typeof node !== 'object') return node;
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.startsWith(ASSET_SCHEME) && (k === 'src' || k === 'coverSrc')) {
        const id = v.slice(ASSET_SCHEME.length);
        const found = resolve(id);
        if (!found) { missing.add(id); out[k] = v; continue; }
        out[k] = assetToDataUrl(found.mime, found.bytes);
        continue;
      }
      out[k] = visit(v);
    }
    return out;
  };
  return { document: visit(doc), missing };
}
