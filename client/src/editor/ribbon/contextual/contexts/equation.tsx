/* ══════════════════════════════════════════════════════════════════════════
   Equation context — the "Equation / Design" tab (Word-style).

   Registration, not architecture: it only matches `equation` /
   `equationInline` nodes and contributes ONE compact contextual tab whose
   tools run against the ACTIVE equation through the bridge — the equation
   the user is editing right now. Design goals:
   • the tab looks native (same RibbonGroup/Button primitives) — it is a
     menu, not a dashboard: ONE symbol button + ONE structures button,
     not a wall of family buttons.
   • typewriter shortcuts are discoverable: typing x^2 / x_i / a/b builds
     real structures — the Structures picker says so on every item.
   • every item carries its LaTeX command as the tooltip.
   ══════════════════════════════════════════════════════════════════════════ */

import type {
  ContextProvider, ObjectCapabilities,
  ContextualTab, ContextualGroup, ContextualTool, ContextualAction,
} from '../types';
import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { h4 } from '../icons';
import {
  Sigma, Trash2, AlignLeft, AlignCenter, AlignRight,
  Table, Rows3, Braces, Superscript, Subscript,
} from 'lucide-react';
import { SYMBOL_CATEGORIES, SYMBOLS } from '@/editor/equations/symbols';
import { STRUCTURES } from '@/editor/equations/structures';
import { getActiveEquation, type ActiveEquation } from '@/editor/equations/bridge';

export const EQUATION_CONTEXT_ID = 'context.equation';

interface EquationAttrs extends Record<string, unknown> {
  editor: Editor;
  display?: boolean;
  align?: string;
  numbered?: boolean | string;
  mode?: string;
}

function capabilities(): ObjectCapabilities {
  return {
    canDelete: true,
    canDuplicate: true,
    canAlign: true,
    canEditText: true,
    'equation:convert': true,
    'equation:number': true,
    'equation:display': true,
  };
}

/* ── tool helpers ─────────────────────────────────────────────────── */

type ActiveEq = ActiveEquation | null;

function act(key: string, title: string, icon: React.ReactNode, run: () => void, label?: string, active?: boolean): ContextualAction {
  return { key, title, icon, run, label, active };
}

function withActive(eq: ActiveEq, fn: (active: ActiveEquation) => void) {
  if (!eq) return;
  fn(eq);
}

/* ── groups ───────────────────────────────────────────────────────── */

