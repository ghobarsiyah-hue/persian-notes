import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { cellAround } from '@tiptap/pm/tables';
import {
  Scissors, Copy, ClipboardPaste, Trash2, TextSelect, Search, Replace,
  Link2, Link2Off, PenLine, FileDown, ImagePlus, Table2, Sigma, Maximize2,
  Plus, Minus, ArrowUpToLine, ArrowDownToLine,
  Type, StickyNote, Shapes, Palette, Square, Circle, Diamond, BookOpen,
  ArrowRight, MessageSquare, SeparatorHorizontal,
  Star, HelpCircle, AlertCircle, Lightbulb, Hash, CircleDot, PenTool,
  Columns, Code, AlignRight, AlignCenter, AlignLeft, AlignJustify, Pilcrow,
  List, ListOrdered, ListChecks, CheckCircle, IndentIncrease, IndentDecrease,
  Paintbrush, Repeat,
} from 'lucide-react';
import type { MenuItem } from './contextMenu';
import { h4 } from './icons';
import { resolveSelectionContext } from './registry';
import { getSourceSelections } from './selectionStore';
import { getFloatingSelectionBridge } from './floatingSelectionBridge';
import { openEduBlockStyleModal } from './contexts/eduBlockStyleModalHost';
import { getActiveEquation } from '@/editor/equations/bridge';
import { loadRecentColors, rememberColor } from '@/utils/recentColors';
import type { SelectableObject } from './types';

/* ══════════════════════════════════════════════════════════════════════════
   Context-menu item builders — one menu PER CONTEXT (راست‌کلیک هوشمند).

   The menu answers "what can I do with the thing I just right-clicked?" —
   NOT a second toolbar. Contexts: normal text, selected text, image, table
   (± cell), shape/text-box/sticky (floating), equation, empty page area.

   Rules baked in:
   • every visible item runs a REAL action against real editor/document state
   • actions with no implementation in the editor are OMITTED, never faked
   • quick formatting (bold/italic/colors/…) lives ONLY in the horizontal
     toolbar above the menu — the menu never duplicates it
   • the vertical menu is actions + insertions in a fixed, calm hierarchy:
     clipboard → افزودن → text navigation → link/note → paragraph → delete
   • buildItems() is pure data so it can run directly inside the contextmenu
     handler (no state, no re-render of the editor itself)
   ══════════════════════════════════════════════════════════════════════════ */

/** Host-provided actions (EditorPage) the menu cannot own itself. */
export interface CtxMenuActions {
  /** add the selected text as a NEW note (the existing notes system) */
  addToNote: (text: string) => void;
  /** open the Ribbon's جستجو و جایگزینی panel */
  openFind: () => void;
  /** open the same panel with its جایگزینی row expanded (Ctrl+H) */
  openReplace: () => void;
  /** add a floating object on the active page (§1: unified shape family) */
  addFloating: (type: import('@/components/editor/FloatingLayer').FloatingElementType) => void;
}

const act = (
  key: string, label: string, run: () => void,
  opts: { icon?: ReactNode; shortcut?: string; danger?: boolean; disabled?: boolean; active?: boolean; swatch?: string; title?: string } = {},
): MenuItem => ({ kind: 'action', key, label, run, ...opts });
const sep = (key: string): MenuItem => ({ kind: 'separator', key });

function can(ed: Editor, fn: () => boolean): boolean {
  try { return fn(); } catch { return false; }
}

/* ── ListMarker — the ACTIVE list's glyph choices (change/remove later) ──
   Same token tables as the ribbon's فهرست dropdown; `''` = stock look.
   Values map to data-marker CSS in index.css + printCss 1:1. */
const UL_MARKER_ITEMS = [
  { value: 'disc', glyph: '●', label: 'دایره توپر (پیش‌فرض)' },
  { value: 'circle', glyph: '○', label: 'دایره توخالی' },
  { value: 'square', glyph: '▪', label: 'مربع' },
  { value: 'diamond', glyph: '◆', label: 'لوزی' },
  { value: 'dash', glyph: '—', label: 'خط تیره' },
  { value: 'none', glyph: '⌀', label: 'بدون نشان' },
];
const OL_MARKER_ITEMS = [
  { value: 'decimal', glyph: '1.', label: 'عدد (پیش‌فرض)' },
  { value: 'fa', glyph: '۱.', label: 'عدد فارسی' },
  { value: 'paren', glyph: '١)', label: 'عدد با پرانتز' },
  { value: 'alpha', glyph: 'a.', label: 'حرف الفبا' },
  { value: 'roman', glyph: 'I.', label: 'عدد رومی' },
  { value: 'none', glyph: '⌀', label: 'بدون شماره' },
];
function listMarkerMenuItems(ed: Editor): MenuItem[] {
  const listType = ed.isActive('bulletList')
    ? 'bulletList'
    : ed.isActive('orderedList')
      ? 'orderedList'
      : null;
  if (!listType) return [];
  const current = (ed.getAttributes(listType).marker as string) ?? '';
  const options = listType === 'orderedList' ? OL_MARKER_ITEMS : UL_MARKER_ITEMS;
  return options.map((m) =>
    act(
      `list.marker.${m.value}`,
      m.label,
      () => ed.chain().focus().updateAttributes(listType, { marker: m.value }).run(),
      { active: current === m.value, title: 'نماد هر خط این فهرست' },
    ),
  );
}

