/**
 * Word (.doc) export pipeline — client-side document transforms.
 *
 * The server route (/export/docx) wraps the note HTML in a Word-compatible
 * document; THIS module prepares the content so the output matches what the
 * editor shows:
 *
 *  1. Equations → OMML. The editor stores the LaTeX source in the HTML; the
 *     PDF path re-renders it with KaTeX, but Word cannot apply KaTeX's CSS
 *     and would show a jumble of spans. Word's native equation format is
 *     OMML (m:oMath) — Word reconstructs a real, editable equation from it
 *     when it opens the file. Pipeline: LaTeX → (KaTeX) MathML → OMML.
 *
 *  2. Task-list checkboxes → ☑/☐ characters. Word's HTML engine has no
 *     flexbox, so the editor's input-in-flex layout collapses; a Unicode
 *     ballot box keeps the checked state visible in every Word version.
 *
 *  3. edu-block customization → unscoped CSS the server embeds verbatim,
 *     so a customized «کادرهای آموزشی» theme reaches Word exactly like it
 *     reaches the editor and the PDF.
 */

import katex from 'katex';
import { mathmlToOmml, OMML_NS } from './mathmlToOmml';
import { eduBlocksCss, isTinted, resolveEduBlocks } from './eduBlocks';
import { TINTED_CSS } from './printCss';
import { pageBorderVmlString } from '@/components/border/PageBorder';
import { DEFAULT_BORDER_SETTINGS, type BorderSettings, type EduBlocksSettings } from '@/types';

/* the same entity decoding the PDF equation pass uses (blocks.ts) */
function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * One LaTeX source → `<m:oMath>` OMML island (inline form).
 * Returns null when KaTeX cannot parse the source or the DOM round-trip
 * fails — the caller then falls back to a visible linear source.
 */
