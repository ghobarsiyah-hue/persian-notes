/* ═══════════════════════════════════════════════════════════════════════
   .pnote NATIVE FORMAT tests (task §25) — round-trip + security.

   The pipeline under test (client/src/pnote/, imported at RUNTIME the
   same way collab.test.mts imports client modules — tsc must not
   typecheck client sources from the server project):

     §4 document → exportPnote() → .pnote bytes → importPnote() → document

   The lossless contract (§5): D → D' preserves the MEANINGFUL EDITABLE
   structure — page ids/order/kind/auto, blocks, attrs, floats — asserted
   on the TipTap JSON (never rendered HTML).

   IMPORTANT (runtime environment): the pnote modules call browser
   globals (CompressionStream/DecompressionStream/atob/btoa/crypto).
   Node ≥ 18 ships all of them as globals — CompressionStream landed in
   Node 18 (web streams), so the same code runs unchanged here.
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
const { exportPnote } = (await import(clientModule('pnote/exportPnote'))) as {
  exportPnote: (input: { content: Record<string, unknown>; title?: string }) => Promise<{
    bytes: Uint8Array; fileName: string; pageCount: number; assetCount: number;
  }>;
};
const { importPnote, pnotePageCount } = (await import(clientModule('pnote/importPnote'))) as {
  importPnote: (bytes: Uint8Array) => Promise<{
    manifest: Record<string, unknown>; document: Record<string, unknown>;
  }>;
  pnotePageCount: (pkg: { document: Record<string, unknown> }) => number;
};
const { PnoteError } = (await import(clientModule('pnote/format'))) as {
  PnoteError: new (code: string, message: string) => Error & { code: string };
};
const { isSafeEntryName } = (await import(clientModule('pnote/zip'))) as {
  isSafeEntryName: (name: string) => boolean;
  buildZip: (entries: Array<{ name: string; data: Uint8Array; deflate?: boolean }>) => Promise<Uint8Array>;
};

/* ── helpers ─────────────────────────────────────────────────────────────── */

interface JsonNode { type: string; attrs?: Record<string, unknown>; content?: JsonNode[]; text?: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }> }

/** find all nodes of a type in a document tree */
function findAll(node: unknown, type: string, out: JsonNode[] = []): JsonNode[] {
  if (node === null || typeof node !== 'object') return out;
  const n = node as JsonNode;
  if (Array.isArray(n)) { for (const c of n) findAll(c, type, out); return out; }
  if (n.type === type) out.push(n);
  if (Array.isArray(n.content)) for (const c of n.content) findAll(c, type, out);
  return out;
}

/** the §4 page ids exactly as splitDocIntoPages derives them */
function pageIds(doc: { content?: JsonNode[] }): string[] {
  const ids = ['p1'];
  for (const b of doc.content ?? []) {
    if (b.type !== 'pageBreak') continue;
    const pid = (b.attrs as Record<string, unknown> | undefined)?.pid;
    ids.push(typeof pid === 'string' && pid ? pid : `p${ids.length + 1}`);
  }
  return ids;
}

