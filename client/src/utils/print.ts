/**
 * Shared building blocks for print/PDF export.
 *
 * Pagination lives in `pageModelExport.ts`: the real pages array is
 * the source of truth and application Page N becomes exactly one A4 PDF
 * page N. This module only provides the shared types and the standalone
 * print-document wrapper. The export is a faithful replica of the editable
 * sheets — no print-only options exist that could diverge from the editor.
 * The print window loads the SAME font pack as the editor app
 * (/fonts.css — B Titr, Shabnam, Sahel, Dast Nevis + فونت‌های آیتم ۱۴:
 * Samim, Tanha, Gandom, Parastoo, Lalezar, Noto Naskh Arabic, Markazi
 * Text, Inter, Merriweather, Comic Sans) so text styled with any ribbon
 * font keeps its face in the PDF instead of silently falling back to Tahoma.
 */

import type { BorderSettings, EduBlocksSettings } from '@/types';
/* raw text of the editor's font pack — ?raw keeps it in sync with the app
   build and needs no runtime fetch (see /fonts.css for the full list) */
import fontsCssRaw from '../../public/fonts.css?raw';
const FONTS_CSS = fontsCssRaw;

export interface PageSettings {
  border?: BorderSettings;
  /** document font size in px — the editor's own setting */
  fontSize: number;
  /** document line-height — the editor's own setting */
  lineHeight: number;
  /** document font family — the editor's fontFamily setting (Word export) */
  fontFamily?: string;
  /** «رنگی» edu-box style — mirrors the editor's eduBlocks setting.
   *  legacy boolean/string forms are normalized by the callers. */
  eduTinted?: boolean;
  /** full edu-block customization (کادرهای آموزشی) — when present it wins
   *  over the legacy eduTinted flag and its CSS is appended to the doc */
  eduBlocks?: EduBlocksSettings;
}

export interface PaginateMeta {
  title: string;
  subject?: string;
  chapter?: string;
}

export interface PaginateResult {
  pagesHtml: string;
  pageCount: number;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** builds the complete standalone HTML document for the print window */
export function buildPrintDocument(
  pagesHtml: string,
  meta: PaginateMeta,
  _settings: PageSettings,
  css: string
): string {
  return `<!doctype html>
<html dir="rtl" lang="fa">
<head>
<meta charset="utf-8">
<title>${escape(meta.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://cdn.jsdelivr.net/gh/rastikerdar/sahel-font@v3.4.0/dist/font-face.css" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<style>/* Persian font pack — the editor's /fonts.css, inlined verbatim
   (all its URLs are absolute CDN links, safe in a blank print window) */
${FONTS_CSS}</style>
<style>
${css}
</style>
</head>
<body>
${pagesHtml}
</body>
</html>`;
}
