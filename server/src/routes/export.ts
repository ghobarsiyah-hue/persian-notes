import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler, ApiError } from '../middleware/error.js';

const router = Router();
router.use(requireAuth);

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* the document font name is interpolated into the CSS font-family list —
   keep legitimate font names (letters, digits, spaces, quotes, hyphens)
   and strip anything that could break out of the declaration */
function safeFontFamily(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const clean = s.replace(/[^\p{L}\p{N}\s'"-]/gu, '').trim();
  return clean || undefined;
}

/* the edu-block CSS is embedded in a <style> block — the client generator
   only emits color/geometry rules, but strip markup closers defensively so
   a hand-crafted payload can never escape the block */
function safeCss(s: string | undefined): string | undefined {
  if (!s || !s.trim()) return undefined;
  return s.replace(/<\/?style[^>]*>/gi, '').replace(/</g, '');
}

/* the header/footer fragments carry Word-specific markup (VML frame,
   PAGE field) that must be embedded verbatim — only hostile constructs
   (script blocks) are stripped; the payload is the user's own document */
function safeWordFragment(s: string | undefined): string | undefined {
  if (!s || !s.trim()) return undefined;
  return s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<script/gi, '');
}

/* ── OMML namespace — declared on the <html> element so every m:oMath /
   m:oMathPara island the client embeds resolves its m: prefix in Word ── */
const OMML_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

/* ── the editor's EXACT typography (index.css .ProseMirror), expressed in
   pt for Word's HTML engine. 1px @96dpi = 0.75pt. ── */
const TYPO_CSS = `
  .pn-doc-body { color: #171717; }
  .pn-doc-body p { margin: 0 0 0.5em; text-align: justify; text-justify: inter-word; }
  .pn-doc-body h1, .pn-doc-body h2, .pn-doc-body h3, .pn-doc-body h4 {
    color: #171717; font-weight: 700; margin: 1em 0 0.4em; letter-spacing: -0.04em;
  }
  .pn-doc-body h1 { font-size: 1.8em; letter-spacing: -0.05em; line-height: 1.15; }
  .pn-doc-body h2 { font-size: 1.35em; letter-spacing: -0.04em; line-height: 1.25; padding-bottom: 0.3em; border-bottom: 1px solid #ebebeb; }
  .pn-doc-body h3 { font-size: 1.15em; letter-spacing: -0.03em; }
  .pn-doc-body h4 { font-size: 1.02em; letter-spacing: -0.02em; color: #666; }
  .pn-doc-body ul, .pn-doc-body ol { padding-right: 1.6em; padding-left: 0; margin: 0 0 0.5em; }
  .pn-doc-body ul { list-style-type: disc; }
  .pn-doc-body ol { list-style-type: decimal; }
  .pn-doc-body li { margin-bottom: 0.2em; }
  .pn-doc-body ul li span.pn-li-marker { color: #0070f3; }
  .pn-doc-body ol li span.pn-li-marker { color: #114b64; font-weight: 600; }
  .pn-doc-body blockquote { border-right: 3px solid #0070f3; margin: 0.5em 0; padding: 0.4em 1em; color: #444; background: #f9fbff; border-radius: 0 6px 6px 0; }
  .pn-doc-body code { background: #f7f7f7; border-radius: 4px; padding: 0.1em 0.35em; font-size: 0.88em; font-family: 'Geist Mono', Consolas, monospace; }
  .pn-doc-body pre { background: #fafafa; border: 1px solid #ebebeb; border-radius: 8px; padding: 0.8em 1em; direction: ltr; text-align: left; font-size: 0.88em; font-family: 'Geist Mono', Consolas, monospace; margin: 0 0 0.6em; white-space: pre-wrap; }
  /* ── tables — Word's CSS engine DROPS rgba() colors, which made every
     table border invisible (the reported «جدول درست رندر نمی‌شود»): all
     table colors are pre-blended solid hex here. Column/row dimensions
     arrive as width/height attributes from the client (Word reads the
     attributes, not CSS, on <col>/<tr>). */
  .pn-doc-body table { border-collapse: collapse; table-layout: auto; margin: 0.6em 0; border-radius: 8px; }
  .pn-doc-body table td, .pn-doc-body table th { border: 1px solid #ebebeb; padding: 8px 12px; vertical-align: top; background: #ffffff; }
  .pn-doc-body table th { background: #fafafa; color: #171717; font-weight: 600; font-size: 0.9em; }
  .pn-doc-body table td p, .pn-doc-body table th p { margin: 0 0 0.5em; }
  .pn-doc-body table td p:last-child, .pn-doc-body table th p:last-child { margin-bottom: 0; }
  .pn-doc-body img { max-width: 100%; border-radius: 8px; margin: 0.5em 0; }
  .pn-doc-body img[data-align='center'] { display: block; margin-inline: auto; }
  .pn-doc-body img[data-align='left'] { display: block; margin-inline: auto auto 0.5em; }
  .pn-doc-body img[data-align='right'] { display: block; margin-inline: 0.5em auto; }
  .pn-doc-body hr { border: none; border-top: 1px dashed rgba(0,0,0,0.12); margin: 16px 0; }
  .pn-doc-body a { color: #0070f3; text-decoration: underline; }
  .pn-doc-body mark { background: #111; color: #fff; padding: 0.05em 0.1em; border-radius: 2px; }
  .pn-doc-body img.pn-inline-icon { display: inline-block; width: 1.45em; height: 1.45em; vertical-align: -0.32em; margin: 0 0.08em; }

  /* ── educational blocks — EXACT palette of the editor's light theme ── */
  .pn-doc-body .edu-block { border: 1.5px solid #dddddd; border-radius: 4px; margin: 0.6em 0; padding: 0.6em 0.9em; position: relative; background: transparent; }
  .pn-doc-body .edu-block > div:last-child > p:last-child { margin-bottom: 0; }
  .pn-doc-body .edu-title { font-weight: 600; margin-bottom: 0.3em; font-size: 0.9em; letter-spacing: -0.01em; }
  .pn-doc-body .edu-definition .edu-title { color: #0070f3; }
  .pn-doc-body .edu-important .edu-title { color: #b45309; }
  .pn-doc-body .edu-exam .edu-title { color: #175e7d; }
  .pn-doc-body .edu-warning .edu-title { color: #dc2626; }
  .pn-doc-body .edu-summary .edu-title { color: #0070f3; }
  .pn-doc-body .edu-question .edu-title { color: #7928ca; }
  .pn-doc-body .edu-example .edu-title { color: #175e7d; }
  .pn-doc-body .edu-keyterm .edu-title { color: #7928ca; }
  .pn-doc-body .edu-highlight .edu-title { color: #b45309; }
  .pn-doc-body .edu-reference .edu-title { color: #7928ca; }
  .pn-doc-body .edu-procon .edu-title { color: #0070f3; }
  .pn-doc-body .edu-codeoutput .edu-title { color: #0070f3; }
  .pn-doc-body .edu-formula { text-align: center; padding: 0.8em; }
  .pn-doc-body .edu-answer { border-top: 1px solid #f0f0f0; margin-top: 0.4em; padding-top: 0.4em; color: #666; }
  .pn-doc-body .edu-title-icon { display: inline-flex; align-items: center; opacity: 0.85; }
  .pn-doc-body .edu-title-icon svg { width: 1em; height: 1em; display: block; }
  .pn-doc-body .edu-title-suffix { opacity: 0.6; font-weight: 500; font-size: 0.85em; }
  .pn-doc-body .edu-procon-cols { width: 100%; }
  .pn-doc-body .edu-procon-col { border-radius: 8px; padding: 8px 12px; }
  .pn-doc-body .edu-procon-pro { background: #f4f8fa; border: 1px solid #c7dce4; }
  .pn-doc-body .edu-procon-con { background: #fef3f3; border: 1px solid #fccfcf; }
  .pn-doc-body .edu-procon-label { font-weight: 700; font-size: 0.85em; margin-bottom: 4px; }
  .pn-doc-body .edu-procon-pro .edu-procon-label { color: #175e7d; }
  .pn-doc-body .edu-procon-con .edu-procon-label { color: #b91c1c; }
  .pn-doc-body .edu-procon-text { font-size: 0.9em; white-space: pre-wrap; }
  .pn-doc-body .edu-code-area, .pn-doc-body .edu-code-out {
    direction: ltr; text-align: left; font-family: 'Geist Mono', Consolas, monospace;
    font-size: 13px; border-radius: 8px; padding: 10px 12px; margin: 4px 0 0; white-space: pre-wrap;
  }
  .pn-doc-body .edu-code-area { background: #f4f4f5; color: #27272a; border: 1px solid #f0f0f0; }
  .pn-doc-body .edu-code-out { background: #fafafa; border: 1px solid #ebebeb; min-height: 1.8em; }
  .pn-doc-body .edu-code-out-label { font-size: 0.8em; color: #64748b; margin-top: 8px; font-weight: 600; }
  .pn-doc-body .edu-footnote { border-style: dashed; border-radius: 4px; padding: 8px 12px; margin: 6px 0; }
  .pn-doc-body .edu-footnote .edu-title { font-size: 0.85em; color: #175e7d; margin-bottom: 2px; }
  .pn-doc-body .edu-longanswer .edu-title { color: #b45309; border-bottom: 1px solid #fdedd3; padding-bottom: 4px; }
  .pn-doc-body .edu-timeline .edu-title { color: #0070f3; border-bottom: 1px solid #e6f1fd; padding-bottom: 6px; margin-bottom: 8px; }
  .pn-doc-body .timeline-item { border-right: 3px solid #0070f3; margin-right: 8px; padding-right: 12px; padding: 6px 4px; }
  .pn-doc-body .cmp-head { padding: 8px 10px; background: #f7f2fb; border-radius: 8px 8px 0 0; }
  .pn-doc-body .cmp-label { font-weight: 600; font-size: 0.88em; color: #7928ca; }
  .pn-doc-body .cmp-vs { color: #7928ca; font-weight: 600; font-size: 0.82em; }
  .pn-doc-body .cmp-body { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .pn-doc-body .cmp-body td { border: 1px solid #f0f0f0; padding: 8px 10px; font-size: 0.9em; vertical-align: top; }
  .pn-doc-body .cmp-row-label { font-weight: 600; color: #666; background: #fafafa; width: 35%; }
  .pn-doc-body .cmp-row-cell { color: #333; }
  .pn-doc-body .edu-term-input, .pn-doc-body .edu-input { background: transparent; border: none; border-bottom: 1px dashed #d9d9d9; font-weight: 600; width: 100%; font-family: inherit; color: inherit; }

  /* ── quiz blocks (سوالات) — PARITY with index.css/printCss (light theme).
     Word's engine drops rgba() and box-shadows: all hairlines are solid
     hex borders and tints are pre-blended fills. Task-list checkboxes are
     already ☑/☐ characters (client transform). */
  .pn-doc-body .quiz-opts { margin: 2px 0 6px; }
  .pn-doc-body .quiz-opt { border: 1px solid #d4d4d8; border-radius: 6px; padding: 5px 8px; margin-bottom: 6px; background: #ffffff; }
  .pn-doc-body .quiz-opt-num { display: inline-block; min-width: 1.55em; text-align: center; border-radius: 50%; background: #f1f7fd; color: #0070f3; font-size: 0.82em; font-weight: 700; }
  .pn-doc-body .quiz-opt[data-correct='true'] { background: #f2fbf5; border: 1.5px solid #16a34a; }
  .pn-doc-body .quiz-opt[data-correct='true'] .quiz-opt-num { background: #16a34a; color: #ffffff; }
  .pn-doc-body .quiz-opt-text { font-size: 0.95em; }
  .pn-doc-body .quiz-opt-del { display: none; }
  .pn-doc-body .quiz-layout-row { display: none; }
  .pn-doc-body .quiz-tf-row { margin: 2px 0 8px; }
  .pn-doc-body .quiz-tf-btn { display: inline-block; min-width: 88px; border: 1px solid #d4d4d8; border-radius: 8px; font-family: inherit; font-size: 0.85em; font-weight: 600; padding: 5px 16px; color: #64748b; text-align: center; }
  .pn-doc-body .quiz-tf-row[data-answer='true'] .quiz-tf-true { background: #e4f6ea; border-color: #16a34a; color: #15803d; }
  .pn-doc-body .quiz-tf-row[data-answer='false'] .quiz-tf-false { background: #fdeaec; border-color: #dc2626; color: #b91c1c; }
  .pn-doc-body .quiz-end-answer { margin-top: 6px; padding: 4px 10px; font-size: 0.82em; font-weight: 600; color: #16a34a; background: #f2fbf5; border-radius: 6px; }
  /* quiz variants (data-qv) — index.css v2/v3 mirrored print-safe */
  .pn-doc-body .edu-mcq[data-qv='v2'] .quiz-opt { border-radius: 10px; padding: 7px 11px; border: 1.5px solid #d4d4d8; background: #ffffff; }
  .pn-doc-body .edu-mcq[data-qv='v2'] .quiz-opt-num { background: #0070f3; color: #ffffff; border-radius: 8px; }
  .pn-doc-body .edu-mcq[data-qv='v2'] .quiz-opt[data-correct='true'] { background: #f4faf6; border: 2px solid #16a34a; }
  .pn-doc-body .edu-mcq[data-qv='v2'] .quiz-opt[data-correct='true'] .quiz-opt-num { background: #16a34a; border-radius: 8px; }
  .pn-doc-body .edu-truefalse[data-qv='v2'] .quiz-tf-btn { border-radius: 999px; }
  .pn-doc-body .edu-mcq[data-qv='v3'] .edu-title, .pn-doc-body .edu-truefalse[data-qv='v3'] .edu-title, .pn-doc-body .edu-longanswer[data-qv='v3'] .edu-title, .pn-doc-body .edu-question[data-qv='v3'] .edu-title { border-bottom: 1px solid #d4d4d8; padding-bottom: 5px; }
  .pn-doc-body .edu-mcq[data-qv='v3'] .quiz-opts-stacked .quiz-opt { background: transparent; border: none; border-bottom: 1px dashed #a1a1aa; border-radius: 4px; padding: 5px 6px; margin-bottom: 2px; }
  .pn-doc-body .edu-mcq[data-qv='v3'] .quiz-opts-stacked .quiz-opt:last-child { border-bottom: none; }
  .pn-doc-body .edu-mcq[data-qv='v3'] .quiz-opts-grid .quiz-opt { border: 1px solid #d4d4d8; border-bottom: none; margin-bottom: 6px; background: transparent; }
  .pn-doc-body .edu-mcq[data-qv='v3'] .quiz-opt-num { background: transparent; color: #171717; font-weight: 800; border-radius: 4px; }
  .pn-doc-body .edu-mcq[data-qv='v3'] .quiz-opt[data-correct='true'] { border: 1.5px solid #16a34a; background: #f7fdf9; }
  .pn-doc-body .edu-mcq[data-qv='v3'] .quiz-opt[data-correct='true'] .quiz-opt-num { color: #16a34a; background: #eaf7ef; }
  .pn-doc-body .edu-truefalse[data-qv='v3'] .quiz-tf-btn { border-radius: 4px; font-weight: 700; }
  /* ── ListMarker (data-marker) — the glyph tokens Word CAN express
     natively (list-style-type); pseudo-counter tokens (fa/paren/diamond)
     degrade to Word's default numbering instead of fighting its engine */
  .pn-doc-body ul[data-marker='circle'] { list-style-type: circle; }
  .pn-doc-body ul[data-marker='square'] { list-style-type: square; }
  .pn-doc-body ul[data-marker='diamond'] { list-style-type: square; }
  .pn-doc-body ul[data-marker='dash'] { list-style-type: square; }
  .pn-doc-body ol[data-marker='decimal'] { list-style-type: decimal; }
  .pn-doc-body ol[data-marker='alpha'] { list-style-type: lower-alpha; }
  .pn-doc-body ol[data-marker='roman'] { list-style-type: upper-roman; }
`;

/**
 * Word-compatible HTML export (.doc opens natively in Microsoft Word /
 * LibreOffice with full RTL + Persian support). The file is generated
 * server-side so the client never needs heavy office libraries.
 *
 * Fidelity contract: the client sends the SAME prepared HTML the PDF path
 * renders — equations already converted to native OMML (m:oMath islands),
 * task-list checkboxes already turned into ☑/☐ characters, KaTeX CSS +
 * the document's edu-block customization CSS already inlined — and this
 * route wraps it in the editor's exact typography. What the user sees on
 * the editable page is what Word shows.
 */
router.post(
  '/docx',
  asyncHandler(async (req: AuthRequest, res) => {
    const { title, html, subject, chapter, headerText, footerText, bodyFontFamily, fontSizePx, lineHeight, eduCss, headerHtml, footerHtml } = z
      .object({
        title: z.string().default('بدون عنوان'),
        html: z.string().min(1),
        subject: z.string().optional(),
        chapter: z.string().optional(),
        headerText: z.string().optional(),
        footerText: z.string().optional(),
        /** document font — the editor's fontFamily setting (Sahel default) */
        bodyFontFamily: z.string().optional(),
        /** document font size in px — the editor's own setting */
        fontSizePx: z.coerce.number().min(8).max(72).optional(),
        /** document line-height — the editor's own setting */
        lineHeight: z.coerce.number().min(1).max(4).optional(),
        /** edu-block customization CSS, prebuilt client-side (unscoped) */
        eduCss: z.string().max(20000).optional(),
        /** ornamental page frame as VML — embedded in the Word page header
         *  so it repeats on every page (like the editor sheet and the PDF) */
        headerHtml: z.string().max(100000).optional(),
        /** footer HTML carrying a real PAGE field for the page number */
        footerHtml: z.string().max(10000).optional(),
      })
      .parse(req.body);

    /* §34/§36 — the DOCX/HTML-for-Word export preserves the CONTINUOUS
       logical document: Word runs its own pagination, so the editor's page
       boundaries must NOT be baked in as fake containers or manual breaks.
       Stray pageBreak divs (legacy persisted markers) are stripped — a
       manual break the user wants can be inserted in Word itself. */
    const continuousHtml = html.replace(
      /<div[^>]*data-type=["']page-break["'][^>]*>[\s\S]*?<\/div>/gi,
      '',
    );

    /* px → pt (1px @96dpi = 0.75pt); editor defaults: 16px / line-height 2 */
    const fontSizePt = fontSizePx ? Math.round(fontSizePx * 0.75 * 100) / 100 : 13;
    const lineHeightValue = lineHeight && lineHeight > 0 ? lineHeight : 1.9;
    const fontFamily = safeFontFamily(bodyFontFamily);

    const eduBlock = safeCss(eduCss) ? `<style>\n${safeCss(eduCss)}\n</style>\n` : '';

    /* ── per-page ornamental frame (قاب) ──
       The client sends the border as a VML group + a footer with a real
       PAGE field. Word repeats its page header/footer on EVERY page, so
       the frame wraps every page of the continuous document exactly like
       the editor sheet and the PDF export. Headers are only visible in
       Print Layout — the w:View=Print blob below makes Word open there. */
    const headerFrag = safeWordFragment(headerHtml);
    const footerFrag = safeWordFragment(footerHtml);
    const hasHeaderFooter = !!(headerFrag || footerFrag);

    /* the user's optional header text lives INSIDE the Word PAGE HEADER
       (repeats on every page, under the ornamental frame) — it must NEVER
       be a fake paragraph on page 1's body (the «متن اضافه اول صفحه» bug) */
    const headerTextFrag = headerText
      ? `<p class="MsoHeader" style="margin:10pt 0 0;font-size:9pt;color:#475569;text-align:center">${escapeHtml(headerText)}</p>`
      : '';

    const doc = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:m="${OMML_NS}" dir="rtl" lang="fa">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]><xml>
<w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument>
</xml><![endif]-->
<style>v\:* {behavior:url(#default#VML);} o\:* {behavior:url(#default#VML);}</style>
<style>
  /* §41 — SAME page settings as the editor: the editor sheet is 794×1123px
     with a ≈30/32px writing margin (framed) — that maps to A4 with ≈1cm
     margins, NOT Word's default 2cm. One set of dimensions for every output.
     mso-page-numbers is deliberately ABSENT: a page number stamped here
     printed at the page's TOP-LEFT corner, next to the frame — the real
     number comes from the PAGE field inside the frame's dome (footer). */
  @page { size: A4; margin: 1cm; }
  .pn-page-break { display: none; }
  body { font-family: ${fontFamily || 'Sahel'}, 'B Nazanin', Tahoma, sans-serif; direction: rtl; text-align: right; font-size: ${fontSizePt}pt; line-height: ${lineHeightValue}; color: #1a2332; }
${TYPO_CSS}
</style>
${eduBlock}${
  hasHeaderFooter
    ? `<style>
  @page WordSection1 {
    size: 21.0cm 29.7cm;
    margin: 1cm 1cm 1.2cm 1cm;
    mso-header-margin: 0;
    mso-footer-margin: 0;
    mso-header: h1;
    mso-paper-source: 0;
  }
  div.WordSection1 { page: WordSection1; }
  p.MsoHeader, li.MsoHeader, div.MsoHeader { margin: 0; mso-pagination: none; }
  p.MsoFooter, li.MsoFooter, div.MsoFooter { margin: 0; mso-pagination: none; }
</style>`
    : ''
}</head>
<body>
<!-- FIDELITY CONTRACT (خروجی Word = ادیت‌پیج): the body carries ONLY the
     note content — no injected <h1> title, no header/footer text paragraphs.
     Title/subject/meta reach the page through the ornamental frame (side
     label, dome) exactly like the editor sheet; Word paginates itself. -->
<div class="WordSection1">
<div class="pn-doc-body">
${continuousHtml}
</div>
</div>
${headerFrag || headerTextFrag || footerFrag ? `<div style='mso-element:header' id=h1>${headerFrag ?? ''}${headerTextFrag ?? ''}${footerFrag ?? ''}</div>` : ''}
</body>
</html>`;

    const safeName = (title || 'note').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
    res.setHeader('Content-Type', 'application/msword; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`${safeName}.doc`)}`
    );
    res.send('\ufeff' + doc);
  })
);

/** server-side HTML export (used by the client for archiving / backup) */
router.post(
  '/html',
  asyncHandler(async (req: AuthRequest, res) => {
    const { title, html, subject, chapter } = z
      .object({
        title: z.string().default('بدون عنوان'),
        html: z.string().min(1),
        subject: z.string().optional(),
        chapter: z.string().optional(),
      })
      .parse(req.body);
    if (!html) throw new ApiError(400, 'محتوایی برای خروجی وجود ندارد.');
    const safeName = (title || 'note').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${safeName}.html`)}`);
    res.send(`<!DOCTYPE html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:Sahel,Tahoma;direction:rtl;max-width:800px;margin:2rem auto;line-height:1.9;padding:0 1rem;color:#1a2332}
.meta{color:#64748b;font-size:.9rem;border-bottom:1px solid #e2e8f0;padding-bottom:.5rem;margin-bottom:1.5rem}</style></head>
<body><div class="meta">${[title, subject, chapter].filter(Boolean).join(' — ')}</div>${html}</body></html>`);
  })
);

export default router;