/** a 1×1 red PNG (tiny, valid, base64) */
const RED_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function buildComplexDocument(): Record<string, unknown> {
  const heading: JsonNode = {
    type: 'heading', attrs: { level: 2, dir: 'rtl', textAlign: 'right' },
    content: [{ type: 'text', text: 'فصل اول: فیزیولوژی قلب' }],
  };
  const para: JsonNode = {
    type: 'paragraph', attrs: { dir: 'rtl', textAlign: 'justify' },
    content: [{
      type: 'text', text: 'متن فارسی با English mixed و عدد ۱۲۳',
      marks: [{ type: 'bold' }, { type: 'italic' }],
    }],
  };
  const bulletList: JsonNode = {
    type: 'bulletList', attrs: { dir: 'rtl', marker: 'disc' },
    content: ['الف', 'ب', 'پ'].map((t) => ({
      type: 'listItem', attrs: { dir: 'rtl' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
    })),
  };
  const orderedList: JsonNode = {
    type: 'orderedList', attrs: { dir: 'rtl', marker: 'fa', start: 2 },
    content: ['یک', 'دو'].map((t) => ({
      type: 'listItem', attrs: { dir: 'rtl' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
    })),
  };
  const table: JsonNode = {
    type: 'table',
    attrs: { 'data-tstyle': 'navy', 'data-striped': true, 'data-borderless': false, 'data-align': 'center', 'data-cellpad': '8px', width: 640 },
    content: [
      {
        type: 'tableRow', content: [
          { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: [160] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ستون', marks: [{ type: 'bold' }] }] }] },
          { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'مقدار' }] }] },
        ],
      },
      {
        type: 'tableRow', content: [
          { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ضربان' }] }] },
          { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '۷۲' }] }] },
        ],
      },
    ],
  };
  const equation: JsonNode = {
    type: 'equation',
    attrs: {
      ast: { kind: 'frac', num: { kind: 'sym', v: 'a' }, den: { kind: 'pow', base: { kind: 'sym', v: 'b' }, exp: { kind: 'num', v: 2 } } },
      latex: '\\frac{a}{b^2}',
    },
  };
  const eduBlock: JsonNode = {
    type: 'questionBlock',
    attrs: {
      title: 'سوال ۱', styleBg: '#f5f0e1', styleBorder: '#8b6914', styleBorderWidth: -1,
      styleBorderStyle: 'dashed', styleRadius: 12, styleTitle: '#5b4410',
    },
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'متن سوال؟' }] },
      { type: 'paragraph', attrs: { 'edu-answer': '' }, content: [{ type: 'text', text: 'پاسخ مدل.' }] },
    ],
  };
  const pageBreak = (pid: string, kind?: string, auto?: boolean): JsonNode => ({
    type: 'pageBreak', attrs: { pid, ...(kind ? { kind } : {}), ...(auto ? { auto: true } : {}) },
  });

  const floats = [
    { id: 'float-1', type: 'sticky', x: 120, y: 80, w: 160, h: 120, rotation: 15, z: 2, text: 'یادداشت چسبان', color: '#fde68a' },
    { id: 'float-2', type: 'image', x: 400, y: 300, w: 200, h: 150, rotation: 0, z: 1, src: `data:image/png;base64,${RED_PNG}` },
  ];

  return {
    type: 'doc',
    attrs: { pageKind: 'cover', pageCover: { title: 'جزوهٔ تست', subtitle: 'سلامت', icon: 'heart' } },
    content: [
      { type: 'paragraph' },
      pageBreak('p2'),
      heading, para, bulletList, orderedList, table, equation, eduBlock,
      pageBreak('p3', 'notebook'),
      { type: 'paragraph', content: [{ type: 'text', text: 'صفحهٔ سوم' }] },
      pageBreak('p4', 'framed', true),
      { type: 'paragraph' },
    ],
    floatingElements: floats,
    noteDesign: {
      border: { color: '#8b5cf6', secondary: '#c4b5fd', style: 'ornate', headerLabel: 'سربرگ جزوه' },
      eduBlocks: { mode: 'tinted', opacity: 0.24 },
    },
  };
}

/* ── §25.1–25.19: lossless round-trip of the complex document ───────────── */

