import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Bold, Italic, Underline, Highlighter, Link as LinkIcon, Sparkles } from 'lucide-react';
import {
  RibbonButton, RibbonSelect, FontSizeCombo, RibbonColorButton,
} from './RibbonUI';

/* ══════════════════════════════════════════════════════════════════════════
   SelectionToolbar — the CONTENT of the horizontal quick-format card that
   the ContextMenu renders directly above the vertical menu (one floating
   unit, like the mockup). Only the CONTENT lives here; positioning and
   dismissal belong to ContextMenu so the two cards open/close together.

   Uses the same primitives as the Ribbon tool rows (RibbonSelect /
   FontSizeCombo / RibbonButton / RibbonColorButton) — no new visuals.
   بازنویسی با هوش مصنوعی lives ONLY here; quick formatting lives ONLY here,
   so the vertical menu stays a calm action list.
   ══════════════════════════════════════════════════════════════════════════ */

const FONTS = [
  /* فارسی/عربی */
  { value: 'Sahel', label: 'ساحل' },
  { value: 'B Titr', label: 'ب تیتر' },
  { value: 'Shabnam', label: 'شبنم' },
  { value: 'Dast Nevis', label: 'دست‌نویس' },
  { value: 'Samim', label: 'صمیم' },
  { value: 'Tanha', label: 'تنها' },
  { value: 'Gandom', label: 'گندم' },
  { value: 'Parastoo', label: 'پرستو' },
  { value: 'Lalezar', label: 'لاله‌زار' },
  { value: 'Noto Naskh Arabic', label: 'نسخ (عربی)' },
  { value: 'Markazi Text', label: 'مرکزی' },
  /* انگلیسی */
  { value: 'Inter', label: 'Inter — انگلیسی' },
  { value: 'Merriweather', label: 'Merriweather — انگلیسی' },
  { value: 'Comic Sans', label: 'Comic Sans' },
];

export interface SelectionToolbarProps {
  editor: Editor;
  /** run an AI action on the current selection (بازنویسی با هوش مصنوعی) */
  onRunAI: (action: { id: string; label: string }) => void;
}

export function SelectionToolbar({ editor, onRunAI }: SelectionToolbarProps) {
  const ch = () => editor.chain().focus();

  /* live active states — every transaction (bold toggled from THIS bar,
     caret moved by the menu's keyboard nav…) re-renders the row */
  const [, bump] = useState(0);
  useEffect(() => {
    const h = () => bump((n) => n + 1);
    editor.on('transaction', h);
    return () => { editor.off('transaction', h); };
  }, [editor]);

  const fontSize = (() => {
    const raw = editor.getAttributes('textStyle').fontSize as string | undefined;
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : 16;
  })();
  const sizeOptions = Array.from(new Set([fontSize, 12, 14, 16, 18, 20, 24]))
    .sort((a, b) => a - b)
    .map((s) => ({ value: String(s), label: String(s) }));

  const setLink = () => {
    const prev = (editor.getAttributes('link').href as string) || '';
    const url = window.prompt('آدرس لینک (خالی = حذف):', prev);
    if (url === null) return;
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <>
      <RibbonSelect
        title="فونت"
        width={104}
        value={editor.getAttributes('textStyle').fontFamily || 'Sahel'}
        onChange={(v) => ch().setFontFamily(v).run()}
        options={FONTS.map((f) => ({ value: f.value, label: f.label, style: { fontFamily: f.value } }))}
      />
      <FontSizeCombo
        title="اندازه فونت"
        value={fontSize}
        onChange={(v) => ch().setFontSize(`${v}px`).run()}
        options={sizeOptions}
        width={56}
      />
      <RibbonButton title="بولد (Ctrl+B)" active={editor.isActive('bold')} icon={<Bold className="h-4 w-4 font-black" />} onClick={() => ch().toggleBold().run()} />
      <RibbonButton title="ایتالیک (Ctrl+I)" active={editor.isActive('italic')} icon={<Italic className="h-4 w-4" />} onClick={() => ch().toggleItalic().run()} />
      <RibbonButton title="زیرخط (Ctrl+U)" active={editor.isActive('underline')} icon={<Underline className="h-4 w-4" />} onClick={() => ch().toggleUnderline().run()} />
      <RibbonColorButton
        title="رنگ متن"
        icon={<span className="text-[11px] font-black">A</span>}
        value={(editor.getAttributes('textStyle').color as string) || '#171717'}
        onChange={(v) => (v ? ch().setColor(v).run() : ch().unsetColor().run())}
      />
      <RibbonColorButton
        title="هایلایت"
        icon={<Highlighter className="h-4 w-4" />}
        value={editor.isActive('highlight') ? ((editor.getAttributes('highlight').color as string) || '#171717') : '#171717'}
        onChange={(v) => (v ? ch().toggleHighlight({ color: v }).run() : ch().unsetHighlight().run())}
      />
      <RibbonButton title="لینک (Ctrl+K)" active={editor.isActive('link')} icon={<LinkIcon className="h-4 w-4" />} onClick={setLink} />
      <RibbonButton
        title="بازنویسی با هوش مصنوعی"
        icon={<Sparkles className="h-4 w-4" />}
        onClick={() => onRunAI({ id: 'proofread', label: 'اصلاح نگارشی' })}
      />
    </>
  );
}
