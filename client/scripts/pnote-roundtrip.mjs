/* Round-trip probe for the .pnote import bug report:
   «۲ صفحه خروجی گرفتم، صفحه اول رو خالی ایمپورت کرد»

   Simulates the REAL pipeline with the REAL modules:
     1. live 2-page state (page 1 typed content, page 2 typed content)
     2. exportPnoteFile's merge  (mergePagesIntoDoc + mergeContent)
     3. exportPnote → importPnote
     4. applyImport's split     (splitContent + splitDocIntoPages + makePage)
     5. reload path             (splitContent + splitDocIntoPages again)

   Run: cd client && npx tsx scripts/pnote-roundtrip.mjs
*/
process.env.TSX_TSCONFIG_PATH = 'tsconfig.json';

// Minimal browser globals the pnote modules rely on (matches qa-pnote.test.mts setup)
import jsdom from 'jsdom';
const dom = new jsdom.JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
try { Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true }); } catch { /* Node ≥21 already has a navigator */ }
globalThis.btoa = dom.window.btoa;
globalThis.atob = dom.window.atob;
globalThis.TextEncoder = dom.window.TextEncoder ?? globalThis.TextEncoder;
globalThis.TextDecoder = dom.window.TextDecoder ?? globalThis.TextDecoder;
globalThis.localStorage = dom.window.localStorage;

const { exportPnote } = await import('../src/pnote/exportPnote.ts');
const { importPnote } = await import('../src/pnote/importPnote.ts');
const { splitDocIntoPages, splitContent, mergePagesIntoDoc, mergeContent } = await import('../src/utils/docPages.ts');

const para = (text, align) => ({
  type: 'paragraph',
  ...(align ? { attrs: { textAlign: align } } : {}),
  content: [{ type: 'text', text }],
});

/* ── 1. LIVE state: two pages, each with typed content (user report scenario) ── */
const livePages = [
  {
    id: 'p1',
    pageNumber: 1,
    content: { type: 'doc', content: [para('متن صفحهٔ اول — خط یک'), para('متن صفحهٔ اول — خط دو')] },
    floatingElements: [],
    kind: 'framed',
    auto: false,
  },
  {
    id: 'p2',
    pageNumber: 2,
    content: { type: 'doc', content: [para('متن صفحهٔ دوم — بعد از شکست دستی')] },
    floatingElements: [],
    kind: 'framed',
    auto: true,
  },
];
console.log('live page1 blocks:', livePages[0].content.content.length, '| page2 blocks:', livePages[1].content.content.length);

/* ── 2. EXPORT merge (exactly what exportPnoteFile does) ── */
const mergedDoc = mergePagesIntoDoc(livePages);
const stored = mergeContent(mergedDoc, livePages.flatMap((p) => p.floatingElements ?? []), undefined);
const blocks = stored.content;
console.log('merged stored doc: top-level blocks =', blocks.length,
  '| pageBreak positions =', blocks.map((b, i) => (b.type === 'pageBreak' ? i : -1)).filter((i) => i >= 0));
console.log('first 3 merged block types:', blocks.slice(0, 3).map((b) => b.type).join(','));

/* ── 3. export → import ── */
const exp = await exportPnote({ content: stored, title: 'تست دو صفحه' });
console.log('export ok:', exp.fileName, '| pages claimed:', exp.pageCount, '| bytes:', exp.bytes.length);
const pkg = await importPnote(exp.bytes);

/* ── 4. applyImport split (asNewNote path — BEFORE merge, i.e. what makePage receives) ── */
const { doc: loadedDoc, floats: loadedFloats } = splitContent(pkg.document);
const splitPages = splitDocIntoPages(loadedDoc);
console.log('applyImport split → pages:', splitPages.length);
for (const [i, sp] of splitPages.entries()) {
  const n = (sp.content?.content ?? []).length;
  const firstText = (sp.content?.content ?? [])
    .flatMap((b) => (b.content ?? []).map((t) => t.text ?? ''))
    .join('').slice(0, 40);
  console.log(`  page ${i + 1}: id=${sp.id} kind=${sp.kind} blocks=${n} text="${firstText}"`);
  if (n === 0) console.log(`  ❌ PAGE ${i + 1} SPLIT EMPTY`);
}

/* ── 5. RELOAD path (notesApi.create(stored) then load: split again) ── */
const { doc: reloadDoc } = splitContent(stored);
const reloadPages = splitDocIntoPages(reloadDoc);
console.log('reload split → pages:', reloadPages.length);
for (const [i, sp] of reloadPages.entries()) {
  const n = (sp.content?.content ?? []).length;
  if (n === 0) console.log(`  ❌ RELOAD PAGE ${i + 1} EMPTY (id=${sp.id})`);
}
/* ── 6. ID CONTRACT: §4 normalizes the FIRST page to p1 on reload (by design);
   later pages keep their merge-time ids. The applyImport fix relies on the
   apply-TIME ids only (fresh imp-* keys → editors remount with imported
   content); the stored doc re-normalizes page 1 on the NEXT load, which is
   safe because that load mounts fresh editors. */
const freshPages = livePages.map((p, i) => ({ ...p, id: `imp-abc-${i + 1}` }));
const storedFresh = mergeContent(mergePagesIntoDoc(freshPages), [], undefined);
const splitFresh = splitDocIntoPages(splitContent(storedFresh).doc);
const contractOk = splitFresh[0].id === 'p1' && splitFresh.slice(1).every((sp, i) => sp.id === freshPages[i + 1].id);
console.log('id contract (first=p1, later preserved):', contractOk ? 'OK ✓' : `❌ ${splitFresh.map((s) => s.id).join(',')}`);
if (!contractOk) process.exit(1);

console.log('done');