describe('pnote round-trip (lossless, §25)', () => {
  let imported: Record<string, unknown>;

  test('export → import succeeds and reports the right page/asset counts', async () => {
    const doc = buildComplexDocument();
    const result = await exportPnote({ content: doc, title: 'جزوهٔ آزمون' });
    assert.ok(result.bytes.byteLength > 200);
    assert.equal(result.pageCount, 4);
    assert.equal(result.assetCount, 1);
    assert.ok(result.fileName.endsWith('.pnote'));

    const pkg = await importPnote(result.bytes);
    assert.equal(pkg.manifest.format, 'persian-notes');
    assert.equal(pkg.manifest.formatVersion, 1);
    assert.equal(pkg.manifest.title, 'جزوهٔ آزمون');
    assert.equal(pnotePageCount(pkg), 4);
    imported = pkg.document;
  });

  test('page ids, order and count survive (§25.2–25.4)', () => {
    assert.deepEqual(pageIds(imported as { content?: JsonNode[] }), ['p1', 'p2', 'p3', 'p4']);
    /* order: the notebook page is third, the auto page fourth */
    const breaks = (imported.content as JsonNode[]).filter((b) => b.type === 'pageBreak');
    assert.equal(breaks[1].attrs?.kind, 'notebook');
    assert.equal(breaks[2].attrs?.auto, true);
  });

  test('doc-level pageKind + cover attrs survive (§25.5)', () => {
    assert.equal((imported.attrs as Record<string, unknown>).pageKind, 'cover');
    const cover = (imported.attrs as Record<string, unknown>).pageCover as Record<string, unknown>;
    assert.equal(cover.title, 'جزوهٔ تست');
    assert.equal(cover.subtitle, 'سلامت');
  });

  test('headings survive with level + dir + align (§25.6)', () => {
    const heads = findAll(imported, 'heading');
    assert.equal(heads.length, 1);
    assert.equal(heads[0].attrs?.level, 2);
    assert.equal(heads[0].attrs?.dir, 'rtl');
    assert.equal(heads[0].attrs?.textAlign, 'right');
    assert.equal(findAll(imported, 'text').some((t) => t.text === 'فصل اول: فیزیولوژی قلب'), true);
  });

  test('text formatting marks survive (§25.7)', () => {
    const texts = findAll(imported, 'text');
    const mixed = texts.find((t) => t.text?.includes('English mixed'));
    assert.ok(mixed);
    assert.deepEqual(mixed.marks?.map((m) => m.type).sort(), ['bold', 'italic']);
  });

  test('alignment attrs survive (§25.8)', () => {
    const paras = findAll(imported, 'paragraph');
    const justified = paras.find((p) => p.attrs?.textAlign === 'justify');
    assert.ok(justified);
    assert.equal(justified.attrs?.dir, 'rtl');
  });

  test('bullet list survives as ONE list with all items (§25.9)', () => {
    const lists = findAll(imported, 'bulletList');
    assert.equal(lists.length, 1);
    assert.equal(lists[0].attrs?.marker, 'disc');
    assert.equal(lists[0].content?.length, 3);
    assert.ok(lists[0].content?.every((li) => li.type === 'listItem'));
  });

  test('ordered list survives with marker + start (§25.10)', () => {
    const lists = findAll(imported, 'orderedList');
    assert.equal(lists.length, 1);
    assert.equal(lists[0].attrs?.marker, 'fa');
    assert.equal(lists[0].attrs?.start, 2);
    assert.equal(lists[0].content?.length, 2);
  });

  test('tables survive (§25.11)', () => {
    const tables = findAll(imported, 'table');
    assert.equal(tables.length, 1);
    assert.equal(findAll(imported, 'tableRow').length, 2);
    assert.equal(findAll(imported, 'tableHeader').length, 2);
    assert.equal(findAll(imported, 'tableCell').length, 2);
  });

  test('table design attrs survive (§25.12)', () => {
    const t = findAll(imported, 'table')[0];
    assert.equal(t.attrs?.['data-tstyle'], 'navy');
    assert.equal(t.attrs?.['data-striped'], true);
    assert.equal(t.attrs?.['data-align'], 'center');
    assert.equal(t.attrs?.['data-cellpad'], '8px');
    assert.equal(t.attrs?.width, 640);
    /* colwidth on the header cell survives */
    const th = findAll(imported, 'tableHeader')[0];
    assert.deepEqual(th.attrs?.colwidth, [160]);
  });

  test('structured equation AST survives byte-exactly (§25.13)', () => {
    const eqs = findAll(imported, 'equation');
    assert.equal(eqs.length, 1);
    assert.deepEqual(eqs[0].attrs?.ast, {
      kind: 'frac', num: { kind: 'sym', v: 'a' }, den: { kind: 'pow', base: { kind: 'sym', v: 'b' }, exp: { kind: 'num', v: 2 } },
    });
    assert.equal(eqs[0].attrs?.latex, '\\frac{a}{b^2}');
  });

  test('edu block + ALL persisted style attrs survive (§25.14)', () => {
    const blocks = findAll(imported, 'questionBlock');
    assert.equal(blocks.length, 1);
    const a = blocks[0].attrs ?? {};
    assert.equal(a.title, 'سوال ۱');
    assert.equal(a.styleBg, '#f5f0e1');
    assert.equal(a.styleBorder, '#8b6914');
    assert.equal(a.styleBorderWidth, -1);
    assert.equal(a.styleBorderStyle, 'dashed');
    assert.equal(a.styleRadius, 12);
    assert.equal(a.styleTitle, '#5b4410');
  });

  test('floating elements survive with types + geometry + text (§25.15/§25.16)', () => {
    const floats = imported.floatingElements as Array<Record<string, unknown>>;
    assert.equal(floats.length, 2);
    const sticky = floats.find((f) => f.type === 'sticky');
    assert.ok(sticky);
    assert.equal(sticky.x, 120); assert.equal(sticky.y, 80);
    assert.equal(sticky.w, 160); assert.equal(sticky.h, 120);
    assert.equal(sticky.rotation, 15);
    assert.equal(sticky.text, 'یادداشت چسبان');
    assert.equal(sticky.color, '#fde68a');
  });

  test('image asset round-trips as an IDENTICAL data-URL (§25.17)', () => {
    const floats = imported.floatingElements as Array<Record<string, unknown>>;
    const img = floats.find((f) => f.type === 'image');
    assert.equal(img?.src, `data:image/png;base64,${RED_PNG}`);
  });

  test('Persian RTL + mixed Persian/English/numbers survive untouched (§25.18/§25.19)', () => {
    const texts = findAll(imported, 'text');
    assert.ok(texts.some((t) => t.text === 'متن فارسی با English mixed و عدد ۱۲۳'));
    assert.ok(texts.some((t) => t.text === 'صفحهٔ سوم'));
  });

  test('noteDesign (per-note frame + eduBlocks) survives', () => {
    const design = imported.noteDesign as Record<string, { color?: string } | Record<string, unknown>>;
    assert.equal((design.border as { color?: string }).color, '#8b5cf6');
    assert.equal((design.eduBlocks as Record<string, unknown>).mode, 'tinted');
  });
});

