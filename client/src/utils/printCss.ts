import type { BorderSettings, EduBlocksSettings } from '@/types';
import { eduBlocksCss, isTinted, resolveEduBlocks } from './eduBlocks';

/** editor document settings — the export replicates them 1:1 */
export interface ExportOptionsCss {
  border?: BorderSettings;
  fontSize: number;
  lineHeight: number;
  /** «رنگی» edu-box style (legacy flag — superseded by eduBlocks) */
  eduTinted?: boolean;
  /** full edu-block customization — generated CSS appended when present */
  eduBlocks?: EduBlocksSettings;
}

/* .edu-tinted scope — exact backgrounds of index.css (light theme).
   In the print doc there is no .edu-tinted ancestor element, so when the
   option is on, the tinted backgrounds are applied to the blocks directly.
   The Word export re-uses this list too — with the .pn-sheet-content scope
   stripped off (see buildWordEduCss). */
export const TINTED_CSS = `
  .pn-sheet-content .edu-definition { background: rgba(0,112,243,0.04); }
  .pn-sheet-content .edu-important { background: rgba(245,166,35,0.06); }
  .pn-sheet-content .edu-exam { background: rgba(31,115,150,0.06); }
  .pn-sheet-content .edu-warning { background: rgba(239,68,68,0.05); }
  .pn-sheet-content .edu-summary { background: rgba(0,112,243,0.04); }
  .pn-sheet-content .edu-question { background: rgba(121,40,202,0.05); }
  .pn-sheet-content .edu-example { background: rgba(31,115,150,0.05); }
  .pn-sheet-content .edu-keyterm { background: rgba(121,40,202,0.05); }
  .pn-sheet-content .edu-formula { background: rgba(0,112,243,0.03); }
  .pn-sheet-content .edu-highlight { background: rgba(245,166,35,0.06); }
  .pn-sheet-content .edu-reference { background: rgba(121,40,202,0.04); }
  .pn-sheet-content .edu-procon { background: rgba(0,112,243,0.03); }
  .pn-sheet-content .edu-codeoutput { background: rgba(0,112,243,0.03); }
  .pn-sheet-content .edu-comparison { background: rgba(121,40,202,0.04); }
  .pn-sheet-content .edu-timeline { background: rgba(0,112,243,0.04); }
  .pn-sheet-content .edu-footnote { background: rgba(31,115,150,0.04); }
  .pn-sheet-content .edu-longanswer { background: rgba(245,166,35,0.05); }
  .pn-sheet-content .edu-truefalse { background: rgba(31,115,150,0.05); }
  .pn-sheet-content .edu-mcq { background: rgba(121,40,202,0.04); }
`;

/**
 * Resolve the edu customization and emit its print-scoped CSS.
 * Returns '' when nothing is customized (the shipped minimal look applies).
 */
function eduCssForPrint(options: ExportOptionsCss): string {
  const edu = resolveEduBlocks(options.eduBlocks);
  if (!edu) return '';
  /* shipped fills FIRST, then the user's rules — later declarations win,
     so a customized family fill always beats the base palette */
  const baseTint = isTinted(edu) ? TINTED_CSS : '';
  const custom = eduBlocksCss(edu, { prefix: '.pn-sheet-content' });
  return `${baseTint}\n${custom}`.trim();
}

/**
 * Stylesheet for the print/PDF document.
 *
 * This is a REPLICA of the editor's own rules (index.css): same 794×1123px
 * A4 sheet geometry, same per-kind paddings, same typography (document font
 * size / line-height, justify, headings, lists, tables, code, blockquote…).
 * No print margins, headers, footers or cover are added — the exported page
 * shows exactly what the user applied on the editable pages.
 */
