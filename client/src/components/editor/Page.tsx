import { memo, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
import type { XmlFragment } from 'yjs';
import { Collaboration } from '@tiptap/extension-collaboration';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import { TableView } from '@tiptap/pm/tables';
import type { ViewMutationRecord } from '@tiptap/pm/view';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import { FontSize } from '@/editor/extensions/FontSize';
import { FontFamily } from '@/editor/extensions/FontFamily';
import { Indent } from '@/editor/extensions/Indent';
import {
  CalloutBlock,
  QuestionBlock,
  ExampleBlock,
  KeyTermBlock,
  FormulaBlock,
  ComparisonTable,
  Timeline,
  FootnoteBlock as FootnoteBlock,
  LongAnswerBlock,
  HighlightBox,
  ReferenceBlock,
  ProConBlock,
  CodeOutputBlock,
  TrueFalseBlock,
  McqBlock,
} from '@/editor/extensions/blocks';
import { Equation, EquationInline, EquationExtension } from '@/editor/extensions/EquationNode';
import { SlashCommand } from '@/editor/extensions/SlashCommand';
import { DragHandle } from '@/editor/extensions/DragHandle';
import { PageBreak } from '@/editor/extensions/PageBreak';
import { TableEscape } from '@/editor/extensions/TableEscape';
import { TableRowResizing } from '@/editor/extensions/TableRowResizing';
import { PagedDoc } from '@/editor/extensions/PagedDoc';
import { FixedPageGuard } from '@/editor/extensions/FixedPageGuard';
import { flowEngineActiveRef } from '@/editor/flowEngineState';
import { scaleToFit, insertionArea } from '@/editor/pageCapacity';
import { emitCapacityReject } from '@/editor/paginationMode';
import { InlineIcon } from '@/editor/extensions/InlineIcon';
import { ListMarker } from '@/editor/extensions/ListMarker';
import { PageBorder } from '@/components/border/PageBorder';
import { DEFAULT_BORDER_SETTINGS, type BorderSettings, type PageKind } from '@/types';
import { FloatingLayer } from '@/components/editor/FloatingLayer';
import type { FloatingElement } from '@/components/editor/FloatingLayer';

const A4_W_PX = 794;
const A4_H_PX = 1123;

/** Border shown on workspace pages — exported so the pages-sidebar thumbnails
 *  render the exact same قاب and previews stay pixel-identical to the page. */
export const PAGE_PREVIEW_BORDER: BorderSettings = {
  ...DEFAULT_BORDER_SETTINGS,
  style: 'classic',
  primaryColor: '#1e3a5f',
  secondaryColor: '#c5a24d',
  thickness: 1,
  cornerDecoration: true,
  showPageNumbers: true,
};

/** Shared empty array (§11): a fresh `?? []` allocation per page per render
 *  defeats prop-identity memoization — the empty case can always be shared. */
export const EMPTY_FLOATS_LIST: FloatingElement[] = [];

/** THE extension list, built once per useEditor. Exported so the static
 *  JSON→HTML serializer (EditorPage.docJsonToHtml) can build a ProseMirror
 *  schema with `getSchema` that is node-for-node IDENTICAL to the live
 *  editors' — the fallback HTML it produces must serialize every custom
 *  block (edu blocks, equations, formula, tables design attrs, …) exactly
 *  the way `editor.getHTML()` does, otherwise unmounted pages would export
 *  structurally different markup than mounted ones. */
export function buildEditorExtensions() {
  return [
    /* PagedDoc replaces StarterKit's stock Document so the FIRST page's
       visual kind (attrs.pageKind) survives save → load — the stock doc
       node declares no attributes and TipTap strips unknown ones */
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      history: { depth: 200 },
      document: false,
    }),
    PagedDoc,
    Underline,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    /* جدول — resizable=true دسته‌های درگ لبه ستون‌ها را فعال می‌کند (مثل
       Word: drag به عرض ستون) و getHTML آن‌وقت <colgroup> با عرض‌ها را
       سری می‌کند تا در چاپ/PDF و Word هم همان عرض‌ها برقرار بماند.
       ویژگی‌های طراحی (راه‌راه/بدون‌خط/تراز/عرض/پدینگ) روی خود گره جدول
       سوار شده‌اند تا از طریق تب «طراحی جدول» و در هر سه خروجی یکی باشند. */
    Table.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          striped: {
            default: false,
            parseHTML: (el) => el.getAttribute('data-striped') === 'true',
            renderHTML: (a) => (a.striped ? { 'data-striped': 'true' } : {}),
          },
          borderless: {
            default: false,
            parseHTML: (el) => el.getAttribute('data-borderless') === 'true',
            renderHTML: (a) => (a.borderless ? { 'data-borderless': 'true' } : {}),
          },
          align: {
            default: null as string | null,
            parseHTML: (el) => el.getAttribute('data-align'),
            renderHTML: (a) => (a.align ? { 'data-align': a.align } : {}),
          },
          width: {
            default: null as string | null,
            parseHTML: (el) => el.getAttribute('data-width'),
            renderHTML: (a) => (a.width ? { style: `width:${a.width}` } : {}),
          },
          cellpad: {
            default: null as string | null,
            parseHTML: (el) => el.getAttribute('data-cellpad'),
            renderHTML: (a) => (a.cellpad ? { 'data-cellpad': a.cellpad } : {}),
          },
          /* قالب آماده (تمپلیت) جدول — توکن استایل که در index.css/printCss
             قواعدش هست و در Word به‌صورت inline بیک می‌شود */
          tstyle: {
            default: null as string | null,
            parseHTML: (el) => el.getAttribute('data-tstyle'),
            renderHTML: (a) => (a.tstyle ? { 'data-tstyle': a.tstyle } : {}),
          },
        };
      },
      /* ═══ THE design-attrs DOM bridge ═══
         The table is rendered by prosemirror-tables' TableView node view,
         whose update() syncs ONLY the colgroup widths — design attrs
         (data-tstyle / data-striped / data-borderless / data-align /
         data-cellpad / width) never reached the editor DOM, so every
         «طراحی جدول» tool appeared dead ON THE PAGE while exports (which
         read the doc, not the DOM) were fine. This view wraps TableView
         and writes those attrs onto the <table> element on every update. */
      addNodeView() {
        const cellMinWidth = this.options?.cellMinWidth ?? 25;
        return ({ node }) => {
          const tv = new TableView(node, cellMinWidth);
          const sync = (n: typeof node) => {
            const el = tv.table as HTMLTableElement;
            const a = n.attrs as Record<string, unknown>;
            el.toggleAttribute('data-striped', a.striped === true);
            el.toggleAttribute('data-borderless', a.borderless === true);
            if (a.tstyle) el.setAttribute('data-tstyle', String(a.tstyle)); else el.removeAttribute('data-tstyle');
            if (a.align) el.setAttribute('data-align', String(a.align)); else el.removeAttribute('data-align');
            if (a.cellpad) el.setAttribute('data-cellpad', String(a.cellpad)); else el.removeAttribute('data-cellpad');
            /* whole-table width (resize grip) — the width style lives in
               sync() which now runs AFTER tv.update; updateColumnsOnResize
               would otherwise overwrite it back to the doc-derived width
               and every drag of the grip would bounce. */
            if (a.width) el.style.width = String(a.width);
            else el.style.removeProperty('width');
            /* guard the colgroup: '100%' values (insertTable default
               colWidths) freeze the table width AND make subsequent
               drags compute NaN widths — rewrite them to px from the
               real rendered width, once, after tv.update has run. */
            const cg = el.querySelector('colgroup');
            if (cg) {
              const realW = el.getBoundingClientRect().width || el.offsetWidth || 0;
              if (realW > 0) {
                for (const c of Array.from(cg.children) as HTMLElement[]) {
                  if (c.style.width === '100%') c.style.width = `${realW}px`;
                }
              }
            }
          };
          sync(node);
          return {
            dom: tv.dom,
            contentDOM: tv.contentDOM,
            update: (n: typeof node) => {
              if (n.type !== node.type) return false;
              tv.update(n);
              /* AFTER tv.update: updateColumnsOnResize rewrites table.style
                 (width/min-width) — re-applying the design attrs last makes
                 data-striped/data-tstyle/… deterministic even when the
                 TableView resets inline styles (the editor-page striping
                 must never lag one transaction behind the doc). */
              sync(n);
              return true;
            },
            ignoreMutation: (rec: ViewMutationRecord) => tv.ignoreMutation(rec),
          };
        };
      },
    }).configure({ resizable: true }),
    TableRow.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          /* ارتفاع ردیف — با کشیدن دستهٔ پایین ردیف (TableRowResizing)
             تنظیم می‌شود؛ height روی <tr> مثل Word فقط حداقل ارتفاع است */
          height: {
            default: null as number | null,
            parseHTML: (el) => {
              const h = (el as HTMLElement).style.height;
              return h ? parseFloat(h) : null;
            },
            renderHTML: (a) => (a.height ? { style: `height:${a.height}px` } : {}),
          },
        };
      },
    }),
    TableHeader.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          backgroundColor: {
            default: null as string | null,
            parseHTML: (el) => (el as HTMLElement).style.backgroundColor || null,
            renderHTML: (a) => (a.backgroundColor ? { style: `background-color:${a.backgroundColor}` } : {}),
          },
          verticalAlign: {
            default: null as string | null,
            parseHTML: (el) => (el as HTMLElement).style.verticalAlign || null,
            renderHTML: (a) => (a.verticalAlign ? { style: `vertical-align:${a.verticalAlign}` } : {}),
          },
        };
      },
    }),
    TableCell.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          backgroundColor: {
            default: null as string | null,
            parseHTML: (el) => (el as HTMLElement).style.backgroundColor || null,
            renderHTML: (a) => (a.backgroundColor ? { style: `background-color:${a.backgroundColor}` } : {}),
          },
          verticalAlign: {
            default: null as string | null,
            parseHTML: (el) => (el as HTMLElement).style.verticalAlign || null,
            renderHTML: (a) => (a.verticalAlign ? { style: `vertical-align:${a.verticalAlign}` } : {}),
          },
        };
      },
    }),
    /* کشیدن لبهٔ پایین ردیف برای بلند/کوتاه کردن آن — مکمل resize ستون‌ها */
    TableRowResizing,
    /* width + align attrs so the ابزار تصویر contextual menu can resize
       and align the selected image (rendered as native img[width] and
       data-align, both printable/exportable) */
    Image.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          width: {
            default: null,
            parseHTML: (el) => el.getAttribute('width'),
            renderHTML: (a) => (a.width ? { width: a.width } : {}),
          },
          align: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-align'),
            renderHTML: (a) => (a.align ? { 'data-align': a.align } : {}),
          },
        };
      },
    }).configure({ inline: false }),
    InlineIcon,
    /* per-list marker glyphs (●/○/▪ … , ۱./۲) styleable + removable after
       creation — data-marker attr + CSS counters in index.css/printCss */
    ListMarker,
    Link.configure({ openOnClick: false, autolink: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: '' }),
    Superscript,
    Subscript,
    FontSize,
    FontFamily,
    Indent,
    CalloutBlock,
    QuestionBlock,
    ExampleBlock,
    KeyTermBlock,
    FormulaBlock,
    ComparisonTable,
    Timeline,
    FootnoteBlock,
    LongAnswerBlock,
    HighlightBox,
    ReferenceBlock,
    ProConBlock,
    CodeOutputBlock,
    TrueFalseBlock,
    McqBlock,
    /* structured equations — real AST-backed document objects */
    Equation,
    EquationInline,
    EquationExtension,
    SlashCommand,
    DragHandle,
    PageBreak,
    /* Word-like خروج از جدول — Enter/ArrowDown leave the last cell into a
       paragraph AFTER the table (so the TABLE never teleports to the next
       page; only the following paragraph flows), Backspace returns inside.
       Registered LAST: its handleKeyDown must run after the stock table
       plugins (which no-op on these cases) and before the default
       SplitBlock fallback. */
    TableEscape,
    /* ManualFixedPagePolicy (paginationMode.ts): rejects transactions whose
       rendered result would overflow the sheet — WITHOUT ever making the
       page read-only (deletion/selection/editing stay free). Registered
       last; inert the moment the pagination mode flips to 'smart'. */
    FixedPageGuard,
  ];
}

