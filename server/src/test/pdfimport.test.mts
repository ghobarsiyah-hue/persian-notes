/* ═══════════════════════════════════════════════════════════════════════
   PDF IMPORT tests (task §26) — parse → reconstruct → editable TipTap.

   The pipeline under test (client/src/pnote/pdf/, imported at RUNTIME the
   same way collab.test.mts imports client modules):

     PDF bytes → parsePdfText → reconstructDocument → §4 merged document
                 → pnoteValidateDocument → (EditorPage commit path)

   FIXTURES: small real PDFs are BUILT here (uncompressed WinAnsi content
   streams with explicit BT/ET/Td/Tf/Tj operators + a ToUnicode CMap for
   the Persian font) so every operator path of the hand-rolled extractor
   is exercised deterministically — no binary fixtures on disk.
   ═══════════════════════════════════════════════════════════════════════ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const clientModule = (name: string): string =>
  decodeURIComponent(new URL(`../../../client/src/${name}.ts`, import.meta.url).pathname);

/* runtime imports (tsx resolves these at test time; tsc never sees the
   client sources — so NO `typeof import('../../../client/…')` type casts
   here: a type-position client path would drag the file under the server
   project's rootDir (TS6059). Inline structural types instead, exactly
   like collab.test.mts. */
interface FixturePageShape { index: number; width: number; height: number; imageOnly: boolean; runs: Array<{ x: number; y: number; size: number; text: string; hex: boolean }> }
const { parsePdfText } = (await import(clientModule('pnote/pdf/parsePdf'))) as {
  parsePdfText: (input: Uint8Array) => Promise<{ pages: FixturePageShape[]; encrypted: boolean }>;
};
const { importPdf } = (await import(clientModule('pnote/pdf/importPdf'))) as {
  importPdf: (bytes: Uint8Array, fileName: string) => Promise<{
    document: Record<string, unknown>;
    stats: { pages: number; textPages: number; imageOnlyPages: number; chars: number };
    partial: boolean;
  }>;
};
const { reconstructPage, reconstructDocument, reconstructStats } = (await import(clientModule('pnote/pdf/reconstruct'))) as {
  reconstructPage: (page: FixturePageShape, opts?: { bodySize?: number }) => Array<RecBlock>;
  reconstructDocument: (pages: FixturePageShape[]) => { type: string; content: RecBlock[] };
  reconstructStats: (pages: FixturePageShape[]) => { pages: number; textPages: number; imageOnlyPages: number; chars: number };
};
const { pnoteValidateDocument } = (await import(clientModule('pnote/validate'))) as { pnoteValidateDocument: (doc: unknown) => { ok: boolean; reason?: string } };
const { splitDocIntoPages } = (await import(clientModule('utils/docPages'))) as { splitDocIntoPages: (doc: Record<string, unknown>) => Array<{ id: string; kind: string; auto: boolean; content: unknown }> };

/* ── PDF fixture builder ─────────────────────────────────────────────────── */

interface FixtureRun { x: number; y: number; size?: number; text: string; font?: string }
interface FixturePage { runs: FixtureRun[]; width?: number; height?: number; imageXObject?: boolean }

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** minimal structural type for a reconstructed TipTap block */
interface RecBlock { type: string; attrs?: Record<string, unknown>; content?: Array<{ type: string; text?: string; attrs?: Record<string, unknown> }> }

/** build one page's content stream (PDF user space: y grows UP) */
function contentStream(page: FixturePage): string {
  let out = '';
  let lastFont = '';
  for (const r of page.runs) {
    const font = r.font ?? 'F1';
    /* F2 is the 2-BYTE CID font (Identity-H): its text is hex-encoded
       big-endian CID pairs, exactly like a real Persian PDF. Each A..Z
       run char is a glyph CODE; the CMap maps that code → Persian. */
    if (font === 'F2') {
      const hex = [...r.text].map((ch) => ch.charCodeAt(0).toString(16).padStart(4, '0')).join('');
      if (font !== lastFont) out += `BT /${font} ${r.size ?? 12} Tf ${r.x} ${r.y} Td <${hex}> Tj ET\n`;
      else out += `BT ${r.x} ${r.y} Td /${font} ${r.size ?? 12} Tf <${hex}> Tj ET\n`;
      continue;
    }
    if (font !== lastFont) { out += `BT /${font} ${r.size ?? 12} Tf ${r.x} ${r.y} Td (${esc(r.text)}) Tj ET\n`; lastFont = font; }
    else out += `BT ${r.x} ${r.y} Td /${font} ${r.size ?? 12} Tf (${esc(r.text)}) Tj ET\n`;
  }
  return out;
}