/* native execCommand works on the DOCUMENT focus — the menu never moves
   focus (mousedown is preventDefault-ed), so refocus before cut/copy when
   the editor was blurred */
function focusForClipboard(ed: Editor) {
  try {
    if (!ed.isFocused && ed.view.dom?.isConnected) ed.commands.focus(undefined, { scrollIntoView: false });
  } catch { /* best effort */ }
}

/** System-clipboard paste through the async Clipboard API → the editor's
 *  own paste pipeline (handlePaste converts image FILES, links autolink…). */
async function pasteClipboard(ed: Editor) {
  try {
    ed.commands.focus();
    const items = await navigator.clipboard.read();
    let handled = false;
    for (const ci of items) {
      const imgType = ci.types.find((t) => t.startsWith('image/'));
      if (imgType) {
        const blob = await ci.getType(imgType);
        const file = new File([blob], `paste-${Date.now()}.${imgType.split('/')[1] || 'png'}`, { type: imgType });
        const dt = new DataTransfer();
        dt.items.add(file);
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        ed.view.dom.dispatchEvent(ev);
        handled = true;
        break;
      }
    }
    if (!handled) {
      const text = await navigator.clipboard.readText();
      if (text) ed.chain().focus().insertContent(text).run();
    }
  } catch {
    /* permission denied / unsupported — the keyboard shortcut still works */
  }
}

/** paste — the async Clipboard API → the editor's own paste pipeline */
function pasteItem(ed: Editor): MenuItem {
  return act('sys.paste', 'چسباندن', () => { void pasteClipboard(ed); }, { icon: h4(ClipboardPaste), shortcut: 'Ctrl+V' });
}

/** clipboard section — cut/copy/paste against the REAL selection.
 *  A plain labeled group on the menu's normal background (no colored card):
 *  it sits at the very top of every text menu. */
function clipboardItems(ed: Editor): MenuItem[] {
  const hasSel = !ed.state.selection.empty;
  return [
    act('sys.cut', 'برش', () => { focusForClipboard(ed); document.execCommand('cut'); }, { icon: h4(Scissors), shortcut: 'Ctrl+X', disabled: !hasSel }),
    act('sys.copy', 'کپی', () => { focusForClipboard(ed); document.execCommand('copy'); }, { icon: h4(Copy), shortcut: 'Ctrl+C', disabled: !hasSel }),
    pasteItem(ed),
  ];
}

/* ── افزودن — insertion section (real editor + floating-layer commands) ─
   One submenu per family, mirroring the Ribbon's افزودن tab exactly:
   تصویر → the Ribbon's floating-image file picker; شکل → its shape items;
   معادله → درون‌خطی/نمایشی; کادر آموزشی → the same callout blocks. */