function groups(a: EquationAttrs): ContextualGroup[] {
  const ed = a.editor;
  /* The resolved selection context guarantees an equation is NodeSelected
     whenever this tab renders — but the ACTIVE impl may be stale (e.g. the
     user clicked away, then reopened the tab). Re-focus by selecting the
     node again: the NodeView re-registers on the selection update. */
  const refocusSelected = () => {
    const { state } = ed;
    const node = state.selection.$from.nodeAfter ?? state.doc.nodeAt(state.selection.from);
    if (!node || (node.type.name !== 'equation' && node.type.name !== 'equationInline')) return;
    ed.view.dispatch(ed.state.tr.setSelection(
      NodeSelection.create(state.doc, state.selection.from),
    ));
    ed.view.focus();
  };
  /** resolve the active equation, re-selecting the node first if needed */
  const active = (): ActiveEq => {
    const eq = getActiveEquation();
    if (!eq) refocusSelected();
    return getActiveEquation();
  };
  /* inserting a NEW equation while one is NodeSelected would REPLACE it —
     collapse the selection to after the node first (Word behavior) */
  const insertNew = (opts: { display: boolean }) => () => {
    const { to } = ed.state.selection;
    ed.chain().focus().setTextSelection(to).insertEquation(opts).run();
  };

  const inline = a.display === false;

  return [
    /* ── Equation — object commands ── */
    {
      key: 'eq.tools',
      label: 'معادله',
      tools: [
        act('eq.edit', 'ویرایش معادله (کلیک روی فرمول هم همین کار را می‌کند)', h4(Sigma), () => {
          withActive(active(), (eq) => eq.requestEdit());
        }, 'ویرایش'),
        act('eq.new', 'معادله جدید (نمایشی)', h4(Sigma), insertNew({ display: true }), 'جدید'),
        act('eq.inline', 'معادله درون‌خطی', h4(Sigma), insertNew({ display: false }), 'درون‌خطی'),
        { separator: true, key: 's0' },
        act('eq.sup', 'بالانویس (توان)', h4(Superscript), () => withActive(active(), (eq) => eq.insertStructureKey('sup')), 'بالانویس'),
        act('eq.sub', 'زیرنویس', h4(Subscript), () => withActive(active(), (eq) => eq.insertStructureKey('sub')), 'زیرنویس'),
        act('eq.subsup', 'زیرنویس و توان', h4(Sigma), () => withActive(active(), (eq) => eq.insertStructureKey('subsup')), 'اندیس'),
        { separator: true, key: 's0b' },
        act('eq.delete', 'حذف معادله', h4(Trash2), () => ed.chain().focus().deleteSelection().run()),
      ],
    },

    /* ── Structures — ONE dropdown, three labeled columns ── */
    {
      key: 'eq.structures',
      label: 'ساختارها',
      tools: [structurePickerTool(active)],
    },

    /* ── Symbols — ONE dropdown: search + category chips + grid ── */
    {
      key: 'eq.symbols',
      label: 'نمادها',
      tools: [symbolPickerTool(active)],
    },

    /* ── Convert — real AST ↔ LaTeX, display ↔ inline ── */
    {
      key: 'eq.convert',
      label: 'تبدیل',
      tools: [
        act('eq.professional', 'حرفه‌ای — نمایش ریاضی کامل', undefined, () => withActive(active(), (eq) => eq.setMode('professional')), 'حرفه‌ای', a.mode !== 'linear'),
        act('eq.linear', 'خطی — کد LaTeX قابل ویرایش', undefined, () => withActive(active(), (eq) => eq.openLinearEditor()), 'خطی', a.mode === 'linear'),
        { separator: true, key: 's1' },
        act('eq.display', 'نمایشی — خط مستقل', undefined, () => withActive(active(), (eq) => eq.setDisplay(true)), 'نمایشی', !inline),
        act('eq.inlineMode', 'درون‌خطی — داخل متن، با Enter خارج شوید', undefined, () => withActive(active(), (eq) => eq.setDisplay(false)), 'درون‌متنی', inline),
      ],
    },

    /* ── Options — alignment + numbering ── */
    {
      key: 'eq.options',
      label: 'گزینه‌ها',
      tools: [
        act('eq.align.l', 'چپ‌چین', h4(AlignLeft), () => withActive(active(), (eq) => eq.setAlign('left')), undefined, a.align === 'left'),
        act('eq.align.c', 'وسط‌چین', h4(AlignCenter), () => withActive(active(), (eq) => eq.setAlign('center')), undefined, !a.align || a.align === 'center'),
        act('eq.align.r', 'راست‌چین', h4(AlignRight), () => withActive(active(), (eq) => eq.setAlign('right')), undefined, a.align === 'right'),
        /* شماره‌گذاری معادله removed (item 18) — numbering served nobody;
           equations are unnumbered unless content already carries a number */
      ],
    },
  ];
}

/* ── pickers ──────────────────────────────────────────────────────── */

/* copySelectedLatex was removed with the «کپی فرمول به LaTeX» button —
   meaningless to normal users (item 16). Power users can still switch the
   equation to خطی mode, which shows and edits the raw LaTeX inline. */

function insertIntoSelected(ed: Editor, latex: string | undefined) {
  ed.chain().focus().insertEquation(latex !== undefined ? { display: true, latex } : { display: true }).run();
}

/** ONE symbol dropdown: search box + category chips + grid. Every symbol
 *  inserts a real `sym` AST node through the bridge. */
