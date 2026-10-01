/* ═══════════════════════════════════════════════════════════════════════
   pnote/pdf/reconstruct — PDF text runs → EDITABLE TipTap pages (Part B).

   EXTERNAL pipeline (kept fully separate from .pnote — §9):
     PDF → parsePdf → layout/paragraph reconstruction → TipTap JSON
         → the EXISTING §4 page model (one merged document with
           pageBreak separators — NOT a second page system)

   What reconstruction does (§11–§15):
     • groups runs into LINES (y proximity, document-order sort)
     • groups lines into PARAGRAPHS (vertical gaps + indentation)
     • detects HEADINGS (font size ≫ body size)
     • reconstructs bullet/ordered LISTS from •/‑/* markers and "1." /
       "۱." numbering — consecutive items merge into ONE list node
     • assigns RTL to lines whose Persian/Arabic characters dominate
       (per-line dir attr — the EXISTING RTL architecture, no global
       direction hacks — §14)
     • preserves PAGE BOUNDARIES 1:1 (one PDF page → one Persian Notes
       page, merged with pageBreak separators, geometry untouched — §12/§13)
     • keeps Persian digits/letters untouched (no reordering games — the
       editor's bidi engine handles rendering; §14)

   NOT promised (§9): exact fonts, columns, tables, vector graphics.
   Tables are NOT invented — tabular-looking runs degrade to paragraphs.
   ═══════════════════════════════════════════════════════════════════════ */

import type { PdfPageText, PdfTextRun } from './parsePdf';

/* ── detection helpers ──────────────────────────────────────────────────── */

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
/** dominant RTL share of a string (Persian/Arabic vs everything else) */
function rtlShare(s: string): number {
  let rtl = 0, total = 0;
  for (const ch of s) {
    if (/\s/.test(ch)) continue;
    total++;
    if (ARABIC_RE.test(ch)) rtl++;
  }
  return total === 0 ? 0 : rtl / total;
}

/** bullet/numbered markers (Latin + Persian digits) */
const BULLET_RE = /^[\u2022\u25CF\u25AA\u25E6\u2023\u2043\u2219\u00B7\u25A0\u25AB\u2013\u2014*-]\s+/;
const ORDERED_RE = /^(\d{1,3}|[\u06F0-\u06F9\u0660-\u0669]{1,3})\s*[.)-]\s+/;
const ROMAN_RE = /^(?=[ivxlcIVXLC])[ivxlcIVXLC]{1,6}[.)]\s+/;

interface Line {
  y: number;
  x: number;
  xEnd: number;
  size: number;
  text: string;
  page: number;
}

/** group a page's runs into visual lines (tolerance scaled by font size) */
function runsToLines(runs: PdfTextRun[]): Line[] {
  if (runs.length === 0) return [];
  const sorted = [...runs].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Array<{ y: number; items: PdfTextRun[] }> = [];
  for (const r of sorted) {
    const tol = Math.max(2.5, (r.size || 12) * 0.55);
    const last = lines[lines.length - 1];
    if (last && Math.abs(r.y - last.y) <= tol) last.items.push(r);
    else lines.push({ y: r.y, items: [r] });
  }
  return lines.map((ln) => {
    const items = ln.items.sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd: number | null = null;
    for (const it of items) {
      /* gap between runs → a space (keeps words from fusing; RTL-safe
         because we never reorder, only concatenate) */
      if (prevEnd !== null && it.x - prevEnd > (it.size || 12) * 0.18) text += ' ';
      text += it.text;
      prevEnd = it.x + it.text.length * (it.size || 12) * 0.5;
    }
    text = text.replace(/\s+/g, ' ').trim();
    const sizes = items.map((i) => i.size || 12);
    const size = sizes.sort((a, b) => b - a)[Math.floor(sizes.length / 2)] ?? 12;
    return {
      y: ln.y,
      x: Math.min(...items.map((i) => i.x)),
      xEnd: Math.max(...items.map((i) => i.x + i.text.length * (i.size || 12) * 0.5)),
      size,
      text,
      page: items[0]?.y ?? 0,
    };
  }).filter((l) => l.text.length > 0);
}

/* ── TipTap JSON builders (existing schema only) ───────────────────────── */