function insertSectionItems(ed: Editor, a: CtxMenuActions): MenuItem[] {
  const ch = () => ed.chain().focus();
  const insertBlock = (payload: Record<string, unknown>) => ch().insertContent(payload as never).run();
  const pickImage = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.addEventListener('change', () => {
      const f = inp.files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => ch().setImage({ src: String(r.result) }).run();
      r.readAsDataURL(f);
    });
    inp.click();
  };
  return [
    { kind: 'submenu', key: 'ins.image', label: 'افزودن تصویر', icon: h4(ImagePlus), items: [
      act('ins.image.doc', 'تصویر در متن', () => pickImage(), { icon: h4(ImagePlus) }),
      act('ins.image.float', 'تصویر شناور', () => a.addFloating('image'), { icon: h4(StickyNote) }),
    ] },
    { kind: 'submenu', key: 'ins.shape', label: 'افزودن شکل', icon: h4(Shapes), items: [
      act('ins.shape.rect', 'مستطیل', () => a.addFloating('rect'), { icon: h4(Square) }),
      act('ins.shape.rounded', 'مستطیل گرد', () => a.addFloating('roundedRect'), { icon: h4(Square) }),
      act('ins.shape.ellipse', 'بیضی', () => a.addFloating('ellipse'), { icon: h4(Circle) }),
      act('ins.shape.circle', 'دایره', () => a.addFloating('circle'), { icon: h4(Circle) }),
      act('ins.shape.diamond', 'لوزی', () => a.addFloating('diamond'), { icon: h4(Diamond) }),
      act('ins.shape.arrow', 'فلش', () => a.addFloating('arrow'), { icon: h4(ArrowRight) }),
      act('ins.shape.callout', 'حباب گفتار', () => a.addFloating('callout'), { icon: h4(MessageSquare) }),
      /* آیتم ۸: خط افقی — جداکنندهٔ سند، هم‌خانوادهٔ شکل‌ها در همین منو */
      act('ins.shape.hr', 'خط افقی', () => ch().setHorizontalRule().run(), { icon: h4(SeparatorHorizontal) }),
    ] },
    { kind: 'submenu', key: 'ins.equation', label: 'افزودن معادله', icon: h4(Sigma), items: [
      act('ins.eq.inline', 'معادله درون‌خطی', () => ch().insertEquation({ display: false }).run(), { icon: h4(Sigma) }),
      act('ins.eq.display', 'معادله نمایشی', () => ch().insertEquation({ display: true }).run(), { icon: h4(Sigma) }),
    ] },
    { kind: 'submenu', key: 'ins.edublock', label: 'افزودن کادر آموزشی', icon: h4(BookOpen), items: [
      act('ins.edu.definition', 'تعریف', () => insertBlock({ type: 'calloutBlock', attrs: { kind: 'definition' }, content: [{ type: 'paragraph' }] }), { icon: h4(BookOpen) }),
      act('ins.edu.important', 'نکته مهم', () => insertBlock({ type: 'calloutBlock', attrs: { kind: 'important', title: 'نکته مهم' }, content: [{ type: 'paragraph' }] }), { icon: h4(Star) }),
      act('ins.edu.exam', 'نکته امتحانی', () => insertBlock({ type: 'calloutBlock', attrs: { kind: 'exam', title: 'نکته امتحانی' }, content: [{ type: 'paragraph' }] }), { icon: h4(HelpCircle) }),
      act('ins.edu.warning', 'توجه', () => insertBlock({ type: 'calloutBlock', attrs: { kind: 'warning', title: 'توجه' }, content: [{ type: 'paragraph' }] }), { icon: h4(AlertCircle) }),
      act('ins.edu.example', 'مثال', () => insertBlock({ type: 'exampleBlock', attrs: { title: '' }, content: [{ type: 'paragraph' }] }), { icon: h4(Lightbulb) }),
      act('ins.edu.keyterm', 'اصطلاح کلیدی', () => insertBlock({ type: 'keyTermBlock', attrs: { term: '' }, content: [{ type: 'paragraph' }] }), { icon: h4(Hash) }),
      act('ins.edu.highlight', 'جعبه برجسته', () => insertBlock({ type: 'highlightBox', attrs: { title: 'نکته برجسته', icon: '◉' }, content: [{ type: 'paragraph' }] }), { icon: h4(CircleDot) }),
      act('ins.edu.timeline', 'زمان‌خط', () => insertBlock({ type: 'timeline', content: [{ type: 'paragraph' }] }), { icon: h4(PenTool) }),
      act('ins.edu.comparison', 'مقایسه دو ستونه', () => insertBlock({ type: 'comparisonTable', content: [{ type: 'paragraph' }] }), { icon: h4(Columns) }),
      act('ins.edu.procon', 'موافق و مخالف', () => insertBlock({ type: 'proConBlock', attrs: { topic: '' }, content: [{ type: 'paragraph' }] }), { icon: h4(Columns) }),
      act('ins.edu.codeoutput', 'کد با خروجی', () => insertBlock({ type: 'codeOutputBlock', attrs: { lang: '', label: 'کد و خروجی' }, content: [{ type: 'paragraph' }] }), { icon: h4(Code) }),
    ] },
    { kind: 'submenu', key: 'ins.question', label: 'افزودن سوال', icon: h4(HelpCircle), items: [
      act('ins.q.short', 'سوال کوتاه', () => insertBlock({ type: 'questionBlock', attrs: { question: '' }, content: [{ type: 'paragraph' }] }), { icon: h4(HelpCircle) }),
      act('ins.q.essay', 'سوال تشریحی', () => insertBlock({ type: 'longAnswerBlock', attrs: { question: '', points: 0 }, content: [{ type: 'paragraph' }] }), { icon: h4(PenTool) }),
      act('ins.q.tf', 'سوال درست / نادرست', () => insertBlock({ type: 'trueFalseBlock', attrs: { question: '', answer: 'none' }, content: [{ type: 'paragraph' }] }), { icon: h4(CheckCircle) }),
      act('ins.q.mcq', 'سوال چهارگزینه‌ای', () => insertBlock({ type: 'mcqBlock', attrs: { qTitle: '', layout: 'stacked', options: ['', '', '', ''], correct: -1 }, content: [{ type: 'paragraph' }] }), { icon: h4(ListChecks) }),
      act('ins.q.anssheet', 'پاسخ تشریحی', () => insertBlock({ type: 'longAnswerBlock', attrs: { question: 'سوال تشریحی', points: 0 }, content: [{ type: 'paragraph' }] }), { icon: h4(PenTool) }),
    ] },
  ];
}

/** تنظیمات پاراگراف — paragraph/heading type + alignment + lists + indent,
 *  the same commands the خانه tab exposes, kept out of the top level so the
 *  menu stays calm (Word: a single Paragraph… entry with a fly-out). */