export interface PageProps {
  pageId: string;
  pageNumber: number;
  /** visual kind of this sheet: framed (قاب‌دار) | blank (بدون قاب) | notebook (نوت‌بوکی) */
  kind?: PageKind;
  /** the user's REAL persisted border settings (design tab) — when omitted,
   *  PAGE_PREVIEW_BORDER (the classic navy/gold frame) is used */
  borderSettings?: BorderSettings;
  content: Record<string, unknown> | null;
  fontSize: number;
  lineHeight: number;
  enabled: boolean;
  active: boolean;
  floatingElements: FloatingElement[];
  /** accepts a plain list OR a functional updater (both resolve against the
   *  current page's float list — see FloatingLayer.onChange) */
  setFloatingElements: (els: FloatingElement[] | ((current: FloatingElement[]) => FloatingElement[])) => void;
  /** live drag/resize geometry bridge → contextual ribbon (see FloatingLayer) */
  onLiveGeometry?: (pageId: string, id: string, g: { x: number; y: number; width: number; height: number } | null) => void;
  /** doc-content changed. Payload is deliberately the doc JSON ONLY — the
   *  host derives HTML/plainText from its live editors at save/export time
   *  (§10: typing must not pay for serializations it doesn't need). */
  onUpdate: (pageId: string, json: Record<string, unknown>) => void;
  /** called when the user clicks into this page — the parent makes it the
   *  active page (sidebar highlight, floating layer, …) */
  onActivate?: () => void;
  /** called when THIS page's editor gains real DOM focus — the authoritative
   *  active-page signal. Click/keyboard focus lands where the user actually
   *  is, so keyboard edits can never be routed to a previously-focused
   *  page's editor (the "delete deleted text from the LAST page" bug). */
  onEditorFocus?: () => void;
  editorRef?: (editor: Editor | null) => void;
  editorContainerRef?: React.RefObject<HTMLDivElement | null>;
  /** pasted/dropped image files become FLOATING image objects on this page
   *  (paste → تصویر شناور policy). When omitted, paste falls back to the
   *  legacy in-text image node. */
  onPasteToFloat?: (src: string, width: number, height: number, aspectRatio: number) => void;
  /** ── collaboration binding (optional — personal notes pass nothing) ──
   *  When set, this page's editor binds to the shared yjs XmlFragment for
   *  the sheet instead of static TipTap JSON: local transactions merge
   *  into yjs and remote updates arrive as REMOTE transactions (marked
   *  isChangeOrigin by y-prosemirror — no echo loop, no full-doc replace).
   *  `collabEditable=false` keeps the binding but makes the page view-only
   *  (the 4-seat policy). */
  collabFragment?: XmlFragment | null;
  collabEditable?: boolean;
}

