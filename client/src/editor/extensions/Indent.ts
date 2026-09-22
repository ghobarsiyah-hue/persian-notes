import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      /** set the paragraph/heading indent level (0–4) for the whole selection */
      setIndent: (level: number) => ReturnType;
    };
  }
}

const STEP = 24; // px per indent level
const MAX_LEVEL = 4;

/**
 * Real paragraph indentation (margin-inline-start per level) — RTL-aware.
 * Used by the Ribbon's چیدمان tab; applies to every paragraph/heading in
 * the selection. Works everywhere, unlike sinkListItem/liftListItem which
 * only function inside lists.
 */
export const Indent = Extension.create({
  name: 'indent',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => {
              const v = parseInt((el as HTMLElement).style.marginInlineStart || '0', 10) / STEP;
              return Number.isFinite(v) && v > 0 ? Math.min(MAX_LEVEL, Math.round(v)) : 0;
            },
            renderHTML: (attrs) => {
              const level = Math.min(MAX_LEVEL, Math.max(0, Number(attrs.indent) || 0));
              return level > 0 ? { style: `margin-inline-start: ${level * STEP}px` } : {};
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setIndent:
        (level) =>
        ({ state, dispatch }) => {
          const clamped = Math.min(MAX_LEVEL, Math.max(0, level));
          const { from, to } = state.selection;
          const tr = state.tr;
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === 'paragraph' || node.type.name === 'heading') {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: clamped });
              changed = true;
              return false; // don't descend into text blocks
            }
            return true;
          });
          if (!changed) return false;
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});
