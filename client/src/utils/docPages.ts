/* ═══════════════════════════════════════════════════════════════════════
   docPages — the §4 PAGE MODEL as pure functions (EXTRACTED, not rebuilt).

   splitDocIntoPages / mergePagesIntoDoc / splitContent / mergeContent
   lived inside EditorPage.tsx; they are pure document⇄pages projections
   that ALSO need the .pnote serializer (identical multi-page semantics:
   pageBreak separators carry pid/kind/auto/headerLabel/cover, doc attrs
   carry pageKind/pageCover for the first sheet). EditorPage imports the
   same functions from here — ONE page model, zero drift. The logic is
   MOVED verbatim (HANDOFF §4 contract unchanged), with only the
   React-free types coming along.
   ═══════════════════════════════════════════════════════════════════════ */

import type { PageKind, PageCoverAttrs } from '@/types';

export const A4_W_PX = 794;
export const A4_H_PX = 1123;

export const PAGE_KINDS: PageKind[] = ['framed', 'blank', 'notebook', 'cover', 'toc', 'booklet'];
export function isPageKind(v: unknown): v is PageKind {
  return typeof v === 'string' && (PAGE_KINDS as string[]).includes(v);
}

/** split the stored `content` object into (TipTap doc, floats, design) —
 *  TipTap must never see the foreign floatingElements/noteDesign keys. */
export function splitContent(raw: Record<string, unknown>): { doc: Record<string, unknown>; floats: Array<Record<string, unknown>>; design?: Record<string, unknown> } {
  const floats = Array.isArray(raw?.floatingElements) ? (raw.floatingElements as Array<Record<string, unknown>>) : [];
  const doc: Record<string, unknown> = { ...raw };
  delete doc.floatingElements;
  const design = doc.noteDesign as Record<string, unknown> | undefined;
  delete doc.noteDesign;
  return { doc, floats, design };
}

/** merge (doc, floats, design) back into the §4 stored content object */
export function mergeContent(doc: Record<string, unknown>, floats: Array<Record<string, unknown>>, design?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...doc, floatingElements: floats };
  /* an empty design object must NOT persist — keeps old notes byte-stable */
  if (design && Object.keys(design).length > 0) out.noteDesign = design;
  return out;
}

export interface SplitPage {
  id?: string;
  content: Record<string, unknown>;
  kind: PageKind;
  auto: boolean;
  cover?: PageCoverAttrs;
  headerLabel?: string;
}

/** Split a stored document JSON into per-page docs (the collab-invariant
 *  id derivation: first page `p1`, later pages the pageBreak `pid` attr
 *  else the ordinal `p<N>`. A trailing empty non-front-matter chunk is
 *  dropped; cover/toc sheets stay because they are content-free by
 *  design. MOVED VERBATIM from EditorPage — do not re-derive here.) */
