/* ═══════════════════════════════════════════════════════════════════════
   §4 document validator — corruption defense at the state boundaries.

   Treated as UNTRUSTED INPUT (§19): the persisted Note (room seed), the
   projected canonical doc (before every Mongo flush) and a restored
   Version payload are all validated with the SAME lightweight structural
   check before they may become (or be persisted as) canonical state.

   Design rules:
     - DETECT, never repair: an invalid snapshot is REJECTED with a safe
       diagnostic reason; the caller keeps the previous known-good state.
       No silent data mutation ever happens here.
     - Extend the existing conventions instead of a second schema system:
       the checks mirror the §4 storage contract (type:'doc', content
       array, pageBreak separators with pid/kind/auto, floatingElements
       list, bounded size) and the id grammar already enforced by
       protocol.ts.
     - Bounded work: deep-walks at most MAX_WALKED_NODES nodes — a
       hostile/corrupt payload cannot burn the event loop.
     - NEVER logs or returns document content, only shape reasons.
   ═══════════════════════════════════════════════════════════════════════ */

export type SnapshotValidation =
  | { ok: true }
  | { ok: false; reason: string };

/** upper bounds — far above any real document, far below dangerous */
const MAX_TOP_LEVEL_BLOCKS = 50_000;
const MAX_FLOATS = 5_000;
const MAX_JSON_BYTES = 32 * 1024 * 1024; /* matches express json limit */
const MAX_WALKED_NODES = 200_000;

const ID_RE = /^[A-Za-z0-9_\-:.]+$/;
const VALID_KINDS = new Set(['framed', 'blank', 'notebook', 'cover', 'toc', 'booklet']);

/** validate one pageBreak separator's attrs (pid/kind/auto identity) */
function validBreakAttrs(attrs: unknown): boolean {
  if (attrs === null || attrs === undefined) return true; /* legacy break */
  if (typeof attrs !== 'object') return false;
  const a = attrs as Record<string, unknown>;
  if (a.pid !== undefined && (typeof a.pid !== 'string' || !a.pid || a.pid.length > 128 || !ID_RE.test(a.pid))) return false;
  if (a.kind !== undefined && (typeof a.kind !== 'string' || !VALID_KINDS.has(a.kind))) return false;
  if (a.auto !== undefined && typeof a.auto !== 'boolean') return false;
  return true;
}

/** shallow structural walk — detects cycles + impossible shapes cheaply */
function walkOk(root: unknown): boolean {
  let budget = MAX_WALKED_NODES;
  const seen = new Set<unknown>();
  const stack: unknown[] = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === null || typeof cur !== 'object') continue;
    if (seen.has(cur)) return false; /* cyclic — corrupt */
    seen.add(cur);
    if (--budget < 0) return false; /* implausibly deep/wide */
    if (Array.isArray(cur)) {
      for (const c of cur) stack.push(c);
    } else {
      for (const v of Object.values(cur as Record<string, unknown>)) stack.push(v);
    }
  }
  return true;
}

/**
 * Validate a §4-shape note snapshot (TipTap doc + floatingElements).
 * Backward compatible: legacy single-page docs, breaks without attrs and
 * missing floatingElements are all VALID (never require a migration).
 */
export function validateNoteDocument(doc: unknown): SnapshotValidation {
  if (doc === null || doc === undefined) return { ok: true }; /* empty room seed is legal */
  if (typeof doc !== 'object') return { ok: false, reason: 'not-an-object' };
  if (doc instanceof Date || Array.isArray(doc)) return { ok: false, reason: 'impossible-top-level-shape' };
  const d = doc as Record<string, unknown>;
  if (d.type !== 'doc') return { ok: false, reason: 'type-missing-or-not-doc' };

  /* bounded overall size (cheap string check — no full serialization in
     the hot path beyond what flush/seed already do) */
  let json: string | null = null;
  try {
    json = JSON.stringify(doc);
  } catch {
    return { ok: false, reason: 'unserializable' };
  }
  if (json && json.length > MAX_JSON_BYTES) return { ok: false, reason: 'oversized' };

  const content = d.content;
  if (content !== undefined && !Array.isArray(content)) return { ok: false, reason: 'content-not-array' };
  if (Array.isArray(content)) {
    if (content.length > MAX_TOP_LEVEL_BLOCKS) return { ok: false, reason: 'too-many-blocks' };
    let breaks = 0;
    for (const b of content) {
      if (b === null || typeof b !== 'object' || Array.isArray(b)) return { ok: false, reason: 'block-not-object' };
      const block = b as Record<string, unknown>;
      if (typeof block.type !== 'string' || !block.type) return { ok: false, reason: 'block-type-missing' };
      if (block.type === 'pageBreak') {
        breaks++;
        if (!validBreakAttrs(block.attrs)) return { ok: false, reason: 'malformed-pagebreak-attrs' };
      }
    }
    /* duplicate page ids would bind TWO editors to ONE fragment — detect
       them here so they can never become canonical */
    const ids = new Set<string>();
    let ordinal = 1;
    for (const b of content as Array<Record<string, unknown>>) {
      if (b.type !== 'pageBreak') continue;
      const attrs = (b.attrs ?? {}) as Record<string, unknown>;
      const id = typeof attrs.pid === 'string' && attrs.pid ? attrs.pid : `p${++ordinal}`;
      if (ids.has(id)) return { ok: false, reason: `duplicate-page-id:${id}` };
      ids.add(id);
    }
    void breaks;
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

  /* cyclic / impossible nesting anywhere in the tree */
  if (!walkOk(d)) return { ok: false, reason: 'cyclic-or-too-deep' };

  return { ok: true };
}
