import { Node, mergeAttributes } from '@tiptap/core';

/** TipTap command typing for setPageBreak — the addCommands block below is
 *  typed loosely (`as any`), so without this augmentation TS rejects
 *  `editor.chain().setPageBreak()` at every call site. */
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      setPageBreak: () => ReturnType;
    };
  }
}

/**
 * PageBreak — A4 page separator node.
 *
 * This is an atomic (non-editable) block node that marks where one page
 * ends and another begins. It renders as a visual gap between pages
 * with proper A4 proportions.
 *
 * The visual layout is handled purely by CSS:
 *   - Each page section (content before a pageBreak) gets min-height: A4
 *   - The pageBreak node itself renders as a gap between pages
 *   - No DOM manipulation needed — ProseMirror handles the content flow
 */
export const PageBreak = Node.create({
  name: 'pageBreak',

  group: 'block',

  // Atomic = non-editable, cursor skips over it
  atom: true,

  // Can't be nested inside other blocks
  defining: false,

  // Must be alone in its parent (no inline content around it)
  content: '',

  /* Storage format: every page's VISUAL kind (قاب‌دار/بلنک/نوت‌بوکی) and the
     pagination engine's auto flag ride on the pageBreak node that OPENS the
     page (EditorPage.mergePagesIntoDoc). Without declared attrs, TipTap's
     schema strips them on load — pages reopened as the wrong kind and
     auto-created sheets became "manual" (never auto-removed). */
  addAttributes() {
    return {
      kind: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-kind'),
        renderHTML: (attrs) => (attrs.kind ? { 'data-kind': attrs.kind as string } : {}),
      },
      auto: {
        default: null,
        parseHTML: (el) => (el.getAttribute('data-auto') === 'true' ? true : null),
        renderHTML: (attrs) => (attrs.auto === true ? { 'data-auto': 'true' } : {}),
      },
      /* the STABLE page id — collab fragments are addressed by it; without
         this declaration the schema stripped pid on load and every reload
         re-randomized page identities */
      pid: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-pid'),
        renderHTML: (attrs) => (attrs.pid ? { 'data-pid': attrs.pid as string } : {}),
      },
      /* item 15: cover metadata (slot/src/fit/title) — a JSON payload that
         must survive save → load through the schema, same as pid/kind */
      cover: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute('data-cover');
          if (!raw) return null;
          try { return JSON.parse(raw); } catch { return null; }
        },
        renderHTML: (attrs) => (attrs.cover ? { 'data-cover': JSON.stringify(attrs.cover) } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="page-break"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'page-break',
        class: 'pn-page-break',
      }),
      ['div', { class: 'pn-page-break-label' }, '— صفحه جدید —'],
    ];
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ commands }: { commands: any }) => {
          return commands.insertContent({ type: this.name });
        },
    } as any;
  },

  addKeyboardShortcuts() {
    return {};
  },
});
