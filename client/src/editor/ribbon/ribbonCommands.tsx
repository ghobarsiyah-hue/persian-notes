import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { useApp } from '@/store/AppProvider';
import {
  Bold, Italic, Underline, Strikethrough,
  Superscript, Subscript, List, ListOrdered, Quote, Code,
  Link as LinkIcon, Image as ImageIcon, Table as TableIcon, Minus, Search,
  AlignRight, AlignCenter, AlignLeft, AlignJustify, IndentIncrease, IndentDecrease,
  Undo, Redo, Type, Highlighter, Droplet, Eraser, Heading1, Heading2,
  Heading3, FilePlus, SeparatorHorizontal, BookOpen, Star, AlertCircle,
  HelpCircle, Lightbulb, Hash, Columns, FileText, PenTool, CircleDot, Sigma,
  CheckCircle, ListChecks,
  Settings, Focus, Printer, FileDown, FileCode, Save, Keyboard, History,
  ZoomIn, ZoomOut, PanelsTopLeft, Paintbrush, Plus,
  Square as SquareIcon,
  Circle as CircleIcon, Diamond as DiamondIcon,
  Sparkles as SparklesIcon, ArrowRight, MessageSquare,
} from 'lucide-react';
import { faDigits } from '@/utils/fa';
import type { BorderStyle, BorderSettings, PageKind, EduBlocksSettings, SaveState } from '@/types';
import { SaveStatusBadge } from '@/components/editor/SaveStatusBadge';
import {
  RibbonTabs, RibbonGroup, RibbonSeparator, RibbonButton, RibbonColorButton,
  RibbonSelect, RibbonDropdown, RibbonMenuSection, RibbonMenuItem,
  RibbonMenuDivider, FileMenu, RibbonContextualTab,
  RibbonPanel, FontSizeCombo, anyPanelOpen, livePanelOpen, subscribePanels,
  AccountChip,
} from './RibbonUI';
import { FindPanel } from './FindPanel';
import { useContextualRibbon } from './contextual/useContextualRibbon';
import { ContextualToolRow } from './contextual/ContextualToolRow';
import { PageTypePicker } from '@/components/editor/PageTypePicker';
import { IconPicker } from '@/components/editor/IconPicker';
import { svgToDataUri } from '@/components/editor/iconAssets';
import { planTable, measureImportSpace } from '@/editor/importCapacity';

/* ────────────────────────────────────────────────────────────────────────
   Ribbon command layer.
   Every control below reuses an EXISTING TipTap command or an existing
   page-level callback — no fake buttons. Commands are grouped per tab so
   the Ribbon is easy to extend.
   ──────────────────────────────────────────────────────────────────────── */

export interface RibbonProps {
  editor: Editor | null;
  /* page-level callbacks (same handlers the old toolbar used) */
  onOpenAIPanel: () => void;
  /** whether the AI panel is currently open — drives the AI button's
      toggle state (aria-pressed + active style). Undefined = unknown. */
  aiPanelOpen?: boolean;
  onOpenPrintPreview: () => void;
  onToggleFind: () => void;
  onNewPage?: () => void;
  /** add a page of a specific visual kind (بلنک بدون قاب / نوت‌بوکی خط‌دار) */
  onAddPage: (kind: PageKind) => void;
  onAppendPageAtEnd: () => void;
  /* floating layers of the ACTIVE page (text boxes / shapes) — moved here
     from the old PageToolbar above the workspace */
  onAddFloatingElement: (type: import('@/components/editor/FloatingLayer').FloatingElementType, init?: { src?: string; width?: number; height?: number; aspectRatio?: number }) => void;
  /* BUG-2: import modal — single source of truth for capacity. The modal
     shows what the central engine says fits; the host inserts exactly that. */
  onNavigateSettings: () => void;
  /** right sidebar (پنل کناری) open state — default closed */
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onToggleFocus: () => void;
  onSave: () => void;
  onShowHistory: () => void;
  onShowShortcuts: () => void;
  onExportWord: () => void;
  onExportHtml: () => void;
  /* document-level settings (real, persisted via saveSettings) */
  wordCount: number;
  border: BorderSettings;
  onBorderChange: (patch: Partial<BorderSettings>) => void;
  zoom: number;
  onZoomChange: (z: number) => void;
  /** visual style of the educational (کادر آموزشی) blocks — persisted setting.
   *  legacy string form is normalized by the AppProvider before it lands here. */
  eduBlocks: EduBlocksSettings;
  /** open the کادرهای آموزشی customization modal */
  onOpenEduBlocks: () => void;
  /** centralized save-state of THIS document (§6) — rendered as the subtle
   *  persistent status chip in the top bar; never another note's state */
  saveState: SaveState;
  /** collaboration presence chip (group notes only; null = personal note —
   *  a separate concern from saveState, never merged with it) */
  collabPresence?: React.ReactNode;
}

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
const SIZES = [12, 14, 16, 18, 20, 24, 30, 36, 48];
const BORDER_STYLES: Array<{ value: BorderStyle; label: string }> = [
  { value: 'classic', label: 'کلاسیک (موجی)' },
  { value: 'double', label: 'دوردیف' },
  { value: 'ornate', label: 'تزئینی' },
  { value: 'minimal', label: 'مینیمال' },
  { value: 'none', label: 'بدون قاب' },
];
const FILL_COLORS: Array<{ value: string; label: string }> = [
  { value: '#b8d8e8', label: 'آبی یخی (پیش‌فرض)' },
  { value: '#cfe3ec', label: 'آبی نفتی ملایم' },
  { value: '#f2d4dc', label: 'صورتی ملایم' },
  { value: '#f2e3b3', label: 'زرد ملایم' },
  { value: '#dcd3ee', label: 'بنفش ملایم' },
  { value: '#e0e0e0', label: 'خاکستری ملایم' },
  { value: 'none', label: 'بدون رنگ' },
];
const BORDER_COLORS = [
  { label: 'سرمه‌ای/طلایی (پیش‌فرض)', primary: '#1e3a5f', secondary: '#c5a24d' },
  { label: 'آبی نفتی', primary: '#175e7d', secondary: '#4490ad' },
  { label: 'بنفش', primary: '#6d28d9', secondary: '#c4b5fd' },
  { label: 'قرمز', primary: '#b91c1c', secondary: '#f59e0b' },
  { label: 'خاکستری', primary: '#343434', secondary: '#a3a3a3' },
];

const icon4 = (I: React.ComponentType<{ className?: string }>) => <I className="h-4 w-4" />;

/* ── ListMarker option tables (extensions/ListMarker.ts) ────────────────
   One token per row; `''` = the stock look. The glyph column previews the
   real shape; value maps to data-marker CSS tokens (editor + PDF 1:1). */