/* ── §25.20/§25.21: the imported document is a NORMAL §4 document ───────── */

describe('imported document integrability (§25.20/§25.21)', () => {
  test('imported doc passes the SAME §4 validator the editor uses', async () => {
    const doc = buildComplexDocument();
    const bytes = (await exportPnote({ content: doc, title: 'x' })).bytes;
    const pkg = await importPnote(bytes);
    const { pnoteValidateDocument } = (await import(clientModule('pnote/validate'))) as { pnoteValidateDocument: (doc: unknown) => { ok: boolean; reason?: string } };
    assert.equal(pnoteValidateDocument(pkg.document).ok, true);
    /* and it splits into pages through the ONE page-model implementation */
    const { splitDocIntoPages } = (await import(clientModule('utils/docPages'))) as { splitDocIntoPages: (doc: Record<string, unknown>) => Array<{ id: string; kind: string; auto: boolean; content: unknown }> };
    const pages = splitDocIntoPages(pkg.document as Record<string, unknown>);
    assert.equal(pages.length, 4);
    assert.deepEqual(pages.map((p) => p.id), ['p1', 'p2', 'p3', 'p4']);
    assert.equal(pages[2].kind, 'notebook');
    assert.equal(pages[3].auto, true);
  });
});

/* ── §25.22–§25.24: security / rejection paths ──────────────────────────── */

