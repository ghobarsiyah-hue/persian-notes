import type {
  ContextProvider, ObjectCapabilities,
  ContextualTab, ContextualGroup, ContextualAction, ContextualTool, ContextualDropdown,
} from '../types';
import { h4 } from '../icons';
import type { Editor } from '@tiptap/core';
import { cellAround } from '@tiptap/pm/tables';
import {
  Table as TableIcon, Trash2, SquareDashedBottom,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Palette, Rows3, AlignVerticalJustifyStart, AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd, Highlighter, SwatchBook,
} from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   Table context — «چیدمان جدول» + «طراحی جدول» for table family selections.

   ROOT CAUSE of the dead design tools: TipTap's `updateAttributes` walks
   `nodesBetween(selection.from, selection.to)` — with a plain CARET inside a
   cell that range is empty and NOTHING is updated. Every table-level patch
   here therefore dispatches `tr.setNodeMarkup` DIRECTLY on the ancestor
   table node (found from the caret), and cell patches go through
   prosemirror-tables' own setCellAttr path (caret + CellSelection aware).
   ══════════════════════════════════════════════════════════════════════════ */

export const TABLE_CONTEXT_ID = 'context.table';

const TABLE_NODES = new Set(['table', 'tableRow', 'tableCell', 'tableHeader']);

interface TableAttrs extends Record<string, unknown> {
  editor: import('@tiptap/core').Editor;
}

function capabilities(): ObjectCapabilities {
  return {
    canChangeLayout: true,
    canDelete: true,
    canEditText: true,
    'table:mergeSplit': true,
    'table:dimensions': true,
    'table:design': true,
  };
}

const act = (key: string, title: string, icon: React.ReactNode, run: () => void, label?: string, active?: boolean): ContextualAction =>
  ({ key, title, icon, run, label, active });

/** Ensure a cell is selected before running a merge/split command. */
function withCell(editor: Editor, fn: () => void) {
  const { state } = editor;
  const { $from } = state.selection;
  const cellInfo = cellAround($from);
  if (!cellInfo) return;
  fn();
}

/** the table node containing the caret (or null when outside any table) */
function currentTable(ed: Editor): { pos: number; node: import('prosemirror-model').Node } | null {
  try {
    const { $from } = ed.state.selection;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'table') {
        return { pos: $from.before(d), node: $from.node(d) };
      }
    }
  } catch { /* detached */ }
  return null;
}

/** DIRECT table-attr patch — immune to the collapsed-selection no-op of
 *  TipTap's updateAttributes (the reason the design tools were dead). */
function setTableAttrs(ed: Editor, patch: Record<string, unknown>) {
  const t = currentTable(ed);
  if (!t) return;
  ed.view.dispatch(ed.state.tr.setNodeMarkup(t.pos, null, { ...t.node.attrs, ...patch }));
}

/** is the table's first row a header row? (toggleHeaderRow active state) */
function firstRowIsHeader(table: import('prosemirror-model').Node): boolean {
  const firstRow = table.firstChild;
  return !!firstRow && firstRow.firstChild?.type.name === 'tableHeader';
}

/** is the whole first column headered? (toggleHeaderColumn active state) */
function firstColIsHeader(table: import('prosemirror-model').Node): boolean {
  let rows = 0;
  table.forEach((row) => {
    rows++;
    if (row.firstChild?.type.name !== 'tableHeader') rows = -999;
  });
  return rows > 0;
}

/** background color of the cell under the caret (cell-palette active state) */
function currentCellBackground(ed: Editor): string | null {
  try {
    const cell = cellAround(ed.state.selection.$from);
    return (cell?.nodeAfter as { attrs?: { backgroundColor?: string } } | null)?.attrs?.backgroundColor ?? null;
  } catch {
    return null;
  }
}

function currentCellVAlign(ed: Editor): string | null {
  try {
    const cell = cellAround(ed.state.selection.$from);
    return (cell?.nodeAfter as { attrs?: { verticalAlign?: string } } | null)?.attrs?.verticalAlign ?? null;
  } catch {
    return null;
  }
}

/* ── table style templates (قالب‌های آماده جدول) ──
   Same idea as the کادرهای آموزشی preset gallery: one token per look,
   shipped as CSS tokens (index.css / printCss) and baked inline by the Word
   exporter, so a preset renders identically in the editor, PDF and Word. */