/** plain-text projection of a page doc — used ONLY at save/export time
 *  (lazy: never on the typing hot path). */
export function plainTextOf(json: Record<string, unknown>): string {
  let out = '';
  const walk = (n: { type?: string; text?: string; content?: never[] }) => {
    if (n.text) out += n.text + ' ';
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(json as never);
  return out.trim();
}
/** Insert every image file in `files` at the current cursor position as a
 *  base64 <img> node, SCALED TO FIT the page's remaining usable area
 *  (ManualFixedPagePolicy §10: «scale to fit, never crop to fit» — natural
 *  aspect ratio preserved, the whole image stays visible). When even the
 *  minimum size cannot fit the free space, the insertion is rejected with
 *  the capacity toast instead of producing an overflowing sheet. Returns
 *  true when image files were present so ProseMirror skips its default
 *  (text-only) paste/drop logic — the actual insertion happens
 *  asynchronously once each file has been read (and measured). */
/** Convert pasted/dropped image files into FLOATING image objects instead of
 *  in-text image nodes. Fires `floatInsert(src, w, h, ratio)` once per file
 *  (after the file is read and measured); the parent adds the object to the
 *  page's floating layer. Returns true when image files were present so
 *  ProseMirror skips its default paste/drop logic. */
function insertImageFiles(
  view: any,
  files: FileList | null | undefined,
  floatInsert?: (src: string, width: number, height: number, aspectRatio: number) => void,
): boolean {
  const images = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'));
  if (images.length === 0) return false;
  images.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      const src = reader.result;
      /* window.Image — the DOM constructor; `Image` here is the TipTap extension */
      const img = new window.Image();
      img.onload = () => {
        const natW = img.naturalWidth || 600;
        const natH = img.naturalHeight || 400;
        if (floatInsert) {
          /* paste becomes a floating object — cap to a sane width so a
             full-res screenshot does not fill the whole sheet; the floating
             layer's own placement/bounds policy takes it from here */
          const w = Math.min(480, natW);
          const h = Math.round(w * (natH / natW));
          floatInsert(src, w, h, natW / natH);
          return;
        }
        /* fallback (no float bridge wired): in-text image, scaled to fit */
        const { schema } = view.state;
        const area = insertionArea(view);
        const fit = scaleToFit(natW, natH, area.width, area.height);
        if (!fit.fits) {
          emitCapacityReject('تصویر در فضای باقی‌مانده صفحه جا نمی‌شود');
          return;
        }
        const node = schema.nodes.image?.create({ src, alt: file.name, width: fit.width });
        if (!node) return;
        const tr = view.state.tr.replaceSelectionWith(node);
        view.dispatch(tr.scrollIntoView());
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
  return true;
}

/** QA diagnostics (§11/§16): zero-cost unless `window.__layoutDebug` is on.
 *  Counts renders per page so the validation harness can prove typing in
 *  page N does NOT re-render pages 1..N-1 (render-cascade check). */
function pageRenderStat(pageId: string): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __layoutDebug?: boolean; __pnPageRenders?: Record<string, number> };
  if (!w.__layoutDebug) return;
  w.__pnPageRenders = w.__pnPageRenders ?? {};
  w.__pnPageRenders[pageId] = (w.__pnPageRenders[pageId] ?? 0) + 1;
}