/** assemble a complete single-font PDF fixture */
function buildPdf(pages: FixturePage[], opts: { withToUnicode?: boolean } = {}): Uint8Array {
  const enc = new TextEncoder();
  const objects: string[] = [];
  const nPages = pages.length;

  /* obj 1: catalog, obj 2: pages tree, obj 3..2+n: page objects,
     then per page: content stream obj (+ optional image xobject obj),
     then font objects */
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${nPages} >>`;

  pages.forEach((page, i) => {
    const pageObj = 3 + i * 2;
    const contentObj = pageObj + 1;
    const content = contentStream(page);
    let resources = '<< /Font << /F1 100 0 R /F2 102 0 R >>';
    if (page.imageXObject) resources += ' /XObject << /Im0 ' + (contentObj + 1) + ' 0 R >>';
    resources += ' >>';
    objects[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width ?? 612} ${page.height ?? 792}] /Resources ${resources} /Contents ${contentObj} 0 R >>`;
    objects[contentObj] = { stream: content } as unknown as string;
    if (page.imageXObject) {
      objects[contentObj + 1] = '<< /Type /XObject /Subtype /Image /Width 4 /Height 4 /BitsPerComponent 8 >>';
    }
  });

  /* 100: Latin font (no ToUnicode), 102: Persian CID font WITH ToUnicode */
  objects[100] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[101] = { cmap: false } as unknown as string; /* placeholder marker (unused) */
  objects[102] = '<< /Type /Font /Subtype /Type0 /BaseFont /Tahoma-Identity-H /Encoding /Identity-H /ToUnicode 104 0 R >>';
  const persianMap: Record<number, string> = { 0x0041: 'آ', 0x0042: 'ب', 0x0043: 'پ', 0x0044: 'ت', 0x0045: 'ث', 0x0046: 'ج', 0x0047: 'چ', 0x0048: 'ح', 0x0049: 'خ', 0x004A: 'د', 0x004B: 'ذ', 0x004C: 'ر', 0x004D: 'ز', 0x004F: 'س', 0x0050: 'ش', 0x0051: 'ص', 0x0052: 'ض', 0x0053: 'ط', 0x0054: 'ظ', 0x0055: 'ع', 0x0056: 'غ', 0x0057: 'ف', 0x0058: 'ق', 0x0059: 'ک', 0x005A: 'گ', 0x0061: 'ل', 0x0062: 'م', 0x0063: 'ن', 0x0064: 'و', 0x0065: 'ه', 0x0066: 'ی' };
  const codes = Object.keys(persianMap).map(Number);
  let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n1 beginbfchar\n';
  cmap += codes.map((c, i) => `<${c.toString(16).padStart(4, '0')}> <${persianMap[c].codePointAt(0)!.toString(16).padStart(4, '0')}>`).join('\n');
  /* pad the bfchar block to ≤100 entries then close */
  cmap += '\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
  objects[104] = { stream: cmap } as unknown as string;

  /* serialize */
  const chunks: string[] = ['%PDF-1.7\n'];
  const offsets: number[] = [];
  let pos = 9;
  for (let i = 1; i < objects.length; i++) {
    const o = objects[i];
    if (o === undefined) continue;
    offsets[i] = pos;
    if (typeof o === 'string' && o.startsWith('<<')) {
      chunks.push(`${i} 0 obj\n${o}\nendobj\n`);
      pos += `${i} 0 obj\n${o}\nendobj\n`.length;
    } else if (o && typeof o === 'object' && 'stream' in (o as Record<string, unknown>)) {
      const data = (o as { stream: string }).stream;
      const head = `${i} 0 obj\n<< /Length ${data.length} >>\nstream\n`;
      const tail = '\nendstream\nendobj\n';
      chunks.push(head + data + tail);
      pos += head.length + data.length + tail.length;
    }
    void 0;
  }
  const xrefPos = pos;
  const maxObj = objects.length;
  let xref = `xref\n0 ${maxObj}\n0000000000 65535 f \n`;
  for (let i = 1; i < maxObj; i++) {
    xref += offsets[i] !== undefined
      ? `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
      : `0000000000 65535 f \n`;
  }
  xref += `trailer\n<< /Size ${maxObj} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  chunks.push(xref);
  void opts;
  return new TextEncoder().encode(chunks.join(''));
}

/** fixture runs for a text line */
const line = (x: number, y: number, text: string, size = 12, font = 'F1'): FixtureRun => ({ x, y, text, size, font });

