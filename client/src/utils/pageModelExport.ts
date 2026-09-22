/**
 * Page-model-based print/PDF export — FAITHFUL SHEET REPLICA.
 *
 * EDITOR AND PDF SHARE THE SAME PAGE MODEL *AND* THE SAME GEOMETRY:
 *   Document → Page 1, Page 2, Page 3 …  (each = one A4 portrait PDF page)
 *
 * Every exported sheet is a 1:1 replica of its on-screen page: the 794×1123px
 * editor sheet is rendered exactly into the 210×297mm @page box (px values
 * map 1:1 through the uniform ≈0.99626 factor — see mmpx/K below), with no
 * print margins, headers, footers or cover layered on top. The PDF contains
 * exactly what the user applied on the editable pages: the decorative border
 * (with its page numbers), the notebook ruled lines, the content with the
 * document font settings, and the floating layers.
 */

import { pageBorderSvgString } from '@/components/border/PageBorder';
import { buildPrintDocument, type PaginateMeta, type PaginateResult } from './print';
import type { FloatingElement } from '@/components/editor/FloatingLayer';
import type { BorderSettings, PageKind } from '@/types';

const A4_W_MM = 210;
const A4_H_MM = 297;

/* Editor page model: one on-screen sheet is 794×1123 CSS px. The physical
 * A4 page box at 96dpi is 793.70×1122.52px — 1123px is ~0.5px TALLER than
 * 297mm, which used to spill every sheet onto a second blank PDF page.
 * The export now renders each sheet exactly into the 210×297mm @page box:
 * px values are emitted in `mmpx` units (1px editor = 210/794mm), a uniform
 * ≈0.99626 scale that keeps the sheet's CONTENT layout pixel-identical to
 * the editor while the sheet fits its PDF page exactly. */
const A4_W_PX = 794;
const A4_H_PX = 1123;

/** px → print unit: 1 editor px = A4_W_MM / A4_W_PX mm, exact by definition.
    MUST emit the real `mm` unit — any invented unit makes the browser DROP
    the whole declaration (padding/float geometry silently vanish and the
    content renders full-bleed over the decorative frame). */
function mmpx(px: number): string {
  return `${round2((px * A4_W_MM) / A4_W_PX)}mm`;
}

/** red notebook margin line sits 28px from the right edge (RTL) — index.css */
const NB_MARGIN_PX = 28;

/** uniform px→print scale, shared by every emitted length (see mmpx) */
const K = A4_W_MM / A4_W_PX;

/** per-kind sheet padding — mirrors .page-paper/.page-blank/.page-notebook,
 *  emitted in mmpx so the paddings scale with the sheet exactly */
const PAD_OF: Record<PageKind, string> = {
  framed: `${mmpx(30)} ${mmpx(32)}`,
  blank: mmpx(38),
  notebook: mmpx(38),
};

/** One application page snapshot handed to the exporter by the editor. */
export interface ExportPage {
  id: string;
  /** rendered HTML of THIS page only (formulas already rendered) */
  html: string;
  /** floating layers that belong to THIS page (local px coordinates) */
  floatingElements?: FloatingElement[];
  /** visual kind: blank → no frame, notebook → ruled sheet (default: framed) */
  kind?: PageKind;
}

export type ExportMeta = PaginateMeta;