function paragraphSettingsItems(ed: Editor): MenuItem[] {
  const ch = () => ed.chain().focus();
  const isHeading = (lv: number) => ed.isActive('heading', { level: lv });
  return [
    act('para.body', 'متن ساده', () => ch().setParagraph().run(), { icon: h4(Type), active: !ed.isActive('heading') }),
    act('para.h1', 'عنوان ۱', () => ch().toggleHeading({ level: 1 }).run(), { icon: h4(Type), active: isHeading(1) }),
    act('para.h2', 'عنوان ۲', () => ch().toggleHeading({ level: 2 }).run(), { icon: h4(Type), active: isHeading(2) }),
    act('para.h3', 'عنوان ۳', () => ch().toggleHeading({ level: 3 }).run(), { icon: h4(Type), active: isHeading(3) }),
    sep('para.sep1'),
    act('para.align.right', 'راست‌چین', () => ch().setTextAlign('right').run(), { icon: h4(AlignRight), active: ed.isActive({ textAlign: 'right' }) }),
    act('para.align.center', 'وسط‌چین', () => ch().setTextAlign('center').run(), { icon: h4(AlignCenter), active: ed.isActive({ textAlign: 'center' }) }),
    act('para.align.left', 'چپ‌چین', () => ch().setTextAlign('left').run(), { icon: h4(AlignLeft), active: ed.isActive({ textAlign: 'left' }) }),
    act('para.align.justify', 'هم‌تراز (justify)', () => ch().setTextAlign('justify').run(), { icon: h4(AlignJustify), active: ed.isActive({ textAlign: 'justify' }) }),
    sep('para.sep2'),
    act('para.list.bullet', 'فهرست نقطه‌ای', () => ch().toggleBulletList().run(), { icon: h4(List), active: ed.isActive('bulletList') }),
    act('para.list.ordered', 'فهرست شماره‌دار', () => ch().toggleOrderedList().run(), { icon: h4(ListOrdered), active: ed.isActive('orderedList') }),
    act('para.list.task', 'چک‌لیست', () => ch().toggleTaskList().run(), { icon: h4(ListChecks), active: ed.isActive('taskList') }),
    /* list marker glyph — change/remove AFTER creation (ListMarker ext) */
    ...listMarkerMenuItems(ed),
    sep('para.sep3'),
    act('para.indent.more', 'تورفتگی بیشتر', () => ch().sinkListItem('listItem').run(), { icon: h4(IndentIncrease), disabled: !can(ed, () => ed.can().sinkListItem('listItem')) }),
    act('para.indent.less', 'تورفتگی کمتر', () => ch().liftListItem('listItem').run(), { icon: h4(IndentDecrease), disabled: !can(ed, () => ed.can().liftListItem('listItem')) }),
  ];
}

/* ── text menus ───────────────────────────────────────────────────────── */

/** TEXT MENUS — fixed hierarchy (RTL), identical ordering in both variants:
 *  1) clipboard (cut/copy/paste)      2) افزودن section
 *  3) text navigation (find/replace/select all)
 *  4) link + note                     5) تنظیمات پاراگراف (fly-out)
 *  6) حذف — destructive, last, behind a divider.
 *  Formatting (bold/colors/size…) stays ONLY in the horizontal toolbar
 *  above the menu — never duplicated here. */

/** NORMAL TEXT — caret only (no selection: cut/copy disabled, note hidden) */
function normalTextMenu(ed: Editor, a: CtxMenuActions): MenuItem[] {
  return [
    ...clipboardItems(ed),
    sep('nt.sep1'),
    ...insertSectionItems(ed, a),
    sep('nt.sep2'),
    act('nt.find', 'جستجو در متن', a.openFind, { icon: h4(Search), shortcut: 'Ctrl+F' }),
    act('nt.replace', 'جایگزینی در متن', a.openReplace, { icon: h4(Replace), shortcut: 'Ctrl+H' }),
    act('nt.selectall', 'انتخاب همه', () => ed.chain().focus().selectAll().run(), { icon: h4(TextSelect), shortcut: 'Ctrl+A' }),
    sep('nt.sep3'),
    act('nt.link', 'پیوند', () => linkPrompt(ed, null), { icon: h4(Link2) }),
    sep('nt.sep4'),
    { kind: 'submenu', key: 'nt.para', label: 'تنظیمات پاراگراف', icon: h4(Pilcrow), items: paragraphSettingsItems(ed) },
    sep('nt.sep5'),
    act('nt.delete', 'حذف', () => ed.chain().focus().deleteSelection().run(), { icon: h4(Trash2), danger: true }),
  ];
}