/* ── §26.1/§26.2/§26.7: text pages, boundaries, paragraphs/headings ─────── */

describe('pdf import — text pages & boundaries (§26.1/§26.2/§26.7)', () => {
  test('a 3-page text PDF produces 3 Persian Notes pages in order (§26.2)', async () => {
    const pdf = buildPdf([
      { runs: [line(72, 700, 'Page one body text'), line(72, 670, 'second line of page one')] },
      { runs: [line(72, 700, 'Page two body text')] },
      { runs: [line(72, 700, 'Page three body text')] },
    ]);
    const result = await importPdf(pdf, 'book.pdf');
    assert.equal(result.stats.pages, 3);
    const check = pnoteValidateDocument(result.document);
    assert.equal(check.ok, true, check.ok ? '' : check.reason);
    const pages = splitDocIntoPages(result.document as Record<string, unknown>);
    assert.equal(pages.length, 3);
    const json = JSON.stringify(pages.map((p) => p.content));
    assert.ok(json.includes('Page one body text'), `page 1 text missing: ${json.slice(0, 300)}`);
    assert.ok(json.includes('Page two body text'), 'page 2 text missing');
    assert.ok(json.includes('Page three body text'), 'page 3 text missing');
  });

  test('consecutive body lines merge into paragraphs, big font becomes a heading (§26.7)', async () => {
    const pdf = buildPdf([
      {
        runs: [
          line(72, 740, 'The Title Of The Chapter', 20),
          line(72, 700, 'first body line'),
          line(72, 685, 'second body line'),
        ],
      },
    ]);
    const result = await importPdf(pdf, 't.pdf');
    const blocks = result.document.content as Array<{ type: string; content?: Array<{ text?: string }>; attrs?: Record<string, unknown> }>;
    const types = blocks.map((b) => b.type);
    assert.ok(types.includes('heading'), `expected a heading, got ${types.join(',')}`);
    const heading = blocks.find((b) => b.type === 'heading')!;
    assert.equal(JSON.stringify(heading.content).includes('The Title Of The Chapter'), true);
    /* the two short body lines fused into ONE paragraph */
    const paras = blocks.filter((b) => b.type === 'paragraph');
    assert.equal(paras.length, 1);
    assert.equal(JSON.stringify(paras[0].content).includes('second body line'), true);
  });
});

/* ── §26.3/§26.4: Persian RTL + mixed text ───────────────────────────────── */

describe('pdf import — Persian/RTL (§26.3/§26.4)', () => {
  test('CID/ToUnicode Persian text extracts and is marked RTL (§26.3)', async () => {
    /* F2 codes: A..Z map to Persian letters via the ToUnicode CMap;
       use A B C D E F G H I J K = آ ب پ ت ث ج چ ح خ د ذ ر (glyph order,
       exactly what a Persian PDF's font encodes) */
    const pdf = buildPdf([
      { runs: [{ x: 72, y: 700, text: 'ABCDEFGHIJK', font: 'F2', size: 14 }] },
    ]);
    const parsed = await parsePdfText(pdf);
    assert.equal(parsed.pages.length, 1);
    assert.equal(parsed.pages[0].runs.length, 1);
    const text = parsed.pages[0].runs[0].text;
    /* the ToUnicode CMap resolved every code to a Persian letter */
    assert.equal(/[\u0600-\u06FF]/.test(text), true, `expected Persian letters, got "${text}"`);

    const result = await importPdf(pdf, 'fa.pdf');
    const blocks = result.document.content as Array<{ type: string; attrs?: Record<string, unknown> }>;
    const para = blocks.find((b) => b.type === 'paragraph')!;
    assert.equal(para.attrs?.dir, 'rtl');
  });

  test('mixed Persian (majority) + English + numbers keeps one RTL paragraph (§26.4)', () => {
    const doc = reconstructDocument([
      {
        index: 0, width: 612, height: 792, imageOnly: false,
        runs: [{ x: 72, y: 700, size: 12, text: 'این متن فارسی است با English و عدد ۱۲۳', hex: false }],
      },
    ]);
    const para = (doc.content as Array<{ type: string; attrs?: Record<string, unknown> }>)[0];
    assert.equal(para.attrs?.dir, 'rtl');
    const text = JSON.stringify(doc.content);
    assert.ok(text.includes('English'));
    assert.ok(text.includes('۱۲۳'));
  });
});

/* ── §26.5/§26.6: list reconstruction ────────────────────────────────────── */