export function printCss(options: ExportOptionsCss): string {
  const fs = options.fontSize;
  const lh = options.lineHeight;
  return `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #fff; }
  body { font-family: Sahel, Tahoma, sans-serif; color: #171717; }

  /* ── A4 sheet — identical geometry to the editor (.page-paper) ──
     ROOT-CAUSE FIX (blank page between every real page):
     the sheets used to be sized in CSS px (794×1123). 1123px = 297.127mm,
     0.127mm TALLER than the physical 297mm @page box — every sheet was
     ~0.5px too tall for its page, so it spilled onto a second (blank) page
     and the print dialog rendered Real, Blank, Real, Blank…
     The sheets are now sized in mm and mapped to the exact @page box:
     1px editor = 210/794mm keeps the CONTENT layout identical to the
     editor (fonts, paddings, border, floats all scale by one uniform
     factor ≈ 0.99626) while the sheet fits its PDF page EXACTLY —
     zero residue, zero spill, N logical pages → N PDF pages. */
  .pn-page {
    width: 210mm;
    height: 297mm;
    background: #fff;
    overflow: hidden;
    position: relative;
    page-break-after: always;
    break-after: page;
  }
  .pn-page:last-child { page-break-after: auto; break-after: auto; }
  @page { size: A4; margin: 0; }

  /* inner box: absolutely positioned so background layers (border SVG,
     notebook lines) and the content share the sheet's exact geometry */
  .pn-sheet {
    position: absolute;
    inset: 0;
  }
  .pn-sheet > svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 1;
  }
  .pn-sheet-content {
    position: absolute;
    inset: 0;
    z-index: 2;
    font-size: ${fs}px;
    line-height: ${lh};
    letter-spacing: -0.01em;
  }

  /* ── typography — mirrors .ProseMirror in index.css 1:1 (light rules
     only; the editor's dark-mode variants don't apply to paper) ── */
  .pn-sheet-content p { margin: 0 0 0.5em; text-align: justify; text-justify: inter-word; }
  .pn-sheet-content p:empty::before { content: '\\200B'; }
  .pn-sheet-content h1, .pn-sheet-content h2, .pn-sheet-content h3, .pn-sheet-content h4 {
    color: #171717; font-weight: 700; margin: 1em 0 0.4em; letter-spacing: -0.04em; text-wrap: balance;
  }
  .pn-sheet-content h1 { font-size: 1.8em; letter-spacing: -0.05em; line-height: 1.15; }
  .pn-sheet-content h2 { font-size: 1.35em; letter-spacing: -0.04em; line-height: 1.25; padding-bottom: 0.3em; box-shadow: inset 0 -1px 0 0 rgba(0,0,0,0.08); }
  .pn-sheet-content h3 { font-size: 1.15em; letter-spacing: -0.03em; }
  .pn-sheet-content h4 { font-size: 1.02em; letter-spacing: -0.02em; color: #666; }
  .pn-sheet-content ul, .pn-sheet-content ol { padding-right: 1.6em; padding-left: 0; margin: 0 0 0.5em; }
  .pn-sheet-content ul { list-style-type: disc; }
  .pn-sheet-content ol { list-style-type: decimal; }
  .pn-sheet-content li { margin-bottom: 0.2em; }
  .pn-sheet-content ul li::marker { color: #0070f3; }
  .pn-sheet-content ol li::marker { color: #114b64; font-weight: 600; }
  /* ── ListMarker (data-marker) — index.css 1:1 so the PDF matches the editor ── */
  .pn-sheet-content ul[data-marker='circle'] { list-style-type: circle; }
  .pn-sheet-content ul[data-marker='square'] { list-style-type: square; }
  .pn-sheet-content ul[data-marker='diamond'] { list-style-type: none; }
  .pn-sheet-content ul[data-marker='diamond'] > li { position: relative; }
  .pn-sheet-content ul[data-marker='diamond'] > li::before {
    content: '\\25C6'; position: absolute; right: -1.35em; top: 0.08em;
    color: #0070f3; font-size: 0.62em;
  }
  .pn-sheet-content ul[data-marker='dash'] { list-style-type: none; }
  .pn-sheet-content ul[data-marker='dash'] > li { position: relative; }
  .pn-sheet-content ul[data-marker='dash'] > li::before {
    content: '\\2014'; position: absolute; right: -1.25em; top: 0;
    color: #114b64; font-weight: 600;
  }
  .pn-sheet-content ul[data-marker='none'] { list-style-type: none; }
  .pn-sheet-content ol[data-marker='decimal'] { list-style-type: decimal; }
  .pn-sheet-content ol[data-marker='fa'] { list-style-type: none; counter-reset: pn-list; }
  .pn-sheet-content ol[data-marker='fa'] > li { position: relative; counter-increment: pn-list; }
  .pn-sheet-content ol[data-marker='fa'] > li::before {
    content: counter(pn-list, persian) '.';
    position: absolute; right: -1.6em; top: 0;
    color: #114b64; font-weight: 600;
  }
  .pn-sheet-content ol[data-marker='paren'] { list-style-type: none; counter-reset: pn-list; }
  .pn-sheet-content ol[data-marker='paren'] > li { position: relative; counter-increment: pn-list; }
  .pn-sheet-content ol[data-marker='paren'] > li::before {
    content: counter(pn-list, arabic-indic) ')';
    position: absolute; right: -1.6em; top: 0;
    color: #114b64; font-weight: 600;
  }
  .pn-sheet-content ol[data-marker='alpha'] { list-style-type: lower-alpha; }
  .pn-sheet-content ol[data-marker='roman'] { list-style-type: upper-roman; }
  .pn-sheet-content ol[data-marker='none'] { list-style-type: none; }
  .pn-sheet-content ul[data-type='taskList'] { padding-right: 0.2em; list-style: none; }
  .pn-sheet-content ul[data-type='taskList'] li { display: flex; align-items: flex-start; gap: 0.5em; }
  .pn-sheet-content ul[data-type='taskList'] li::before { display: none; }
  .pn-sheet-content ul[data-type='taskList'] input[type='checkbox'] { width: 1.1em; height: 1.1em; margin-top: 0.35em; accent-color: #0070f3; }
  .pn-sheet-content blockquote { box-shadow: inset 3px 0 0 0 #0070f3; margin: 0.5em 0; padding: 0.4em 1em; color: #444; background: rgba(0,112,243,0.03); border-radius: 0 6px 6px 0; }
  .pn-sheet-content code { background: rgba(0,0,0,0.04); border-radius: 4px; padding: 0.1em 0.35em; font-size: 0.88em; font-family: 'Geist Mono', 'SF Mono', Consolas, monospace; }
  .pn-sheet-content pre { background: #fafafa; box-shadow: 0 0 0 1px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04); border-radius: 8px; padding: 0.8em 1em; direction: ltr; text-align: left; font-size: 0.88em; overflow-x: auto; margin: 0 0 0.6em; white-space: pre-wrap; }
  /* overflow:hidden REMOVED: with border-collapse it can clip the shared
     cell edges in the print fragment renderer — the visible symptom was
     tables whose inner gridlines vanished while the outer edge survived.
     border-radius is sacrificed on paper (no clipping needed anyway). */
  .pn-sheet-content table { border-collapse: collapse; table-layout: fixed; width: 100%; margin: 0.6em 0; }
  /* kept from index.css 1:1: min-width floor — the EDITOR allows dragging
     a table narrow (min-width:120px); print honors whatever width was set
     via the width attribute below, but a shrunken table still floors at
     its own natural width so cells never collapse in the PDF */
  .pn-sheet-content table[style*='width'] { min-width: 0; }
  /* column widths chosen by dragging the column edges travel as <colgroup>
     <col style="width:Npx"> in the exported HTML — honored natively here */
  .pn-sheet-content thead { display: table-header-group; }
  .pn-sheet-content tr { break-inside: avoid; page-break-inside: avoid; }
  /* ROOT CAUSE of the missing cell lines (reported 3×): the print replica
     reused the SCREEN border color rgba(0,0,0,0.08). The print pipeline
     drops sub-pixel translucent hairlines — on paper an 8%-alpha 1px line
     rounds to <1 device px and disappears, while backgrounds/text survive.
     Print lines must be SOLID print-safe colors at a full px. #d4d4d8 ≈
     the same visual weight as 8% black over white, but opaque → the grid
     always reaches the PDF. Header/striping colors were already solid. */
  .pn-sheet-content table td, .pn-sheet-content table th { border: 1px solid #d4d4d8; padding: 8px 12px; vertical-align: top; /* BUG-1: opaque surface — notebook ruling must not show through cells */ background: #ffffff; }
  .pn-sheet-content table th { background: #fafafa; color: #171717; font-weight: 600; font-size: 0.9em; }
  /* ── table design (طراحی جدول) — index.css 1:1 ──
     print-color-adjust: exact — WITHOUT it Chrome's default print
     rendering strips cell/header BACKGROUND paints (navy headers,
     striping, soft fills) from the PDF: the design simply vanishes in
     some looks while it is visible in the editor/preview. The whole
     content box is forced to honor the authored colors. */
  .pn-sheet-content {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* Chrome honors the exact-paint flag more reliably when it is also
     declared at the document root — the cascade otherwise lets an
     ancestor opt a distant subtree back out of exact rendering */
  html, body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .pn-sheet-content table[data-cellpad='compact'] td, .pn-sheet-content table[data-cellpad='compact'] th { padding: 4px 6px; }
  .pn-sheet-content table[data-cellpad='roomy'] td, .pn-sheet-content table[data-cellpad='roomy'] th { padding: 14px 18px; }
  .pn-sheet-content table[data-borderless='true'] td, .pn-sheet-content table[data-borderless='true'] th { border-color: transparent; }
  .pn-sheet-content table[data-striped='true'] tr:nth-of-type(even) td { background: #f4f4f5; }
  .pn-sheet-content table[data-align='center'] { margin-inline: auto; }
  .pn-sheet-content table[data-align='left'] { margin-inline: auto auto 0.6em; }
  .pn-sheet-content table[data-align='right'] { margin-inline: 0.6em auto; }
  /* ── table style templates (قالب‌های آماده) — index.css tokens 1:1 ── */
  .pn-sheet-content table[data-tstyle='navy'] th { background: #1e3a5f; color: #ffffff; }
  .pn-sheet-content table[data-tstyle='soft'] td, .pn-sheet-content table[data-tstyle='soft'] th { border-color: #d8dee6; }
  .pn-sheet-content table[data-tstyle='soft'] th { background: #f0f4f8; }
  .pn-sheet-content table[data-tstyle='minimal'] td, .pn-sheet-content table[data-tstyle='minimal'] th { border: none; border-bottom: 1px solid #e2e5ea; }
  .pn-sheet-content table[data-tstyle='minimal'] th { border-bottom: 2px solid #9aa4af; }
  .pn-sheet-content table[data-tstyle='academic'] td, .pn-sheet-content table[data-tstyle='academic'] th { border: none; }
  .pn-sheet-content table[data-tstyle='academic'] tr:first-of-type td, .pn-sheet-content table[data-tstyle='academic'] tr:first-of-type th { border-top: 2px solid #171717; }
  .pn-sheet-content table[data-tstyle='academic'] th { border-bottom: 2px solid #171717; }
  .pn-sheet-content table[data-tstyle='academic'] tr:last-of-type td, .pn-sheet-content table[data-tstyle='academic'] tr:last-of-type th { border-bottom: 2px solid #171717; }
  .pn-sheet-content table[data-tstyle='bold'] td, .pn-sheet-content table[data-tstyle='bold'] th { border: 2px solid #565656; }
  .pn-sheet-content table[data-tstyle='plain'] td, .pn-sheet-content table[data-tstyle='plain'] th { border-color: transparent; }
  .pn-sheet-content img { max-width: 100%; border-radius: 8px; margin: 0.5em 0; }
  .pn-sheet-content img[data-align='center'] { display: block; margin-inline: auto; }
  .pn-sheet-content img[data-align='left'] { display: block; margin-inline: auto auto 0.5em; }
  .pn-sheet-content img[data-align='right'] { display: block; margin-inline: 0.5em auto; }
  .pn-sheet-content hr { border: none; border-top: 1px dashed rgba(0,0,0,0.12); margin: 16px 0; }
  .pn-sheet-content a { color: #0070f3; text-decoration: underline; text-decoration-color: rgba(0,112,243,0.3); text-underline-offset: 3px; text-decoration-thickness: 1px; }
  .pn-sheet-content mark { background: #111; color: #fff; padding: 0.05em 0.1em; border-radius: 2px; }
  .pn-sheet-content img.pn-inline-icon { display: inline-block; width: 1.45em; height: 1.45em; vertical-align: -0.32em; margin: 0 0.08em; }

  /* ── educational blocks — EXACT palette of the editor's light theme
     (index.css .edu-*): minimal paper style, no fills unless .edu-tinted ── */
  .pn-sheet-content .edu-block { border: 1.5px solid rgba(0,0,0,0.14); border-radius: 4px; margin: 0.6em 0; padding: 0.6em 0.9em; break-inside: avoid; position: relative; background: transparent; }
  .pn-sheet-content .edu-block > div:last-child > p:last-child { margin-bottom: 0; }
  .pn-sheet-content .edu-title { font-weight: 600; margin-bottom: 0.3em; display: flex; align-items: center; gap: 0.4em; font-size: 0.9em; letter-spacing: -0.01em; }
  .pn-sheet-content .edu-definition .edu-title { color: #0070f3; }
  .pn-sheet-content .edu-important .edu-title { color: #b45309; }
  .pn-sheet-content .edu-exam .edu-title { color: #175e7d; }
  .pn-sheet-content .edu-warning .edu-title { color: #dc2626; }
  .pn-sheet-content .edu-summary .edu-title { color: #0070f3; }
  .pn-sheet-content .edu-question .edu-title { color: #7928ca; }
  .pn-sheet-content .edu-example .edu-title { color: #175e7d; }
  .pn-sheet-content .edu-keyterm .edu-title { color: #7928ca; }
  .pn-sheet-content .edu-highlight .edu-title { color: #b45309; }
  .pn-sheet-content .edu-reference .edu-title { color: #7928ca; }
  .pn-sheet-content .edu-procon .edu-title { color: #0070f3; }
  .pn-sheet-content .edu-codeoutput .edu-title { color: #0070f3; }
  .pn-sheet-content .edu-formula { text-align: center; padding: 0.8em; }
  .pn-sheet-content .edu-answer { border-top: 1px solid rgba(0,0,0,0.06); margin-top: 0.4em; padding-top: 0.4em; color: #666; }
  .pn-sheet-content .edu-title-icon { display: inline-flex; align-items: center; opacity: 0.85; }
  .pn-sheet-content .edu-title-icon svg { width: 1em; height: 1em; display: block; }
  .pn-sheet-content .edu-title-suffix { opacity: 0.6; font-weight: 500; font-size: 0.85em; white-space: nowrap; }
  .pn-sheet-content .edu-procon-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 6px; }
  .pn-sheet-content .edu-procon-col { border-radius: 8px; padding: 8px 12px; }
  .pn-sheet-content .edu-procon-pro { background: rgba(31,115,150,0.06); box-shadow: inset 0 0 0 1px rgba(31,115,150,0.25); }
  .pn-sheet-content .edu-procon-con { background: rgba(220,38,38,0.05); box-shadow: inset 0 0 0 1px rgba(220,38,38,0.22); }
  .pn-sheet-content .edu-procon-label { font-weight: 700; font-size: 0.85em; margin-bottom: 4px; }
  .pn-sheet-content .edu-procon-pro .edu-procon-label { color: #175e7d; }
  .pn-sheet-content .edu-procon-con .edu-procon-label { color: #b91c1c; }
  .pn-sheet-content .edu-procon-text { font-size: 0.9em; min-height: 2.5em; white-space: pre-wrap; }
  .pn-sheet-content .edu-code-area, .pn-sheet-content .edu-code-out {
    direction: ltr; text-align: left; font-family: 'Geist Mono', Consolas, monospace;
    font-size: 13px; border-radius: 8px; padding: 10px 12px; margin: 4px 0 0;
    white-space: pre-wrap;
  }
  .pn-sheet-content .edu-code-area { background: #f4f4f5; color: #27272a; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.06); }
  .pn-sheet-content .edu-code-out { background: #fafafa; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.08); min-height: 1.8em; }
  .pn-sheet-content .edu-code-out-label { font-size: 0.8em; color: #64748b; margin-top: 8px; font-weight: 600; }
  .pn-sheet-content .edu-procon-legacy, .pn-sheet-content .edu-codeoutput-legacy { font-size: 0.9em; }
  /* footnote / long-answer / timeline / comparison / fill-in inputs */
  .pn-sheet-content .edu-footnote { border-style: dashed; border-radius: 4px; padding: 8px 12px; margin: 6px 0; }
  .pn-sheet-content .edu-footnote .edu-title { font-size: 0.85em; color: #175e7d; margin-bottom: 2px; }
  .pn-sheet-content .edu-longanswer .edu-title { color: #b45309; box-shadow: inset 0 -1px 0 0 rgba(245,166,35,0.2); padding-bottom: 4px; }
  .pn-sheet-content .edu-truefalse .edu-title { color: #175e7d; }
  .pn-sheet-content .edu-mcq .edu-title { color: #7928ca; }

  /* ── quiz blocks (سوالات) — same visuals as the editor's light theme.
     All hairlines are OPAQUE (print-safe, see the table-cell rule above). */
  .pn-sheet-content .quiz-opts { margin: 2px 0 6px; }
  .pn-sheet-content .quiz-opts-grid { display: flex; flex-wrap: wrap; gap: 6px; }
  .pn-sheet-content .quiz-opt {
    display: flex; align-items: center; gap: 0.5em;
    padding: 5px 8px; border-radius: 6px;
    box-shadow: inset 0 0 0 1px #d4d4d8;
    background: transparent;
    margin-bottom: 6px;
    break-inside: avoid;
  }
  .pn-sheet-content .quiz-opts-grid .quiz-opt { width: calc(50% - 3px); margin-bottom: 0; }
  .pn-sheet-content .quiz-opt[data-correct="true"] {
    background: rgba(22, 163, 74, 0.1);
    box-shadow: inset 0 0 0 1.5px #16a34a;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pn-sheet-content .quiz-opt-num {
    flex: none; width: 1.55em; height: 1.55em; border-radius: 50%;
    background: color-mix(in srgb, var(--q-accent, #0070f3) 12%, white); color: var(--q-accent, #0070f3);
    font-size: 0.82em; font-weight: 700;
    display: inline-flex; align-items: center; justify-content: center;
    font-family: inherit;
  }
  .pn-sheet-content .quiz-opt[data-correct="true"] .quiz-opt-num { background: #16a34a; color: #fff; }
  .pn-sheet-content .quiz-opt-text { flex: 1; font-size: 0.95em; }
  .pn-sheet-content .quiz-opt-del { display: none; }
  .pn-sheet-content .quiz-layout-row { display: none; }

  /* ── quiz variants (data-qv) — MUST mirror index.css v2/v3 so the PDF
     matches the editor exactly. Print-safe: opaque hairlines, exact colors. */
  .pn-sheet-content .edu-mcq[data-qv="v2"] .quiz-opt {
    box-shadow: inset 0 0 0 1.5px #d4d4d8, 0 1px 2px rgba(0,0,0,0.06);
    background: #ffffff;
    border-radius: 10px;
    padding: 7px 11px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pn-sheet-content .edu-mcq[data-qv="v2"] .quiz-opt-num { background: #0070f3; color: #fff; border-radius: 8px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .pn-sheet-content .edu-mcq[data-qv="v2"] .quiz-opts-grid { gap: 8px; }
  .pn-sheet-content .edu-mcq[data-qv="v2"] .quiz-opts-grid .quiz-opt { width: calc(50% - 4px); }
  .pn-sheet-content .edu-mcq[data-qv="v2"] .quiz-opt[data-correct="true"] {
    background: rgba(22, 163, 74, 0.07);
    box-shadow: inset 0 0 0 2px #16a34a, 0 1px 2px rgba(0,0,0,0.06);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pn-sheet-content .edu-mcq[data-qv="v2"] .quiz-opt[data-correct="true"] .quiz-opt-num { background: #16a34a; border-radius: 8px; }
  .pn-sheet-content .edu-truefalse[data-qv="v2"] .quiz-tf-btn { border-radius: 999px; box-shadow: inset 0 0 0 1.5px #d4d4d8; }
  .pn-sheet-content .edu-mcq[data-qv="v3"] .edu-title,
  .pn-sheet-content .edu-truefalse[data-qv="v3"] .edu-title,
  .pn-sheet-content .edu-longanswer[data-qv="v3"] .edu-title,
  .pn-sheet-content .edu-question[data-qv="v3"] .edu-title {
    border-bottom: 1px solid #d4d4d8;
    padding-bottom: 5px;
  }
  .pn-sheet-content .edu-mcq[data-qv="v3"] .quiz-opts-stacked .quiz-opt {
    background: transparent;
    box-shadow: none;
    border-radius: 4px;
    padding: 5px 6px;
    margin-bottom: 2px;
    border-bottom: 1px dashed #a1a1aa;
  }
  .pn-sheet-content .edu-mcq[data-qv="v3"] .quiz-opts-stacked .quiz-opt:last-child { border-bottom: none; }
  .pn-sheet-content .edu-mcq[data-qv="v3"] .quiz-opts-grid .quiz-opt {
    box-shadow: inset 0 0 0 1px #d4d4d8;
    border-bottom: none;
    margin-bottom: 6px;
    background: transparent;
  }
  .pn-sheet-content .edu-mcq[data-qv="v3"] .quiz-opt-num { background: transparent; color: #171717; font-weight: 800; border-radius: 4px; }
  .pn-sheet-content .edu-mcq[data-qv="v3"] .quiz-opt[data-correct="true"] { box-shadow: inset 0 0 0 1.5px #16a34a; background: rgba(22, 163, 74, 0.05); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .pn-sheet-content .edu-mcq[data-qv="v3"] .quiz-opt[data-correct="true"] .quiz-opt-num { color: #16a34a; background: rgba(22, 163, 74, 0.12); }
  .pn-sheet-content .edu-truefalse[data-qv="v3"] .quiz-tf-btn { border-radius: 4px; font-weight: 700; }
  /* ── v4 «مینیمال» — borderless tinted rows (mirror index.css) ── */
  .pn-sheet-content .edu-mcq[data-qv="v4"] .quiz-opt { box-shadow: none; background: #f4f4f5; border-radius: 8px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .pn-sheet-content .edu-mcq[data-qv="v4"] .quiz-opt[data-correct="true"] { background: #dcf5e5; box-shadow: none; }
  .pn-sheet-content .edu-mcq[data-qv="v4"] .quiz-opt-num { background: transparent; color: #0070f3; font-weight: 800; }
  .pn-sheet-content .edu-mcq[data-qv="v4"] .quiz-opt[data-correct="true"] .quiz-opt-num { background: #16a34a; color: #fff; }
  .pn-sheet-content .edu-truefalse[data-qv="v4"] .quiz-tf-btn { box-shadow: none; background: #f4f4f5; }
  .pn-sheet-content .edu-truefalse[data-qv="v4"] .quiz-tf-row[data-answer="true"] .quiz-tf-true,
  .pn-sheet-content .edu-truefalse[data-qv="v4"] .quiz-tf-row[data-answer="false"] .quiz-tf-false { background: #dcf5e5; color: #15803d; font-weight: 700; }

  /* ── v5 «تیتر خط‌دار» — accent rule under title, square chips ── */
  .pn-sheet-content .edu-mcq[data-qv="v5"] .edu-title,
  .pn-sheet-content .edu-truefalse[data-qv="v5"] .edu-title,
  .pn-sheet-content .edu-longanswer[data-qv="v5"] .edu-title,
  .pn-sheet-content .edu-question[data-qv="v5"] .edu-title {
    border-bottom: 2px solid #0070f3; padding-bottom: 6px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pn-sheet-content .edu-mcq[data-qv="v5"] .quiz-opt-num { border-radius: 4px; background: #0070f3; color: #fff; }
  .pn-sheet-content .edu-mcq[data-qv="v5"] .quiz-opt[data-correct="true"] .quiz-opt-num { background: #16a34a; }
  .pn-sheet-content .edu-mcq[data-qv="v5"] .quiz-opt[data-correct="true"] { box-shadow: inset 0 0 0 2px #16a34a; }

  /* ── v6 «کپسولی» — pill rows ── */
  .pn-sheet-content .edu-mcq[data-qv="v6"] .quiz-opt { border-radius: 999px; padding: 6px 14px; }
  .pn-sheet-content .edu-mcq[data-qv="v6"] .quiz-opts-grid .quiz-opt { padding: 6px 14px; }
  .pn-sheet-content .edu-mcq[data-qv="v6"] .quiz-opt-num { box-shadow: inset 0 0 0 1.5px #0070f3; background: transparent; color: #0070f3; }
  .pn-sheet-content .edu-mcq[data-qv="v6"] .quiz-opt[data-correct="true"] .quiz-opt-num { background: #16a34a; box-shadow: none; color: #fff; }
  .pn-sheet-content .edu-truefalse[data-qv="v6"] .quiz-tf-btn { border-radius: 999px; padding: 6px 26px; }

  /* ── v7 «کنتراست» — dark plate (kept exact in print like the editor) ── */
  .pn-sheet-content .edu-mcq[data-qv="v7"],
  .pn-sheet-content .edu-truefalse[data-qv="v7"],
  .pn-sheet-content .edu-longanswer[data-qv="v7"],
  .pn-sheet-content .edu-question[data-qv="v7"] {
    background: #101a2e; color: #e5edf8; border-radius: 14px; padding: 14px 16px 10px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pn-sheet-content .edu-mcq[data-qv="v7"] .quiz-opt { background: rgba(255, 255, 255, 0.055); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); color: #e5edf8; }
  .pn-sheet-content .edu-mcq[data-qv="v7"] .quiz-opt-num { background: #3291ff; color: #fff; }
  .pn-sheet-content .edu-mcq[data-qv="v7"] .quiz-opt[data-correct="true"] { background: rgba(34, 197, 94, 0.16); box-shadow: inset 0 0 0 1.5px #22c55e; }
  .pn-sheet-content .edu-mcq[data-qv="v7"] .quiz-opt[data-correct="true"] .quiz-opt-num { background: #22c55e; color: #06280f; }
  .pn-sheet-content .edu-truefalse[data-qv="v7"] .quiz-tf-btn { background: rgba(255, 255, 255, 0.055); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1); color: #e5edf8; }
  .pn-sheet-content .edu-truefalse[data-qv="v7"] .quiz-tf-row[data-answer="true"] .quiz-tf-true,
  .pn-sheet-content .edu-truefalse[data-qv="v7"] .quiz-tf-row[data-answer="false"] .quiz-tf-false { background: rgba(34, 197, 94, 0.2); box-shadow: inset 0 0 0 1.5px #22c55e; color: #86efac; }

  /* ── v8 «کلاسیک» — accent bar on the RTL edge of each option ── */
  .pn-sheet-content .edu-mcq[data-qv="v8"] .quiz-opt {
    border-right: 3px solid rgba(0, 112, 243, 0.4); border-radius: 6px;
    background: transparent; box-shadow: none; padding-right: 10px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pn-sheet-content .edu-mcq[data-qv="v8"] .quiz-opt-num { background: transparent; color: #0070f3; font-weight: 800; }
  .pn-sheet-content .edu-mcq[data-qv="v8"] .quiz-opt[data-correct="true"] { background: rgba(22, 163, 74, 0.07); border-right-color: #16a34a; }
  .pn-sheet-content .edu-mcq[data-qv="v8"] .quiz-opt[data-correct="true"] .quiz-opt-num { background: transparent; color: #16a34a; }
  .pn-sheet-content .edu-truefalse[data-qv="v8"] .quiz-tf-btn { border-right: 3px solid rgba(0, 112, 243, 0.4); border-radius: 6px; }

  /* ── v9 «سری‌دار» — colored side rule + filled square chips ── */
  .pn-sheet-content .edu-mcq[data-qv="v9"],
  .pn-sheet-content .edu-truefalse[data-qv="v9"],
  .pn-sheet-content .edu-longanswer[data-qv="v9"],
  .pn-sheet-content .edu-question[data-qv="v9"] {
    border-radius: 6px; border-right-width: 3px; border-right-color: var(--q-accent, #0070f3);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pn-sheet-content .edu-mcq[data-qv="v9"] .quiz-opt { background: #f2f7fd; border-radius: 4px; box-shadow: none; }
  .pn-sheet-content .edu-mcq[data-qv="v9"] .quiz-opt[data-correct="true"] { background: #dcf5e5; box-shadow: inset 0 0 0 1.5px #16a34a; }
  .pn-sheet-content .edu-mcq[data-qv="v9"] .quiz-opt-num { background: var(--q-accent, #0070f3); color: #fff; border-radius: 4px; }
  .pn-sheet-content .edu-mcq[data-qv="v9"] .quiz-opt[data-correct="true"] .quiz-opt-num { background: #16a34a; }

  /* ── v10 «شیشه‌ای ملایم» — accent-tinted wash ── */
  .pn-sheet-content .edu-mcq[data-qv="v10"],
  .pn-sheet-content .edu-truefalse[data-qv="v10"],
  .pn-sheet-content .edu-longanswer[data-qv="v10"],
  .pn-sheet-content .edu-question[data-qv="v10"] {
    background: color-mix(in srgb, var(--q-accent, #0070f3) 6%, white);
    border-radius: 12px; box-shadow: none;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pn-sheet-content .edu-mcq[data-qv="v10"] .quiz-opt { background: transparent; box-shadow: inset 0 0 0 1px #d4d4d8; border-radius: 8px; }
  .pn-sheet-content .edu-mcq[data-qv="v10"] .quiz-opt[data-correct="true"] { box-shadow: inset 0 0 0 2px #16a34a; background: #f2fbf5; }
  .pn-sheet-content .edu-mcq[data-qv="v10"] .quiz-opt-num { background: transparent; color: var(--q-accent, #0070f3); font-weight: 800; }
  .pn-sheet-content .edu-mcq[data-qv="v10"] .quiz-opt[data-correct="true"] .quiz-opt-num { color: #16a34a; }

  /* ── v11 «دفتر امتحان» — dotted leaders ── */
  .pn-sheet-content .edu-mcq[data-qv="v11"] .quiz-opt { background: transparent; box-shadow: none; border-radius: 0; padding: 5px 2px; border-bottom: 1px dotted #a1a1aa; }
  .pn-sheet-content .edu-mcq[data-qv="v11"] .quiz-opts-grid .quiz-opt { border-bottom: none; box-shadow: inset 0 0 0 1px #d4d4d8; border-radius: 6px; }
  .pn-sheet-content .edu-mcq[data-qv="v11"] .quiz-opt-num { background: transparent; color: #171717; font-weight: 700; }
  .pn-sheet-content .edu-mcq[data-qv="v11"] .quiz-opt[data-correct="true"] { background: #f2fbf5; box-shadow: none; border-bottom-color: #16a34a; }
  .pn-sheet-content .edu-truefalse[data-qv="v11"] .quiz-tf-btn { background: transparent; box-shadow: inset 0 0 0 1px #d4d4d8; }

  /* ── v12 «چاپخانه» — heavy top rule, square mono chips ── */
  .pn-sheet-content .edu-mcq[data-qv="v12"],
  .pn-sheet-content .edu-truefalse[data-qv="v12"],
  .pn-sheet-content .edu-longanswer[data-qv="v12"],
  .pn-sheet-content .edu-question[data-qv="v12"] {
    border-top: 3px solid var(--q-accent, #171717); border-radius: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pn-sheet-content .edu-mcq[data-qv="v12"] .quiz-opt { background: transparent; box-shadow: none; border-radius: 0; padding: 4px 6px; }
  .pn-sheet-content .edu-mcq[data-qv="v12"] .quiz-opt-num { background: transparent; color: var(--q-accent, #171717); font-weight: 800; border-radius: 2px; }
  .pn-sheet-content .edu-mcq[data-qv="v12"] .quiz-opt[data-correct="true"] { background: #f2fbf5; box-shadow: inset 0 0 0 1.5px rgba(22, 163, 74, 0.5); }
  .pn-sheet-content .edu-mcq[data-qv="v12"] .quiz-opt[data-correct="true"] .quiz-opt-num { color: #16a34a; }

  /* ── per-block tuning mirrors (chip shape / spacing) ── */
  .pn-sheet-content .edu-mcq[data-chip="square"] .quiz-opt-num,
  .pn-sheet-content .edu-truefalse[data-chip="square"] .quiz-tf-btn { border-radius: 4px; }
  .pn-sheet-content .edu-mcq[data-chip="none"] .quiz-opt-num { background: transparent; box-shadow: inset 0 0 0 1.5px #a1a1aa; color: #171717; }
  .pn-sheet-content .edu-mcq[data-gap="tight"] .quiz-opt { margin-bottom: 2px; padding-top: 3px; padding-bottom: 3px; }
  .pn-sheet-content .edu-mcq[data-gap="wide"] .quiz-opt { margin-bottom: 12px; }
  .pn-sheet-content .edu-mcq[data-gap="tight"] .quiz-opts-grid { gap: 2px 6px; }
  .pn-sheet-content .edu-mcq[data-gap="wide"] .quiz-opts-grid { gap: 12px 6px; }

  /* end answer line (answerAt='end') — printed like the editor's chip */
  .pn-sheet-content .quiz-end-answer {
    margin-top: 6px;
    padding: 4px 10px;
    font-size: 0.82em;
    font-weight: 600;
    color: #16a34a;
    background: rgba(22, 163, 74, 0.07);
    border-radius: 6px;
    width: fit-content;
    max-width: 100%;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* ruled answer sheet (تشریحی v2/v3) — same line rhythm as the editor */
  .pn-sheet-content .edu-longanswer[data-qv="v2"] .edu-body > p,
  .pn-sheet-content .edu-longanswer[data-qv="v3"] .edu-body > p {
    background-image: repeating-linear-gradient(transparent 0, transparent 27px, #d4d4d8 27px, #d4d4d8 28px);
    line-height: 28px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pn-sheet-content .quiz-tf-row { display: flex; gap: 8px; margin: 2px 0 8px; }
  .pn-sheet-content .quiz-tf-btn {
    flex: none; min-width: 88px;
    border: 1px solid #d4d4d8; border-radius: 8px; background: transparent;
    font-family: inherit; font-size: 0.85em; font-weight: 600;
    padding: 5px 16px; color: #64748b; text-align: center;
  }
  .pn-sheet-content .quiz-tf-row[data-answer="true"] .quiz-tf-true {
    background: rgba(22, 163, 74, 0.14); border-color: #16a34a; color: #15803d;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pn-sheet-content .quiz-tf-row[data-answer="false"] .quiz-tf-false {
    background: rgba(220, 38, 38, 0.12); border-color: #dc2626; color: #b91c1c;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pn-sheet-content .edu-timeline .edu-title { color: #0070f3; box-shadow: inset 0 -1px 0 0 rgba(0,112,243,0.1); padding-bottom: 6px; margin-bottom: 8px; }
  .pn-sheet-content .timeline-item { display: flex; gap: 12px; padding: 6px 4px; box-shadow: inset 3px 0 0 0 #0070f3; margin-left: 8px; padding-left: 12px; }
  .pn-sheet-content .timeline-item + .timeline-item { margin-top: 2px; }
  .pn-sheet-content .cmp-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: rgba(121,40,202,0.06); border-radius: 8px 8px 0 0; }
  .pn-sheet-content .cmp-label { flex: 1; font-weight: 600; font-size: 0.88em; color: #7928ca; }
  .pn-sheet-content .cmp-vs { color: #7928ca; font-weight: 600; letter-spacing: 0.02em; font-size: 0.82em; }
  .pn-sheet-content .cmp-body { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .pn-sheet-content .cmp-body td { border: 1px solid rgba(0,0,0,0.06); padding: 8px 10px; font-size: 0.9em; vertical-align: top; }
  .pn-sheet-content .cmp-row-label { font-weight: 600; color: #666; background: rgba(0,0,0,0.02); width: 35%; }
  .pn-sheet-content .cmp-row-cell { color: #333; }
  .pn-sheet-content .cmp-body-pm { min-height: 1em; }
  .pn-sheet-content .edu-term-input, .pn-sheet-content .edu-input { background: transparent; border: none; border-bottom: 1px dashed rgba(0,0,0,0.15); font-weight: 600; width: 100%; font-family: inherit; color: inherit; }
  .pn-sheet-content .edu-block .katex-display { margin: 0.3em 0; }
  .pn-sheet-content .edu-katex-src, .pn-sheet-content .edu-latex-src { direction: ltr; }

  /* ── equations (KaTeX export markup) — index.css .mq-export-* 1:1 ──
     The print document is dir="rtl" and KaTeX's own CSS does NOT set a
     direction, so without these rules display equations lose their
     centering and BOTH display and inline math are laid out with RTL
     bidi — the exact divergence from the editor, whose equation nodes
     carry dir="ltr". unicode-bidi:isolate gives the span the same
     embedding the editor's dir attribute provides. */
  .pn-sheet-content .katex { direction: ltr; unicode-bidi: isolate; }
  .pn-sheet-content .mq-export-display { text-align: center; margin: 0.6em 0; direction: ltr; break-inside: avoid; }
  .pn-sheet-content .mq-export-align-left { text-align: left; }
  .pn-sheet-content .mq-export-align-right { text-align: right; }
  .pn-sheet-content .mq-export-display .katex-display { margin: 0; }
  .pn-sheet-content .mq-export-no { display: inline-block; margin-left: 2.5em; opacity: 0.85; }

  /* ── کادرهای آموزشی customization ──
     The user's saved eduBlocks object generates the same scoped rules the
     editor injects (scoped here to .pn-sheet-content). A legacyeduBlocks
     string or missing object falls back to the shipped eduTinted flag. */
  ${eduCssForPrint(options)}
  ${!resolveEduBlocks(options.eduBlocks) && options.eduTinted ? TINTED_CSS : ''}

  /* legacy in-content page-break markers never belong on an exported sheet */
  .pn-sheet-content .pn-page-break { display: none !important; }

  @media print {
    body { background: #fff; }
    .pn-page {
      width: 210mm;
      height: 297mm;
      margin: 0;
      box-shadow: none;
    }
  }
`;
}
