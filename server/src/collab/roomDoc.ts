/* ═══════════════════════════════════════════════════════════════════════
   Room → document projection.

   The collaboration Y.Doc stores, per A4 sheet, a Y.XmlFragment named
   `page:<pageId>` holding that sheet's TipTap content as y-prosemirror
   XML (element names = TipTap node types; attrs on the Y.XmlElement;
   marks as inline XmlElement wrappers produced by y-prosemirror).

   The PERSISTED Note must keep the EXISTING §4 storage contract: ONE
   TipTap doc with top-level `pageBreak` separators and the `floatingElements`
   key. The CLIENT adapter owns the authoritative merge (it holds the live
   editors, page kinds, float model and page identity) and submits the
   merged doc via the `doc` frame; this projection is the server-side
   fallback used when the room persists on a timer without a recent client
   submission.

   STRUCTURE SOURCE: the SEMANTIC model — Y.Array 'pageOrder' (ordered
   pageIds) + Y.Map 'pageMeta' (kind/auto). pageNumber is DERIVED here
   (UI info only), never persisted as identity. Floats are projected from
   the per-object Y.Maps `floatObj:<pageId>` so the latest property-level
   merges land in the §4 array.
   ═══════════════════════════════════════════════════════════════════════ */

import * as Y from 'yjs';
import type { CollabRoom } from './rooms.js';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';

/** project one page's floatObj Y.Map → the §4 FloatingElement array */
export function floatListFromYRoom(room: CollabRoom, pageId: string): Array<Record<string, unknown>> {
  const objMap = room.doc.getMap(`floatObj:${pageId}`);
  const out: Array<Record<string, unknown>> = [];
  for (const [oid, raw] of objMap.entries()) {
    if (!(raw instanceof Y.Map)) continue;
    const props: Record<string, unknown> = { id: oid };
    for (const [k, v] of raw.entries()) props[k] = v;
    out.push(props);
  }
  /* stable order: by 'order' attr when present, else insertion */
  out.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
  return out;
}

/** Derive a full §4-shape document from the room's page fragments. Page
 *  ids, kinds and floating elements come from the SEMANTIC structure
 *  (pageOrder + pageMeta) written by the clients' semantic ops. */
export function docJsonFromYRoom(room: CollabRoom): Record<string, unknown> | null {
  const structure = room.structure;
  /* a client-submitted merged doc always wins when fresh */
  const pending = structure.get('pendingDoc');
  if (pending && typeof pending === 'object') return pending as Record<string, unknown>;

  /* SEMANTIC source of truth: pageOrder + pageMeta */
  const order = room.pageOrder.toArray();
  if (order.length > 0) {
    const blocks: Array<Record<string, unknown>> = [];
    let allFloats: Array<Record<string, unknown>> = [];
    order.forEach((pageId, idx) => {
      if (typeof pageId !== 'string' || !pageId) return;
      if (blocks.length > 0) {
        const meta = (room.pageMeta.get(pageId) ?? {}) as Record<string, unknown>;
        const attrs: Record<string, unknown> = { pid: pageId };
        const kind = typeof meta.kind === 'string' ? meta.kind : 'framed';
        if (kind !== 'framed') attrs.kind = kind;
        if (meta.auto === true) attrs.auto = true;
        blocks.push({ type: 'pageBreak', attrs });
      }
      const frag = room.doc.getXmlFragment(`page:${pageId}`);
      let content: unknown[] = [];
      try {
        const json = yXmlFragmentToProsemirrorJSON(frag) as unknown as { content?: unknown[] };
        content = Array.isArray(json?.content) ? json.content : [];
      } catch {
        content = [];
      }
      blocks.push(...(content.length ? (content as Array<Record<string, unknown>>) : [{ type: 'paragraph' }]));
      allFloats = allFloats.concat(floatListFromYRoom(room, pageId));
    });
    if (blocks.length > 0) {
      const firstMeta = (room.pageMeta.get(order[0]) ?? {}) as Record<string, unknown>;
      const firstKind = typeof firstMeta.kind === 'string' ? firstMeta.kind : 'framed';
      const doc: Record<string, unknown> = { type: 'doc', content: blocks };
      if (firstKind !== 'framed') doc.attrs = { pageKind: firstKind };
      doc.floatingElements = allFloats;
      return doc;
    }
  }

  /* fallback: the legacy 'pages' snapshot mirror (pre-semantic rooms) */
  const pages = structure.get('pages');
  if (!Array.isArray(pages) || pages.length === 0) {
    const lastSaved = structure.get('lastSavedDoc');
    return (lastSaved && typeof lastSaved === 'object') ? (lastSaved as Record<string, unknown>) : null;
  }

  const blocks: Array<Record<string, unknown>> = [];
  for (const rawPage of pages as unknown[]) {
    const p = (rawPage ?? {}) as Record<string, unknown>;
    if (blocks.length > 0) {
      const attrs: Record<string, unknown> = {};
      if (p.kind && p.kind !== 'framed') attrs.kind = p.kind;
      if (p.auto === true) attrs.auto = true;
      blocks.push(Object.keys(attrs).length ? { type: 'pageBreak', attrs } : { type: 'pageBreak' });
    }
    const fragName = `page:${p.id}`;
    const frag = room.doc.getXmlFragment(fragName);
    let content: unknown[] = [];
    try {
      const json = yXmlFragmentToProsemirrorJSON(frag) as unknown as { content?: unknown[] };
      content = Array.isArray(json?.content) ? json.content : [];
    } catch {
      content = [];
    }
    blocks.push(...(content.length ? (content as Array<Record<string, unknown>>) : [{ type: 'paragraph' }]));
  }

  const firstRaw = (pages as unknown[])[0];
  const first = (firstRaw ?? {}) as Record<string, unknown>;
  const doc: Record<string, unknown> = { type: 'doc', content: blocks };
  if (first?.kind && first.kind !== 'framed') doc.attrs = { pageKind: first.kind };
  return doc;
}
