import { Node } from '@tiptap/core';

/**
 * Doc — the top-level document node with a persisted `pageKind` attribute.
 *
 * The FIRST page's visual kind (قاب‌دار/بلنک/نوت‌بوکی) is stored on the doc
 * node itself (EditorPage.mergePagesIntoDoc); every following page's kind
 * rides on the pageBreak node before it. Without this extension the stock
 * `doc` node declares no attributes, so TipTap's schema silently DROPPED
 * `attrs.pageKind` on load — a note whose first sheet was بلنک/نوت‌بوکی
 * reopened as قاب‌دار after save → reload.
 *
 * Registered by replacing StarterKit's stock Document:
 *   StarterKit.configure({ document: false }) + PagedDoc
 */
export const PagedDoc = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block+',

  addAttributes() {
    return {
      pageKind: {
        default: null,
        /** the doc node is never rendered as HTML — keep the round-trip
            JSON-only; renderHTML/parseHTML stay no-ops */
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-pn-doc]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-pn-doc': '', ...HTMLAttributes }, 0];
  },
});
