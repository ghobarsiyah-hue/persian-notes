/* ═══════════════════════════════════════════════════════════════════════
   copyPage — «کپی صفحه با استایل و آیتم‌ها» (user request: «وقتی از صفحه
   کپی میکنی استایل و ایتمای دیگه صفحه رو هم کپی کنه»).

   Plain Ctrl+C copies only the SELECTED TEXT — the sheet's قاب, notebook
   ruling, edu-box styling, floating objects and page numbers were lost.
   This module re-uses the PRINT/PIPELINE (the SAME builders that render
   the faithful PDF replica — buildPagesHtml + buildPrintDocument) so the
   clipboard receives the page EXACTLY as the editor shows it:

     text/html  — a full standalone HTML doc (inline CSS, KaTeX CDN link,
                  Persian font pack) → pastes styled into Word/Telegram/
                  Gmail/another note tab
     text/plain — the page's plain text (fallback for text-only targets)

   The float/cover/toc/border rendering is literally the print pipeline's
   — zero second implementation to drift (§ ONE model, many targets).
   ═════════════════════════════════════════════════════════════════════ */

import { buildPagesHtml, type ExportPage, type ExportMeta, type ExportOptions } from './pageModelExport';
import { buildPrintDocument } from './print';
import { printCss, type ExportOptionsCss } from './printCss';

export interface CopyPageSettings {
  border?: ExportOptions['border'];
  fontSize: number;
  lineHeight: number;
  eduTinted?: boolean;
  eduBlocks?: ExportOptionsCss['eduBlocks'];
}

export interface CopyPageInput {
  /** the page snapshots (ExportPage shape — same objects print uses) */
  pages: ExportPage[];
  meta: ExportMeta;
  settings: CopyPageSettings;
  /** 1-based page numbers to copy; default = ALL pages */
  pageNumbers?: number[];
}

/** build the standalone styled HTML for the chosen pages (print replica) */
export function buildStyledPageHtml(input: CopyPageInput): { html: string; count: number } {
  const wanted = input.pageNumbers && input.pageNumbers.length
    ? input.pageNumbers.map((n) => n - 1)
    : input.pages.map((_, i) => i);
  const pages = wanted.map((i) => input.pages[i]).filter(Boolean);
  if (pages.length === 0) return { html: '', count: 0 };

  /* keep the page's REAL index so the قاب page number and the float layer
     mapping stay faithful — but rebuild `total` as the WHOLE document's
     count (a copied middle page must still print its true «صفحهٔ n از m») */
  const opts: ExportOptions & ExportOptionsCss = {
    border: input.settings.border,
    fontSize: input.settings.fontSize,
    lineHeight: input.settings.lineHeight,
    eduTinted: input.settings.eduTinted,
    eduBlocks: input.settings.eduBlocks,
  };
  const all = input.pages;
  const total = all.length;
  /* buildPagesHtml renders pages[0..n-1] as pages 1..n — to keep the TRUE
     page numbers we temporarily re-index: feed the FULL array and slice
     the resulting sections back out (cheaper than re-plumbing the builder) */
  const { pagesHtml } = buildPagesHtml(all, input.meta, opts);
  const sections = pagesHtml.split(/(?=<section class="pn-page")/).filter((s) => s.startsWith('<section class="pn-page"'));
  const picked = wanted.map((i) => sections[i] ?? '').filter(Boolean).join('\n');
  const css = printCss(opts);
  const html = buildPrintDocument(picked, input.meta, opts as never, css);
  return { html, count: picked ? wanted.length : 0 };
}

/** the pasted-into-a-note experience: Word/Gmail keep only the BODY when
 *  the fragment is a full document — extract <body> for text/html flavor */
function bodyFragment(docHtml: string): string {
  const m = /<body>([\s\S]*?)<\/body>/.exec(docHtml);
  return m ? m[1] : docHtml;
}

/** plain-text twin of the copied pages (fallback flavor) */
function plainTextOf(pageHtml: string): string {
  const el = document.createElement('div');
  el.innerHTML = pageHtml;
  return (el.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Copy the given pages to the clipboard as styled HTML + plain text.
 * Returns the flavor actually written ('html' | 'plain' | 'none').
 *
 * Uses the async ClipboardItem path when available (Chromium: both flavors
 * in ONE write — no permission prompt difference), falling back to
 * execCommand('copy') with a hidden selection (Firefox/Safari), then to
 * plain-text navigator.clipboard.writeText.
 */
export async function copyPagesToClipboard(input: CopyPageInput): Promise<'html' | 'plain' | 'none'> {
  const { html, count } = buildStyledPageHtml(input);
  if (!html || !count) return 'none';
  const body = bodyFragment(html);
  const plain = input.pages
    .map((p) => plainTextOf(p.html))
    .filter(Boolean)
    .join('\n\n──────────\n\n');

  /* 1 — modern async clipboard: text/html + text/plain in one write */
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain || body], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      return 'html';
    }
  } catch { /* fall through to the legacy path */ }

  /* 2 — legacy: put the styled fragment in the DOM, select, execCommand */
  try {
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;';
    /* the FRAGMENT (body contents) — a full <html> document inside a div
       would be mangled; the fragment keeps the section markup + classes,
       and the doc's <style> blocks ride along so the paste target styles it */
    const styleBlocks = Array.from(html.matchAll(/<style>([\s\S]*?)<\/style>/g)).map((m) => m[1]).join('\n');
    host.innerHTML = `<style>${styleBlocks}</style>${body}`;
    document.body.appendChild(host);
    const range = document.createRange();
    range.selectNodeContents(host);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = document.execCommand('copy');
    sel?.removeAllRanges();
    host.remove();
    if (ok) return 'html';
  } catch { /* fall through */ }

  /* 3 — last resort: plain text only */
  try {
    await navigator.clipboard.writeText(plain || body);
    return 'plain';
  } catch {
    return 'none';
  }
}