/** SELECTED TEXT — same hierarchy; the note action joins پیوند in its group */
function selectedTextMenu(ed: Editor, a: CtxMenuActions): MenuItem[] {
  return [
    ...clipboardItems(ed),
    sep('st.sep1'),
    ...insertSectionItems(ed, a),
    sep('st.sep2'),
    act('st.find', 'جستجو در متن', a.openFind, { icon: h4(Search), shortcut: 'Ctrl+F' }),
    act('st.replace', 'جایگزینی در متن', a.openReplace, { icon: h4(Replace), shortcut: 'Ctrl+H' }),
    act('st.selectall', 'انتخاب همه', () => ed.chain().focus().selectAll().run(), { icon: h4(TextSelect), shortcut: 'Ctrl+A' }),
    sep('st.sep3'),
    { kind: 'submenu', key: 'st.link', label: 'پیوند', icon: h4(Link2), items: linkSubItems(ed) },
    act('st.note', 'افزودن به یادداشت', () => { const t = selText(ed); if (t.trim()) a.addToNote(t); }, { icon: h4(StickyNote) }),
    sep('st.sep4'),
    { kind: 'submenu', key: 'st.para', label: 'تنظیمات پاراگراف', icon: h4(Pilcrow), items: paragraphSettingsItems(ed) },
    sep('st.sep5'),
    act('st.delete', 'حذف', () => ed.chain().focus().deleteSelection().run(), { icon: h4(Trash2), danger: true }),
  ];
}

/* ── shared submenu payloads (colors, links) ──────────────────────────── */

const NOTE_COLORS: Array<{ label: string; color: string }> = [
  { label: 'مشکی', color: '#171717' },
  { label: 'خاکستری', color: '#6b7280' },
  { label: 'قرمز', color: '#dc2626' },
  { label: 'نارنجی', color: '#ea580c' },
  { label: 'آبی', color: '#2563eb' },
  { label: 'آبی نفتی', color: '#1f7396' },
];

/** recents strip + named colors + OS custom picker */
function colorSubItems(current: string | null | undefined, apply: (c: string) => void, clear?: { label: string; run: () => void }): MenuItem[] {
  const items: MenuItem[] = [];
  const recent = loadRecentColors();
  if (recent.length) {
    items.push({
      kind: 'swatches',
      key: 'col.recent',
      colors: recent,
      onPick: (c) => { rememberColor(c); apply(c); },
    });
  }
  for (const { label, color } of NOTE_COLORS) {
    items.push(act(`col.${color}`, label, () => { rememberColor(color); apply(color); }, { swatch: color, active: current?.toLowerCase() === color.toLowerCase() }));
  }
  items.push(act('col.custom', 'انتخاب رنگ…', () => {
    const inp = document.createElement('input');
    inp.type = 'color';
    if (current) inp.value = current;
    inp.addEventListener('change', () => { rememberColor(inp.value); apply(inp.value); });
    inp.click();
  }, { icon: h4(Palette) }));
  if (clear) {
    items.push(sep('col.sep'));
    items.push(act('col.clear', clear.label, clear.run, { icon: h4(Link2Off), danger: true }));
  }
  return items;
}

function linkPrompt(ed: Editor, href: string | null) {
  const next = window.prompt('آدرس لینک (خالی = حذف):', href ?? '');
  if (next === null) return;
  if (next === '') { ed.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
  ed.chain().focus().extendMarkRange('link').setLink({ href: next }).run();
}

function linkSubItems(ed: Editor): MenuItem[] {
  const attrs = ed.getAttributes('link') as { href?: string };
  const href = attrs.href ?? null;
  return [
    act('lnk.add', 'افزودن پیوند…', () => linkPrompt(ed, href), { icon: h4(Link2) }),
    act('lnk.copy', 'کپی آدرس لینک', () => { if (href) void navigator.clipboard.writeText(href); }, { icon: h4(Copy), disabled: !href }),
    act('lnk.remove', 'حذف لینک', () => ed.chain().focus().extendMarkRange('link').unsetLink().run(), { icon: h4(Link2Off), danger: true, disabled: !href }),
  ];
}

const selText = (ed: Editor): string => {
  const { from, to } = ed.state.selection;
  return ed.state.doc.textBetween(from, to, ' ');
};

/* ── image ─────────────────────────────────────────────────────────────── */

function imageMenu(ed: Editor, attrs: Record<string, unknown>): MenuItem[] {
  const ch = () => ed.chain().focus();
  const src = (attrs.src as string | null) ?? null;
  const raw = attrs.width ? parseInt(String(attrs.width), 10) : NaN;
  const pct = Number.isFinite(raw) ? Math.min(100, Math.max(10, raw)) : 50;
  const setSize = (v: string) => () => ch().updateAttributes('image', { width: v }).run();
  const pickFile = (apply: (dataUrl: string) => void) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.addEventListener('change', () => {
      const f = inp.files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => apply(String(r.result));
      r.readAsDataURL(f);
    });
    inp.click();
  };
  return [
    ...clipboardItems(ed),
    sep('img.sep1'),
    act('img.replace', 'جایگزینی تصویر…', () => pickFile((dataUrl) => ch().updateAttributes('image', { src: dataUrl }).run()), { icon: h4(ImagePlus) }),
    act('img.download', 'دانلود تصویر', () => {
      if (!src) return;
      const link = document.createElement('a');
      link.href = src;
      link.download = (attrs.alt as string) || 'image';
      link.click();
    }, { icon: h4(FileDown), disabled: !src }),
    sep('img.sep2'),
    {
      kind: 'submenu', key: 'img.size', label: 'تغییر اندازه', icon: h4(Maximize2),
      items: [
        act('img.w25', '۲۵٪', setSize('25%'), { active: attrs.width === '25%' }),
        act('img.w50', '۵۰٪', setSize('50%'), { active: attrs.width === '50%' }),
        act('img.w75', '۷۵٪', setSize('75%'), { active: attrs.width === '75%' }),
        act('img.w100', 'تمام‌عرض', setSize('100%'), { active: attrs.width === '100%' }),
        sep('img.sz.sep'),
        act('img.w+', 'بزرگ‌تر (+۱۰٪)', () => ch().updateAttributes('image', { width: pct >= 100 ? '100%' : `${pct + 10}%` }).run(), { icon: h4(Plus) }),
        act('img.w-', 'کوچک‌تر (−۱۰٪)', () => ch().updateAttributes('image', { width: pct <= 10 ? '10%' : `${pct - 10}%` }).run(), { icon: h4(Minus) }),
        act('img.wreset', 'اندازه اصلی', () => ch().updateAttributes('image', { width: null }).run()),
      ],
    },
    sep('img.sep3'),
    act('img.delete', 'حذف تصویر', () => ch().deleteSelection().run(), { icon: h4(Trash2), danger: true }),
  ];
}