/** Memoized (§11 render-cascade fix): typing in page N re-renders EditorPage
 *  (new pages array), but every UNTOUCHED page now bails out here because its
 *  props keep identity — content object, floats (or the shared EMPTY_FLOATS_LIST)
 *  and all callbacks are stable across keystrokes. Only the edited page (new
 *  content object) and pages whose `active` flips actually re-render. */
export const Page = memo(function PageInner({
  pageId,
  pageNumber,
  kind = 'framed',
  borderSettings,
  content,
  fontSize,
  lineHeight,
  enabled,
  active,
  floatingElements,
  setFloatingElements,
  onLiveGeometry,
  onUpdate,
  onActivate,
  onEditorFocus,
  editorRef,
  editorContainerRef,
  onPasteToFloat,
  collabFragment,
  collabEditable = true,
}: PageProps) {
  pageRenderStat(pageId);
  const pageRef = useRef<HTMLDivElement>(null);
  /* per-page ref on THIS page's content box — the FloatingLayer measures the
     sheet's real usable area through it. (Passing a single shared ref down
     from EditorPage meant every layer measured the same — never attached —
     node and silently fell back to hardcoded framed-page constants, so
     notebook/blank pages got wrong object bounds.) */
  const pageContainerRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      /* PagedDoc replaces StarterKit's stock Document so the FIRST page's
         visual kind (attrs.pageKind) survives save → load — the stock doc
         node declares no attributes and TipTap strips unknown ones */
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        /* §UNDO/REDO: while collaborating, history must be OFF — the
           Collaboration extension brings its own yjs UndoManager (per-user
           origin tracking) and is incompatible with prosemirror-history;
           leaving both mounted makes Ctrl+Z ambiguous and spams the
           tiptap warn on every page mount. */
        history: collabFragment ? false : { depth: 200 },
        document: false,
      }),
      PagedDoc,
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      /* جدول — resizable=true دسته‌های درگ لبه ستون‌ها را فعال می‌کند (مثل
         Word: drag به عرض ستون) و getHTML آن‌وقت <colgroup> با عرض‌ها را
         سری می‌کند تا در چاپ/PDF و Word هم همان عرض‌ها برقرار بماند.
         ویژگی‌های طراحی (راه‌راه/بدون‌خط/تراز/عرض/پدینگ) روی خود گره جدول
         سوار شده‌اند تا از طریق تب «طراحی جدول» و در هر سه خروجی یکی باشند. */
      Table.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            striped: {
              default: false,
              parseHTML: (el) => el.getAttribute('data-striped') === 'true',
              renderHTML: (a) => (a.striped ? { 'data-striped': 'true' } : {}),
            },
            borderless: {
              default: false,
              parseHTML: (el) => el.getAttribute('data-borderless') === 'true',
              renderHTML: (a) => (a.borderless ? { 'data-borderless': 'true' } : {}),
            },
            align: {
              default: null as string | null,
              parseHTML: (el) => el.getAttribute('data-align'),
              renderHTML: (a) => (a.align ? { 'data-align': a.align } : {}),
            },
            width: {
              default: null as string | null,
              parseHTML: (el) => el.getAttribute('data-width'),
              renderHTML: (a) => (a.width ? { style: `width:${a.width}` } : {}),
            },
            cellpad: {
              default: null as string | null,
              parseHTML: (el) => el.getAttribute('data-cellpad'),
              renderHTML: (a) => (a.cellpad ? { 'data-cellpad': a.cellpad } : {}),
            },
            /* قالب آماده (تمپلیت) جدول — توکن استایل که در index.css/printCss
               قواعدش هست و در Word به‌صورت inline بیک می‌شود */
            tstyle: {
              default: null as string | null,
              parseHTML: (el) => el.getAttribute('data-tstyle'),
              renderHTML: (a) => (a.tstyle ? { 'data-tstyle': a.tstyle } : {}),
            },
          };
        },
        /* ═══ THE design-attrs DOM bridge ═══
           The table is rendered by prosemirror-tables' TableView node view,
           whose update() syncs ONLY the colgroup widths — design attrs
           (data-tstyle / data-striped / data-borderless / data-align /
           data-cellpad / width) never reached the editor DOM, so every
           «طراحی جدول» tool appeared dead ON THE PAGE while exports (which
           read the doc, not the DOM) were fine. This view wraps TableView
           and writes those attrs onto the <table> element on every update. */
        addNodeView() {
          const cellMinWidth = this.options?.cellMinWidth ?? 25;
          return ({ node }) => {
            const tv = new TableView(node, cellMinWidth);
            const sync = (n: typeof node) => {
              const el = tv.table as HTMLTableElement;
              const a = n.attrs as Record<string, unknown>;
              el.toggleAttribute('data-striped', a.striped === true);
              el.toggleAttribute('data-borderless', a.borderless === true);
              if (a.tstyle) el.setAttribute('data-tstyle', String(a.tstyle)); else el.removeAttribute('data-tstyle');
              if (a.align) el.setAttribute('data-align', String(a.align)); else el.removeAttribute('data-align');
              if (a.cellpad) el.setAttribute('data-cellpad', String(a.cellpad)); else el.removeAttribute('data-cellpad');
              /* whole-table width (resize grip) — the width style lives in
                 sync() which now runs AFTER tv.update; updateColumnsOnResize
                 would otherwise overwrite it back to the doc-derived width
                 and every drag of the grip would bounce. */
              if (a.width) el.style.width = String(a.width);
              else el.style.removeProperty('width');
              /* guard the colgroup: '100%' values (insertTable default
                 colWidths) freeze the table width AND make subsequent
                 drags compute NaN widths — rewrite them to px from the
                 real rendered width, once, after tv.update has run. */
              const cg = el.querySelector('colgroup');
              if (cg) {
                const realW = el.getBoundingClientRect().width || el.offsetWidth || 0;
                if (realW > 0) {
                  for (const c of Array.from(cg.children) as HTMLElement[]) {
                    if (c.style.width === '100%') c.style.width = `${realW}px`;
                  }
                }
              }
            };
            sync(node);
            return {
              dom: tv.dom,
              contentDOM: tv.contentDOM,
              update: (n: typeof node) => {
                if (n.type !== node.type) return false;
                tv.update(n);
                /* AFTER tv.update: updateColumnsOnResize rewrites table.style
                   (width/min-width) — re-applying the design attrs last makes
                   data-striped/data-tstyle/… deterministic even when the
                   TableView resets inline styles (the editor-page striping
                   must never lag one transaction behind the doc). */
                sync(n);
                return true;
              },
              ignoreMutation: (rec: ViewMutationRecord) => tv.ignoreMutation(rec),
            };
          };
        },
      }).configure({ resizable: true }),
      TableRow.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            /* ارتفاع ردیف — با کشیدن دستهٔ پایین ردیف (TableRowResizing)
               تنظیم می‌شود؛ height روی <tr> مثل Word فقط حداقل ارتفاع است */
            height: {
              default: null as number | null,
              parseHTML: (el) => {
                const h = (el as HTMLElement).style.height;
                return h ? parseFloat(h) : null;
              },
              renderHTML: (a) => (a.height ? { style: `height:${a.height}px` } : {}),
            },
          };
        },
      }),
      TableHeader.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            backgroundColor: {
              default: null as string | null,
              parseHTML: (el) => (el as HTMLElement).style.backgroundColor || null,
              renderHTML: (a) => (a.backgroundColor ? { style: `background-color:${a.backgroundColor}` } : {}),
            },
            verticalAlign: {
              default: null as string | null,
              parseHTML: (el) => (el as HTMLElement).style.verticalAlign || null,
              renderHTML: (a) => (a.verticalAlign ? { style: `vertical-align:${a.verticalAlign}` } : {}),
            },
          };
        },
      }),
      TableCell.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            backgroundColor: {
              default: null as string | null,
              parseHTML: (el) => (el as HTMLElement).style.backgroundColor || null,
              renderHTML: (a) => (a.backgroundColor ? { style: `background-color:${a.backgroundColor}` } : {}),
            },
            verticalAlign: {
              default: null as string | null,
              parseHTML: (el) => (el as HTMLElement).style.verticalAlign || null,
              renderHTML: (a) => (a.verticalAlign ? { style: `vertical-align:${a.verticalAlign}` } : {}),
            },
          };
        },
      }),
      /* کشیدن لبهٔ پایین ردیف برای بلند/کوتاه کردن آن — مکمل resize ستون‌ها */
      TableRowResizing,
      /* width + align attrs so the ابزار تصویر contextual menu can resize
         and align the selected image (rendered as native img[width] and
         data-align, both printable/exportable) */
      Image.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            width: {
              default: null,
              parseHTML: (el) => el.getAttribute('width'),
              renderHTML: (a) => (a.width ? { width: a.width } : {}),
            },
            align: {
              default: null,
              parseHTML: (el) => el.getAttribute('data-align'),
              renderHTML: (a) => (a.align ? { 'data-align': a.align } : {}),
            },
          };
        },
      }).configure({ inline: false }),
      InlineIcon,
      /* per-list marker glyphs (●/○/▪ … , ۱./۲) styleable + removable after
         creation — data-marker attr + CSS counters in index.css/printCss */
      ListMarker,
      Link.configure({ openOnClick: false, autolink: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: '' }),
      Superscript,
      Subscript,
      FontSize,
      FontFamily,
      Indent,
      CalloutBlock,
      QuestionBlock,
      ExampleBlock,
      KeyTermBlock,
      FormulaBlock,
      ComparisonTable,
      Timeline,
      FootnoteBlock,
      LongAnswerBlock,
      HighlightBox,
      ReferenceBlock,
      ProConBlock,
      CodeOutputBlock,
      TrueFalseBlock,
      McqBlock,
      /* structured equations — real AST-backed document objects */
      Equation,
      EquationInline,
      EquationExtension,
      SlashCommand,
      DragHandle,
      PageBreak,
      /* Word-like خروج از جدول — Enter/ArrowDown leave the last cell into a
         paragraph AFTER the table (so the TABLE never teleports to the next
         page; only the following paragraph flows), Backspace returns inside.
         Registered LAST: its handleKeyDown must run after the stock table
         plugins (which no-op on these cases) and before the default
         SplitBlock fallback. */
      TableEscape,
      /* ManualFixedPagePolicy (paginationMode.ts): rejects transactions whose
         rendered result would overflow the sheet — WITHOUT ever making the
         page read-only (deletion/selection/editing stay free). Registered
         last; inert the moment the pagination mode flips to 'smart'. */
      FixedPageGuard,
      /* ── collaboration binding (conditional — see collabFragment) ──
         When present, replaces static content with the shared yjs fragment:
         TipTap history is DISABLED (Collaboration brings its own yjs
         UndoManager per user, so Ctrl+Z undoes MY local history, not
         another editor's transactions — task §UNDO/REDO). Remote updates
         are applied by y-prosemirror as remote transactions; the local
         onUpdate still fires for autosave. The conditional keeps the
         extension list STABLE in identity for the non-collab case so the
         memoized Page and static-schema export behave exactly as before. */
      ...(collabFragment ? [Collaboration.configure({ fragment: collabFragment })] : []),
    ],
    /* When collaborating, initial content comes from the shared yjs
       fragment (server-seeded from the room / converged CRDT state) —
       passing TipTap JSON here would be re-pushed into yjs by y-prosemirror
       and clobber concurrent remote edits. content: null starts empty and
       lets the fragment render. */
    content: collabFragment ? null : ((content as never) ?? { type: 'doc', content: [{ type: 'paragraph' }] }),
    editable: enabled && collabEditable,
    editorProps: {
      attributes: {
        dir: 'rtl',
        class: 'pn-editor focus:outline-none',
        'data-gramm': 'false',
      },
      /* real focus (click, Tab, programmatic) is THE active-page signal:
         keyboard input always lands in the focused editor, so the parent
         must track focus, not merely mousedown — a click on a not-yet
         focused page otherwise leaves focus (and the caret) on the
         previously typed-in page, and Delete/Backspace then edits THAT
         page's selection instead of the text the user just selected. */
      handleDOMEvents: {
        /* ── Nested-contenteditable typing trap (edu title + MCQ option spans) ──
         Chromium retargets beforeinput of the nested .edu-title-text span
         to the PM root; PM would then apply the char at its INTERNAL
         selection (the body paragraph) and the caret "jumps" out of the
         question title while typing fast. Trap it: apply the insertion
         inside the span ourselves and block PM. */
        beforeinput: (_view: unknown, event: InputEvent) => {
          const target = event.target as HTMLElement | null;
          const span = (target?.closest?.('.edu-title-text') || target?.closest?.('.quiz-opt-text')) as HTMLElement | null;
          if (!span || !span.isContentEditable) return false;
          const t = event.inputType || '';
          const inserting =
            t === 'insertText' || t === 'insertCompositionText' ||
            t === 'insertReplacementText';
          if (!inserting) return false;
          event.preventDefault();
          event.stopImmediatePropagation();
          const data = event.data ?? '';
          if (data) document.execCommand('insertText', false, data);
          return true;
        },
        focus: () => {
          onEditorFocus?.();
          return false;
        },
      },
      /* Paste/drop of image FILES (screenshot in clipboard, copied picture,
         drag-and-drop from Explorer): ProseMirror only handles <img> HTML —
         image files in the clipboard would be silently dropped. Convert
         them to base64 and insert an image node at the cursor. */
      handlePaste: (view: any, event: ClipboardEvent) => {
        return insertImageFiles(view, event.clipboardData?.files, onPasteToFloat);
      },
      handleDrop: (view: any, event: DragEvent) => {
        return insertImageFiles(view, event.dataTransfer?.files, onPasteToFloat);
      },
    },
    onUpdate: ({ editor: ed }) => {
      /* the pagination engine's own bookkeeping transactions (content moves
         between pages) must not re-enter React state per cascade step — the
         engine reconciles the pages mirror itself. The USER's edit (which
         triggered the flow) always fires onUpdate BEFORE the engine pass
         starts, so autosave still sees every user change. */
      if (flowEngineActiveRef.current) return;
      /* ── collaboration note (loop prevention) ──
         Remote updates arrive through y-prosemirror as transactions marked
         isChangeOrigin; they fire onUpdate too, and their converged JSON
         SHOULD refresh the local mirror (the debounced save persists what
         the room shows). The forbidden echo loop is structurally absent:
         outbound traffic is yjs BINARY OPS fanned out by the session's doc
         observer — never this JSON — so onUpdate can never send the
         document anywhere (task §CRITICAL: TRANSACTION-BASED SYNC). */
      /* §10 hot path: ONE serialization per keystroke. getHTML() (a second
         full-document DOM walk + stringify) and the plain-text walk used to
         run here on EVERY keystroke though their only consumers are the
         debounced save and export — both now derive those from the live
         editors when actually needed. */
      const json = ed.getJSON() as Record<string, unknown>;
      onUpdate(pageId, json);
    },
  });

  useEffect(() => {
    editorRef?.(editor ?? null);
    return () => editorRef?.(null);
  }, [editor, editorRef]);

  /* QA automation hook (dev/E2E tests only): expose this page's editor so a
     test driver can dispatch transactions and read measurements without
     touching the real DOM focus. Cheap, no-op without the flag. */
  useEffect(() => {
    if (!editor || typeof window === 'undefined') return;
    const w = window as unknown as { __pn?: { editors?: Record<string, any> } };
    w.__pn = w.__pn ?? {};
    w.__pn.editors = w.__pn.editors ?? {};
    w.__pn.editors[pageId] = editor;
    return () => {
      if (w.__pn?.editors) delete w.__pn.editors[pageId];
    };
  }, [editor, pageId]);

  /* TipTap ignores prop changes to `editable` after creation — keep the
     editor's editability in sync with the `enabled` prop ourselves */
  useEffect(() => {
    const effective = enabled && collabEditable;
    if (editor && editor.isEditable !== effective) editor.setEditable(effective);
  }, [editor, enabled, collabEditable]);

  return (
    <div
      className={`page-paper page-${kind}`}
      ref={pageRef}
      data-page-id={pageId}
      onMouseDown={onActivate}
    >
      {kind === 'framed' && (
        <PageBorder settings={borderSettings ?? PAGE_PREVIEW_BORDER} pageNumber={pageNumber} />
      )}
      {kind === 'notebook' && (
        <div
          className="page-notebook-lines"
          aria-hidden="true"
          style={{
            '--editor-font-size': `${fontSize}px`,
            '--editor-line-height': String(lineHeight),
          } as CSSProperties}
        />
      )}
      <div className="page-content" ref={pageContainerRef}>
        <div
          className="pn-editor-wrap"
          style={{
            '--editor-font-size': `${fontSize}px`,
            '--editor-line-height': String(lineHeight),
          } as CSSProperties}
        >
          <EditorContent editor={editor} />
        </div>
        <FloatingLayer
          elements={floatingElements}
          onChange={setFloatingElements}
          editorContainerRef={pageContainerRef}
          pageKind={kind}
          pageId={pageId}
          onLiveGeometry={onLiveGeometry}
        />
      </div>
    </div>
  );
});
