/**
 * Round-trip probe for pagination attrs through TipTap's schema:
 * does pageBreak{kind,auto} and doc{pageKind} survive load → getJSON?
 * Run with tsx (server workspace ships it): npx tsx scripts/qa-attr-probe.ts
 */
import { JSDOM } from 'jsdom';

/* TipTap wants a DOM — provide jsdom's before constructing the Editor */
const dom = new JSDOM('<!doctype html><html><body></body></html>');
(globalThis as Record<string, unknown>).document = dom.window.document;
(globalThis as Record<string, unknown>).window = dom.window;
(globalThis as Record<string, unknown>).Element = dom.window.Element;
(globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement;
(globalThis as Record<string, unknown>).Node = dom.window.Node;
(globalThis as Record<string, unknown>).navigator = dom.window.navigator;

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { PageBreak } from '../client/src/editor/extensions/PageBreak';
import { PagedDoc } from '../client/src/editor/extensions/PagedDoc';

const docJSON = {
  type: 'doc',
  attrs: { pageKind: 'blank' },
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
    { type: 'pageBreak', attrs: { kind: 'notebook', auto: true } },
    { type: 'paragraph' },
    { type: 'pageBreak' },
    { type: 'paragraph', content: [{ type: 'text', text: 'tail' }] },
  ],
};

const ed = new Editor({
  extensions: [StarterKit.configure({ document: false }), PagedDoc, PageBreak],
  content: docJSON as never,
});
const out = ed.getJSON();
ed.destroy();

console.log('docAttrs:', JSON.stringify(out.attrs));
console.log(
  'breaks:',
  JSON.stringify(out.content?.filter((n) => n.type === 'pageBreak').map((n) => n.attrs)),
);

const okDoc = (out.attrs as { pageKind?: string } | undefined)?.pageKind === 'blank';
const breaks = out.content?.filter((n) => n.type === 'pageBreak') ?? [];
const okBreaks =
  breaks.length === 2 &&
  (breaks[0]!.attrs as { kind?: string })!.kind === 'notebook' &&
  (breaks[0]!.attrs as { auto?: boolean })!.auto === true &&
  Object.keys(breaks[1]!.attrs ?? {}).length === 0;

console.log(`doc.pageKind survives: ${okDoc ? 'YES ✅' : 'NO ❌'}`);
console.log(`pageBreak kind/auto survive: ${okBreaks ? 'YES ✅' : 'NO ❌'}`);
process.exit(okDoc && okBreaks ? 0 : 1);