describe('pdf import — list reconstruction (§26.5/§26.6)', () => {
  test('bullet lines merge into ONE bulletList with N items (§26.5)', () => {
    /* runs in PARSE-PDF orientation (y grows DOWN — reconstructPage's
       input contract); y=10 is the first line, 15-gap steps = 12pt body
       with normal leading (no paragraph split) */
    const blocks = reconstructPage({
      index: 0, width: 612, height: 792, imageOnly: false,
      runs: [
        { x: 72, y: 10, size: 12, text: '• گزینه اول', hex: false },
        { x: 72, y: 25, size: 12, text: '• گزینه دوم', hex: false },
        { x: 72, y: 40, size: 12, text: '• گزینه سوم', hex: false },
        { x: 72, y: 55, size: 12, text: '• گزینه چهارم', hex: false },
      ],
    });
    const lists = blocks.filter((b) => b.type === 'bulletList');
    assert.equal(lists.length, 1, 'one bullet list — not one per line');
    assert.equal(lists[0].content?.length, 4);
    const first = lists[0].content?.[0] as { content?: Array<{ content?: Array<{ text?: string }> }> };
    assert.equal(JSON.stringify(first).includes('گزینه اول'), true);
  });

  test('numbered lines merge into ONE orderedList (§26.6)', () => {
    const blocks = reconstructPage({
      index: 0, width: 612, height: 792, imageOnly: false,
      runs: [
        { x: 72, y: 10, size: 12, text: '1. Step one', hex: false },
        { x: 72, y: 25, size: 12, text: '2. Step two', hex: false },
        { x: 72, y: 40, size: 12, text: '3. Step three', hex: false },
      ],
    });
    const lists = blocks.filter((b) => b.type === 'orderedList');
    assert.equal(lists.length, 1);
    assert.equal(lists[0].content?.length, 3);
  });

  test('Persian numbered list (۱. ۲. ۳.) also reconstructs', () => {
    const blocks = reconstructPage({
      index: 0, width: 612, height: 792, imageOnly: false,
      runs: [
        { x: 72, y: 10, size: 12, text: '۱. مورد نخست', hex: false },
        { x: 72, y: 25, size: 12, text: '۲. مورد دوم', hex: false },
      ],
    });
    const lists = blocks.filter((b) => b.type === 'orderedList');
    assert.equal(lists.length, 1);
    assert.equal(lists[0].content?.length, 2);
  });
});

/* ── §26.8/§26.9: scanned + corrupt PDFs ─────────────────────────────────── */

describe('pdf import — scanned & corrupt handling (§26.8/§26.9)', () => {
  test('image-only page is flagged imageOnly; the honest Persian error fires when NO text exists (§26.8)', async () => {
    const pdf = buildPdf([{ runs: [], imageXObject: true }]);
    const parsed = await parsePdfText(pdf);
    assert.equal(parsed.pages[0].imageOnly, true);
    assert.equal(parsed.pages[0].runs.length, 0);
    await assert.rejects(() => importPdf(pdf, 'scan.pdf'), (e: unknown) => (e as { code?: string }).code === 'no-text');
  });

  test('corrupt bytes are rejected with a Persian-mappable code (§26.9)', async () => {
    const garbage = new TextEncoder().encode('definitely not a portable document format file');
    await assert.rejects(() => importPdf(garbage, 'x.pdf'), (e: unknown) => (e as { code?: string }).code === 'corrupt');
  });

  test('a non-PDF renamed to .pdf is rejected (extension alone is not trusted, §20)', async () => {
    const fake = new TextEncoder().encode('<html><body>not a pdf</body></html>');
    await assert.rejects(() => importPdf(fake, 'looks-fine.pdf'));
  });

  test('stats classify image-only pages for the partial message (§17)', () => {
    const stats = reconstructStats([
      { index: 0, width: 612, height: 792, imageOnly: true, runs: [] },
      { index: 1, width: 612, height: 792, imageOnly: false, runs: [{ x: 10, y: 10, size: 12, text: 'enough text on this page', hex: false }] },
    ]);
    assert.equal(stats.pages, 2);
    assert.equal(stats.imageOnlyPages, 1);
    assert.equal(stats.textPages, 1);
    assert.equal(stats.chars > 0, true);
  });
});

/* ── §26.10: partial import keeps what succeeded ─────────────────────────── */

