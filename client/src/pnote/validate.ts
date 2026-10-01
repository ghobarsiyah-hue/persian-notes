/* ═══════════════════════════════════════════════════════════════════════
   pnote/validate — client-side §4 document validation (IMPORT BOUNDARY).

   This is the CLIENT twin of server/src/collab/validateDoc.ts (same §4
   contract, same reject-never-repair policy, same bounds). It is used by
   the .pnote import to validate document.json BEFORE anything reaches
   the editor, and by the PDF importer for the generated pages.

   NOT a second validation framework: the checks deliberately mirror the
   ONE §4 storage contract (type:'doc', content array, pageBreak
   separators with pid/kind/auto, floatingElements list, bounded size,
   no cycles) so client and server keep agreeing on what a valid document
   is. Detect, never repair — an invalid payload is rejected with a
   reason, never silently mutated.
   ═══════════════════════════════════════════════════════════════════════ */

export type DocValidation =
  | { ok: true }
  | { ok: false; reason: string };

/** upper bounds — identical philosophy to the server validator */
const MAX_TOP_LEVEL_BLOCKS = 50_000;
const MAX_FLOATS = 5_000;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_WALKED_NODES = 200_000;

const ID_RE = /^[A-Za-z0-9_\-:.]+$/;
const VALID_KINDS = new Set(['framed', 'blank', 'notebook', 'cover', 'toc', 'booklet']);

function validBreakAttrs(attrs: unknown): boolean {
  if (attrs === null || attrs === undefined) return true; /* legacy break */
  if (typeof attrs !== 'object') return false;
  const a = attrs as Record<string, unknown>;
  if (a.pid !== undefined && (typeof a.pid !== 'string' || !a.pid || a.pid.length > 128 || !ID_RE.test(a.pid))) return false;
  if (a.kind !== undefined && (typeof a.kind !== 'string' || !VALID_KINDS.has(a.kind))) return false;
  if (a.auto !== undefined && typeof a.auto !== 'boolean') return false;
  return true;
}

/** bounded structural walk — cycles and impossible shapes reject cheaply */
function walkOk(root: unknown): boolean {
  let budget = MAX_WALKED_NODES;
  const seen = new Set<unknown>();
  const stack: unknown[] = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === null || typeof cur !== 'object') continue;
    if (seen.has(cur)) return false;
    seen.add(cur);
    if (--budget < 0) return false;
    if (Array.isArray(cur)) { for (const c of cur) stack.push(c); }
    else { for (const v of Object.values(cur as Record<string, unknown>)) stack.push(v); }
  }
  return true;
}

/**
 * Validate a §4-shape document ({ type:'doc', content, floatingElements? }).
 * Backward compatible: legacy single-page docs, attr-less breaks and
 * missing floatingElements are VALID (never require a migration).
 */
export function pnoteValidateDocument(doc: unknown): DocValidation {
  if (doc === null || doc === undefined) return { ok: true };
  if (typeof doc !== 'object') return { ok: false, reason: 'not-an-object' };
  if (doc instanceof Date || Array.isArray(doc)) return { ok: false, reason: 'impossible-top-level-shape' };
  const d = doc as Record<string, unknown>;
  if (d.type !== 'doc') return { ok: false, reason: 'type-missing-or-not-doc' };

  let json: string | null = null;
  try { json = JSON.stringify(doc); } catch { return { ok: false, reason: 'unserializable' }; }
  if (json && json.length > MAX_JSON_BYTES) return { ok: false, reason: 'oversized' };

  const content = d.content;
  if (content !== undefined && !Array.isArray(content)) return { ok: false, reason: 'content-not-array' };
  if (Array.isArray(content)) {
    if (content.length > MAX_TOP_LEVEL_BLOCKS) return { ok: false, reason: 'too-many-blocks' };
    for (const b of content) {
      if (b === null || typeof b !== 'object' || Array.isArray(b)) return { ok: false, reason: 'block-not-object' };
      const block = b as Record<string, unknown>;
      if (typeof block.type !== 'string' || !block.type) return { ok: false, reason: 'block-type-missing' };
      if (block.type === 'pageBreak' && !validBreakAttrs(block.attrs)) return { ok: false, reason: 'malformed-pagebreak-attrs' };
    }
    /* duplicate page ids would bind TWO editors to ONE collab fragment */
    const ids = new Set<string>();
    let ordinal = 1;
    for (const b of content as Array<Record<string, unknown>>) {
      if (b.type !== 'pageBreak') continue;
      const attrs = (b.attrs ?? {}) as Record<string, unknown>;
      const id = typeof attrs.pid === 'string' && attrs.pid ? attrs.pid : `p${++ordinal}`;
      if (ids.has(id)) return { ok: false, reason: `duplicate-page-id:${id}` };
      ids.add(id);
    }
  }

  const floats = d.floatingElements;
  if (floats !== undefined) {
    if (!Array.isArray(floats)) return { ok: false, reason: 'floats-not-array' };
    if (floats.length > MAX_FLOATS) return { ok: false, reason: 'too-many-floats' };
    const fids = new Set<string>();
    for (const f of floats) {
      if (f === null || typeof f !== 'object' || Array.isArray(f)) return { ok: false, reason: 'float-not-object' };
      const oid = (f as Record<string, unknown>).id;
      if (typeof oid !== 'string' || !oid || oid.length > 128 || !ID_RE.test(oid)) return { ok: false, reason: 'float-id-invalid' };
      if (fids.has(oid)) return { ok: false, reason: `duplicate-float-id:${oid}` };
      fids.add(oid);
    }
  }

  if (!walkOk(d)) return { ok: false, reason: 'cyclic-or-too-deep' };
  return { ok: true };
}