const UL_MARKER_OPTIONS = [
  { value: 'disc', glyph: '●', label: 'دایره توپر (پیش‌فرض)' },
  { value: 'circle', glyph: '○', label: 'دایره توخالی' },
  { value: 'square', glyph: '▪', label: 'مربع' },
  { value: 'diamond', glyph: '◆', label: 'لوزی' },
  { value: 'dash', glyph: '—', label: 'خط تیره' },
  { value: 'none', glyph: '⌀', label: 'بدون نشان' },
];
const OL_MARKER_OPTIONS = [
  { value: 'decimal', glyph: '1.', label: 'عدد (پیش‌فرض)' },
  { value: 'fa', glyph: '۱.', label: 'عدد فارسی' },
  { value: 'paren', glyph: '١)', label: 'عدد با پرانتز' },
  { value: 'alpha', glyph: 'a.', label: 'حرف الفبا' },
  { value: 'roman', glyph: 'I.', label: 'عدد رومی' },
  { value: 'none', glyph: '⌀', label: 'بدون شماره' },
];

/** current font size of the selection (fallback: document default) */
function currentFontSize(editor: Editor): number {
  const raw = editor.getAttributes('textStyle').fontSize as string | undefined;
  const parsed = raw ? parseInt(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : 16;
}

/** insert an educational/callout block at the caret */
function insertBlock(editor: Editor, payload: Record<string, unknown>) {
  editor.chain().focus().insertContent(payload as never).run();
}

/** Apply text-align per the original spec (item 3):
 *  text highlighted → only the paragraphs the selection touches;
 *  nothing highlighted (collapsed caret) → the WHOLE box (all blocks
 *  of the active page), then restore the caret where it was.
 *  Inside tables / on node selections, stay native (current cell only)
 *  — selectAll there would leak alignment outside the table.
 */
function setTextAlignSmart(editor: Editor, align: string) {
  const { from, to } = editor.state.selection;
  const caretInTable = editor.isActive('table');
  if (from === to && !caretInTable) {
    editor.chain().focus().selectAll().setTextAlign(align).setTextSelection(from).run();
    return;
  }
  editor.chain().focus().setTextAlign(align).run();
}

export function Ribbon({
  editor, onOpenAIPanel, aiPanelOpen, onOpenPrintPreview, onToggleFind,
  onNewPage, onAddPage, onAppendPageAtEnd, onAddFloatingElement,
  onNavigateSettings, onToggleSidebar,
  onToggleFocus, onSave, onShowHistory, onShowShortcuts, onExportWord, onExportHtml,
  wordCount, border, onBorderChange, zoom, onZoomChange,
  eduBlocks, onOpenEduBlocks, saveState, collabPresence,
}: RibbonProps) {
  const { toast, user, online, settings } = useApp();
  const navigate = useNavigate();
  /* re-render on every transaction so active states + contextual tabs track selection */
  const [, bump] = useState(0);
  const [tab, setTab] = useState<string>('home');
  const [fileOpen, setFileOpen] = useState(false);
  /* any open ribbon panel (equation pickers, search panel, …) blocks the
     contextual auto-switch below AND freezes the resolved context —
     editing the equation between symbol picks must never unmount the open
     picker (item ۴/14). panelTick makes the panel registry reactive. */
  const [panelTick, bumpPanels] = useState(0);
  useEffect(() => subscribePanels(() => bumpPanels((n) => n + 1)), []);
  /* جستجو و جایگزینی lives in a dropdown panel opened by the persistent
     toolbar search icon (top bar) — no more floating search box.
     findReplace: the panel opens with its جایگزینی row expanded (Ctrl+H). */
  const [findOpen, setFindOpen] = useState(false);
  const [findReplace, setFindReplace] = useState(false);

  useEffect(() => {
    if (!editor) return;
    const h = () => bump((n) => n + 1);
    editor.on('transaction', h);
    return () => { editor.off('transaction', h); };
  }, [editor]);

  /* ── contextual ribbon — resolved from the LIVE selection ── */
  const { ctx } = useContextualRibbon(editor);
  /* while a panel is open, FREEZE the resolved context — each equation edit
     is a transaction that can disturb the selection, and a context swap
     would unmount the tool row — closing the open symbols/structures picker
     mid-flow. Word freezes the ribbon the same way while a dialog is open.
     Panels close via their own toggle button, Escape or a direct tab click —
     then the live context resumes.
     EXCEPTION (live formatting panels, §2/§3): object formatting panels
     re-render from the CURRENT selection on every change — freezing them
     served a stale element snapshot so consecutive patches overwrote each
     other and live preview never reached the object. If the open panel set
     contains at least one non-live panel, the freeze stays on; live panels
     alone never freeze. */
  const panelOpenNow = anyPanelOpen();
  const frozenByNonLivePanel = panelOpenNow && !livePanelOpen();
  const lastLiveCtxRef = useRef(ctx);
  if (!frozenByNonLivePanel) lastLiveCtxRef.current = ctx;
  const liveCtx = frozenByNonLivePanel ? (lastLiveCtxRef.current ?? ctx) : ctx;
  /* the contextual tab the user is actually viewing (sticky while the
     selection keeps the same tab set, restored when it collapses) */
  const [contextTab, setContextTab] = useState('');
  /* custom table size state for the visual-grid insert picker — must live
     ABOVE the `if (!editor)` early return: hooks run unconditionally or
     React kills the component with "Rendered more hooks" on editor load. */
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const contextualTabs = liveCtx?.tabs.filter((t) => !t.mergesWith) ?? [];
  const contextualIds = contextualTabs.map((t) => t.id);
  const viewingContextual = contextualIds.includes(contextTab);
  const effectiveTab = viewingContextual ? contextTab : tab;

  /* Word behavior: when a context appears (or switches object family), its
     first tab activates; when it disappears the standard tab resumes on its
     own — `tab` is never touched while a context is active, so there is
     nothing to restore. Reactions run on the resolved context itself.
     DEFERRED while any ribbon panel is open: editing the equation through
     an open symbols/structures picker changes the selection (each commit is
     a transaction) — auto-switching then would remount the picker mid-flow
     (item ۴/14: the modal must never close while the user edits). */
  const prevCtxKey = useRef('');
  useEffect(() => {
    if (anyPanelOpen()) return;
    const key = contextualIds.join('|');
    if (key === prevCtxKey.current) return;
    prevCtxKey.current = key;
    setContextTab(contextualTabs[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextualIds.join('|'), panelTick]);

  /* Ctrl+F opens the toolbar search panel; Ctrl+H opens it with the
     جایگزینی row expanded. Esc closes it. Alt+S toggles the right sidebar. */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFindOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setFindReplace(true);
        setFindOpen(true);
      } else if (e.key === 'Escape') {
        setFindOpen(false);
      } else if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onToggleSidebar?.();
      }
    };
    window.addEventListener('keydown', handler);
    /* the right-click menu's جستجو/جایگزینی در متن opens this same panel
       through a window event (the panel state lives inside the Ribbon);
       detail.replace expands the panel's جایگزینی row */
    const onOpenFind = (e: Event) => {
      const replace = (e as CustomEvent<{ replace?: boolean }>).detail?.replace === true;
      if (replace) setFindReplace(true);
      setFindOpen(true);
    };
    window.addEventListener('pn:open-find', onOpenFind);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('pn:open-find', onOpenFind);
    };
  }, [onToggleSidebar]);

  if (!editor) return null;

  /* ⚠️ TipTap executes chained commands the moment they are CALLED, not on
     .run() — so a render-time `editor.chain().focus()` queued the focus
     command on EVERY re-render, and its internal requestAnimationFrame
     stole focus back to the document from any ribbon <input> the user was
     typing in (متن قاب / any future field). Create the chain lazily inside
     each click handler instead, where focusing the editor is intended. */
  const ch = () => editor.chain().focus();
  const fontSize = currentFontSize(editor);
  /* size options always include the CURRENT size, so a custom value stays
     visible and re-selectable (the old <select> injected it as an extra
     <option> when it wasn't in the fixed list) */
  const sizeOptions = Array.from(new Set([fontSize, ...SIZES]))
    .sort((a, b) => a - b)
    .map((s) => ({ value: String(s), label: faDigits(s) }));
  const inTable = editor.isActive('table');
  const inLink = editor.isActive('link');

  /* current paragraph/heading indent level (0–4) for stepping */
  const indentLevel = (() => {
    const attrs = editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph');
    return Math.max(0, Math.min(4, Number(attrs.indent) || 0));
  })();

  /* ── ListMarker state: the ACTIVE list's node type + current token ── */
  const listType: 'bulletList' | 'orderedList' | null = editor.isActive('bulletList')
    ? 'bulletList'
    : editor.isActive('orderedList')
      ? 'orderedList'
      : null;
  const inList = listType !== null;
  const currentMarker = inList ? ((editor.getAttributes(listType).marker as string) ?? '') : '';
  const listMarkerOptions = listType === 'orderedList' ? OL_MARKER_OPTIONS : UL_MARKER_OPTIONS;

  /* ── تصویر خالی — floating image via file picker; the box starts at a
     sane aspect-correct dimension capped to the A4 content width, then the
     user drags it / resize-handles it like any other floating layer ── */
  const insertFloatingImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result);
        const img = new Image();
        img.onload = () => {
          const maxW = 620;
          const w = Math.min(maxW, img.naturalWidth || maxW);
          const h = Math.round(w / ((img.naturalWidth || w) / (img.naturalHeight || 1)));
          onAddFloatingElement('image', { src, width: w, height: h, aspectRatio: (img.naturalWidth || w) / (img.naturalHeight || 1) });
        };
        img.onerror = () => onAddFloatingElement('image', { src, width: 320, height: 240 });
        img.src = src;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const setLink = () => {
    const prev = (editor.getAttributes('link').href as string) || '';
    const url = window.prompt('آدرس لینک (خالی = حذف):', prev);
    if (url === null) return;
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const textColor = (editor.getAttributes('textStyle').color as string) || '#171717';
  const highlightColor = editor.isActive('highlight')
    ? ((editor.getAttributes('highlight').color as string) || '#171717')
    : '#171717';

  /* ═══════════════ TAB: خانه ═══════════════ */
  const homeTab = (
    <>
      <RibbonGroup label="فونت">
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
        />
        <RibbonButton title="بولد (Ctrl+B)" active={editor.isActive('bold')} icon={<Bold className="h-4 w-4 font-black" />} onClick={() => ch().toggleBold().run()} />
        <RibbonButton title="ایتالیک (Ctrl+I)" active={editor.isActive('italic')} icon={<Italic className="h-4 w-4" />} onClick={() => ch().toggleItalic().run()} />
        <RibbonButton title="زیرخط (Ctrl+U)" active={editor.isActive('underline')} icon={<Underline className="h-4 w-4" />} onClick={() => ch().toggleUnderline().run()} />
        <RibbonButton title="خط‌خورده" active={editor.isActive('strike')} icon={icon4(Strikethrough)} onClick={() => ch().toggleStrike().run()} />
        {/* آیتم‌های ۵ و ۶: درج لینک + نقل‌قول + بلوک کد — منتقل‌شده به کنار
            خط‌خورده (گروه فونت)، حذف‌شده از گروه‌های پراکندهٔ قبلی */}
        <RibbonButton title="درج لینک (Ctrl+K)" active={inLink} icon={icon4(LinkIcon)} onClick={setLink} />
        <RibbonButton title="نقل‌قول" active={editor.isActive('blockquote')} icon={icon4(Quote)} onClick={() => ch().toggleBlockquote().run()} />
        <RibbonButton title="بلوک کد" active={editor.isActive('codeBlock')} icon={icon4(Code)} onClick={() => ch().toggleCodeBlock().run()} />
      </RibbonGroup>
      <RibbonSeparator />

      <RibbonGroup label="رنگ">
        <RibbonColorButton
          title="رنگ متن"
          icon={<span className="text-[11px] font-black">A</span>}
          value={textColor === '#171717' ? '#171717' : textColor}
          onChange={(v) => (v ? ch().setColor(v).run() : ch().unsetColor().run())}
        />
        <RibbonColorButton
          title="هایلایت"
          icon={<Highlighter className="h-4 w-4" />}
          value={highlightColor}
          onChange={(v) => (v ? ch().toggleHighlight({ color: v }).run() : ch().unsetHighlight().run())}
        />
        <RibbonButton title="پاک کردن رنگ‌ها" icon={icon4(Eraser)} onClick={() => ch().unsetColor().unsetHighlight().run()} />
      </RibbonGroup>
      <RibbonSeparator />

      <RibbonGroup label="پاراگراف">
        <RibbonDropdown
          button={{ icon: icon4(AlignCenter), label: 'هم‌ترازی', title: 'جهت‌دهی پاراگراف', active: !!editor.isActive({ textAlign: 'right' }) || !!editor.isActive({ textAlign: 'center' }) || !!editor.isActive({ textAlign: 'left' }) || !!editor.isActive({ textAlign: 'justify' }) }}
          width={190}
        >
          <RibbonMenuSection label="هم‌ترازی" />
          <RibbonMenuItem icon={icon4(AlignRight)} label="راست‌چین" active={editor.isActive({ textAlign: 'right' })} onClick={() => setTextAlignSmart(editor, 'right')} />
          <RibbonMenuItem icon={icon4(AlignCenter)} label="وسط‌چین" active={editor.isActive({ textAlign: 'center' })} onClick={() => setTextAlignSmart(editor, 'center')} />
          <RibbonMenuItem icon={icon4(AlignLeft)} label="چپ‌چین" active={editor.isActive({ textAlign: 'left' })} onClick={() => setTextAlignSmart(editor, 'left')} />
          <RibbonMenuItem icon={icon4(AlignJustify)} label="هم‌تراز (justify)" active={editor.isActive({ textAlign: 'justify' })} onClick={() => setTextAlignSmart(editor, 'justify')} />
        </RibbonDropdown>
        <RibbonDropdown
          button={{ icon: icon4(List), label: 'فهرست', title: 'فهرست‌ها و تورفتگی', active: editor.isActive('bulletList') || editor.isActive('orderedList') || editor.isActive('taskList') }}
          width={210}
        >
          <RibbonMenuSection label="فهرست‌ها" />
          <RibbonMenuItem icon={icon4(List)} label="فهرست نقطه‌ای" active={editor.isActive('bulletList')} onClick={() => ch().toggleBulletList().run()} />
          <RibbonMenuItem icon={icon4(ListOrdered)} label="فهرست شماره‌دار" active={editor.isActive('orderedList')} onClick={() => ch().toggleOrderedList().run()} />
          <RibbonMenuItem icon={icon4(ListChecks)} label="چک‌لیست" active={editor.isActive('taskList')} onClick={() => ch().toggleTaskList().run()} />
          {/* marker glyph — lives on the ACTIVE list node; change or remove
              AFTER creation (ListMarker extension + data-marker CSS tokens) */}
          {inList && (
            <>
              <RibbonMenuDivider />
              <RibbonMenuSection label="نماد فهرست" />
              {listMarkerOptions.map((m) => (
                <RibbonMenuItem
                  key={m.value || 'stock'}
                  icon={<span className="min-w-5 text-center text-[13px]" style={{ fontWeight: m.value === 'dash' ? 600 : 400 }}>{m.glyph}</span>}
                  label={m.label}
                  active={currentMarker === m.value}
                  onClick={() => editor.chain().focus().updateAttributes(listType, { marker: m.value }).run()}
                />
              ))}
            </>
          )}
          <RibbonMenuDivider />
          <RibbonMenuSection label="تورفتگی" />
          <RibbonMenuItem icon={icon4(IndentIncrease)} label="تورفتگی بیشتر" hint="Tab" onClick={() => ch().setIndent(indentLevel + 1).run()} />
          <RibbonMenuItem icon={icon4(IndentDecrease)} label="تورفتگی کمتر" hint="Shift+Tab" disabled={indentLevel === 0} onClick={() => ch().setIndent(indentLevel - 1).run()} />
        </RibbonDropdown>
      </RibbonGroup>
    </>
  );

  /* ═══════════════ TAB: افزودن (insert) ═══════════════ */
  const insertTab = (
    <>
      <RibbonGroup label="صفحات">
        <RibbonDropdown
          button={{ icon: icon4(FilePlus), label: 'افزودن صفحه جدید', title: 'افزودن صفحه بلنک (بدون قاب) یا نوت‌بوکی (خط‌دار)' }}
          width={260}
        >
          <PageTypePicker onPick={onAddPage} />
        </RibbonDropdown>
      </RibbonGroup>
      <RibbonSeparator />

      <RibbonGroup label="جدول">
        <RibbonDropdown button={{ icon: icon4(TableIcon), label: 'جدول', title: 'درج جدول' }} width={320}>
          {/* ManualFixedPagePolicy §15–17: the modal knows the ACTIVE page's
              remaining capacity BEFORE insertion. Cells beyond the maximum
              fitting rows×cols are visibly disabled (muted design tokens,
              no new colors) — the user can never pick a size that would
              obviously overflow the sheet. Computed lazily here: dropdown
              children render only while the panel is open, so the live
              measurement runs exactly when the user is choosing a size. */}
          {(() => {
            /* SINGLE SOURCE OF TRUTH: the table capacity shown here is the
               SAME engine the insert path uses (importCapacity.planTable),
               so the picker can never promise what the sheet cannot hold. */
            const plan = planTable(measureImportSpace(editor));
            const cap = { rows: Math.max(1, Math.min(plan.rows, 8)), cols: Math.max(1, Math.min(plan.cols, 10)) };
            const clamp = (n: number, max: number) => Math.max(1, Math.min(n, max));
            return (
          <div className="px-2 pt-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[9px] font-bold uppercase tracking-widest text-ink-300 dark:text-ink-600">انتخاب اندازه</span>
              <span className="text-[11px] font-semibold text-ink-600 dark:text-ink-300">
                {faDigits(rows)} × {faDigits(cols)}
              </span>
            </div>
            {/* 10 ستون × ۸ ردیف مربع — هاور روی هر مربع، اندازه را تعیین می‌کند */}
            <div className="grid grid-cols-10 gap-[3px] rounded-md border border-ink-100 bg-ink-50 p-1.5 dark:border-ink-800 dark:bg-ink-900">
              {Array.from({ length: 80 }).map((_, idx) => {
                const r = Math.floor(idx / 10);
                const c = idx % 10;
                const active = r < rows && c < cols;
                const beyond = r >= cap.rows || c >= cap.cols; // beyond the current page capacity
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={beyond}
                    aria-label={beyond
                      ? `فراتر از ظرفیت صفحه — حداکثر ${faDigits(cap.rows)} ردیف و ${faDigits(cap.cols)} ستون`
                      : `${faDigits(r + 1)} ردیف، ${faDigits(c + 1)} ستون`}
                    title={beyond ? 'از ظرفیت باقی‌مانده صفحه بیشتر است' : undefined}
                    className={`h-[22px] w-[22px] rounded-[3px] border transition-colors ${
                      beyond
                        ? 'cursor-not-allowed border-ink-100 bg-ink-100 opacity-60 dark:border-ink-800 dark:bg-ink-800'
                        : active
                          ? 'border-accent-500 bg-accent-500/80'
                          : 'border-ink-200 bg-white hover:border-accent-300 dark:border-ink-700 dark:bg-ink-800'
                    }`}
                    onMouseEnter={() => { if (!beyond) { setRows(r + 1); setCols(c + 1); } }}
                    onClick={() => { /* درج همان plan مرکزی را clamp می‌کند — بدون محاسبه‌ی موازی */ ch().insertTable({ rows: r + 1, cols: c + 1 }).run(); }}
                  />
                );
              })}
            </div>
            <div className="mt-1.5 text-center text-[10px] text-ink-400">
              جدولی با {faDigits(rows)} ردیف و {faDigits(cols)} ستون درج می‌شود
              {(cap.rows < 8 || cap.cols < 10) && (
                <span className="mr-2 text-ink-300 dark:text-ink-600">
                  (ظرفیت این صفحه: حداکثر {faDigits(cap.rows)} × {faDigits(cap.cols)})
                </span>
              )}
            </div>
          </div>
            );
          })()}
          <RibbonMenuDivider />
          {/* Custom size input: for large or small tables — clamped to the
              page's remaining capacity so «درج» can never obviously overflow */}
          <div className="px-1.5 pb-1.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-ink-300 dark:text-ink-600 pb-1">اندازه دلخواه</div>
            <div className="flex items-center gap-2">
              <input type="number" min="1" max="20" value={rows} onChange={(e) => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n) && n >= 1 && n <= 20) setRows(n); }}
                className="h-7 w-16 rounded-md border border-ink-200 bg-white px-2 text-center text-[12px] font-medium text-ink-700 outline-none focus:border-accent-400 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200"
                aria-label="تعداد ردیف" />
              <span className="text-[11px] text-ink-400">×</span>
              <input type="number" min="1" max="20" value={cols} onChange={(e) => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n) && n >= 1 && n <= 20) setCols(n); }}
                className="h-7 w-16 rounded-md border border-ink-200 bg-white px-2 text-center text-[12px] font-medium text-ink-700 outline-none focus:border-accent-400 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200"
                aria-label="تعداد ستون" />
              <button type="button" title="درج جدول با ابعاد دلخواه"                onClick={() => {
                  /* SINGLE SOURCE OF TRUTH: re-plan at click time (space may
                     have changed while the dropdown stayed open) and clamp —
                     «درج» can never obviously overflow the sheet. */
                  const cap2 = planTable(measureImportSpace(editor));
                  ch().insertTable({ rows: Math.min(rows, Math.max(1, cap2.rows)), cols: Math.min(cols, Math.max(1, cap2.cols)) }).run();
                }}
                className="ml-auto h-7 min-w-[72px] rounded-md border border-accent-500 bg-accent-500 px-2 text-[11px] font-semibold text-white hover:bg-accent-600 active:scale-95 transition-colors">
                درج
              </button>
            </div>
          </div>
        </RibbonDropdown>
      </RibbonGroup>
      <RibbonSeparator />

      {/* icon box — premium vector picker (Twemoji artwork + famous-app
          brand logos). Picks are inserted as INLINE SVG icons so they flow
          with the text and print/export identically everywhere. لینک moved
          to the خانه tab's font group (item ۵). */}
      <RibbonGroup label="آیکون">
        <RibbonDropdown button={{ icon: icon4(SparklesIcon), label: 'آیکون', title: 'درج آیکون و لوگو' }} width={360}>
          <IconPicker
            onPick={({ svg, name }) => {
              ch()
                .insertContent({
                  type: 'inlineIcon',
                  attrs: { src: svgToDataUri(svg), alt: name, title: name },
                } as never)
                .run();
              /* cursor AFTER the icon, not on it: TipTap leaves a NodeSelection
                 on the inserted atomic node, so the next keystroke REPLACED the
                 icon and it felt like a shape. With a text caret parked after
                 it, typing continues the sentence — icons behave like text. */
              const { state, view } = editor;
              const pos = Math.min(state.selection.to, state.doc.content.size);
              view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
              view.focus();
            }}
          />
        </RibbonDropdown>
      </RibbonGroup>
      <RibbonSeparator />

      {/* floating shapes — previously the PageToolbar above the workspace;
          now lives in the افزودن tab so the page area stays clean.
          §1: shapes are ONE family — هر شکل می‌تواند متن داخلی داشته باشد
          (double-click / Enter). The standalone TextBox was removed from the
          UX. آیتم ۸: خط افقی (جداکنندهٔ سند) به این منو منتقل شد. */}
      <RibbonGroup label="لایه‌های شناور">
        <RibbonDropdown button={{ icon: icon4(CircleIcon), label: 'شکل', title: 'شکل‌ها — هر شکل می‌تواند متن داشته باشد' }} width={240}>
          <RibbonMenuItem icon={icon4(SquareIcon)} label="مستطیل" hint="با متن اختیاری" onClick={() => onAddFloatingElement('rect')} />
          <RibbonMenuItem icon={icon4(SquareIcon)} label="مستطیل گرد" hint="گوشه‌های نرم" onClick={() => onAddFloatingElement('roundedRect')} />
          <RibbonMenuItem icon={icon4(CircleIcon)} label="بیضی" hint="با متن اختیاری" onClick={() => onAddFloatingElement('ellipse')} />
          <RibbonMenuItem icon={icon4(CircleIcon)} label="دایره" hint="دقیقاً گرد" onClick={() => onAddFloatingElement('circle')} />
          <RibbonMenuItem icon={icon4(DiamondIcon)} label="لوزی" hint="فلوچارت / سلسله‌مراتب" onClick={() => onAddFloatingElement('diamond')} />
          <RibbonMenuItem icon={icon4(ArrowRight)} label="فلش" hint="جهت و جریان" onClick={() => onAddFloatingElement('arrow')} />
          <RibbonMenuItem icon={icon4(MessageSquare)} label="حباب گفتار" hint="کال‌اوت با دُم" onClick={() => onAddFloatingElement('callout')} />
          <RibbonMenuDivider />
          {/* آیتم ۸: خط افقی — جداکنندهٔ سند، درج در جریان متن (نه لایهٔ شناور) */}
          <RibbonMenuItem icon={icon4(SeparatorHorizontal)} label="خط افقی" hint="جداکنندهٔ سند" onClick={() => ch().setHorizontalRule().run()} />
        </RibbonDropdown>
        <RibbonButton label="تصویر" title="تصویر — با کلیک فایل تصویر را انتخاب کنید؛ بعد از درج با درگ جابه‌جا و با دستگیره‌ها اندازه‌اش را تغییر دهید" icon={icon4(ImageIcon)} onClick={insertFloatingImage} />
      </RibbonGroup>
      <RibbonSeparator />

      <RibbonGroup label="عناصر">
        {/* معادله — INLINE at the caret (Word behavior): the box appears in
            the sentence and auto-activates. Its dropdown stays open
            (persistent, data-keep-open): «معادله نمایشی» inserts a display
            equation without closing the panel, so users can insert several.
            The old standalone فرمول (LaTeX) button is removed. */}
        <RibbonDropdown button={{ icon: icon4(Sigma), label: 'معادله', title: 'درج معادله' }} width={210}>
          <div data-keep-open>
            <RibbonMenuItem icon={icon4(Sigma)} label="معادله درون‌خطی" hint="در دل متن" onClick={() => ch().insertEquation({ display: false }).run()} />
            <RibbonMenuItem icon={icon4(Sigma)} label="معادله نمایشی" hint="خط مستقل وسط‌چین" onClick={() => ch().insertEquation({ display: true }).run()} />
          </div>
        </RibbonDropdown>
        <RibbonDropdown
          button={{ icon: icon4(BookOpen), label: 'کادر آموزشی', title: 'کادرهای آموزشی' }}
          width={220}
        >
          <RibbonMenuItem icon={icon4(BookOpen)} label="تعریف" onClick={() => insertBlock(editor, { type: 'calloutBlock', attrs: { kind: 'definition' }, content: [{ type: 'paragraph' }] })} />
          <RibbonMenuItem icon={icon4(Star)} label="نکته مهم" onClick={() => insertBlock(editor, { type: 'calloutBlock', attrs: { kind: 'important', title: 'نکته مهم' }, content: [{ type: 'paragraph' }] })} />
          <RibbonMenuItem icon={icon4(HelpCircle)} label="نکته امتحانی" onClick={() => insertBlock(editor, { type: 'calloutBlock', attrs: { kind: 'exam', title: 'نکته امتحانی' }, content: [{ type: 'paragraph' }] })} />
          <RibbonMenuItem icon={icon4(AlertCircle)} label="توجه" onClick={() => insertBlock(editor, { type: 'calloutBlock', attrs: { kind: 'warning', title: 'توجه' }, content: [{ type: 'paragraph' }] })} />
          <RibbonMenuItem icon={icon4(Lightbulb)} label="مثال" onClick={() => insertBlock(editor, { type: 'exampleBlock', attrs: { title: '' }, content: [{ type: 'paragraph' }] })} />
          <RibbonMenuItem icon={icon4(Hash)} label="اصطلاح کلیدی" onClick={() => insertBlock(editor, { type: 'keyTermBlock', attrs: { term: '' }, content: [{ type: 'paragraph' }] })} />
          <RibbonMenuItem icon={icon4(CircleDot)} label="جعبه برجسته" onClick={() => insertBlock(editor, { type: 'highlightBox', attrs: { title: 'نکته برجسته', icon: '◉' }, content: [{ type: 'paragraph' }] })} />
          <RibbonMenuItem icon={icon4(PenTool)} label="زمان‌خط" onClick={() => insertBlock(editor, { type: 'timeline', content: [{ type: 'paragraph' }] })} />
          <RibbonMenuItem icon={icon4(Columns)} label="مقایسه دو ستونه" onClick={() => insertBlock(editor, { type: 'comparisonTable', content: [{ type: 'paragraph' }] })} />
          <RibbonMenuItem icon={icon4(Columns)} label="موافق و مخالف" onClick={() => insertBlock(editor, { type: 'proConBlock', attrs: { topic: '' }, content: [{ type: 'paragraph' }] })} />
          <RibbonMenuItem icon={icon4(Code)} label="کد با خروجی" onClick={() => insertBlock(editor, { type: 'codeOutputBlock', attrs: { lang: '', label: 'کد و خروجی' }, content: [{ type: 'paragraph' }] })} />
        </RibbonDropdown>
        {/* سوالات — منوی مستقل از کادر آموزشی؛ همان معماری بلوک‌ها (تم،
            شخصی‌سازی، چاپ/PDF) */}
        <RibbonDropdown
          button={{ icon: icon4(HelpCircle), label: 'سوال', title: 'انواع سوال — تشریحی، درست/نادرست، چهارگزینه‌ای' }}
          width={220}
        >
          <RibbonMenuItem icon={icon4(HelpCircle)} label="سوال کوتاه" hint="پاسخ کوتاه در همان کادر" onClick={() => insertBlock(editor, { type: 'questionBlock', attrs: { question: '' }, content: [{ type: 'paragraph' }] })} />
          <RibbonMenuItem icon={icon4(PenTool)} label="سوال تشریحی" hint="با فضا برای پاسخ بلند" onClick={() => insertBlock(editor, { type: 'longAnswerBlock', attrs: { question: '', points: 0 }, content: [{ type: 'paragraph' }] })} />
          <RibbonMenuItem icon={icon4(CheckCircle)} label="سوال درست / نادرست" hint="با دکمه‌های درست و نادرست" onClick={() => insertBlock(editor, { type: 'trueFalseBlock', attrs: { question: '', answer: 'none' }, content: [{ type: 'paragraph' }] })} />
          <RibbonMenuItem icon={icon4(ListChecks)} label="سوال چهارگزینه‌ای" hint="۴ گزینه زیر هم یا دو ستون" onClick={() => insertBlock(editor, { type: 'mcqBlock', attrs: { qTitle: '', layout: 'stacked', options: ['', '', '', ''], correct: -1 }, content: [{ type: 'paragraph' }] })} />
          <RibbonMenuItem icon={icon4(PenTool)} label="پاسخ تشریحی" hint="برگه پاسخ جدا" onClick={() => insertBlock(editor, { type: 'longAnswerBlock', attrs: { question: 'سوال تشریحی', points: 0 }, content: [{ type: 'paragraph' }] })} />
        </RibbonDropdown>
      </RibbonGroup>
    </>
  );

  /* ═══════════════ TAB: طراحی ═══════════════ */
  const designTab = (
    <>
      <RibbonGroup label="قاب صفحه">
        <RibbonButton
          title={border.enabled ? 'غیرفعال کردن قاب' : 'فعال کردن قاب'}
          label={border.enabled ? 'قاب فعال' : 'قاب خاموش'}
          icon={icon4(PanelsTopLeft)}
          active={border.enabled}
          onClick={() => onBorderChange({ enabled: !border.enabled })}
        />
        <RibbonSelect
          title="نوع قاب"
          width={130}
          value={border.style}
          onChange={(v) => onBorderChange({ style: v as BorderStyle, enabled: v === 'none' ? false : true })}
          options={BORDER_STYLES.map((s) => ({ value: s.value, label: s.label }))}
        />
        <RibbonDropdown button={{ icon: icon4(Droplet), label: 'رنگ قاب', title: 'رنگ قاب' }} width={220}>
          {BORDER_COLORS.map((c) => (
            <RibbonMenuItem
              key={c.label}
              icon={<span className="flex gap-0.5"><span className="h-3 w-3 rounded-sm" style={{ background: c.primary }} /><span className="h-3 w-3 rounded-sm" style={{ background: c.secondary }} /></span>}
              label={c.label}
              onClick={() => onBorderChange({ primaryColor: c.primary, secondaryColor: c.secondary, enabled: true })}
            />
          ))}
        </RibbonDropdown>
        <RibbonDropdown button={{ icon: icon4(Droplet), label: 'رنگ خط میانی', title: 'رنگ نوار میانی قاب (آبی یخی)' }} width={220}>
          {FILL_COLORS.map((c) => (
            <RibbonMenuItem
              key={c.label}
              icon={<span className="h-3 w-3 rounded-sm" style={{ background: c.value === 'none' ? 'transparent' : c.value, boxShadow: c.value === 'none' ? 'inset 0 0 0 1px rgba(0,0,0,0.25)' : 'inset 0 0 0 1px rgba(0,0,0,0.1)' }} />}
              label={c.label}
              onClick={() => onBorderChange({ fillColor: c.value })}
            />
          ))}
        </RibbonDropdown>
        <RibbonButton title="ضخامت کمتر" icon={icon4(Minus)} onClick={() => onBorderChange({ thickness: Math.max(0.5, border.thickness - 0.5) })} />
        <span className="flex h-8 min-w-14 items-center justify-center text-[12px] font-semibold tabular-nums text-ink-600 dark:text-ink-300">ضخامت {faDigits(border.thickness)}</span>
        <RibbonButton title="ضخامت بیشتر" icon={icon4(Plus)} onClick={() => onBorderChange({ thickness: Math.min(3, border.thickness + 0.5) })} />
        <label
          title="متن عمودی سمت چپ قاب"
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-ink-600 transition-colors hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
        >
          متن قاب
          <input
            type="text"
            value={border.sideLabel ?? ''}
            placeholder="پیش‌فرض"
            dir="rtl"
            onChange={(e) => onBorderChange({ sideLabel: e.target.value })}
            className="h-7 w-28 rounded-md border border-ink-200 bg-transparent px-2 text-[12px] outline-none placeholder:text-ink-400 focus:border-[#0070f3] dark:border-ink-700"
          />
        </label>
      </RibbonGroup>
      <RibbonSeparator />

      <RibbonGroup label="کادرهای آموزشی">
        <RibbonButton
          title="شخصی‌سازی کادرهای آموزشی — استایل، رنگ و پیش‌نمایش زنده"
          icon={icon4(Paintbrush)}
          label={`کادرها: ${eduBlocks.base === 'minimal' ? 'حداقلی' : 'رنگی'}`}
          onClick={onOpenEduBlocks}
        />
      </RibbonGroup>

      <RibbonGroup label="صفحه">
        <RibbonButton title="تنظیمات حاشیه/اندازه چاپ (A4 عمودی ثابت)" icon={icon4(Settings)} label="تنظیمات صفحه" onClick={onOpenPrintPreview} />
      </RibbonGroup>
    </>
  );

  /* ═══════════════ TAB: مراجع ═══════════════
     (نقل‌قول اینجا نبود — تکراری؛ در تب خانه و راست‌کلیک موجود است) */
  const refsTab = (
    <>
      <RibbonGroup label="درج مرجع">
        <RibbonButton title="یادداشت پاورقی" label="پاورقی" icon={icon4(FileText)} onClick={() => insertBlock(editor, { type: 'footnoteBlock', content: [{ type: 'paragraph' }] })} />
        <RibbonButton title="منبع آکادمیک" label="منبع" icon={icon4(BookOpen)} onClick={() => insertBlock(editor, { type: 'referenceBlock', attrs: { authors: '', year: '', title: '', url: '' }, content: [{ type: 'paragraph' }] })} />
      </RibbonGroup>
    </>
  );

  /* ═══════════════ TAB: بازبینی — نمایش (بزرگ‌نمایی) ادغام‌شده اینجا
     (آیتم ۱۵: تب مستقل «نمایش» حذف شد تا ریبون جمع‌وجورتر شود) ═══════════════ */
  const reviewTab = (
    <>
      <RibbonGroup label="بزرگ‌نمایی">
        <RibbonButton title="کوچک‌نمایی" icon={icon4(ZoomOut)} onClick={() => onZoomChange(Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10))} />
        <span className="flex h-8 min-w-14 items-center justify-center text-[12px] font-semibold tabular-nums text-ink-600 dark:text-ink-300">{faDigits(Math.round(zoom * 100))}٪</span>
        <RibbonButton title="بزرگ‌نمایی" icon={icon4(ZoomIn)} onClick={() => onZoomChange(Math.min(1.5, Math.round((zoom + 0.1) * 10) / 10))} />
        <RibbonButton title="اندازه ۱۰۰٪" label="۱۰۰٪" onClick={() => onZoomChange(1)} />
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup label="متن">
        <span
          title="شمارش کلمات سند"
          className="flex h-8 min-w-14 items-center justify-center gap-1 rounded-md px-2 text-[12px] font-medium text-ink-600 dark:text-ink-300"
        >
          <Type className="h-4 w-4" />
          {faDigits(wordCount)} کلمه
        </span>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup label="نسخه‌ها">
        <RibbonButton title="ثبت نسخه از تغییرات فعلی" label="ثبت نسخه" icon={icon4(History)} onClick={onShowHistory} />
      </RibbonGroup>
    </>
  );

  /* ═══════════════ TAB: فایل (منوی سند) ═══════════════ */
  const fileMenuItems = (
    <>
      <RibbonMenuSection label="سند" />
      <RibbonMenuItem icon={icon4(Save)} label="ذخیره" hint="Ctrl+S" onClick={onSave} />
      <RibbonMenuItem icon={icon4(History)} label="ثبت نسخه" onClick={onShowHistory} />
      <RibbonMenuDivider />
      <RibbonMenuSection label="خروجی" />
      <RibbonMenuItem icon={icon4(Printer)} label="چاپ / ذخیره PDF" hint="Ctrl+P" onClick={onOpenPrintPreview} />
      <RibbonMenuItem icon={icon4(FileDown)} label="خروجی Word" onClick={onExportWord} />
      <RibbonMenuItem icon={icon4(FileCode)} label="خروجی HTML" onClick={onExportHtml} />
      <RibbonMenuDivider />
      <RibbonMenuSection label="سیستم" />
      <RibbonMenuItem icon={icon4(Keyboard)} label="میانبرها" hint="Ctrl+/" onClick={onShowShortcuts} />
      <RibbonMenuItem icon={icon4(Settings)} label="تنظیمات" onClick={onNavigateSettings} />
    </>
  );

  /* quick-access cluster: undo/redo next to فایل. The ⋯ more-menu's former
     items moved out: نقل‌قول/کد now live in the خانه tab's font group
     (item ۶), خط افقی joined the shape menu (item ۸) and اصلاح نیم‌فاصله
     was removed entirely (item ۷) — so the more-menu itself is gone. */

  /* map active tab → tool row. A contextual tab renders ONLY the selected
     object's tools; a standard tab renders its own row plus any context
     groups explicitly merged into it (e.g. text → خانه). */
  const activeContextual = contextualTabs.find((t) => t.id === effectiveTab);
  const mergedTabs = activeContextual ? [] : (liveCtx?.tabs ?? []).filter((t) => t.mergesWith === effectiveTab);
  /* single source of truth for the standard tool row — no separate viewTab
     (آیتم ۱۵: نمایش merged into بازبینی) */
  const standardRow = tab === 'home' ? homeTab
    : tab === 'insert' ? insertTab
    : tab === 'design' ? designTab
    : tab === 'refs' ? refsTab
    : reviewTab;
  const toolRow = activeContextual ? (
    <ContextualToolRow tab={activeContextual} />
  ) : (
    <>
      {standardRow}
      {mergedTabs.map((t) => (
        <ContextualToolRow key={t.id} tab={t} />
      ))}
    </>
  );

  return (
    <div
      data-ribbon-root
      className="pn-glass-panel border-b border-ink-100 dark:border-ink-800"
      style={{ boxShadow: '0 1px 0 0 rgba(0,0,0,0.06)' }}
    >
      {/* LEVEL 1 — tab bar + persistent search panel + sidebar toggle */}
      <div className="flex items-stretch justify-between gap-2 pl-3">
        <div className="flex min-w-0 items-stretch gap-2">
          <RibbonTabs
            active={effectiveTab}
            onChange={(id) => {
              /* leaving the contextual view must CLEAR the sticky context
                 tab — otherwise effectiveTab keeps resolving to it and
                 clicking a standard tab looks dead while an object is
                 selected. The contextual chip stays visible next to the
                 standard tabs (Word behavior) and can be clicked again. */
              setContextTab('');
              setTab(id);
            }}
            tabs={[
              { id: 'home', label: 'خانه' },
              { id: 'insert', label: 'افزودن' },
              { id: 'design', label: 'طراحی' },
              { id: 'refs', label: 'مراجع' },
              { id: 'review', label: 'بازبینی' },
            ]}
          />
          {/* account chip — AFTER the last tab (بازبینی). Circular avatar,
              monochrome ring states (see the Wiki). */}
          <div className="flex items-center gap-2 pb-1.5 pt-1">
            <AccountChip
              name={user?.name}
              email={user?.email}
              avatar={user?.avatar}
              online={online}
              avatarPreset={settings?.avatarPreset}
              onOpen={() => navigate('/settings?tab=account')}
            />
          </div>
        </div>
        {/* contextual tabs — generated from the resolved selection context
            (registry of per-object-type providers), not a hardcoded list.
            Clicking a standard tab while a context is active returns to it;
            the context stays available next to the standard tabs. */}
        {contextualTabs.length > 0 && (
          <div className="flex items-end pb-1.5">
            <div className="flex items-end gap-0.5 border-r border-ink-200 pr-2 dark:border-ink-800">
              {contextualTabs.map((t) => (
                <RibbonContextualTab
                  key={t.id}
                  label={t.label}
                  icon={t.icon}
                  onClick={() => { setContextTab(t.id); }}
                />
              ))}
            </div>
          </div>
        )}
        {/* far-left cluster: فایل + undo/redo + AI button + search + focus.
            آیتم ۹: فایل/برگردان/بازگردانی از کنار تب‌ها به این خوشه منتقل
            شدند (کنار هوش مصنوعی) تا همهٔ دستورات سند یک‌جا باشند. */}
        <div className="flex shrink-0 items-center gap-1 pl-1">
          <FileMenu items={fileMenuItems} open={fileOpen} onToggle={() => setFileOpen((v) => !v)} onClose={() => setFileOpen(false)} />
          <div className="flex items-center gap-0.5 border-l border-ink-100 pl-1.5 pr-1 dark:border-ink-800">
            <RibbonButton title="برگردان (Ctrl+Z)" icon={icon4(Undo)} onClick={() => ch().undo().run()} />
            <RibbonButton title="بازگردانی (Ctrl+Shift+Z)" icon={icon4(Redo)} onClick={() => ch().redo().run()} />
          </div>
          {/* persistent save-status chip (§6) — THIS document's state only,
              from the one centralized SaveState machine; no toasts on save */}
          <SaveStatusBadge state={saveState} />
          {/* collaboration presence (ویرایشگران ۲/۴ + connection dot) — only
              when the note is a live group-collaboration session */}
          {collabPresence}
          {/* حالت تمرکز — moved here (next to the AI button) from the former نمایش tab (آیتم ۱۵: merged into بازبینی) */}
          <RibbonButton title="حالت تمرکز (Ctrl+Shift+F)" icon={icon4(Focus)} onClick={onToggleFocus} />
          {/* جستجو و جایگزینی — dropdown panel from the toolbar icon itself
              (replaces the old floating search box above the editor) */}
          <RibbonPanel
            button={{ icon: icon4(Search), title: 'جستجو و جایگزینی (Ctrl+F)', active: findOpen }}
            width={430}
            open={findOpen}
            onOpen={() => setFindOpen(true)}
            onClose={() => setFindOpen(false)}
          >
            <FindPanel editor={editor} onClose={() => setFindOpen(false)} panelWidth={402} showReplace={findReplace} onShowReplaceChange={setFindReplace} />
          </RibbonPanel>
          {/* BUG-4 fix: real TOGGLE — the AI button opens the panel when it
              is closed AND CLOSES it when open (its active state follows
              aiOpen via this prop). The old always-onOpen handler made the
              second click a no-op while the panel was open. */}
          <button
            type="button"
            onClick={onToggleSidebar ?? onOpenAIPanel}
            aria-pressed={aiPanelOpen}
            aria-label="دستیار هوش مصنوعی"
            title="دستیار هوش مصنوعی (Ctrl+Shift+A / Alt+S)"
            className={`flex h-7 items-center rounded-lg px-3 text-[12px] font-semibold transition-all ${
              aiPanelOpen
                ? 'bg-ink-100 text-accent-700 ring-1 ring-accent-500/50 dark:bg-ink-800 dark:text-accent-300'
                : 'bg-gradient-to-l from-accent-600 to-accent-500 text-white hover:opacity-90 dark:from-accent-400 dark:to-accent-500 dark:text-ink-950'
            }`}
          >
            {/* AI mark — bigger, two-star sparkle composition with a soft
                drop shadow so the badge reads at a glance inside the button */}
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              style={{ filter: aiPanelOpen ? 'none' : 'drop-shadow(0 0 3px rgba(255,255,255,0.35))' }}
            >
              <path d="M11 2l2.1 6.4L19.5 10l-6.4 1.6L11 18l-2.1-6.4L2.5 10l6.4-1.6L11 2z" />
              <path d="M18.5 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
            </svg>
            {/* item ۱۳: icon-only (label removed) — the tooltip above carries
                the full name + shortcut, and aria-label keeps it accessible */}
          </button>
        </div>
      </div>

      {/* LEVEL 2 — tool ribbon for the active tab */}
      <div
        className="flex items-stretch gap-0 overflow-x-auto border-t border-ink-100 px-2 py-1 dark:border-ink-900"
        style={{ minHeight: 56, scrollbarWidth: 'thin' }}
      >
        {toolRow}
      </div>
    </div>
  );
}