type JsonNode = Record<string, unknown>;

function textNode(text: string): JsonNode {
  return { type: 'text', text };
}

function paragraph(text: string, dir?: 'rtl' | 'ltr', align?: string): JsonNode {
  const node: JsonNode = { type: 'paragraph', content: text ? [textNode(text)] : [] };
  const attrs: Record<string, unknown> = {};
  if (dir) attrs.dir = dir;
  if (align) attrs.textAlign = align;
  if (Object.keys(attrs).length) node.attrs = attrs;
  return node;
}

function heading(text: string, level: 1 | 2 | 3, dir: 'rtl' | 'ltr'): JsonNode {
  return { type: 'heading', attrs: { level, dir }, content: [textNode(text)] };
}

function bulletList(items: string[], dir: 'rtl' | 'ltr'): JsonNode {
  return {
    type: 'bulletList',
    attrs: { dir },
    content: items.map((t) => ({ type: 'listItem', attrs: { dir }, content: [paragraph(t, dir)] })),
  };
}

function orderedList(items: string[], dir: 'rtl' | 'ltr'): JsonNode {
  return {
    type: 'orderedList',
    attrs: { dir },
    content: items.map((t) => ({ type: 'listItem', attrs: { dir }, content: [paragraph(t, dir)] })),
  };
}

/* ── page reconstruction ────────────────────────────────────────────────── */

export interface ReconstructOptions {
  /** median body font size override (computed when omitted) */
  bodySize?: number;
}

/** reconstruct ONE PDF page into TipTap block nodes */
export function reconstructPage(page: PdfPageText, opts: ReconstructOptions = {}): JsonNode[] {
  const lines = runsToLines(page.runs);
  if (lines.length === 0) return [];

  /* body size = MODE of the line sizes (a heading-heavy page must not
     push the "normal" size up — the modal size is the body text) */
  let bodySize = opts.bodySize ?? 12;
  if (opts.bodySize === undefined) {
    const counts = new Map<number, number>();
    for (const l of lines) {
      const bucket = Math.round(l.size * 2) / 2;
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    let best = 12, bestN = -1;
    for (const [size, n] of counts) {
      if (n > bestN || (n === bestN && size < best)) { best = size; bestN = n; }
    }
    bodySize = best;
  }
  const pageWidth = page.width || 612;

  /* paragraph-gap threshold from the page's OWN line rhythm: the MEDIAN
     gap of adjacent body-size lines. A fixed pt threshold mis-split
     every document whose leading exceeded it (12pt body @ 15pt leading
     → one paragraph PER line). A paragraph break is a gap clearly above
     the document's normal leading. */
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i].y - lines[i - 1].y;
    const bodyish = (s: number) => Math.abs(s - bodySize) <= bodySize * 0.18;
    if (gap > 0 && gap < bodySize * 6 && bodyish(lines[i].size) && bodyish(lines[i - 1].size)) gaps.push(gap);
  }
  let baseLeading = 0;
  if (gaps.length) {
    gaps.sort((a, b) => a - b);
    baseLeading = gaps[Math.floor(gaps.length / 2)];
  }
  const paraGap = Math.max(6, baseLeading > 0 ? baseLeading * 1.35 : bodySize * 0.85);
  const extraSplit = Math.max(6, bodySize * 0.75); /* or a big absolute jump above the leading */

  const blocks: JsonNode[] = [];

  /* paragraph grouping state */
  let pending: Array<{ text: string; dir: 'rtl' | 'ltr'; size: number; indent: number; first: boolean }> = [];

  const flushPending = () => {
    if (pending.length === 0) return;
    const first = pending[0];
    /* single-line pending → its own paragraph; multi-line → merged */
    const text = pending.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim();
    const size = first.size;
    const dir = first.dir;
    if (size >= bodySize * 1.45) blocks.push(heading(text, 1, dir));
    else if (size >= bodySize * 1.22) blocks.push(heading(text, 2, dir));
    else if (size >= bodySize * 1.12 && pending.length === 1) blocks.push(heading(text, 3, dir));
    else blocks.push(paragraph(text, dir));
    pending = [];
  };

  const isBullet = (t: string) => BULLET_RE.test(t);
  const isOrdered = (t: string) => ORDERED_RE.test(t) || ROMAN_RE.test(t);
  const stripBullet = (t: string) => t.replace(BULLET_RE, '');
  const stripOrdered = (t: string) => t.replace(ORDERED_RE, '').replace(ROMAN_RE, '');

  let list: { kind: 'bullet' | 'ordered'; items: string[]; dir: 'rtl' | 'ltr' } | null = null;

  const flushList = () => {
    if (!list) return;
    if (list.items.length) {
      blocks.push(list.kind === 'bullet' ? bulletList(list.items, list.dir) : orderedList(list.items, list.dir));
    }
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.text;
    if (!text) continue;
    const dir: 'rtl' | 'ltr' = rtlShare(text) >= 0.34 ? 'rtl' : 'ltr';
    const indent = line.x;

    /* list markers */
    if (isBullet(text) || isOrdered(text)) {
      flushPending();
      const kind = isBullet(text) ? 'bullet' : 'ordered';
      const itemText = kind === 'bullet' ? stripBullet(text) : stripOrdered(text);
      if (list && list.kind !== kind) flushList();
      if (!list) list = { kind, items: [], dir };
      list.items.push(itemText);
      continue;
    }
    flushList();

    /* a direction change is a hard block boundary: a paragraph that
       flips RTL/LTR mid-block is almost always two separate blocks, and
       merging them would erase the Persian line's rtl dir (§14: per-line
       direction preservation — the test matrix pins this). */
    if (pending.length > 0 && pending[pending.length - 1].dir !== dir) flushPending();

    /* vertical gap → new paragraph */
    if (pending.length > 0) {
      const prev = pending[pending.length - 1];
      const prevLine = lines[i - 1];
      const gap = prevLine ? line.y - prevLine.y : 0;
      const sizeJump = Math.abs(line.size - prev.size) > bodySize * 0.18;
      const bigIndent = line.x - prevLine.x > bodySize * 1.6 && prev.first;
      const wideEnough = line.xEnd < pageWidth * 0.94; /* line ends short → paragraph end */
      if (gap > paraGap || gap - baseLeading >= extraSplit || sizeJump || (bigIndent && !wideEnough)) {
        flushPending();
      }
    }
    pending.push({ text, dir, size: line.size, indent, first: pending.length === 0 });
  }
  flushList();
  flushPending();

  return blocks;
}

