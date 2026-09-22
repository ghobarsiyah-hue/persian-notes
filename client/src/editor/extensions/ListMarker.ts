import { Extension } from '@tiptap/core';

/* ══════════════════════════════════════════════════════════════════════════
   ListMarker — per-list marker glyph control.

   The ribbon's «فهرست» menu creates bullet/ordered lists with stock
   markers. This extension adds ONE persisted attribute, `marker`, on the
   list node itself (bulletList / orderedList) so the user can LATER:

     • change the glyph  — dot variants for bullets (● ○ ▪ ◆ ─ — none),
                           number styles for ordered lists (۱. ۱) ۱ (۱) ۱-
                           (decimal / arabic-indic / alpha / paren …),
     • remove it         — 'none': numbered/bulleted lines keep their
                           indentation but show no marker.

   HOW THE MARKER RENDERS:
   `marker` maps to a CSS token in the data-marker attribute the extension
   emits on <ul>/<ol>; the actual glyph painting lives in CSS counters
   (index.css + printCss 1:1 — the SAME tokens in the editor and PDF), so a
   chosen style survives save/load, print and Word export.

   Values shared with ListMarkerMenu (ribbonCommands) and printCss:
   ── bullets (ul) ──  disc | circle | square | diamond | dash | none
   ── numbers (ol) ──  decimal | fa | paren | alpha | roman | none
   The default '' means «stock look»: ul → disc, ol → decimal.
   ══════════════════════════════════════════════════════════════════════════ */

/** every marker token the UI may store (extend both places together) */
export const UL_MARKERS = ['disc', 'circle', 'square', 'diamond', 'dash', 'none'] as const;
export const OL_MARKERS = ['decimal', 'fa', 'paren', 'alpha', 'roman', 'none'] as const;
export type UlMarker = (typeof UL_MARKERS)[number] | '';
export type OlMarker = (typeof OL_MARKERS)[number] | '';

export const ListMarker = Extension.create({
  name: 'listMarker',

  addGlobalAttributes() {
    return [
      {
        types: ['bulletList', 'orderedList'],
        attributes: {
          marker: {
            default: '',
            parseHTML: (element) => {
              const v = element.getAttribute('data-marker');
              return typeof v === 'string' ? v : '';
            },
            renderHTML: (attributes) => {
              const v = attributes.marker;
              return v ? { 'data-marker': v } : {};
            },
          },
        },
      },
    ];
  },
});
