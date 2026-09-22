import type {
  ContextProvider, ObjectCapabilities,
  ContextualTab, ContextualGroup, ContextualAction,
} from '../types';
import { h4 } from '../icons';
import { Quote, Code } from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   Text context — paragraph/heading/text selections. Per the architecture
   rule "not every object needs a new tab": text formatting lives in خانه
   already, so this provider contributes NO tab — it only contributes
   capabilities (the multi-select intersection uses them) and, when the
   selection sits inside a blockquote/code block, merges its block toggles
   into the standard home tab via `mergesWith: 'home'`.
   ══════════════════════════════════════════════════════════════════════════ */

export const TEXT_CONTEXT_ID = 'context.text';

interface TextAttrs extends Record<string, unknown> {
  editor: import('@tiptap/core').Editor;
}

function capabilities(): ObjectCapabilities {
  return {
    canEditText: true,
    canChangeFont: true,
    canChangeColor: true,
    canChangeSpacing: true,
    canChangeLayout: true,
  };
}

function groups(a: TextAttrs): ContextualGroup[] {
  const ed = a.editor;
  const ch = () => ed.chain().focus();
  const act = (key: string, title: string, icon: React.ReactNode, run: () => void, label?: string, active?: boolean): ContextualAction =>
    ({ key, title, icon, run, label, active });

  return [
    {
      key: 'text.blocks',
      tools: [
        act('text.quote', 'نقل‌قول', h4(Quote), () => ch().toggleBlockquote().run(), undefined, ed.isActive('blockquote')),
        act('text.code', 'بلوک کد', h4(Code), () => ch().toggleCodeBlock().run(), undefined, ed.isActive('codeBlock')),
      ],
    },
  ];
}

function tabs(a: TextAttrs): ContextualTab[] {
  /* only when the text sits inside a blockquote/code block do we surface
     the toggle tools — merged INTO خانه, not as a new tab */
  const inQuoteOrCode = a.editor.isActive('blockquote') || a.editor.isActive('codeBlock');
  if (!inQuoteOrCode) return [];
  return [
    {
      id: 'context-text',
      label: 'متن',
      priority: 20,
      mergesWith: 'home',
      groups: groups(a),
    },
  ];
}

export const textProvider: ContextProvider = {
  id: TEXT_CONTEXT_ID,
  matches: (o) => o.source === 'document' && (o.type === 'paragraph' || o.type === 'heading' || o.type === 'text'),
  label: 'متن',
  capabilities: () => capabilities(),
  tabs: (o) => tabs(o.attrs as unknown as TextAttrs),
};