/**
 * Reconstruct a WHOLE PDF into one §4 MERGED document:
 *   { type:'doc', content:[ page1 blocks, pageBreak, page2 blocks, … ] }
 * Page geometry is untouched (the merged doc IS the existing page model).
 * Empty pages (scanned) produce an empty paragraph so the page boundary
 * survives — the caller decides what to tell the user (§16/§17).
 */
export function reconstructDocument(pages: PdfPageText[]): Record<string, unknown> {
  /* body size from the WHOLE document: the MODE of run sizes (robust
     against many headings/large titles skewing the normal text size) */
  const counts = new Map<number, number>();
  for (const p of pages) {
    for (const r of p.runs) {
      const bucket = Math.round((r.size || 12) * 2) / 2;
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
  }
  let bodySize = 12, bestN = -1;
  for (const [size, n] of counts) {
    if (n > bestN || (n === bestN && size < bodySize)) { bodySize = size; bestN = n; }
  }

  const blocks: JsonNode[] = [];
  pages.forEach((page, idx) => {
    if (idx > 0) blocks.push({ type: 'pageBreak' });
    const pageBlocks = reconstructPage(page, { bodySize });
    blocks.push(...(pageBlocks.length ? pageBlocks : [paragraph('', 'rtl')]));
  });

  return { type: 'doc', content: blocks };
}

/** stats used for the honest partial-import messaging (§17) */
export function reconstructStats(pages: PdfPageText[]): { pages: number; textPages: number; imageOnlyPages: number; chars: number } {
  let textPages = 0, imageOnlyPages = 0, chars = 0;
  for (const p of pages) {
    const c = p.runs.reduce((s, r) => s + r.text.replace(/\s/g, '').length, 0);
    if (p.imageOnly || c < 12) imageOnlyPages++;
    else textPages++;
    chars += c;
  }
  return { pages: pages.length, textPages, imageOnlyPages, chars };
}
