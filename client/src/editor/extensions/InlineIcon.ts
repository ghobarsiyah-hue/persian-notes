import { Node, mergeAttributes } from '@tiptap/core';

/**
 * InlineIcon — small decorative icon (emoji artwork / famous-app brand logo)
 * inserted from the icon picker. Unlike the block-level `image` node, this
 * one flows with the text like a character, so it can sit inside a sentence.
 *
 * The SVG travels as a self-contained data URI: saved documents, printing,
 * and the HTML export all keep the exact same crisp vector artwork without
 * depending on the system emoji font.
 */
export const InlineIcon = Node.create({
  name: 'inlineIcon',

  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
    };
  },

  parseHTML() {
    /* attribute-qualified selector keeps it distinct from the `image` node */
    return [{ tag: 'img[data-inline-icon]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-inline-icon': '',
        class: 'pn-inline-icon',
        draggable: false,
      }),
    ];
  },
});