/* ── table (± cell) ───────────────────────────────────────────────────── */

function tableMenu(ed: Editor, inCell: boolean): MenuItem[] {
  const ch = () => ed.chain().focus();
  /* The full table toolset lives in the contextual ribbon tab (چیدمان جدول).
     The right-click menu keeps only clipboard + full-table delete — no row/col
     add/delete and no cell selection submenu, to avoid a duplicated/conflicting
     interface alongside the ribbon's own table tools. */
  const items: MenuItem[] = [
    ...clipboardItems(ed),
    sep('tbl.sep1'),
    act('tbl.del', 'حذف جدول', () => ch().deleteTable().run(), { icon: h4(Trash2), danger: true }),
  ];
  return items;
}

/* ── floating shape / text box / sticky note ─────────────────────────── */

interface FloatOps {
  element?: { id: string; type: string; width: number; height: number; rotation: number; bgColor?: string; borderColor?: string; fontColor?: string; borderWidth?: number };
  patch?: (p: Record<string, unknown>) => void;
  remove?: () => void;
  duplicate?: () => void;
  bringToFront?: () => void;
  sendToBack?: () => void;
}

function shapeMenu(obj: SelectableObject): MenuItem[] {
  const a = obj.attrs as FloatOps;
  const el = a.element;
  if (!el || !a.patch) return [];
  const p = (fn: () => Record<string, unknown>) => () => a.patch!(fn());
  const isText = el.type === 'textBox' || el.type === 'sticky';
  const items: MenuItem[] = [
    act('sh.dup', 'تکثیر', () => a.duplicate?.(), { icon: h4(Copy) }),
    sep('sh.sep1'),
  ];
  if (isText) {
    items.push(act('sh.edit', 'ویرایش متن', () => {
      /* enter the box's own text editing surface (same as double-click) —
         the contenteditable div IS the [data-float-id] element */
      const node = document.querySelector<HTMLElement>(`[data-float-id="${CSS.escape(el.id)}"][contenteditable]`);
      node?.focus();
    }, { icon: h4(PenLine) }));
  }
  items.push(
    { kind: 'submenu', key: 'sh.bg', label: 'تغییر رنگ', icon: h4(Palette), items: colorSubItems(el.bgColor ?? null, (c) => a.patch!({ bgColor: c }), { label: 'بدون رنگ', run: () => a.patch!({ bgColor: 'transparent' }) }) },
    { kind: 'submenu', key: 'sh.border', label: 'تغییر حاشیه', icon: h4(Palette), items: colorSubItems(el.borderColor ?? null, (c) => a.patch!({ borderColor: c, borderWidth: Math.max(1, el.borderWidth ?? 0) }), { label: 'حذف حاشیه', run: () => a.patch!({ borderWidth: 0 }) }) },
    ...(isText ? [{ kind: 'submenu' as const, key: 'sh.fontcolor', label: 'رنگ متن', icon: h4(Palette), items: colorSubItems(el.fontColor ?? null, (c) => a.patch!({ fontColor: c })) }] : []),
    sep('sh.sep2'),
    /* §5: rotation is owned ONLY by the selection frame's rotation handle —
       no rotation commands in menus or panels. */
    { kind: 'submenu', key: 'sh.size', label: 'تغییر اندازه', icon: h4(Maximize2), items: [
      act('sh.w+', 'عرض بیشتر', () => a.patch!({ width: el.width + 20 }), { icon: h4(Plus) }),
      act('sh.w-', 'عرض کمتر', () => a.patch!({ width: Math.max(60, el.width - 20) }), { icon: h4(Minus) }),
      act('sh.h+', 'ارتفاع بیشتر', () => a.patch!({ height: el.height + 20 }), { icon: h4(Plus) }),
      act('sh.h-', 'ارتفاع کمتر', () => a.patch!({ height: Math.max(40, el.height - 20) }), { icon: h4(Minus) }),
    ] },
    sep('sh.sep3'),
    act('sh.front', 'جلو آوردن', () => a.bringToFront?.(), { icon: h4(ArrowUpToLine) }),
    act('sh.back', 'عقب بردن', () => a.sendToBack?.(), { icon: h4(ArrowDownToLine) }),
    sep('sh.sep4'),
    act('sh.delete', 'حذف', () => a.remove?.(), { icon: h4(Trash2), danger: true }),
  );
  return items;
}