/** Everything the export needs — all of it already lives on the document. */
export interface ExportOptions {
  /** decorative border settings (framed pages only; includes page numbers) */
  border?: BorderSettings;
  /** document font size in px — the editor's --editor-font-size */
  fontSize: number;
  /** document line-height — the editor's --editor-line-height */
  lineHeight: number;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── floating-object fidelity helpers (mirror floatStyle.ts 1:1) ────────
   The editor renders every object (shape/text box) through floatStyle.ts;
   the PDF export must produce the SAME visuals from the same data —
   including the text written INSIDE shapes, which is the object family's
   core feature (§1: text lives inside the shape). */

/** object border CSS (width + style + color) — floatBorder() mirror */
function floatBorderCss(el: FloatingElement): string {
  if (!el.borderWidth || el.borderWidth <= 0) return 'none';
  return `${mmpx(el.borderWidth)} ${el.borderColorStyle || 'solid'} ${el.borderColor || '#171717'}`;
}

/** shadow toggle — floatElementStyle mirror */
function floatShadowCss(el: FloatingElement): string {
  return el.shadow ? 'box-shadow:0 6px 16px rgba(0,0,0,0.18);' : '';
}

/** transform: rotation (+ flip) + the diamond 45° squish — floatTransform mirror */
function floatTransformCss(el: FloatingElement): string {
  const rot = `rotate(${el.rotation || 0}deg)`;
  const flip =
    el.flip === 'h' ? ' scaleX(-1)' :
    el.flip === 'v' ? ' scaleY(-1)' :
    el.flip === 'hv' ? ' scale(-1,-1)' : '';
  const diamond = el.type === 'diamond' ? ' rotate(45deg) scale(0.707)' : '';
  return `${rot}${flip}${diamond}`;
}

/** typography shared by every text-carrying object — the text layer of
 *  floatStyle.ts/FloatingLayer (font, aligns, spacing, pre-wrap) */
function floatTextCss(el: FloatingElement): string {
  const align = el.hAlign ?? 'right';
  const dir = el.direction ?? 'rtl';
  return [
    `font-family:'${el.fontFamily || 'Sahel'}',Tahoma,sans-serif;`,
    `font-size:${el.fontSize || 14}px;`,
    `font-weight:${el.fontWeight ?? 400};`,
    el.italic ? 'font-style:italic;' : '',
    el.underline ? 'text-decoration:underline;' : '',
    `color:${el.fontColor || '#171717'};`,
    `line-height:${el.lineHeight ?? 1.7};`,
    `letter-spacing:${el.letterSpacing ?? 0}px;`,
    `text-align:${align};`,
    `direction:${dir};`,
  ].join('');
}

/** vertical text alignment — real vertical via align-items on a flex layer */
function floatVAlignCss(el: FloatingElement): string {
  switch (el.vAlign ?? 'top') {
    case 'center': return 'display:flex;align-items:center;';
    case 'bottom': return 'display:flex;align-items:flex-end;';
    default: return '';
  }
}

/** shape stroke incl. dash pattern — shapeStroke() mirror */
function shapeStrokeAttrs(el: FloatingElement): string {
  if (!el.borderWidth || el.borderWidth <= 0) return '';
  const style = el.borderColorStyle || 'solid';
  const dash = style === 'dashed' ? ' stroke-dasharray="6 4"' : style === 'dotted' ? ' stroke-dasharray="1.5 3"' : '';
  return ` stroke="${el.borderColor || '#171717'}" stroke-width="${el.borderWidth}"${dash}`;
}

/**
 * Inline SVG painting of ONE shape — the string twin of shapeGeometry().paint
 * in floatStyle.ts (same geometry, same fill rule: a transparent SHAPE shows
 * the sheet surface, never the notebook ruling).
 */
function shapeSvgString(el: FloatingElement, gw: number, gh: number): string {
  const fill = el.bgColor && el.bgColor !== 'transparent' ? el.bgColor : '#ffffff';
  const common = `fill="${fill}"${shapeStrokeAttrs(el)}`;
  let inner = '';
  switch (el.type) {
    case 'roundedRect':
      inner = `<rect x="1" y="1" width="${Math.max(1, gw - 2)}" height="${Math.max(1, gh - 2)}" rx="${el.borderRadius || 12}" ry="${el.borderRadius || 12}"${common}/>`;
      break;
    case 'circle':
    case 'ellipse':
      inner = `<ellipse cx="${gw / 2}" cy="${gh / 2}" rx="${Math.max(1, gw / 2 - 1)}" ry="${Math.max(1, gh / 2 - 1)}"${common}/>`;
      break;
    case 'diamond':
      inner = `<polygon points="${gw / 2},1 ${gw - 1},${gh / 2} ${gw / 2},${gh - 1} 1,${gh / 2}"${common}/>`;
      break;
    case 'arrow': {
      const head = Math.max(18, Math.min(gh, gw * 0.35));
      const shaftH = Math.max(8, gh * 0.4);
      const y0 = (gh - shaftH) / 2;
      inner = `<polygon points="1,${y0} ${gw - head},${y0} ${gw - head},1 ${gw - 1},${gh / 2} ${gw - head},${gh - 1} ${gw - head},${y0 + shaftH} 1,${y0 + shaftH}"${common}/>`;
      break;
    }
    case 'callout': {
      const r = el.borderRadius || 10;
      const tail = Math.max(12, gh * 0.18);
      inner =
        `<rect x="1" y="1" width="${Math.max(1, gw - 2)}" height="${Math.max(1, gh - tail)}" rx="${r}" ry="${r}"${common}/>` +
        `<polygon points="${gw * 0.22},${gh - tail} ${gw * 0.3},${gh - 1} ${gw * 0.38},${gh - tail}" fill="${fill}" stroke="none"/>`;
      break;
    }
    default:
      inner = `<rect x="1" y="1" width="${Math.max(1, gw - 2)}" height="${Math.max(1, gh - 2)}"${common}/>`;
  }
  return `<svg width="100%" height="100%" viewBox="0 0 ${Math.max(1, gw)} ${Math.max(1, gh)}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
}

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/**
 * Serialize the floating layers of ONE sheet into absolutely-positioned HTML.
 *
 * Coordinates are stored CONTENT-BOX local in the editor (the float layer
 * lives inside the sheet's padded writing area), but the exported float
 * container is positioned in the SHEET's full 794×1123 space — so every
 * coordinate is offset by the sheet padding (PAD_OF) here. Legacy documents
 * may store global Y coordinates spanning multiple sheets
 * (y ≥ 1.25 × 1123); those are mapped onto the sheet they belong to first.
 *
 * Fidelity contract (floatStyle.ts is the single source of truth):
 *  - every object EXCEPT images can carry text — the text the user typed
 *    inside a shape is rendered exactly where the editor shows it
 *  - shapes are painted with the same inline SVG geometry as the editor
 *    (rect / rounded / ellipse / diamond / arrow / callout + dash patterns)
 *  - opacity, drop shadow, flip, object-fit/filter (images) all carry over
 */
function floatingElementsHtml(elements: FloatingElement[] | undefined, pageIndex: number, totalPages: number, kind: PageKind = 'framed'): string {
  if (!elements || elements.length === 0) return '';
  const handleGutter = 22;
  const parts: string[] = [];

  /* sheet padding — floats must land exactly where the editor showed them.
     PAD_OF values are already in mmpx units; strip the unit back to editor
     px so the clamping math below stays in the editor's coordinate space. */
  const padParts = PAD_OF[kind].split(/\s+/);
  const toPx = (v: string) => parseFloat(v) / K;
  const padY = toPx(padParts[0]) || 0;
  const padX = padParts.length > 1 ? toPx(padParts[1]) || 0 : padY;
  const boxW = A4_W_PX - padX * 2;
  const boxH = A4_H_PX - padY * 2;

  for (const el of elements) {
    const global = el.y >= A4_H_PX * 1.25;
    const page = global
      ? Math.max(0, Math.min(totalPages - 1, Math.floor(el.y / A4_H_PX)))
      : pageIndex;
    if (page !== pageIndex) continue;

    const rawY = global ? el.y - page * A4_H_PX : el.y;
    /* editor stores WRAPPER-LOCAL coords (0 = writable-area edge); the
       exported float container sits in the sheet's full space, so add the
       sheet padding and clamp inside the writable box */
    const localY = Math.min(boxH - el.height, Math.max(0, rawY)) + padY;
    const safeX = Math.min(boxW - el.width, Math.max(0, el.x)) + padX;
    const isImage = el.type === 'image';
    const isLegacyTextual = el.type === 'textBox' || el.type === 'sticky';
    const isShape = !isImage && !isLegacyTextual;
    const hasText = !isImage && !!el.text;

    /* object box — shapes paint themselves with SVG (no CSS border/bg);
       legacy textual boxes keep true transparency ON PURPOSE */
    const base =
      `position:absolute;left:${mmpx(safeX)};top:${mmpx(localY)};z-index:3;pointer-events:none;box-sizing:border-box;` +
      `opacity:${el.opacity ?? 1};` +
      `transform:${floatTransformCss(el)};` +
      floatShadowCss(el);

    if (isImage) {
      const fit = el.objectFit ?? 'fill';
      parts.push(
        `<div style="${base}width:${mmpx(el.width)};height:${mmpx(el.height)};">` +
          `<img src="${el.src || ''}" alt="" style="width:100%;height:100%;object-fit:${fit};display:block;border-radius:${mmpx(el.borderRadius || 0)};${el.filter ? `filter:${el.filter};` : ''}" />` +
        `</div>`
      );
      continue;
    }

    if (isLegacyTextual) {
      /* legacy text box / sticky — flex column like the editor: the drag
         bar occupies the top gutter, the text fills the rest; padding and
         typography live on the wrapper (floatElementStyle) */
      const pad = el.padding ?? (el.type === 'sticky' ? 10 : 8);
      const vAlign =
        (el.vAlign ?? 'top') === 'center' ? 'justify-content:center;' :
        (el.vAlign ?? 'top') === 'bottom' ? 'justify-content:flex-end;' : '';
      parts.push(
        `<div style="${base}width:${mmpx(el.width)};min-height:${mmpx(el.height)};background:${el.bgColor && el.bgColor !== 'transparent' ? el.bgColor : 'transparent'};border:${floatBorderCss(el)};border-radius:${mmpx(el.borderRadius || 0)};display:flex;flex-direction:column;${vAlign}${floatTextCss(el)}padding:${mmpx(pad)};">` +
          `<div style="height:${mmpx(handleGutter)};flex-shrink:0;"></div>` +
          `<div style="flex:1;min-height:1.2em;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;">${escape(el.text || '')}</div>` +
        `</div>`
      );
      continue;
    }

    /* shapes — one SVG paint + the text layer INSIDE the shape (§1);
       the text is the core feature and must never be dropped in export */
    const shapePad = el.padding ?? (el.type === 'callout' ? 12 : 10);
    parts.push(
      `<div style="${base}width:${mmpx(el.width)};height:${mmpx(el.height)};">` +
        shapeSvgString(el, el.width, el.height) +
        (hasText
          ? `<div style="position:absolute;inset:${mmpx(shapePad)};pointer-events:none;${floatVAlignCss(el)}${floatTextCss(el)}white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;">${escape(el.text)}</div>`
          : '') +
      `</div>`
    );
  }

  return parts.join('\n');
}

/**
 * Notebook ruled lines as an INLINE SVG in the sheet's own 794×1123 px space
 * (same rhythm as the editor: font-size × line-height, red margin line 28px
 * from the right edge). Inline SVG — not a CSS background — so it survives
 * printing regardless of the browser's "background graphics" setting.
 */
function notebookLinesSvg(fontPx: number, lineHeight: number): string {
  const rhythm = Math.max(8, fontPx * lineHeight);
  const rows: string[] = [];
  for (let y = rhythm; y <= A4_H_PX; y += rhythm) {
    rows.push(`<line x1="0" y1="${round2(y)}" x2="${A4_W_PX}" y2="${round2(y)}" stroke="rgba(37,99,235,.18)" stroke-width="1"/>`);
  }
  const redX = A4_W_PX - NB_MARGIN_PX;
  return `<svg viewBox="0 0 ${A4_W_PX} ${A4_H_PX}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${rows.join('')}<line x1="${redX}" y1="0" x2="${redX}" y2="${A4_H_PX}" stroke="rgba(225,29,72,.2)" stroke-width="1"/></svg>`;
}

/**
 * Build one .pn-page section per application page — a pixel-faithful replica
 * of the editor sheet. Page i of the model → PDF page i+1.
 */
export function buildPagesHtml(
  pages: ExportPage[],
  meta: ExportMeta,
  options: ExportOptions
): PaginateResult {
  const list = pages.length ? pages : [{ id: 'page-1', html: '' }];
  const total = list.length;

  const pagesHtml = list
    .map((page, i) => {
      const kind: PageKind = page.kind ?? 'framed';
      /* the decorative border (with its page numbers) only exists on framed
         sheets — blank/notebook pages have none, exactly like the editor */
      const borderSvg = kind !== 'framed'
        ? ''
        : options.border
          ? pageBorderSvgString(options.border, meta.subject, meta.chapter, i + 1, total, meta.title)
          : '';
      const notebookSvg = kind === 'notebook' ? notebookLinesSvg(options.fontSize, options.lineHeight) : '';
      const floats = floatingElementsHtml(page.floatingElements, i, total, kind);
      return `<section class="pn-page" data-page="${i + 1}">
  <div class="pn-sheet">
  ${borderSvg}
  ${notebookSvg}
  <div class="pn-sheet-content" style="padding:${PAD_OF[kind]};font-size:${options.fontSize}px;line-height:${options.lineHeight}">${page.html}</div>
  ${floats}
  </div>
</section>`;
    })
    .join('\n');

  return { pagesHtml, pageCount: total };
}

/**
 * §42 — PDF PAGE COUNT VALIDATION.
 *
 * After the print window renders, assert: expectedPageCount ===
 * actualPdfPageCount. The exporter performs NO second pagination, so any
 * mismatch means the BROWSER split a sheet (content taller than the fixed
 * 210×297mm box, a stray CSS break, a nested page container) — or double
 * pagination crept back in. Log loudly in dev so the cause is diagnosable
 * instead of silently shipping blank/missing pages. Blank pages are never
 * "fixed" by deleting them here — the pipeline itself is what must be right.
 */
export function assertPageCount(
  win: Window | null,
  expectedPageCount: number,
): void {
  try {
    const rendered = win?.document.querySelectorAll('section.pn-page').length ?? 0;
    if (!rendered) return; // window never opened — nothing to validate
    if (rendered === expectedPageCount) return;
    console.error(
      `[PDF] page-count validation FAILED: layout result has ${expectedPageCount} page(s) ` +
      `but ${rendered} sheet(s) were rendered. ` +
      `Causes to check: double pagination, extra page container, CSS page-break interaction, ` +
      `sheet content taller than the fixed A4 box (overflow spill), hidden placeholders.`,
    );
    if (import.meta.env.DEV) {
      (win as unknown as { __pdfPageMismatch?: boolean }).__pdfPageMismatch = true;
    }
  } catch {
    /* cross-origin or closed window — validation unavailable, not a failure */
  }
}

export { buildPrintDocument };
