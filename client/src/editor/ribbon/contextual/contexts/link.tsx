import type {
  ContextProvider, ObjectCapabilities,
  ContextualTab, ContextualGroup, ContextualAction,
} from '../types';
import { h4 } from '../icons';
import {
  Link as LinkIcon, ExternalLink, PenLine, Link2Off,
} from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   Link context — link mark selected/inside → لینک tab. The probe only emits
   a `link` object when editor.isActive('link') is true, so these commands
   operate on the live link mark by construction.
   ══════════════════════════════════════════════════════════════════════════ */

export const LINK_CONTEXT_ID = 'context.link';

interface LinkAttrs extends Record<string, unknown> {
  editor: import('@tiptap/core').Editor;
  href: string | null;
  target: string | null;
}

function capabilities(): ObjectCapabilities {
  return { canEditText: true, 'link:open': true, 'link:edit': true };
}

function groups(a: LinkAttrs): ContextualGroup[] {
  const ed = a.editor;
  const ch = () => ed.chain().focus();
  const act = (key: string, title: string, icon: React.ReactNode, run: () => void, label?: string, active?: boolean): ContextualAction =>
    ({ key, title, icon, run, label, active });

  const edit = () => {
    const next = window.prompt('آدرس لینک (خالی = حذف):', a.href ?? '');
    if (next === null) return;
    if (next === '') { ch().extendMarkRange('link').unsetLink().run(); return; }
    ch().extendMarkRange('link').setLink({ href: next }).run();
  };

  return [
    {
      key: 'link.tools',
      label: 'لینک',
      tools: [
        act('link.open', 'باز کردن پیوند', h4(ExternalLink), () => {
          if (a.href) window.open(a.href, '_blank', 'noopener,noreferrer');
        }, a.href ? undefined : 'بدون آدرس', undefined),
        act('link.edit', 'ویرایش آدرس لینک', h4(PenLine), edit, 'ویرایش'),
        act('link.copy', 'کپی آدرس لینک', undefined, () => {
          if (a.href) void navigator.clipboard.writeText(a.href);
        }, 'کپی آدرس'),
        { separator: true, key: 's1' },
        act('link.remove', 'حذف لینک (حفظ متن)', h4(Link2Off), () => ch().extendMarkRange('link').unsetLink().run(), 'حذف لینک'),
      ],
    },
  ];
}

function tabs(a: LinkAttrs): ContextualTab[] {
  return [
    {
      id: 'context-link',
      label: 'لینک',
      icon: h4(LinkIcon),
      priority: 6,
      groups: groups(a),
    },
  ];
}

export const linkProvider: ContextProvider = {
  id: LINK_CONTEXT_ID,
  matches: (o) => o.source === 'document' && o.type === 'link',
  label: 'لینک',
  capabilities: () => capabilities(),
  tabs: (o) => tabs(o.attrs as unknown as LinkAttrs),
};
