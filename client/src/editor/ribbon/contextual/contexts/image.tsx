import type {
  ContextProvider, ObjectCapabilities,
  ContextualTab, ContextualGroup, ContextualAction, ContextualTool, ContextualDropdown,
} from '../types';
import { h4 } from '../icons';
import {
  AlignCenter, AlignRight, AlignLeft, TextCursorInput,
  FileDown, Trash2, Minus, Plus, RotateCcw, Image as ImageIcon, Check,
} from 'lucide-react';
import type { Editor } from '@tiptap/core';
import { faDigits } from '@/utils/fa';

/* ══════════════════════════════════════════════════════════════════════════
   Image context — the "Picture Format" tab. Registration, not architecture:
   it only matches `image` nodes and contributes one contextual tab whose
   commands run TipTap commands against the LIVE selection.

   UI: three quiet groups (اندازه / چیدمان / تصویر). The size control is ONE
   dropdown in the app's standard list-panel style (edu-kind-picker pattern):
   four preset rows with a live width bar each, then a fine-tune footer.
   ══════════════════════════════════════════════════════════════════════════ */

export const IMAGE_CONTEXT_ID = 'context.image';

interface ImageAttrs extends Record<string, unknown> {
  editor: Editor;
  width: string | null;
  align: string | null;
  alt: string | null;
  src: string | null;
}

const IMG_W_PCT = (a: ImageAttrs) => {
  const raw = a.width ? parseInt(a.width, 10) : NaN;
  return Number.isFinite(raw) ? Math.min(100, Math.max(10, raw)) : 50;
};

/** width visualization bar (RTL: grows from the right) */
const widthBar = (pct: number): React.ReactNode => (
  <span aria-hidden="true" className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-700">
    <span className="block h-full rounded-full bg-ink-400 dark:bg-ink-400" style={{ width: `${pct}%`, marginInlineStart: 'auto' }} />
  </span>
);

function groups(a: ImageAttrs): ContextualGroup[] {
  const ed = a.editor;
  const ch = () => ed.chain().focus();
  const width = a.width;
  const pct = IMG_W_PCT(a);
  const align = a.align;
  const act = (key: string, title: string, icon: React.ReactNode, run: () => void, label?: string, active?: boolean): ContextualAction =>
    ({ key, title, icon, label, run, active });

  const setSize = (p: number | null) => ch().updateAttributes('image', { width: p == null ? null : `${p}%` }).run();

  /* «اندازه» — presets list + fine-tune footer, closes on preset pick */
  const sizePicker: ContextualDropdown = {
    key: 'image.size.picker',
    title: 'اندازه تصویر',
    label: faDigits(pct) + '٪',
    icon: h4(ImageIcon),
    dropdown: {
      width: 232,
      render: (close) => (
        <div className="p-1">
          {[25, 50, 75, 100].map((p) => {
            const active = width === `${p}%` || (p === 50 && !width);
            return (
              <button
                key={p}
                type="button"
                onClick={() => { setSize(p); close(); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] transition-colors ${
                  active
                    ? 'bg-accent-50 font-bold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
                    : 'font-medium text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800'
                }`}
              >
                <span className="w-9 shrink-0 tabular-nums">{faDigits(p)}٪</span>
                {widthBar(p)}
                {active && <Check className="ms-auto h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              </button>
            );
          })}
          <div className="mt-1 flex items-center gap-1 border-t border-ink-100 px-1 pt-1.5 dark:border-ink-800">
            <button
              type="button"
              title="کوچک‌تر (−۱۰٪)"
              aria-label="کوچک‌تر (−۱۰٪)"
              onClick={() => setSize(Math.max(10, pct - 10))}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-200"
            >
              <Minus size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              title="بزرگ‌تر (+۱۰٪)"
              aria-label="بزرگ‌تر (+۱۰٪)"
              onClick={() => setSize(Math.min(100, pct + 10))}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-200"
            >
              <Plus size={13} aria-hidden="true" />
            </button>
            <span className="mx-auto text-[11px] font-bold tabular-nums text-ink-500 dark:text-ink-400">
              {faDigits(pct)}٪
            </span>
            <button
              type="button"
              title="بازگشت به اندازه اصلی (۵۰٪)"
              aria-label="بازگشت به اندازه اصلی"
              onClick={() => setSize(null)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-200"
            >
              <RotateCcw size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
      ),
    },
  };

  return [
    { key: 'image.size', label: 'اندازه', tools: [sizePicker] },
    {
      key: 'image.align',
      label: 'چیدمان',
      tools: [
        act('image.align.c', 'وسط صفحه', h4(AlignCenter), () => ch().updateAttributes('image', { align: 'center' }).run(), 'وسط', !align || align === 'center'),
        act('image.align.r', 'سمت راست', h4(AlignRight), () => ch().updateAttributes('image', { align: 'right' }).run(), 'راست', align === 'right'),
        act('image.align.l', 'سمت چپ', h4(AlignLeft), () => ch().updateAttributes('image', { align: 'left' }).run(), 'چپ', align === 'left'),
      ],
    },
    {
      key: 'image.tools',
      label: 'تصویر',
      tools: [
        act('image.alt', 'متن جایگزین تصویر (alt)', h4(TextCursorInput), () => {
          const next = window.prompt('متن جایگزین تصویر:', a.alt ?? '');
          if (next === null) return;
          ch().updateAttributes('image', { alt: next, title: next }).run();
        }, 'alt'),
        act('image.download', 'دانلود تصویر', h4(FileDown), () => {
          if (!a.src) return;
          const link = document.createElement('a');
          link.href = a.src;
          link.download = a.alt || 'image';
          link.click();
        }, 'دانلود'),
        act('image.delete', 'حذف تصویر', h4(Trash2), () => ch().deleteSelection().run(), 'حذف'),
      ],
    },
  ];
}

function tabs(a: ImageAttrs): ContextualTab[] {
  return [
    {
      id: 'context-image',
      label: 'قالب‌بندی تصویر',
      icon: h4(ImageIcon),
      priority: 10,
      groups: groups(a),
    },
  ];
}

export const imageProvider: ContextProvider = {
  id: IMAGE_CONTEXT_ID,
  matches: (o) => o.source === 'document' && o.type === 'image',
  label: 'تصویر',
  capabilities: (o) => capabilities(),
  tabs: (o) => tabs(o.attrs as unknown as ImageAttrs),
};

function capabilities(): ObjectCapabilities {
  return {
    canResize: true,
    canAlign: true,
    canDelete: true,
    canCrop: false,
    canRotate: false,
    'image:download': true,
    'image:altText': true,
  };
}
