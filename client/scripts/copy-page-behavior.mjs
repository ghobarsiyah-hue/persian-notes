/**
 * Probe — copy-page-with-style pipeline (client/src/utils/copyPage.ts):
 * the copied document must be a FAITHFUL print-pipeline replica:
 *   • one section.pn-page per requested page (true page numbers)
 *   • the decorative frame SVG + page number text
 *   • edu-box markup with its classes (styling rides the <style> blocks)
 *   • floating objects rendered (image/shape/text) with their geometry
 *   • clipboard flavors: text/html + text/plain via ClipboardItem stub
 *
 * Run: cd client && npx tsx scripts/copy-page-behavior.mjs
 */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
globalThis.document = dom.window.document;
globalThis.window = dom.window;
try { Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true }); } catch {}
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`); if (!ok) failed++; };

/* iconAssets stub (Vite import.meta.glob) + the PNG `?inline` import in
   PageBorder — both Vite-only; the loader hook serves stubs for both */
await import('./edu-title-behavior.mjs.loader.mjs');
const { register } = await import('node:module');
const { pathToFileURL } = await import('node:url');
register(`data:text/javascript,${encodeURIComponent(`
export async function load(url, context, next) {
  /* Vite ?raw imports (fonts.css) — export the raw file text as default */
  if (url.includes('%3Fraw') || url.includes('?raw')) {
    try {
      const { readFile } = await import('node:fs/promises');
      const p = new URL(url.startsWith('file:') ? url : 'file://' + url.slice(7)).pathname.replace(/^\\/([A-Za-z]:)/, '$1');
      const text = await readFile(decodeURIComponent(p), 'utf8');
      return { format: 'module', shortCircuit: true, source: 'export default ' + JSON.stringify(text) + ';' };
    } catch { /* fall through */ }
  }
  /* Vite asset imports (?inline PNGs): replace the import with an empty
     string const — the ornament art is irrelevant to the probe */
  if (url.includes('PageBorder')) {
    const src = await next(url, context);
    let code = typeof src.source === 'string' ? src.source : new TextDecoder().decode(src.source);
    code = code.replace(/import\\s+orn7AssetUrl\\s+from\\s+'[^']*';/g, "const orn7AssetUrl = '';");
    return { ...src, source: code, shortCircuit: true };
  }
  return next(url, context);
}
`)}`, { parentURL: pathToFileURL(new URL('.', import.meta.url).pathname.replace(/^\\([A-Za-z]:)/, '$1')) });

const { buildStyledPageHtml, copyPagesToClipboard } = await import('../src/utils/copyPage.ts');

const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const pages = [
  {
    id: 'p1', kind: 'framed',
    html: '<h1>عنوان درس</h1><div class="edu-block edu-definition" style="background:#dbeafe"><div class="edu-title"><span class="edu-title-text">تعریف بردار</span></div><div class="edu-body"><p>متن تعریف</p></div></div>',
    floatingElements: [
      { id: 'f1', type: 'image', src: IMG, x: 40, y: 60, width: 120, height: 90 },
      { id: 'f2', type: 'textBox', text: 'یادداشت مهم', x: 300, y: 500, width: 180, height: 70 },
    ],
  },
  { id: 'p2', kind: 'notebook', html: '<p>صفحهٔ دوم — خط‌دار</p>', floatingElements: [] },
  { id: 'p3', kind: 'framed', html: '<p>صفحهٔ سوم</p>', floatingElements: [] },
];
const meta = { title: 'جزوهٔ فیزیک', subject: 'فیزیک ۱', chapter: 'فصل ۲' };
const settings = {
  border: {
    enabled: true, style: 'classic', primaryColor: '#1e3a5f', secondaryColor: '#c5a24d',
    fillColor: '#b8d8e8', thickness: 1, cornerDecoration: true, showHeader: true,
    showFooter: true, showPageNumbers: true, sideLabel: 'آزمون',
  },
  fontSize: 16, lineHeight: 2,
};

/* ── A: full-document copy builds every section with real page numbers ── */
const full = buildStyledPageHtml({ pages, meta, settings });
check('A: full doc HTML built', full.html.length > 1000 && full.count === 3, `len=${full.html.length}`);
check('A: three pn-page sections', (full.html.match(/class="pn-page"/g) ?? []).length === 3);
check('A: doc skeleton (rtl + KaTeX css link)', full.html.includes('dir="rtl"') && full.html.includes('katex.min.css'));
check('A: printCss style block present', full.html.includes('.pn-sheet-content') || full.html.includes('.pn-page'));

/* ── B: page-2-only copy keeps the TRUE page number + notebook svg ── */
const only2 = buildStyledPageHtml({ pages, meta, settings, pageNumbers: [2] });
check('B: one section', (only2.html.match(/class="pn-page"/g) ?? []).length === 1);
check('B: true page number (data-page="2")', only2.html.includes('data-page="2"'));
check('B: notebook ruling svg rendered', only2.html.includes('<svg') && only2.html.includes('line'));

/* ── C: styled page 1 carries edu markup + frame + floats ── */
const only1 = buildStyledPageHtml({ pages, meta, settings, pageNumbers: [1] });
check('C: edu-block markup preserved', only1.html.includes('edu-definition') && only1.html.includes('تعریف بردار'));
check('C: frame svg present (framed kind)', only1.html.includes('<svg'));
check('C: floating image copied', only1.html.includes('<img') && only1.html.includes(IMG.slice(0, 40)));
check('C: floating textBox text copied', only1.html.includes('یادداشت مهم'));
check('C: placeholders stripped', !only1.html.includes('data-ph'));

/* ── D: clipboard flavors — ClipboardItem stub captures the write ── */
let captured = null;
let capturedWrite = null;
globalThis.ClipboardItem = class {
  constructor(items) { captured = items; }
};
/* jsdom Blob lacks .text() — read via FileReader instead */
const blobText = (blob) => new Promise((res) => { const fr = new dom.window.FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => res(''); fr.readAsText(blob); });
globalThis.navigator.clipboard = { write: async (items) => { capturedWrite = items; captured = items?.[0]; } };
const flavor = await copyPagesToClipboard({ pages, meta, settings, pageNumbers: [1] });
check('D: clipboard flavor = html', flavor === 'html');
/* access flavors by INDEX (jsdom Blob instances may hide string keys from
   Object.keys) — the ClipboardItem record still holds them */
const item0 = capturedWrite?.[0] ?? captured;
const tryFlavor = (key) => {
  if (!item0) return null;
  try { return item0[key] ?? null; } catch { return null; }
};
const htmlBlob = tryFlavor('text/html');
const htmlText = htmlBlob ? await blobText(htmlBlob) : '';
check('D: text/html blob has the full doc', !!htmlBlob);
check('D: html flavor contains the page', htmlText.includes('pn-page') && htmlText.includes('تعریف بردار'), `len=${htmlText.length}`);
const plainBlob = tryFlavor('text/plain');
const plainText = plainBlob ? await blobText(plainBlob) : '';
check('D: text/plain fallback has the text', plainText.includes('عنوان درس'), `len=${plainText.length}`);

/* ── E: empty selection → honest none ── */
const none = await copyPagesToClipboard({ pages: [], meta, settings });
check('E: nothing to copy → none', none === 'none');

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