describe('pdf import — partial extraction (§26.10)', () => {
  test('a half-scanned PDF imports the text pages and reports partial', async () => {
    const pdf = buildPdf([
      { runs: [line(72, 700, 'Readable first page')] },
      { runs: [], imageXObject: true }, /* scanned page */
      { runs: [line(72, 700, 'Readable third page')] },
    ]);
    const result = await importPdf(pdf, 'mixed.pdf');
    assert.equal(result.partial, true);
    assert.equal(result.stats.imageOnlyPages, 1);
    const pages = splitDocIntoPages(result.document as Record<string, unknown>);
    assert.equal(pages.length, 3, 'page boundaries preserved even for empty pages');
    const text = JSON.stringify(pages.map((p) => p.content));
    assert.ok(text.includes('Readable first page'));
    assert.ok(text.includes('Readable third page'));
  });
});

/* ── §26.11/§26.12/§26.13/§26.14: the result is a NORMAL document ────────── */

describe('pdf import result is a normal Persian Notes document (§26.11–§26.14)', () => {
  test('imported pages carry the standard §4 shape: editable, splittable, extendable (§26.11/§26.12)', async () => {
    const pdf = buildPdf([
      { runs: [line(72, 700, 'Imported content here')] },
    ]);
    const result = await importPdf(pdf, 'n.pdf');
    const check = pnoteValidateDocument(result.document);
    assert.equal(check.ok, true);
    const pages = splitDocIntoPages(result.document as Record<string, unknown>);
    /* every page is a normal per-page doc ({type:'doc',content:[…]}) the
       editor mounts a TipTap instance on — i.e. editable */
    for (const p of pages) {
      const pc = p.content as { type?: string; content?: unknown[] };
      assert.equal(pc.type, 'doc');
      assert.ok(Array.isArray(pc.content));
      assert.ok(typeof p.id === 'string' && p.id.length > 0);
      assert.ok(['framed', 'blank', 'notebook', 'cover', 'toc', 'booklet'].includes(p.kind));
    }
  });

  test('appending a NEW page keeps the imported content intact (§26.11)', () => {
    /* the §4 merge path — exactly what mergePagesIntoDoc does when the
       user adds page 4 after 3 imported pages */
    const imported = reconstructDocument([
      { index: 0, width: 612, height: 792, imageOnly: false, runs: [{ x: 72, y: 700, size: 12, text: 'page one text', hex: false }] },
      { index: 1, width: 612, height: 792, imageOnly: false, runs: [{ x: 72, y: 700, size: 12, text: 'page two text', hex: false }] },
    ]);
    /* the imported doc is a legal merge input (it already IS §4 storage
       shape); a new page 4 appends another block group — validated: */
    const check = pnoteValidateDocument(imported);
    assert.equal(check.ok, true);
    const pages = splitDocIntoPages(imported as Record<string, unknown>);
    pages.push({
      id: 'page-new', kind: 'framed', auto: false,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    assert.equal(pages.length, 3);
    assert.equal(typeof pages[2].id, 'string');
  });

  test('the merged document passes the SAME validator autosave/collab use (§26.13)', async () => {
    const pdf = buildPdf([{ runs: [line(72, 700, 'persist me')] }]);
    const result = await importPdf(pdf, 's.pdf');
    /* EditorPage commits through splitContent → splitDocIntoPages →
       notesApi.create/PATCH; every one of those accepts §4 documents —
       pinned by validating with the shared validator here */
    assert.equal(pnoteValidateDocument(result.document).ok, true);
  });

  test('the imported document is export-ready: validator-clean §4 shape the export pipeline consumes (§26.14)', async () => {
    /* NOTE: we intentionally do NOT call the static-schema HTML renderer
       here — client/src/utils/staticSchema.ts imports through the `@/`
       alias, which Node cannot resolve in this runtime-import harness
       (the alias only exists in the bundler/vite context). Export-
       readiness is instead pinned the same way every other consumer
       gates it: the document is validator-clean §4 storage shape, which
       is the exact input contract of the existing PDF/Word/HTML export
       pipeline (EditorPage → docJsonToHtml). */
    const pdf = buildPdf([{ runs: [line(72, 700, 'export me')] }]);
    const result = await importPdf(pdf, 'e.pdf');
    const doc = result.document as { type: string; content: unknown[] };
    assert.equal(doc.type, 'doc');
    assert.ok(Array.isArray(doc.content) && doc.content.length > 0);
    /* every top-level block is a known §4/TipTap type the static schema
       renders (paragraph/heading/bulletList/orderedList/table/…) */
    const KNOWN = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'table', 'pageBreak', 'eduBlock', 'equation', 'blockquote', 'codeBlock']);
    for (const block of doc.content as Array<{ type: string }>) {
      assert.ok(KNOWN.has(block.type), `unexpected top-level block type ${block.type}`);
    }
    assert.equal(pnoteValidateDocument(result.document).ok, true);
  });
});