interface TablePreset {
  id: string;
  label: string;
  desc: string;
  swatch: [string, string];
  /** design attrs applied by the preset */
  attrs: { tstyle: string | null; striped: boolean; borderless: boolean };
}

export const TABLE_PRESETS: TablePreset[] = [
  { id: 'classic', label: 'کلاسیک', desc: 'خطوط ظریف خاکستری با سرستون روشن', swatch: ['#ffffff', '#ebebeb'], attrs: { tstyle: null, striped: false, borderless: false } },
  { id: 'navy', label: 'سرمه‌ای', desc: 'سرستون سرمه‌ای با متن سفید', swatch: ['#1e3a5f', '#dbeafe'], attrs: { tstyle: 'navy', striped: false, borderless: false } },
  { id: 'striped', label: 'راه‌راه', desc: 'ردیف‌های یک‌درمیان رنگی', swatch: ['#f4f4f5', '#ffffff'], attrs: { tstyle: null, striped: true, borderless: false } },
  { id: 'soft', label: 'ملایم', desc: 'سرستون آبی محو، خطوط نرم و راه‌راه', swatch: ['#f0f4f8', '#dbeafe'], attrs: { tstyle: 'soft', striped: true, borderless: false } },
  { id: 'minimal', label: 'مینیمال', desc: 'فقط خطوط افقی ظریف', swatch: ['#e2e5ea', '#ffffff'], attrs: { tstyle: 'minimal', striped: false, borderless: false } },
  { id: 'academic', label: 'آکادمیک', desc: 'قواعد بالا و پایین مثل مقالات علمی', swatch: ['#171717', '#ffffff'], attrs: { tstyle: 'academic', striped: false, borderless: false } },
  { id: 'bold', label: 'پررنگ', desc: 'خطوط ضخیم برای خوانایی چاپ', swatch: ['#565656', '#ffffff'], attrs: { tstyle: 'bold', striped: false, borderless: false } },
  { id: 'plain', label: 'بی‌خط', desc: 'کاملاً بدون خط، مناسب پس‌زمینه رنگی', swatch: ['#ffffff', '#fafafa'], attrs: { tstyle: 'plain', striped: false, borderless: false } },
];

/** mini-table preview used inside the preset gallery panel — a 3×2 table
 *  sketch rendered from the preset's own design attrs, so what you pick is
 *  what you get (same idea as the کادرهای آموزشی preset cards) */
function PresetCard({ p }: { p: TablePreset }) {
  const head = p.attrs.tstyle === 'navy' ? '#1e3a5f' : p.attrs.tstyle === 'soft' ? '#f0f4f8' : '#fafafa';
  const headText = p.attrs.tstyle === 'navy' ? '#ffffff' : '#171717';
  const border = p.attrs.tstyle === 'bold' ? '1.5px solid #565656'
    : p.attrs.tstyle === 'minimal' ? 'none'
    : p.attrs.tstyle === 'academic' ? 'none'
    : p.attrs.borderless || p.attrs.tstyle === 'plain' ? 'none'
    : '1px solid #e4e4e7';
  const rowLine = p.attrs.tstyle === 'minimal' ? 'border-bottom:1px solid #e2e5ea;'
    : p.attrs.tstyle === 'academic' ? 'border-top:1.5px solid #171717;border-bottom:1.5px solid #171717;'
    : p.attrs.borderless || p.attrs.tstyle === 'plain' ? ''
    : `border-bottom:${border};`;
  const striped = (i: number) =>
    (p.attrs.striped || p.attrs.tstyle === 'soft') && i % 2 === 1 ? '#f4f4f5' : 'transparent';
  return (
    <span
      aria-hidden="true"
      className="flex w-full flex-col overflow-hidden rounded-md"
      style={{ border: p.attrs.tstyle === 'academic' ? 'none' : border }}
    >
      <span style={{ background: head, color: headText, borderBottom: p.attrs.tstyle === 'minimal' ? '2px solid #9aa4af' : border, padding: '3px 5px', fontSize: 8, fontWeight: 700 }}>عنوان</span>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ background: striped(i), borderBottom: i === 2 ? 'none' : rowLine || 'none', padding: '3px 5px', fontSize: 8, color: '#52525b' }}>متن</span>
      ))}
    </span>
  );
}