/* ── equation (structured — via the active-equation bridge) ──────────── */

function equationMenu(ed: Editor): MenuItem[] {
  const eq = getActiveEquation();
  const ch = () => ed.chain().focus();
  const copyLatex = () => { eq?.runCommand('copy.latex'); };
  return [
    act('eq.copy', 'کپی فرمول', copyLatex, { icon: h4(Copy), disabled: !eq }),
    act('eq.cut', 'برش', () => { copyLatex(); ch().deleteSelection().run(); }, { icon: h4(Scissors), disabled: !eq }),
    sep('eq.sep1'),
    act('eq.edit', 'ویرایش معادله', () => eq?.requestEdit(), { icon: h4(PenLine), disabled: !eq }),
    act('eq.linear', 'باز کردن ویرایشگر معادله (خطی)', () => eq?.openLinearEditor(), { icon: h4(Sigma), disabled: !eq }),
    sep('eq.sep2'),
    act('eq.pro', 'تبدیل به Professional', () => eq?.setMode('professional'), { active: eq?.mode() === 'professional', disabled: !eq }),
    act('eq.lint', 'تبدیل به Linear', () => eq?.setMode('linear'), { active: eq?.mode() === 'linear', disabled: !eq }),
    sep('eq.sep3'),
    act('eq.delete', 'حذف معادله', () => ch().deleteSelection().run(), { icon: h4(Trash2), danger: true }),
  ];
}

/* ── empty page / canvas area ────────────────────────────────────────── */

function emptyPageMenu(ed: Editor, a: CtxMenuActions): MenuItem[] {
  return [
    pasteItem(ed),
    act('ep.selectall', 'انتخاب همه', () => ed.chain().focus().selectAll().run(), { icon: h4(TextSelect), shortcut: 'Ctrl+A' }),
    sep('ep.sep1'),
    ...insertSectionItems(ed, a),
    sep('ep.sep2'),
    act('ep.table', 'افزودن جدول', () => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), { icon: h4(Table2) }),
  ];
}

/* ── edu block (کادر آموزشی) — شخصی‌سازی + type conversion ─────────── */

/** Per-block customization + quick actions for the edu-block family.
 *  Prepended to the text menu when the caret/selection sits inside one. */
function eduBlockMenu(ed: Editor): MenuItem[] {
  const ch = () => ed.chain().focus();
  return [
    act('edublk.style', 'شخصی‌سازی کادر…', () => openEduBlockStyleModal(ed), { icon: h4(Paintbrush) }),
    { kind: 'submenu', key: 'edublk.kind', label: 'نوع کادر', icon: h4(Repeat), items: [
      act('edublk.kind.definition', 'تعریف', () => ch().updateAttributes('calloutBlock', { kind: 'definition' }).run(), { active: ed.getAttributes('calloutBlock').kind === 'definition' }),
      act('edublk.kind.important', 'نکته مهم', () => ch().updateAttributes('calloutBlock', { kind: 'important' }).run(), { active: ed.getAttributes('calloutBlock').kind === 'important' }),
      act('edublk.kind.exam', 'نکته امتحانی', () => ch().updateAttributes('calloutBlock', { kind: 'exam' }).run(), { active: ed.getAttributes('calloutBlock').kind === 'exam' }),
      act('edublk.kind.warning', 'توجه', () => ch().updateAttributes('calloutBlock', { kind: 'warning' }).run(), { active: ed.getAttributes('calloutBlock').kind === 'warning' }),
      act('edublk.kind.summary', 'خلاصه', () => ch().updateAttributes('calloutBlock', { kind: 'summary' }).run(), { active: ed.getAttributes('calloutBlock').kind === 'summary' }),
    ] },
    sep('edublk.sep'),
  ];
}

/* ── the public builder ───────────────────────────────────────────────── */

/** pos at the pointer inside the editor DOM, or null when outside it. */
export function posAtEvent(editor: Editor, event: MouseEvent): number | null {
  try {
    const view = editor.view;
    const rect = view.dom.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
    return view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
  } catch {
    return null;
  }
}

