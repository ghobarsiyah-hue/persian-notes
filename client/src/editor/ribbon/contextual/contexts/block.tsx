import type {
  ContextProvider, ObjectCapabilities,
  ContextualTab, ContextualGroup, ContextualAction,
} from '../types';
import { h4 } from '../icons';
import { Copy, Trash2, Quote, Code } from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   Block context — generic container blocks (blockquote, codeBlock) that
   have no dedicated provider. The کادرهای آموزشی family has its own
   dedicated tab in eduBlock.tsx (تغییر نوع، نمره، تکثیر، حذف).
   ══════════════════════════════════════════════════════════════════════════ */

export const BLOCK_CONTEXT_ID = 'context.block';

/** block types that expose their own object tools — edu blocks live in
 *  eduBlock.tsx now (dedicated tab); generic blocks stay here */
const BLOCK_TYPES = new Set([
  'comparisonTable', 'timeline', 'highlightBox',
  'referenceBlock', 'proConBlock', 'codeOutputBlock', 'blockquote', 'codeBlock',
]);

interface BlockAttrs extends Record<string, unknown> {
  editor: import('@tiptap/core').Editor;
}

function capabilities(): ObjectCapabilities {
  return {
    canDelete: true,
    canDuplicate: true,
    canEditText: true,
    canChangeLayout: true,
  };
}

function groups(a: BlockAttrs): ContextualGroup[] {
  const ed = a.editor;
  const ch = () => ed.chain().focus();
  const act = (key: string, title: string, icon: React.ReactNode, run: () => void, label?: string, active?: boolean): ContextualAction =>
    ({ key, title, icon, run, label, active });

  return [
    {
      key: 'block.tools',
      label: 'بلوک',
      tools: [
        act('block.duplicate', 'تکثیر بلوک', h4(Copy), () => {
          const { from, to } = ed.state.selection;
          const range = Math.max(1, to - from);
          const slice = ed.state.doc.slice(from, to);
          ch().insertContentAt(from + range, slice.toJSON() as never).run();
        }, 'تکثیر'),
        act('block.delete', 'حذف کل بلوک', h4(Trash2), () => ch().deleteSelection().run(), 'حذف'),
        { separator: true, key: 's1' },
        act('block.quote', 'نقل‌قول', h4(Quote), () => ch().toggleBlockquote().run(), undefined, ed.isActive('blockquote')),
        act('block.code', 'بلوک کد', h4(Code), () => ch().toggleCodeBlock().run(), undefined, ed.isActive('codeBlock')),
      ],
    },
  ];
}

function tabs(a: BlockAttrs): ContextualTab[] {
  return [
    {
      id: 'context-block',
      label: 'ابزار بلوک',
      priority: 7,
      groups: groups(a),
    },
  ];
}

export const blockProvider: ContextProvider = {
  id: BLOCK_CONTEXT_ID,
  matches: (o) => o.source === 'document' && BLOCK_TYPES.has(o.type),
  label: 'بلوک',
  capabilities: () => capabilities(),
  tabs: (o) => tabs(o.attrs as unknown as BlockAttrs),
};