function latexToOmml(latex: string, displayMode: boolean): string | null {
  try {
    const out = katex.renderToString(latex, { output: 'mathml', displayMode, throwOnError: false });
    const m = /<math[\s\S]*?<\/math>/.exec(out);
    if (!m) return null;
    const doc = new DOMParser().parseFromString(m[0], 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return null;
    const mathEl = doc.documentElement;
    if (!mathEl || mathEl.tagName !== 'math') return null;
    return mathmlToOmml(mathEl);
  } catch {
    return null;
  }
}

/** visible fallback when a source cannot become OMML — the LaTeX itself */
function fallbackIsland(latex: string, display: boolean): string {
  const style = display
    ? 'display:block;text-align:center;direction:ltr;font-family:Consolas,monospace;margin:0.6em 0;'
    : 'direction:ltr;font-family:Consolas,monospace;';
  return `<span style="${style}">${latex.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
}

/** append the equation number as a trailing run INSIDE the oMath element */
function withNumber(omml: string, no: string): string {
  return omml.replace(
    /<\/m:oMath>$/,
    `<m:r><m:t xml:space="preserve">\u2002\u2002${no.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</m:t></m:r></m:oMath>`,
  );
}

/** display equation → block-level m:oMathPara with alignment + numbering */
function displayIsland(latex: string, align: string, numbered: string): string {
  const omml = latexToOmml(latex, true);
  if (!omml) return fallbackIsland(latex, true);
  const jc = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
  const no = numbered === 'auto' ? '(n)' : numbered !== 'none' && numbered ? numbered : '';
  const inner = no ? withNumber(omml, no) : omml;
  return `<m:oMathPara xmlns:m="${OMML_NS}"><m:oMathParaPr><m:jc m:val="${jc}"/></m:oMathParaPr>${inner}</m:oMathPara>`;
}

/** inline equation → inline m:oMath in the text flow */
function inlineIsland(latex: string): string {
  return latexToOmml(latex, false) ?? fallbackIsland(latex, false);
}

/* ── tables for Word ──────────────────────────────────────────────────────
   Word's HTML engine ignores modern selectors (:nth-child), CSS custom
   properties and even style="width" on <col> — so every table-design
   feature is BAKED inline here, exactly like Word itself saves tables:
   col widths → width attribute, row heights → height attribute, striped
   rows / cellpad / borderless → per-cell inline styles, table align/width
   → native align/width attributes. */
const WORD_CELLPAD: Record<string, string> = { compact: '4px 6px', roomy: '14px 18px' };

function enhanceWordTables(html: string): string {
  if (!/<table/i.test(html)) return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const el of Array.from(doc.body.querySelectorAll('table'))) {
      const table = el as HTMLTableElement;

      /* dragged column widths (colgroup style) → width attribute */
      table.querySelectorAll('colgroup > col').forEach((c) => {
        const m = /(-?[\d.]+)px/.exec((c as HTMLElement).style.width || '');
        if (m) c.setAttribute('width', m[1]);
      });

      const borderless = table.getAttribute('data-borderless') === 'true';
      const striped = table.getAttribute('data-striped') === 'true';
      const cellpad = table.getAttribute('data-cellpad');
      const align = table.getAttribute('data-align');
      /* BUG «عرض جدول» parity: the editor's whole-table width now lives in
         the table node's width attr AND its style (style="width:85%" — the
         resize grip writes both since the renderHTML style fix). The old
         data-width attribute is kept for backward compatibility with
         previously saved notes. */
      const width = table.getAttribute('data-width')
        ?? /(?:^|;)\s*width\s*:\s*([^;]+)/.exec(table.getAttribute('style') || '')?.[1]?.trim()
        ?? null;
      const tstyle = table.getAttribute('data-tstyle');
      /* رنگ گرید — MUST resolve even when data-grid is absent (default
         purple) or the server's #ebebeb fallback wins and the PDF/Word
         grid never matches the editor. none = بدون خط */
      const grid = table.getAttribute('data-grid')
        ?? (/(?:^|;)\s*--pn-grid\s*:\s*([^;]+)/.exec(table.getAttribute('style') || '')?.[1]?.trim())
        ?? '#b9a7e0';
      if (align) table.setAttribute('align', align);
      if (width) table.setAttribute('width', width);

      const rowsAll = Array.from(table.rows);
      rowsAll.forEach((tr, r) => {
        /* dragged row heights (style) → height attribute */
        const h = tr.style.height;
        if (h) tr.setAttribute('height', String(Math.round(parseFloat(h))));
        const cells = Array.from(tr.children) as HTMLElement[];
        /* گرید سفارشی — رنگ inline روی هر سلول (Word از CSS vars ارث نمی‌برد) */
        if (grid) {
          cells.forEach((td) => {
            if (grid === 'none') { if (!td.style.border) td.style.border = 'none'; }
            else if (!td.style.borderColor) td.style.borderColor = grid;
          });
        }
        /* striping: same parity as the editor's tr:nth-of-type(even) rule
           (row #1 = header, so body rows 2/4/… get tinted everywhere) —
           Word cells carry NO per-cell background unless the user painted
           one (matches the editor's table-level surface + transparent
           cells), so the striping is visible exactly like on the page */
        if (striped && (r + 1) % 2 === 0) {
          cells.forEach((td) => { if (!td.style.backgroundColor) td.style.backgroundColor = '#f4f4f5'; });
        }
        if (borderless || (cellpad && WORD_CELLPAD[cellpad])) {
          cells.forEach((td) => {
            if (borderless) td.style.border = 'none';
            if (cellpad && WORD_CELLPAD[cellpad]) td.style.padding = WORD_CELLPAD[cellpad];
          });
        }
        /* style templates (قالب‌های آماده) — the CSS-token look baked per cell,
           mirroring the index.css/printCss [data-tstyle] rules */
        if (tstyle) {
          const isHeaderRow = r === 0 && !!tr.querySelector('th');
          const isLastRow = r === rowsAll.length - 1;
          cells.forEach((td) => {
            switch (tstyle) {
              case 'navy':
                if (isHeaderRow) { td.style.backgroundColor = td.style.backgroundColor || '#1e3a5f'; td.style.color = '#ffffff'; }
                break;
              case 'soft':
                td.style.borderColor = td.style.borderColor || '#d8dee6';
                if (isHeaderRow) td.style.backgroundColor = td.style.backgroundColor || '#f0f4f8';
                break;
              case 'minimal':
                td.style.border = 'none';
                td.style.borderBottom = isHeaderRow ? '2px solid #9aa4af' : '1px solid #e2e5ea';
                break;
              case 'academic':
                td.style.border = 'none';
                if (r === 0) td.style.borderTop = '2px solid #171717';
                if (isHeaderRow) td.style.borderBottom = '2px solid #171717';
                if (isLastRow) td.style.borderBottom = '2px solid #171717';
                break;
              case 'bold':
                td.style.border = '2px solid #565656';
                break;
              case 'plain':
                td.style.border = 'none';
                break;
              default:
                break;
            }
          });
        }
      });
    }
    return doc.body.innerHTML;
  } catch {
    return html; /* DOM pass is best-effort — never block the export */
  }
}

/**
 * Prepare note HTML for the Word export. Input is the RAW editor HTML
 * (getHTML output — LaTeX sources still un-rendered, exactly what the PDF
 * path receives before renderMathInHtml).
 */
/** ruled TOC sheet for Word — mirrors the PDF tocLayer (item 15) */
const WORD_TOC_ISLAND =
  `<div style="position:relative;width:794px;height:1123px;overflow:hidden">`
  + `<div style="width:340px;margin:90px auto 30px;text-align:center;font-weight:800;font-size:16pt;color:#1e3a5f;border-bottom:2.5pt solid #c5a24d;padding:0 16px 6px">فهرست مطالب</div>`
  + `<div style="padding:0 56px">`
  + Array.from({ length: 22 }, () =>
      `<div style="display:flex;align-items:baseline;gap:8px;height:34px">`
      + `<span style="width:46%;border-bottom:1pt solid #d1d5db;height:20px"></span>`
      + `<span style="flex:1;border-bottom:1pt dotted #9ca3af;height:20px"></span>`
      + `<span style="width:34px;border-bottom:1pt solid #d1d5db;height:20px"></span>`
      + `</div>`).join('')
  + `</div></div><div style="page-break-before:always"></div>`;

export function prepareWordHtml(html: string): string {
  /* tables first (DOM pass — bakes design features Word cannot read from
     CSS); its serialization preserves the attribute order the equation
     regexes below rely on */
  html = enhanceWordTables(html);

  /* item 15 — cover/toc pages: the raw editor HTML has no artwork layer
     (the cover is a React overlay), so the page-break div's data-* attrs
     are the ONLY trace of a cover sheet in the export payload. Rebuild
     the cover artwork + title band (and the toc's ruled sheet) as plain
     HTML islands Word renders — matching the PDF layer's geometry. Each
     cover island is placed BEFORE the content that follows its page-break
     div, so Word paginates it onto the correct sheet. */
  html = html.replace(
    /<div[^>]*data-type="page-break"[^>]*>/gi,
    (tag) => {
      const kindM = /data-kind="([^"]*)"/.exec(tag);
      const kind = kindM ? kindM[1] : '';
      const coverM = /data-cover="([^"]*)"/.exec(tag);
      let cover: { coverSrc?: string; coverFit?: string; coverTitle?: string; coverSubtitle?: string } = {};
      if (coverM) {
        try { cover = JSON.parse(coverM[1].replace(/&quot;/g, '"')); } catch { cover = {}; }
      }
      if (kind !== 'cover' && kind !== 'toc') return tag;
      if (kind === 'toc') {
        return tag + WORD_TOC_ISLAND;
      }
      const img = cover.coverSrc
        ? `<img src="${cover.coverSrc}" style="position:absolute;top:0;left:0;width:794px;height:1123px;object-fit:${cover.coverFit === 'contain' ? 'contain' : 'cover'}"/>`
        : `<div style="position:absolute;top:0;left:0;width:794px;height:1123px;background:linear-gradient(to bottom,#fafafa,#ffffff)"/>`;
      const band = (cover.coverTitle || cover.coverSubtitle)
        ? `<div style="position:absolute;top:1010px;left:0;width:794px;text-align:center">`
          + (cover.coverTitle ? `<span style="background:#00000099;color:#fff;font-weight:800;font-size:24pt;padding:6pt 14pt;border-radius:8pt">${cover.coverTitle}</span>` : '')
          + (cover.coverSubtitle ? ` <span style="background:#00000073;color:#e5e5e5;font-size:11pt;padding:4pt 10pt;border-radius:6pt">${cover.coverSubtitle}</span>` : '')
          + `</div>`
        : '';
      return tag + `<div style="position:relative;width:794px;height:1123px;overflow:hidden">${img}${band}</div><div style="mso-element:pagebreak-before;page-break-before:always"></div>`;
    },
  );

  /* display equations: <div data-type="equation" …>SOURCE</div> */
  html = html.replace(
    /<div ([^>]*data-type="equation"[^>]*)>([\s\S]*?)<\/div>/g,
    (_m, attrs: string, src: string) => {
      const align = /data-align="(\w+)"/.exec(attrs)?.[1] ?? 'center';
      const numbered = /data-numbered="(\w+)"/.exec(attrs)?.[1] ?? 'none';
      return displayIsland(decode(src).trim(), align, numbered);
    },
  );

  /* inline equations: <span data-type="equationInline" …>SOURCE</span> */
  html = html.replace(
    /<span ([^>]*data-type="equationInline"[^>]*)>([\s\S]*?)<\/span>/g,
    (_m, _attrs: string, src: string) => inlineIsland(decode(src).trim()),
  );

  /* formula blocks: <div class="edu-katex-src" …>SOURCE</div> inside the
     bordered .edu-formula box — the box stays, the source becomes math */
  html = html.replace(
    /<div class="edu-katex-src"[^>]*>([\s\S]*?)<\/div>/g,
    (_m, src: string) => displayIsland(decode(src).trim(), 'center', 'none'),
  );

  /* task lists: the checkbox input becomes a visible ballot box */
  html = html.replace(/<input[^>]*type="checkbox"[^>]*>/gi, (tag) =>
    /\bchecked\b/i.test(tag) ? '\u2611' : '\u2610',
  );

  return html;
}

/**
 * Word-ready edu-block CSS: unscoped (plain .edu-* selectors — Word HTML
 * has no .pn-sheet-content ancestor). Mirrors printCss's eduCssForPrint:
 * shipped tint fills first, then the user's customization rules.
 */
export function buildWordEduCss(eduBlocks?: EduBlocksSettings | 'minimal' | 'tinted', eduTinted?: boolean): string {
  const edu = resolveEduBlocks(eduBlocks);
  if (edu) {
    const baseTint = isTinted(edu) ? TINTED_CSS.replace(/\.pn-sheet-content /g, '') : '';
    return `${baseTint}\n${eduBlocksCss(edu, { prefix: '' })}`.trim();
  }
  return eduTinted ? TINTED_CSS.replace(/\.pn-sheet-content /g, '') : '';
}

/* ── per-page ornamental frame for Word ────────────────────────────────
   Word repeats its PAGE HEADER on every page, so the frame is drawn there
   (VML group positioned relative to the page, behind the text) and the
   page number comes from a real PAGE field anchored INSIDE the frame's
   bottom dome — the same spot the editor sheet and the PDF show it. The
   anchor rides the HEADER element (mso-element:header): a Word footer box
   cannot reach the dome at ≈97% page height (it ends above the 1.2cm
   margin), while the header can position against the whole page. The
   number is therefore always correct even though Word paginates the
   continuous document itself. The server embeds these strings into the
   mso header/footer elements when provided. */

/** the page number's resting place: the bottom-center dome of the frame
 *  (1cm margins + 0.986 × content height — the same geometry the SVG/VML
 *  frame is built with, see PageBorder.tsx bottomY) */
const PAGE_NUMBER_TOP_MM = 10 + 0.986 * 277;

/** VML shape anchor CSS shared by every mso-position variant below */
const PAGE_ANCHOR = 'mso-position-vertical-relative:page;mso-position-horizontal-relative:page;';

export function buildWordHeaderFooter(
  border: Partial<BorderSettings> | undefined,
  meta: { subject?: string; chapter?: string; title?: string },
): { headerHtml?: string; footerHtml?: string } {
  const merged: BorderSettings = { ...DEFAULT_BORDER_SETTINGS, ...(border ?? {}) };
  const vml = pageBorderVmlString(merged, meta.subject, meta.chapter, meta.title);
  if (!vml) return {};

  const headerHtml = `<p class=MsoHeader style="margin:0;line-height:0">${vml}</p>`;

  /* the real page number: a PAGE field absolutely positioned inside the
     frame's dome. Word replaces the cached "۱" on repagination; the
     mso-wrap-* resets keep the anchor from shrinking the header box. */
  const footerHtml = merged.showPageNumbers
    ? `<span style="position:absolute;top:${PAGE_NUMBER_TOP_MM.toFixed(1)}mm;${PAGE_ANCHOR}` +
      `mso-wrap-style:square;font-size:10pt;font-weight:800;color:#1e3a5f;">` +
      `<span style="mso-field-code:&quot; PAGE &quot;"><span style="mso-no-proof:yes">۱</span></span>` +
      `</span>`
    : '';

  return { headerHtml, footerHtml: footerHtml || undefined };
}