const FLOAT_TARGET = '[data-float-id]';

/**
 * Align the editor/floating selection with the right-clicked target.
 * Returns the floating SelectableObject when the pointer hit one (their
 * selection is click-driven — a contextmenu never clicks — so it is
 * published SYNCHRONOUSLY through the bridge and returned to the caller).
 */
export function detectRightClickTarget(editor: Editor, event: MouseEvent): SelectableObject | null {
  const target = event.target as HTMLElement | null;
  if (!target) return null;

  /* 1. floating objects — select + publish in ONE synchronous step so the
     box also gets its visible selection outline, like a real click */
  const floatEl = target.closest?.(FLOAT_TARGET) as HTMLElement | null;
  if (floatEl) {
    const floatId = floatEl.getAttribute('data-float-id');
    /* publish FIRST (synchronous): the store holds only the previously
       selected object, so a first-time right-click needs this to resolve */
    if (floatId) getFloatingSelectionBridge()?.select(floatId);
    const floats = getSourceSelections().floating ?? [];
    const hit = floatId
      ? floats.find((o) => (o.attrs as { element?: { id?: string } })?.element?.id === floatId)
      : null;
    return hit ?? null;
  }

  /* 2. document objects — a right-click on the document drops any floating
     selection first so the resolved context cannot be a stale object */
  getFloatingSelectionBridge()?.select(null);

  const within = posAtEvent(editor, event);
  if (within == null) return null;
  try {
    const $pos = editor.state.doc.resolve(within);
    /* NodeSelection when the pointer is directly on an atomic node (image,
       equation…) — from either side, since posAtCoords may land before OR
       after the node depending on where inside it the pointer hit */
    const after = $pos.nodeAfter;
    const before = $pos.nodeBefore;
    if (after && after.type.spec.atom) {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, within)));
      return null;
    }
    if (before && before.type.spec.atom) {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, within - before.nodeSize)));
      return null;
    }
    /* otherwise: keep an existing selection that CONTAINS the pointer; when
       the pointer sits OUTSIDE the current selection, park the caret there —
       the menu then acts on the paragraph the user actually clicked */
    const sel = editor.state.selection;
    const inside = within >= sel.from && within <= sel.to;
    if (!inside) {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, within)));
    }
  } catch { /* best effort — keep the current selection */ }
  return null;
}

/**
 * Build the menu for what the user right-clicked — ONE context, ONE menu.
 *
 * `floatHit` is the floating object returned by detectRightClickTarget().
 * `event` detects the empty-page fallback (pointer on page margins/gaps,
 * outside any text flow). Every context renders ONLY its relevant actions.
 */
export function buildContextMenuItems(
  editor: Editor | null,
  actions: CtxMenuActions,
  floatHit: SelectableObject | null = null,
  event?: MouseEvent,
): MenuItem[] {
  if (!editor) return [];

  /* floating shape / text box / sticky / float image */
  if (floatHit) return shapeMenu(floatHit);

  /* empty page area — pointer outside the text flow entirely (page margins,
     gaps between sheets) */
  if (event && posAtEvent(editor, event) == null) return emptyPageMenu(editor, actions);

  let ctx: ReturnType<typeof resolveSelectionContext> = null;
  try { ctx = resolveSelectionContext(editor); } catch { ctx = null; }

  /* on the text flow but no object context (plain paragraph caret) → the
     TEXT menus; NOT the empty-page menu — the user clicked on text */
  if (!ctx) {
    return editor.state.selection.empty
      ? normalTextMenu(editor, actions)
      : selectedTextMenu(editor, actions);
  }

  const primary = ctx.primary;
  if (primary.source === 'floating') return shapeMenu(primary);

  const attrs = primary.attrs as Record<string, unknown>;
  switch (primary.type) {
    case 'image': return imageMenu(editor, attrs);
    case 'table': case 'tableRow': case 'tableCell': case 'tableHeader':
      return tableMenu(editor, primary.type === 'tableCell' || primary.type === 'tableHeader');
    case 'equation': case 'equationInline': return equationMenu(editor);
    case 'calloutBlock': case 'questionBlock': case 'exampleBlock': case 'keyTermBlock':
    case 'longAnswerBlock': case 'footnoteBlock': case 'highlightBox': case 'referenceBlock':
      return [...eduBlockMenu(editor), ...(editor.state.selection.empty
        ? normalTextMenu(editor, actions)
        : selectedTextMenu(editor, actions))];
    /* caret ON a link without a selection → the normal menu already shows
       the پیوند submenu; only a real selection needs the full text menu */
    case 'link':
      return editor.state.selection.empty
        ? normalTextMenu(editor, actions)
        : selectedTextMenu(editor, actions);
    default: break;
  }

  /* text: caret vs selection */
  return editor.state.selection.empty
    ? normalTextMenu(editor, actions)
    : selectedTextMenu(editor, actions);
}