export function splitDocIntoPages(doc: Record<string, unknown> | null): SplitPage[] {
  const blocks = Array.isArray(doc?.content) ? (doc.content as Record<string, unknown>[]) : [];
  const docAttrs = (doc?.attrs ?? {}) as Record<string, unknown>;
  const firstKind: PageKind = isPageKind(docAttrs.pageKind) ? docAttrs.pageKind : 'framed';
  const firstCover = docAttrs.pageCover as PageCoverAttrs | undefined;
  const chunks: Array<{ id?: string; nodes: Record<string, unknown>[]; kind: PageKind; auto: boolean; cover?: PageCoverAttrs; headerLabel?: string }> = [{ id: 'p1', nodes: [], kind: firstKind, auto: false, cover: firstKind === 'cover' ? firstCover : undefined }];
  let ordinal = 1;
  for (const block of blocks) {
    if (block?.type === 'pageBreak') {
      const attrs = (block.attrs ?? {}) as Record<string, unknown>;
      ordinal += 1;
      chunks.push({ id: typeof attrs.pid === 'string' && attrs.pid ? attrs.pid : `p${ordinal}`, nodes: [], kind: isPageKind(attrs.kind) ? attrs.kind : 'framed', auto: attrs.auto === true, cover: (attrs.cover as PageCoverAttrs | undefined) ?? undefined, headerLabel: typeof attrs.headerLabel === 'string' ? attrs.headerLabel : undefined });
      continue;
    }
    chunks[chunks.length - 1].nodes.push(block);
  }
  const lastChunk = chunks[chunks.length - 1];
  if (
    chunks.length > 1 &&
    lastChunk.nodes.length === 0 &&
    lastChunk.kind !== 'cover' &&
    lastChunk.kind !== 'toc'
  ) {
    chunks.pop();
  }
  /* PAGE-ID DEDUPE (crash report: «جلد آپلودی + لاگین دوباره → صفحات جلد
     سفید و بقیه غیرقابل استفاده»). The first chunk is hardcoded `p1`, and a
     pageBreak may ALSO carry pid='p1' — that happens whenever a cover is
     inserted at the top AFTER the note was saved: the cover takes over the
     doc-attrs kind while the old first sheet keeps its persisted `p1` pid
     on its break. On reload BOTH pages then claim `p1` → two editors bind
     to ONE collab fragment, React keys collide, the cover renders blank
     and the other sheets break. Dedupe: the FIRST claimant keeps the id;
     later duplicates get a fresh deterministic-but-unique id (they will be
     re-persisted on the next save, healing the stored document). */
  const seen = new Set<string>();
  let dedupe = 0;
  const uniqueChunks = chunks.map((c) => {
    if (!c.id || !seen.has(c.id)) {
      if (c.id) seen.add(c.id);
      return c;
    }
    let fresh: string;
    do {
      dedupe += 1;
      fresh = `p${chunks.length + dedupe}-${Date.now().toString(36)}`;
    } while (seen.has(fresh));
    seen.add(fresh);
    return { ...c, id: fresh };
  });
  return uniqueChunks.map((c) => ({
    id: c.id,
    kind: c.kind,
    auto: c.auto,
    coverAttrs: c.cover,
    headerLabel: c.headerLabel,
    content: {
      type: 'doc',
      content: c.nodes.length ? c.nodes : [{ type: 'paragraph' }],
    },
  }));
}

export interface MergePage {
  id?: string;
  content: Record<string, unknown> | null;
  kind?: PageKind;
  auto?: boolean;
  coverAttrs?: PageCoverAttrs;
  headerLabel?: string;
  floatingElements?: unknown[];
}

/** Merge pages back into ONE stored document with pageBreak separators
 *  between them (§4 storage format, backward-compatible with the legacy
 *  single-sheet shape). Inline pageBreaks inside page content are dropped
 *  (never persist a phantom empty page). MOVED VERBATIM from EditorPage. */
export function mergePagesIntoDoc(pages: MergePage[]): Record<string, unknown> {
  const blocks: Record<string, unknown>[] = [];
  pages.forEach((p) => {
    if (blocks.length > 0) {
      const attrs: Record<string, unknown> = {};
      if (p.id) attrs.pid = p.id;
      if (p.kind && p.kind !== 'framed') attrs.kind = p.kind;
      if (p.auto) attrs.auto = true;
      if (p.headerLabel !== undefined) attrs.headerLabel = p.headerLabel;
      if (p.coverAttrs) attrs.cover = p.coverAttrs;
      blocks.push(Object.keys(attrs).length ? { type: 'pageBreak', attrs } : { type: 'pageBreak' });
    }
    const arr = Array.isArray(p.content?.content)
      ? (p.content.content as Record<string, unknown>[])
      : [];
    blocks.push(...arr.filter((n) => n?.type !== 'pageBreak'));
  });
  const firstKind = pages[0]?.kind ?? 'framed';
  const doc: Record<string, unknown> = {
    type: 'doc',
    content: blocks.length ? blocks : [{ type: 'paragraph' }],
  };
  if (firstKind !== 'framed') doc.attrs = { pageKind: firstKind };
  if (firstKind === 'cover' && pages[0]?.coverAttrs) {
    doc.attrs = { ...(doc.attrs as Record<string, unknown> ?? {}), pageCover: pages[0]!.coverAttrs };
  }
  return doc;
}