function symbolPickerTool(active: () => ActiveEq): ContextualTool {
  return {
    key: 'eq.symbols.picker',
    title: 'کتابخانه نمادهای ریاضی (دسته‌بندی‌شده + جستجو)',
    label: 'نمادها',
    icon: h4(Sigma),
    dropdown: {
      width: 340,
      /* persistent: stays open across outside clicks — insert symbol after
         symbol while clicking into the formula between picks (Word-style) */
      persistent: true,
      render: () => <SymbolPicker active={active} />,
    },
  } as unknown as ContextualTool;
}

function SymbolPicker({ active }: { active: () => ActiveEq }) {
  const cats = SYMBOL_CATEGORIES;
  const [cat, setCat] = useState<string>(cats[0]?.id ?? 'basic');
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const list = query
    ? SYMBOLS.filter((s) =>
      (s.id ?? '').toLowerCase().includes(query) ||
      (s.cmd ?? '').toLowerCase().includes(query) ||
      s.ch === q.trim())
    : SYMBOLS.filter((s) => s.cat === cat);
  return (
    <div data-keep-open className="w-[336px]">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="جستجوی نماد… (alpha, int, inf)"
        className="mb-1.5 w-full rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-[12px] text-ink-800 outline-none transition-colors placeholder:text-ink-400 focus:border-accent-400 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
        dir="auto"
      />
      {!query && (
        <div className="flex flex-wrap gap-1 border-b border-ink-100 pb-1.5 dark:border-ink-800">
          {cats.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCat(c.id)}
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                cat === c.id
                  ? 'bg-accent-100 text-accent-800 dark:bg-accent-900/40 dark:text-accent-200'
                  : 'text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="grid max-h-64 grid-cols-8 gap-0.5 overflow-y-auto pt-1.5" dir="ltr">
        {list.map((s, i) => (
          <button
            key={`${s.id ?? s.ch}-${i}`}
            type="button"
            title={s.cmd ? `\\${s.cmd}` : s.id ?? s.ch}
            dir="ltr"
            onClick={() => withActive(active(), (eq) => eq.insertSymbol(s.ch))}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[15px] text-ink-800 transition-all hover:scale-110 hover:bg-accent-50 active:scale-95 dark:text-ink-100 dark:hover:bg-ink-800"
          >
            {s.ch}
          </button>
        ))}
        {!list.length && (
          <div className="col-span-8 py-6 text-center text-[12px] text-ink-400">نمادی یافت نشد</div>
        )}
      </div>
    </div>
  );
}

/** ONE structures dropdown — Word-style: three labeled columns
 *  (کسر و اندیس / رادیکال و انتگرال / ...), every item a mini math preview,
 *  LaTeX tip in the footer. Matrix/cases surgery lives under the grid. */
function structurePickerTool(active: () => ActiveEq): ContextualTool {
  const COLUMNS: Array<{ label: string; groups: string[] }> = [
    { label: 'کسر و اندیس', groups: ['frac', 'script'] },
    { label: 'رادیکال و انتگرال', groups: ['radical', 'integral'] },
    { label: 'عملگر بزرگ', groups: ['bigop'] },
    { label: 'پرانتز و تزئین', groups: ['bracket', 'accent'] },
    { label: 'توابع و حد', groups: ['func', 'limit'] },
    { label: 'ماتریس', groups: ['matrix'] },
    { label: 'حالت‌ها', groups: ['cases'] },
  ];

  return {
    key: 'eq.structures.picker',
    title: 'درج ساختار ریاضی (کسر، رادیکال، انتگرال، ماتریس…)',
    label: 'ساختارها',
    icon: h4(Braces),
    dropdown: {
      width: 400,
      /* persistent: stays open across outside clicks — insert structure
         after structure while editing the formula between picks */
      persistent: true,
      render: () => (
        <div data-keep-open className="w-[396px] p-1">
          <div className="grid grid-cols-2 gap-x-3">
            {COLUMNS.map((col) => {
              const items = STRUCTURES.filter((s) => col.groups.includes(s.group));
              if (!items.length) return null;
              return (
                <div key={col.label} className="mb-1">
                  <div className="mb-0.5 mt-0.5 border-b border-ink-100 pb-0.5 text-[9.5px] font-bold text-ink-400 dark:border-ink-800 dark:text-ink-500">
                    {col.label}
                  </div>
                  <div className="grid grid-cols-4 gap-0.5">
                    {items.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        title={s.label}
                        onClick={() => withActive(active(), (eq) => eq.insertStructureKey(s.key))}
                        className="mq-struct-preview flex flex-col items-center rounded-md border border-transparent px-0.5 py-1 transition-colors hover:border-accent-200 hover:bg-accent-50 dark:hover:border-ink-700 dark:hover:bg-ink-800"
                      >
                        <span
                          className="flex h-7 w-full items-center justify-center rounded border border-ink-200 bg-ink-50 text-[11px] text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200"
                          dir="ltr"
                        >
                          {s.preview}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {/* matrix / cases surgery — real commands against the caret's structure */}
          <div className="mt-1 flex items-center justify-between gap-2 border-t border-ink-100 pt-1.5 dark:border-ink-800">
            <div className="flex items-center gap-0.5">
              {[
                { cmd: 'matrix.addRowAfter', label: '+ سطر', icon: h4(Table) },
                { cmd: 'matrix.addColAfter', label: '+ ستون', icon: h4(Table) },
                { cmd: 'matrix.deleteRow', label: '− سطر', icon: h4(Table) },
                { cmd: 'matrix.deleteCol', label: '− ستون', icon: h4(Table) },
              ].map((entry) => (
                <button
                  key={entry.cmd}
                  type="button"
                  title="روی یک خانه ماتریس کلیک کنید، سپس این دکمه‌ها را بزنید"
                  onClick={() => withActive(active(), (eq) => eq.runCommand(entry.cmd))}
                  className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[10.5px] font-medium text-ink-600 transition-colors hover:bg-accent-50 hover:text-accent-700 dark:text-ink-300 dark:hover:bg-ink-800"
                >
                  {entry.icon}
                  {entry.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5">
              {[
                { cmd: 'cases.addRowAfter', label: '+ حالت', icon: h4(Rows3) },
                { cmd: 'cases.deleteRow', label: '− حالت', icon: h4(Rows3) },
              ].map((entry) => (
                <button
                  key={entry.cmd}
                  type="button"
                  title="روی یک سطر حالت‌ها کلیک کنید، سپس این دکمه‌ها را بزنید"
                  onClick={() => withActive(active(), (eq) => eq.runCommand(entry.cmd))}
                  className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[10.5px] font-medium text-ink-600 transition-colors hover:bg-accent-50 hover:text-accent-700 dark:text-ink-300 dark:hover:bg-ink-800"
                >
                  {entry.icon}
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-1 rounded-md bg-ink-50 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-ink-500 dark:bg-ink-900 dark:text-ink-400" dir="rtl">
            <b className="text-ink-600 dark:text-ink-300">میانبر تایپی:</b>{' '}
            <span dir="ltr" className="font-mono">x^2</span> → x² ،{' '}
            <span dir="ltr" className="font-mono">x_i</span> → xᵢ ،{' '}
            <span dir="ltr" className="font-mono">a/b</span> → کسر ،{' '}
            <span dir="ltr" className="font-mono">\frac&#123;a&#125;&#123;b&#125;</span> یا <span dir="ltr" className="font-mono">\sqrt&#123;x&#125;</span> هم کار می‌کند
          </div>
        </div>
      ),
    },
  } as unknown as ContextualTool;
}

/* ── provider ─────────────────────────────────────────────────────── */

function tabs(a: EquationAttrs): ContextualTab[] {
  return [
    {
      id: 'context-equation',
      label: a.display === false ? 'معادله (درون‌خطی)' : 'معادله',
      icon: h4(Sigma),
      priority: 9,
      groups: groups(a),
    } as ContextualTab,
  ];
}

export const equationProvider: ContextProvider = {
  id: EQUATION_CONTEXT_ID,
  matches: (o) => o.source === 'document' && (o.type === 'equation' || o.type === 'equationInline'),
  label: 'معادله',
  capabilities: () => capabilities(),
  tabs: (o) => tabs(o.attrs as unknown as EquationAttrs),
};