const CELL_COLORS: Array<{ c: string | null; label: string }> = [
  { c: null, label: 'بدون رنگ' },
  { c: '#dbeafe', label: 'آبی روشن' },
  { c: '#dcfce7', label: 'سبز روشن' },
  { c: '#fef9c3', label: 'زرد روشن' },
  { c: '#fee2e2', label: 'قرمز روشن' },
  { c: '#fae8ff', label: 'صورتی روشن' },
  { c: '#e0f2fe', label: 'فیروزه‌ای روشن' },
  { c: '#f5f5f4', label: 'خاکستری روشن' },
  { c: '#1e3a5f', label: 'سرمه‌ای' },
];

function presetIsActive(t: import('prosemirror-model').Node | null, p: TablePreset): boolean {
  if (!t) return false;
  return t.attrs.tstyle === p.attrs.tstyle
    && t.attrs.striped === p.attrs.striped
    && t.attrs.borderless === p.attrs.borderless;
}

function designGroups(ed: Editor): ContextualGroup[] {
  const ch = () => ed.chain().focus();
  const table = currentTable(ed);
  const striped = table?.node.attrs.striped === true;
  const borderless = table?.node.attrs.borderless === true;
  const cellBg = currentCellBackground(ed);
  const cellVa = currentCellVAlign(ed);

  /* «قالب آماده» — ONE dropdown hosting the preset gallery (کادرهای آموزشی
     style cards), instead of a wall of chip buttons on the tab */
  const activePreset = TABLE_PRESETS.find((p) => presetIsActive(table?.node ?? null, p));
  const presetPicker: ContextualDropdown = {
    key: 'tbl.preset.gallery',
    title: 'قالب آماده جدول',
    label: 'قالب آماده',
    icon: h4(SwatchBook),
    dropdown: {
      width: 320,
      render: () => (
        <div className="grid grid-cols-2 gap-1 p-1">
          {TABLE_PRESETS.map((p) => {
            const active = presetIsActive(table?.node ?? null, p);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setTableAttrs(ed, p.attrs)}
                className={`flex items-center gap-2.5 rounded-lg p-1.5 text-right transition-colors ${
                  active
                    ? 'bg-accent-50 dark:bg-accent-900/30'
                    : 'hover:bg-ink-100 dark:hover:bg-ink-800'
                }`}
              >
                <span className="w-16 shrink-0"><PresetCard p={p} /></span>
                <span className="min-w-0">
                  <span className={`block text-[12px] ${active ? 'font-bold text-accent-700 dark:text-accent-300' : 'font-semibold text-ink-700 dark:text-ink-200'}`}>{p.label}</span>
                  <span className="block text-[10px] leading-4 text-ink-400 dark:text-ink-500">{p.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      ),
    },
  };

  /* «ساختار» — header rows/columns + row striping + borderless */
  const structure: ContextualTool[] = [
    act('tbl.des.headRow', 'ردیف عنوان (سرستون)', h4(Rows3), () => ch().toggleHeaderRow().run(), 'سرستون', table ? firstRowIsHeader(table.node) : false),
    act('tbl.des.headCol', 'ستون عنوان', h4(SquareDashedBottom), () => ch().toggleHeaderColumn().run(), 'ستون عنوان', table ? firstColIsHeader(table.node) : false),
    act('tbl.des.striped', 'ردیف‌های یک‌درمیان رنگی', h4(Highlighter), () => setTableAttrs(ed, { striped: !striped }), 'راه‌راه', striped),
    act('tbl.des.borderless', 'جدول بدون خط', h4(Palette), () => setTableAttrs(ed, { borderless: !borderless }), 'بی‌خط', borderless),
  ];

  /* «رنگ سلول» — ONE dropdown with a clean swatch grid (applies to the
     cell under the caret or the whole cell selection) */
  const colorPicker: ContextualDropdown = {
    key: 'tbl.des.bg.picker',
    title: 'رنگ پس‌زمینه سلول',
    label: 'رنگ سلول',
    icon: (
      <span className="flex flex-col items-center leading-none">
        <span className="inline-block h-3.5 w-3.5 rounded-[4px] border border-black/10" style={{ background: cellBg ?? 'transparent', borderStyle: cellBg ? 'solid' : 'dashed' }} />
      </span>
    ),
    dropdown: {
      width: 208,
      render: () => (
        <div className="grid grid-cols-4 gap-1 p-1">
          {CELL_COLORS.map(({ c, label }) => (
            <button
              key={label}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={cellBg === c}
              onClick={() => ch().setCellAttribute('backgroundColor', c).run()}
              className={`flex h-9 items-center justify-center rounded-lg border transition-colors ${
                cellBg === c
                  ? 'border-accent-500 ring-1 ring-accent-500/40'
                  : 'border-ink-200 hover:border-ink-300 dark:border-ink-700 dark:hover:border-ink-600'
              }`}
            >
              <span
                aria-hidden="true"
                className="h-5 w-5 rounded-md"
                style={{
                  background: c ?? 'transparent',
                  border: c ? '1px solid rgba(0,0,0,0.14)' : '1px dashed rgba(0,0,0,0.35)',
                }}
              />
            </button>
          ))}
        </div>
      ),
    },
  };

  /* «تراز عمودی سلول» */
  const valign: ContextualTool[] = [
    act('tbl.des.va.top', 'تراز عمودی بالا', h4(AlignVerticalJustifyStart), () => ch().setCellAttribute('verticalAlign', null).run(), 'بالا', !cellVa || cellVa === 'top'),
    act('tbl.des.va.middle', 'تراز عمودی وسط', h4(AlignVerticalJustifyCenter), () => ch().setCellAttribute('verticalAlign', 'middle').run(), 'وسط', cellVa === 'middle'),
    act('tbl.des.va.bottom', 'تراز عمودی پایین', h4(AlignVerticalJustifyEnd), () => ch().setCellAttribute('verticalAlign', 'bottom').run(), 'پایین', cellVa === 'bottom'),
  ];

  return [
    { key: 'tbl.preset', label: 'قالب آماده', tools: [presetPicker] },
    { key: 'tbl.des.structure', label: 'ساختار', tools: structure },
    { key: 'tbl.des.palette', label: 'رنگ سلول', tools: [colorPicker] },
    { key: 'tbl.des.valign', label: 'تراز عمودی', tools: valign },
  ];
}

function layoutGroups(ed: Editor): ContextualGroup[] {
  const ch = () => ed.chain().focus();
  const tools: ContextualTool[] = [
    act('table.row.add.after', 'افزودن ردیف', h4(ArrowDown), () => ch().addRowAfter().run()),
    act('table.row.add.before', 'افزودن ردیف', h4(ArrowUp), () => ch().addRowBefore().run()),
    act('table.row.delete', 'حذف ردیف', h4(Trash2), () => ch().deleteRow().run()),
    act('table.col.add.after', 'افزودن ستون', h4(ArrowRight), () => ch().addColumnAfter().run()),
    act('table.col.add.before', 'افزودن ستون', h4(ArrowLeft), () => ch().addColumnBefore().run()),
    act('table.col.delete', 'حذف ستون', h4(Trash2), () => ch().deleteColumn().run()),
    { separator: true, key: 's1' },
    act('table.merge', 'ادغام سلول‌ها', h4(SquareDashedBottom), () => withCell(ed, () => ch().mergeCells().run()), 'ادغام'),
    act('table.split', 'تقسیم سلول', h4(SquareDashedBottom), () => withCell(ed, () => ch().splitCell().run()), 'تقسیم'),
    { separator: true, key: 's2' },
    act('table.delete', 'حذف کل جدول', h4(Trash2), () => ch().deleteTable().run()),
  ];

  return [
    { key: 'table.rows', label: 'افزودن ردیف', tools: tools.slice(0, 3) },
    { key: 'table.cols', label: 'افزودن ستون', tools: tools.slice(3, 6) },
    { key: 'table.cell', label: 'ادغام و تقسیم', tools: tools.slice(6) },
  ];
}

function tabs(a: TableAttrs): ContextualTab[] {
  /* ONE table tab (item ۱۰): layout + design groups merged in a single
     contextual tab — order: ساختار (rows/cols) → ادغام → طراحی (قالب/رنگ/تراز).
     The former separate «طراحی جدول» tab duplicated the entry point; its
     groups now live here so every table tool is one click away. */
  return [
    {
      id: 'context-table',
      label: 'جدول',
      icon: h4(TableIcon),
      priority: 8,
      groups: [...layoutGroups(a.editor), ...designGroups(a.editor)],
    },
  ];
}

export const tableProvider: ContextProvider = {
  id: TABLE_CONTEXT_ID,
  matches: (o) => o.source === 'document' && TABLE_NODES.has(o.type),
  label: 'جدول',
  capabilities: () => capabilities(),
  tabs: (o) => tabs(o.attrs as unknown as TableAttrs),
};