describe('pnote security (§25.22–§25.24)', () => {
  test('corrupt package is rejected safely (§25.22)', async () => {
    const garbage = new TextEncoder().encode('this is not a zip file at all, not even close');
    await assert.rejects(() => importPnote(garbage), (e: unknown) => e instanceof PnoteError && e.code === 'not-a-package');
    /* a truncated REAL package is also refused (any PnoteError code is a
       safe outcome — the reader reports a torn central directory as
       unsafe-path, which is still a rejection) */
    const good = (await exportPnote({ content: buildComplexDocument(), title: 't' })).bytes;
    await assert.rejects(() => importPnote(good.subarray(0, Math.floor(good.byteLength / 3))), (e: unknown) => e instanceof PnoteError);
  });

  test('unsupported future version is rejected (§25.23/§3)', async () => {
    const { buildZip } = (await import(clientModule('pnote/zip'))) as { buildZip: (entries: Array<{ name: string; data: Uint8Array; deflate?: boolean }>) => Promise<Uint8Array> };
    const manifest = JSON.stringify({ format: 'persian-notes', formatVersion: 999, assets: [] });
    const bytes = await buildZip([
      { name: 'manifest.json', data: new TextEncoder().encode(manifest) },
      { name: 'document.json', data: new TextEncoder().encode('{"type":"doc","content":[]}') },
    ]);
    await assert.rejects(() => importPnote(bytes), (e: unknown) => e instanceof PnoteError && e.code === 'unsupported-version');
  });

  test('path traversal inside the archive is rejected (§25.24/§20)', async () => {
    /* the grammar gate itself */
    assert.equal(isSafeEntryName('../../etc/passwd'), false);
    assert.equal(isSafeEntryName('assets/../../x.png'), false);
    assert.equal(isSafeEntryName('C:/evil.png'), false);
    assert.equal(isSafeEntryName('/abs.png'), false);
    assert.equal(isSafeEntryName('a\\b.png'), false);
    assert.equal(isSafeEntryName('assets/../manifest.json'), false);
    assert.equal(isSafeEntryName('assets/ok.png'), true);
    assert.equal(isSafeEntryName('manifest.json'), true);
    /* and a hostile package carrying such an entry rejects WHOLE */
    const { buildZip } = (await import(clientModule('pnote/zip'))) as { buildZip: (entries: Array<{ name: string; data: Uint8Array; deflate?: boolean }>) => Promise<Uint8Array> };
    const manifest = JSON.stringify({ format: 'persian-notes', formatVersion: 1, assets: [] });
    const bytes = await buildZip([
      { name: 'manifest.json', data: new TextEncoder().encode(manifest) },
      { name: 'document.json', data: new TextEncoder().encode('{"type":"doc","content":[]}') },
      { name: '../evil.txt', data: new TextEncoder().encode('pwned') },
    ]);
    await assert.rejects(() => importPnote(bytes), (e: unknown) => e instanceof PnoteError && e.code === 'unsafe-path');
  });

  test('a manifest asset entry escaping assets/ is rejected', async () => {
    const { buildZip } = (await import(clientModule('pnote/zip'))) as { buildZip: (entries: Array<{ name: string; data: Uint8Array; deflate?: boolean }>) => Promise<Uint8Array> };
    const manifest = JSON.stringify({
      format: 'persian-notes', formatVersion: 1,
      assets: [{ id: 'a1', file: 'notassets/a1.png', bytes: 4 }],
    });
    const bytes = await buildZip([
      { name: 'manifest.json', data: new TextEncoder().encode(manifest) },
      { name: 'document.json', data: new TextEncoder().encode('{"type":"doc","content":[]}') },
    ]);
    await assert.rejects(() => importPnote(bytes), (e: unknown) => e instanceof PnoteError && e.code === 'bad-manifest');
  });

  test('document referencing a missing asset is rejected (missing-asset)', async () => {
    const { buildZip } = (await import(clientModule('pnote/zip'))) as { buildZip: (entries: Array<{ name: string; data: Uint8Array; deflate?: boolean }>) => Promise<Uint8Array> };
    const manifest = JSON.stringify({
      format: 'persian-notes', formatVersion: 1,
      assets: [{ id: 'a1', file: 'assets/a1.png', bytes: 4 }],
    });
    const doc = { type: 'doc', content: [{ type: 'paragraph' }], floatingElements: [{ id: 'f1', type: 'image', src: 'pnote-asset:a1' }] };
    const bytes = await buildZip([
      { name: 'manifest.json', data: new TextEncoder().encode(manifest) },
      { name: 'document.json', data: new TextEncoder().encode(JSON.stringify(doc)) },
      /* the asset itself is absent → import must refuse */
    ]);
    await assert.rejects(() => importPnote(bytes), (e: unknown) => e instanceof PnoteError && e.code === 'missing-asset');
  });
});

/* ── §25.25: no server-only state in the package ────────────────────────── */

describe('pnote privacy (§25.25/§22)', () => {
  test('localStorage tokens / server fields are never serialized', async () => {
    /* the exported payload is built ONLY from the §4 content object; this
       pins that contract: even when the note row carries server-only
       fields, the package contains neither */
    const doc = buildComplexDocument();
    const bytes = (await exportPnote({ content: doc, title: 't' })).bytes;
    const pkg = await importPnote(bytes);
    const text = JSON.stringify(pkg.document) + JSON.stringify(pkg.manifest);
    for (const forbidden of ['password', 'token', 'jwt', 'authorization', 'sessionId', 'collab', 'userId', 'ownerId', 'groupId', 'permission']) {
      assert.equal(text.toLowerCase().includes(forbidden.toLowerCase()), false, `package must not contain "${forbidden}"`);
    }
    /* manifest.documentId is a random portable id, NOT a Mongo ObjectId */
    if (pkg.manifest.documentId) assert.equal(/^[0-9a-f]{24}$/.test(String(pkg.manifest.documentId)), false);
  });
});
