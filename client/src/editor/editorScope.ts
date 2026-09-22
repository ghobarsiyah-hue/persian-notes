import type { Editor } from '@tiptap/core';
import type { AIScope } from '@/components/editor/RightPanel';

export interface ScopeText {
  text: string;
  /** range to replace when the user applies a suggestion in "replace" mode */
  range?: { from: number; to: number };
}

export function getScopeText(editor: Editor | null, scope: AIScope): ScopeText {
  if (!editor) return { text: '' };
  const state = editor.view.state;
  const { $from, $to, empty } = state.selection;

  if (scope === 'selection') {
    const text = state.doc.textBetween($from.pos, $to.pos, '\n');
    return empty ? { text: '' } : { text, range: { from: $from.pos, to: $to.pos } };
  }

  if (scope === 'paragraph') {
    const from = $from.before(1);
    const to = $from.after(1);
    return { text: state.doc.textBetween(from, to, '\n'), range: { from, to } };
  }

  if (scope === 'section') {
    // section = from the previous top-level heading (inclusive) to just before the next one
    let sectionFrom = 0;
    let sectionTo = state.doc.content.size;
    const headings: Array<{ pos: number; size: number }> = [];
    state.doc.forEach((node, pos) => {
      if (node.type.name === 'heading') headings.push({ pos, size: node.nodeSize });
    });
    for (const hd of headings) {
      if (hd.pos <= $from.pos) sectionFrom = hd.pos;
      else {
        sectionTo = hd.pos;
        break;
      }
    }
    return { text: state.doc.textBetween(sectionFrom, sectionTo, '\n'), range: { from: sectionFrom, to: sectionTo } };
  }

  // whole document
  return { text: state.doc.textBetween(0, state.doc.content.size, '\n') };
}
