import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SidePanel, Button } from '@/components/ui';
import type { Editor } from '@tiptap/core';

/* ══════════════════════════════════════════════════════════════════════════
   Per-block شخصی‌سازی — modal host + the modal itself.

   The contextual tab and the right-click menu run OUTSIDE the React tree
   that hosts app-level modals, so this module mounts its own React root
   (created lazily on first open, removed when the modal closes) and exposes
   one imperative entry point: openEduBlockStyleModal(editor).

   All changes go through setNodeMarkup on the SELECTED/ancestor edu node —
   real document edits: undoable, autosaved, and exported to print/PDF/Word
   because the style attrs ride the node (renderHTML emits them as inline
   CSS on the wrapper div).
   ══════════════════════════════════════════════════════════════════════════ */

/** edu node types the modal can style (subset with the shared style attrs) */
const STYLEABLE = new Set([
  'calloutBlock', 'questionBlock', 'exampleBlock', 'keyTermBlock',
  'longAnswerBlock', 'footnoteBlock', 'highlightBox', 'referenceBlock',
  'timeline', 'trueFalseBlock', 'mcqBlock', 'matrixCompareBlock', 'orderStepsBlock',
]);
/** quiz families that expose the variant + answer-placement controls */
const QUIZ_STYLEABLE = new Set(['questionBlock', 'trueFalseBlock', 'mcqBlock', 'longAnswerBlock']);

const QUIZ_VARIANTS = [
  { v: 'v1', label: 'خط ظریف', desc: 'گزینه‌های خط‌نازک — ظاهر اصلی' },
  { v: 'v2', label: 'کارت', desc: 'کارت سفید با چیپ توپر' },
  { v: 'v3', label: 'امتحانی', desc: 'خط‌چین، گوشه مربع — کاغذ امتحان' },
  { v: 'v4', label: 'مینیمال', desc: 'بدون حاشیه — فقط پس‌زمینه ملایم' },
  { v: 'v5', label: 'تیتر خط‌دار', desc: 'خط پررنگ زیر صورت سوال' },
  { v: 'v6', label: 'کپسولی', desc: 'گزینه‌های کاملاً گرد (pill)' },
  { v: 'v7', label: 'کنتراست', desc: 'صفحه تیره — هایلایت سوال مهم' },
  { v: 'v8', label: 'نوار رنگی', desc: 'میله رنگی کنار هر گزینه' },
  { v: 'v9', label: 'سری‌دار', desc: 'خط رنگی کنار کادر + چیپ مربع' },
  { v: 'v10', label: 'شیشه‌ای', desc: 'پس‌زمینه رنگی ملایم بدون حاشیه' },
  { v: 'v11', label: 'دفتر امتحان', desc: 'خط نقطه‌چین زیر گزینه‌ها' },
  { v: 'v12', label: 'چاپخانه', desc: 'خط ضخیم بالای کادر — حالت چاپی' },
] as const;
const QUIZ_ANSWER_AT = [
  { v: 'mark', label: 'روی گزینه', desc: 'گزینه صحیح سبز می‌شود — برای کتاب/جزوه' },
  { v: 'end', label: 'انتهای سوال', desc: 'خط پاسخ بعد از سوال — مناسب نمونه سوال' },
  { v: 'none', label: 'بدون پاسخ', desc: 'برگه سوال خالی، بدون پاسخ' },
] as const;

interface StyleState {
  styleBg: string;
  styleBorder: string;
  styleBorderWidth: number;
  styleBorderStyle: string;
  styleRadius: number;
  styleTitle: string;
  /** quiz families: visual variant + answer placement (v1/v2/v3, mark/end/none) */
  /** question mark (نمره) — empty/0 means NO نمره shown at all */
  points: string;
  /** MCQ option arrangement — the ONLY layout switcher (modal), per user request */
  mcqLayout: string;
  /** accent color for chips/rules — '' follows the theme */
  qAccent: string;
  /** option number chip shape — '' follows the variant */
  qChip: string;
  /** option row spacing — '' follows the variant */
  qGap: string;
  qVariant: string;
  answerAt: string;
  showAnswer: boolean;
  /** live body text — dispatched as a text replacement on ذخیره */
  bodyText: string;
  /** live title text — dispatched to the title attr on ذخیره */
  titleText: string;
  titleAttr: string;
  nodePos: number;
  nodeType: string;
  hadSelection: boolean;
  /** body text at open time — live body is only written if it differs */
  bodyText0: string;
}

/* ── locating the target node ─────────────────────────────────────────── */

function findEduNode(editor: Editor): { pos: number; type: string } | null {
  const sel = editor.state.selection as unknown as { node?: { type: { name: string } } };
  if (sel.node && STYLEABLE.has(sel.node.type.name)) {
    return { pos: editor.state.selection.from, type: sel.node.type.name };
  }
  const $from = editor.state.selection.$from;
  for (let d = $from.depth; d >= 1; d--) {
    const name = $from.node(d).type.name;
    if (STYLEABLE.has(name)) return { pos: $from.before(d), type: name };
  }
  return null;
}

/** the title attr per type (must mirror TITLE_ATTR in the extensions) */
const TITLE_ATTR: Record<string, string> = {
  calloutBlock: 'title',
  questionBlock: 'question',
  exampleBlock: 'title',
  keyTermBlock: 'term',
  longAnswerBlock: 'question',
  footnoteBlock: 'label',
  highlightBox: 'title',
  referenceBlock: 'title',
  timeline: 'title',
  trueFalseBlock: 'question',
  mcqBlock: 'qTitle',
  matrixCompareBlock: 'topic',
  orderStepsBlock: 'topic',
};

/** current plain text of the block's body (first paragraph level) */
function bodyTextOf(editor: Editor, pos: number): string {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return '';
  let out = '';
  node.descendants((child) => {
    if (child.isText && child.text) out += child.text;
    if (child.type.name === 'paragraph' && out && !out.endsWith('\n')) out += '\n';
    return true;
  });
  return out.trim();
}

function readState(editor: Editor): StyleState | null {
  const hit = findEduNode(editor);
  if (!hit) return null;
  const node = editor.state.doc.nodeAt(hit.pos);
  if (!node) return null;
  const a = node.attrs as Record<string, unknown>;
  const bodyText = bodyTextOf(editor, hit.pos);
  return {
    styleBg: (a.styleBg as string) || '',
    styleBorder: (a.styleBorder as string) || '',
    styleBorderWidth: a.styleBorderWidth === 0 && !a.styleBorder && !a.styleBorderStyle
      ? -1
      : ((a.styleBorderWidth as number) ?? -1),
    styleBorderStyle: (a.styleBorderStyle as string) || 'solid',
    styleRadius: (a.styleRadius as number) ?? -1,
    styleTitle: (a.styleTitle as string) || '',
    points: a.points === undefined || a.points === null ? '' : String(a.points),
    mcqLayout: a.layout === 'grid' ? 'grid' : 'stacked',
    qAccent: (a.qAccent as string) || '',
    qChip: (a.qChip as string) || '',
    qGap: (a.qGap as string) || '',
    qVariant: typeof a.qVariant === 'string' && /^v(?:1[0-2]|[1-9])$/.test(a.qVariant) ? (a.qVariant as string) : 'v1',
    answerAt: a.answerAt === 'end' || a.answerAt === 'none' ? (a.answerAt as string) : 'mark',
    showAnswer: a.showAnswer !== false,
    bodyText,
    titleText: (a[TITLE_ATTR[hit.type]] as string) || '',
    titleAttr: TITLE_ATTR[hit.type],
    nodePos: hit.pos,
    nodeType: hit.type,
    hadSelection: !editor.state.selection.empty,
    bodyText0: bodyText,
  };
}

/* ── the modal UI ─────────────────────────────────────────────────────── */

const PALETTE = [
  '', // = پیش‌فرض
  '#ffffff', '#fef9c3', '#fef3c7', '#dbeafe', '#e0f2fe', '#dcfce7',
  '#fae8ff', '#f3e8ff', '#ffe4e6', '#fee2e2', '#f5f5f4', '#1e3a5f', '#171717',
];
const BORDER_PALETTE = [
  '', // = پیش‌فرض
  '#171717', '#1e3a5f', '#0070f3', '#7928ca', '#dc2626', '#b45309',
  '#0a7d4f', '#c5a24d', '#64748b', '#94a3b8',
];
const TITLE_PALETTE = [
  '', // = رنگ خانواده
  '#0070f3', '#175e7d', '#7928ca', '#b45309', '#dc2626', '#0a7d4f',
  '#1e3a5f', '#171717', '#c5a24d',
];

function Swatches({ value, colors, defaultLabel, onPick }: {
  value: string; colors: string[]; defaultLabel: string; onPick: (c: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {colors.map((c, i) => (
        <button
          key={i}
          type="button"
          title={c === '' ? defaultLabel : c}
          onClick={() => onPick(c)}
          className={`h-6 w-6 rounded-md border ${c === '' ? 'border-dashed border-ink-400 text-[9px] font-bold text-ink-500' : 'border-black/10'} ${value === c ? 'ring-2 ring-[#0070f3] ring-offset-1 dark:ring-offset-ink-900' : ''}`}
          style={{ background: c === '' ? 'repeating-linear-gradient(45deg,#fff 0 3px,#eee 3px 6px)' : c }}
        >
          {c === '' ? '✓' : ''}
        </button>
      ))}
      <input
        type="color"
        title="رنگ دلخواه"
        className="h-6 w-6 cursor-pointer rounded-md border border-ink-200 dark:border-ink-700"
        onChange={(e) => onPick(e.target.value)}
      />
    </div>
  );
}

function EduBlockStyleModalInner({ editor, state, onClose }: {
  editor: Editor; state: StyleState; onClose: (result: { commit: boolean; live: StyleState }) => void;
}) {
  const [s, setS] = useState<StyleState>(state);
  const patch = (p: Partial<StyleState>) => setS((prev) => ({ ...prev, ...p }));
  const apply = () => {
    try {
      const node = editor.state.doc.nodeAt(s.nodePos);
      if (!node) { onClose({ commit: false, live: s }); return; }
      editor.view.dispatch(editor.state.tr.setNodeMarkup(s.nodePos, undefined, {
        ...node.attrs,
        [s.titleAttr]: s.titleText,
        styleBg: s.styleBg,
        styleBorder: s.styleBorder,
        styleBorderWidth: s.styleBorderWidth,
        styleBorderStyle: s.styleBorderStyle,
        styleRadius: s.styleRadius,
        styleTitle: s.styleTitle,
        /* quiz attrs ride along UNCHANGED (not authored here — the question
           modal owns them); keeping them in the patch preserves a variant
           picked earlier instead of silently resetting it */
      }));
      onClose({ commit: true, live: s });
    } catch {
      onClose({ commit: false, live: s });
    }
  };

  /* live preview box (mini replica) */
  const borderCss = s.styleBorderWidth === 0
    ? 'none'
    : `${s.styleBorderWidth < 0 ? 1.5 : s.styleBorderWidth}px ${s.styleBorderStyle || 'solid'} ${s.styleBorder || 'rgba(0,0,0,0.2)'}`;

  const requestClose = (commit: boolean) => onClose({ commit, live: s });

  return (
    <SidePanel open onClose={() => requestClose(false)} title="شخصی‌سازی کادر">
      <div className="grid gap-5 md:grid-cols-[1fr_260px]">
        <div className="space-y-4">
          {/* ── متن ── */}
          <section className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
            <h3 className="mb-2.5 text-[13px] font-bold text-ink-900 dark:text-ink-100">متن</h3>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-400">تیتر کادر</span>
                <input
                  value={s.titleText}
                  onChange={(e) => patch({ titleText: e.target.value })}
                  className="w-full min-h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm outline-none focus:border-[#0070f3] dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-400">
                  متن داخل کادر <span className="text-ink-400">(جایگزینی کل متن بدنه)</span>
                </span>
                <textarea
                  value={s.bodyText}
                  onChange={(e) => patch({ bodyText: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-[#0070f3] dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-400">رنگ تیتر</span>
                <Swatches value={s.styleTitle} colors={TITLE_PALETTE} defaultLabel="رنگ خانواده" onPick={(c) => patch({ styleTitle: c })} />
              </label>
            </div>
          </section>

          {/* ── قالب و پاسخ — REMOVED: these live in the QUESTION modal
              (شخصی‌سازی سوال). This modal is the BOX designer — title,
              body text, border, background — shared by every block family
              without leaking quiz-only controls into it. ── */}

          {/* ── بوردر ── */}
          <section className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
            <h3 className="mb-2.5 text-[13px] font-bold text-ink-900 dark:text-ink-100">بوردر</h3>
            <div className="space-y-3">
              <div>
                <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-400">رنگ خط</span>
                <Swatches value={s.styleBorder} colors={BORDER_PALETTE} defaultLabel="پیش‌فرض" onPick={(c) => patch({ styleBorder: c, styleBorderWidth: c && s.styleBorderWidth === 0 ? 1.5 : s.styleBorderWidth })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 flex justify-between text-[12px] font-medium text-ink-600 dark:text-ink-400">
                    ضخامت
                    <span className="tabular-nums text-ink-500">
                      {s.styleBorderWidth < 0 ? 'پیش‌فرض خانواده' : s.styleBorderWidth === 0 ? 'بدون خط' : `${s.styleBorderWidth} پیکسل`}
                    </span>
                  </span>
                  <input
                    type="range" min={-1} max={5} step={0.5}
                    value={s.styleBorderWidth}
                    onChange={(e) => patch({ styleBorderWidth: Number(e.target.value) })}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink-200 accent-[#0070f3] dark:bg-ink-700"
                  />
                </label>
                <div>
                  <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-400">نوع خط</span>
                  <div className="flex gap-1">
                    {(['solid', 'dashed', 'dotted'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => patch({ styleBorderStyle: st, styleBorderWidth: Math.max(1.5, s.styleBorderWidth) })}
                        className={`h-8 flex-1 rounded-md border text-[11px] transition-colors ${
                          (s.styleBorderStyle || 'solid') === st
                            ? 'border-[#0070f3] bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
                            : 'border-ink-200 text-ink-500 dark:border-ink-700'
                        }`}
                        style={{ borderStyle: st === 'solid' ? 'solid' : st, borderWidth: 2 }}
                      >
                        {st === 'solid' ? 'یکسره' : st === 'dashed' ? 'خط‌چین' : 'نقطه‌چین'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <label className="block">
                <span className="mb-1 flex justify-between text-[12px] font-medium text-ink-600 dark:text-ink-400">
                  گردی گوشه‌ها
                  <span className="tabular-nums text-ink-500">
                    {s.styleRadius < 0 ? 'پیش‌فرض' : `${s.styleRadius} پیکسل`}
                  </span>
                </span>
                <input
                  type="range" min={-1} max={24} step={1}
                  value={s.styleRadius}
                  onChange={(e) => patch({ styleRadius: Number(e.target.value) })}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink-200 accent-[#0070f3] dark:bg-ink-700"
                />
              </label>
            </div>
          </section>

          {/* ── پس‌زمینه ── */}
          <section className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
            <h3 className="mb-2.5 text-[13px] font-bold text-ink-900 dark:text-ink-100">پس‌زمینه</h3>
            <Swatches value={s.styleBg} colors={PALETTE} defaultLabel="پیش‌فرض خانواده" onPick={(c) => patch({ styleBg: c })} />
          </section>
        </div>

        {/* ── live preview ── */}
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink-700 dark:text-ink-300">پیش‌نمایش زنده</div>
          <div className="rounded-xl bg-white p-4 shadow-inner ring-1 ring-ink-100 dark:bg-ink-950 dark:ring-ink-800">
            <div style={{ border: borderCss, borderRadius: s.styleRadius >= 0 ? s.styleRadius : 4, background: s.styleBg || undefined, padding: 12 }}>
              <div className="mb-1 text-[0.9em] font-semibold" style={{ color: s.styleTitle || '#0070f3' }}>
                {s.titleText || 'تیتر کادر'}
              </div>
              <div className="text-[0.85em] leading-6 text-ink-600 dark:text-ink-300">
                {s.bodyText ? s.bodyText.split('\n')[0] : 'متن نمونه داخل کادر'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setS({ ...state })}
            className="mt-3 w-full rounded-lg border border-dashed border-ink-300 py-1.5 text-[11px] font-medium text-ink-500 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-900"
          >
            بازگردانی به حالت اول
          </button>
        </div>
      </div>

      <div className="pn-side-footer mt-auto flex shrink-0 justify-end gap-2.5 border-t border-ink-100 pt-4 dark:border-ink-800">
        <Button variant="secondary" onClick={() => requestClose(false)}>انصراف</Button>
        <Button onClick={apply}>اعمال</Button>
      </div>
    </SidePanel>
  );
}

/* ── imperative host (created lazily) ────────────────────────────────── */

let host: { el: HTMLDivElement; root: Root } | null = null;

function ensureHost(): { el: HTMLDivElement; root: Root } {
  if (!host) {
    const el = document.createElement('div');
    el.id = 'edu-block-style-host';
    document.body.appendChild(el);
    host = { el, root: createRoot(el) };
  }
  return host;
}

/** body text replacement — replaces the text of the FIRST body paragraph */
function replaceBodyText(editor: Editor, pos: number, text: string) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const firstTextChild: { pos: number; node: { isText: boolean; text?: string; nodeSize: number } } | null = (() => {
    let found: { pos: number; node: { isText: boolean; text?: string; nodeSize: number } } | null = null;
    node.descendants((child, offset) => {
      if (!found && child.isText && child.text) found = { pos: pos + offset + 1, node: child as never };
      return !found;
    });
    return found;
  })();
  if (firstTextChild) {
    const t = firstTextChild as unknown as { pos: number; node: { nodeSize: number } };
    editor.view.dispatch(editor.state.tr.replaceWith(
      t.pos,
      t.pos + t.node.nodeSize,
      text ? editor.state.schema.text(text) : editor.state.schema.nodes.paragraph.create(),
    ));
  }
}

/* ── LIVE TARGET TRACKING (the «سوییچ» behavior) ────────────────────────
   The modal used to be a static snapshot: once open, clicking ANOTHER edu
   block (or empty page) changed nothing — the panel kept editing the OLD
   node and never followed the user's next click. The host now tracks the
   live selection itself:

   • caret/click lands on a DIFFERENT edu block  → the modal re-reads that
     block and SWITCHES (box ⇄ question variant picked by the block type)
   • caret lands on a NON-edu target (plain paragraph, empty page, image…)
     → the modal CLOSES (its subject is gone; a stale panel is confusing)
   • pure text edits INSIDE the currently-styled block never re-open/re-target
     (typing must not fight the panel)

   The watcher lives in the same module-level root as the modal so both
   entry points (ribbon button, right-click menu) behave identically. */

let trackedEditor: Editor | null = null;
let trackedPos = -1;
let trackedType = '';
let trackedMode: 'box' | 'question' = 'box';
let onTransaction: (() => void) | null = null;

function stopTracking() {
  if (onTransaction) document.removeEventListener('selectionchange', onTransaction);
  trackedEditor = null;
  trackedPos = -1;
  trackedType = '';
  onTransaction = null;
}

function renderFor(editor: Editor, mode: 'box' | 'question'): boolean {
  const state = mode === 'question' ? readQuestionState(editor) : readState(editor);
  if (!state) return false;
  const { root } = ensureHost();
  trackedEditor = editor;
  trackedPos = state.nodePos;
  trackedType = state.nodeType;
  trackedMode = mode;
  /* Multi-page gotcha: each sheet owns its OWN TipTap editor, and a click on
     another page moves THAT editor's selection — the tracked editor's
     transaction hook never fires for it. document-level 'selectionchange'
     covers every editor (and fires even when the caret only collapses). */
  if (!onTransaction) {
    onTransaction = () => retargetIfSelectionMoved();
    document.addEventListener('selectionchange', onTransaction);
  }
  if (mode === 'question') {
    root.render(<QuestionStyleModalInner editor={editor} state={state as never} onClose={() => closeStyleModal()} />);
  } else {
    root.render(
      <EduBlockStyleModalContainer
        editor={editor}
        state={state as never}
        onClose={() => closeStyleModal()}
      />,
    );
  }
  return true;
}

/** called on document selectionchange while a modal is open. The CLICK path
 *  (the click-follow deferred handler) is the authority for switching —
 *  it reads the FINAL post-click selection. Here we only
 *  handle the leave-cases the click handler cannot see: keyboard caret moves
 *  (arrows, Ctrl+Home) and programmatic selections. */
function retargetIfSelectionMoved() {
  if (!trackedEditor) return;
  const sel = window.getSelection();
  const anchorEl = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement ?? null;
  const anchorInTracked = !!anchorEl && (trackedEditor.view.dom === anchorEl || trackedEditor.view.dom.contains(anchorEl));
  const activeInTracked = trackedEditor.isFocused ||
    (document.activeElement instanceof Element &&
      (document.activeElement === trackedEditor.view.dom || trackedEditor.view.dom.contains(document.activeElement)));
  if (!anchorInTracked && !activeInTracked) {
    closeStyleModal();
    return;
  }
  const hit = findEduNode(trackedEditor);
  if (!hit) {
    /* keyboard move left the edu block entirely */
    closeStyleModal();
    return;
  }
}

/** imperative close — also tears the tracker down (both modal variants call it) */
export function closeStyleModal() {
  stopTracking();
  ensureHost().root.render(null);
}

export function openEduBlockStyleModal(editor: Editor) {
  if (!renderFor(editor, 'box')) return;
}

/* ── CLICK-FOLLOW — panel follow behavior (OPEN stays EXPLICIT) ─────────
   1. panel CLOSED + click on an edu block  → NOTHING opens. The click's
      only visible response is the contextual «کادر آموزشی/سوال» ribbon tab
      activating (the horizontal menu) plus the right-click menu. Opening
      شخصی‌سازی is a deliberate act: the ribbon button or the right-click
      شخصی‌سازی entry. (Auto-open on click was removed TWICE now — the
      installer used to render the side panel on every block click, which
      the user explicitly rejected: «نباید خودکار وقتی روی یه کادر آموزشی
      کلیک میکنی مودال چپش باز شه».)
   2. panel OPEN + click on another edu block → the panel SWITCHES to it
   3. panel OPEN + click on an empty page spot (trailing paragraph OR the
      page margin outside the editor) → the panel CLOSES
   Typing never triggers any of this — the trigger is a real editor DOM
   click with a settled selection, never a transaction alone.

   Multi-page gotcha: each sheet owns its OWN TipTap editor, so this is
   installed per page editor (Page.tsx). The margin case (#3 for clicks
   outside every editor) is one SHARED document-level listener below. */

const clickFollowInstalled = new WeakSet<Editor>();

/** one shared document-level listener: a click on a page's margin/chrome
 *  (inside .page-paper but NOT inside any ProseMirror editor) closes the
 *  panel — the caret never moved, so selectionchange cannot see it */
let docMarginCloseInstalled = false;
function installDocMarginClose() {
  if (docMarginCloseInstalled || typeof document === 'undefined') return;
  docMarginCloseInstalled = true;
  document.addEventListener(
    'click',
    (e) => {
      if (!trackedEditor) return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      const paper = t.closest('.page-paper');
      if (!paper) return; /* ribbon, menus, the panel itself… — not ours */
      if (t.closest('.ProseMirror')) return; /* editor clicks: per-editor handler */
      closeStyleModal();
    },
    true,
  );
}

/** install the click-follow behavior on ONE page editor (idempotent) */
export function installEduPanelClickFollow(editor: Editor) {
  if (clickFollowInstalled.has(editor)) return;
  clickFollowInstalled.add(editor);
  installDocMarginClose();
  const dom = editor.view.dom as HTMLElement;
  dom.addEventListener('click', () => {
    /* defer past the selectionchange close-race: clicking block B while the
       modal edits block A fires A's close (selectionchange) AND this click.
       The close and the re-open must collapse into ONE switch, so run after
       the selectionchange handler settled and re-check the live target. */
    setTimeout(() => {
      const hit = findEduNode(editor);
      /* empty spot inside the editor (trailing paragraph) → close only */
      if (!hit) {
        if (trackedEditor) closeStyleModal();
        return;
      }
      const mode: 'box' | 'question' = QUIZ_STYLEABLE.has(hit.type) ? 'question' : 'box';
      /* panel closed → do NOTHING (behavior #1: no auto-open). While open,
         clicks keep switching the target (#2) — never re-open from closed. */
      if (trackedEditor) {
        /* already showing THIS node in the matching mode? leave it alone */
        if (trackedEditor === editor && trackedPos === hit.pos && trackedMode === mode) return;
        renderFor(editor, mode);
      }
    }, 0);
  });
}

/** open the QUESTION modal for the current selection — falls back to the
 *  box modal when the caret is NOT in a quiz family so the click always
 *  yields a visible panel (the silent no-op read as «مودال باز نمیشه») */
export function openEduQuestionStyleModal(editor: Editor): boolean {
  if (renderFor(editor, 'question')) return true;
  openEduBlockStyleModal(editor);
  return false;
}

/* ════════════════════════════════════════════════════════════════════════
   شخصی‌سازی سوال — the QUESTION modal (quiz families ONLY).

   Split from the box modal (item: «شخصی سازی کادرها آپشناش باید جوری باشه
   که رو کادرای سوالی اعمال نشه»): the box modal keeps title/body/border/
   background; THIS modal owns everything question-specific — the 12
   ready-made variants (with live mini-samples), نقاط, MCQ layout, accent,
   chip shape, option spacing, answer placement. Every control maps 1:1 to
   a persisted node attr via setNodeMarkup (undoable + exported).
   ════════════════════════════════════════════════════════════════════════ */

interface QuestionStyleState {
  qVariant: string;
  answerAt: string;
  showAnswer: boolean;
  points: string;
  mcqLayout: string;
  qAccent: string;
  qChip: string;
  qGap: string;
  answerText: string;
  nodePos: number;
  nodeType: string;
}

/** live mini-sample of one variant — same markup/CSS as the ribbon picker */
function VariantSample({ v }: { v: string }) {
  return (
    <span aria-hidden className="vsample" data-qv={v}>
      <span className="vsample-title" />
      <span className="vsample-row"><span className="vsample-num" /><span className="vsample-line w1" /></span>
      <span className="vsample-row"><span className="vsample-num" /><span className="vsample-line w2" /></span>
    </span>
  );
}

function readQuestionState(editor: Editor): QuestionStyleState | null {
  const hit = findEduNode(editor);
  if (!hit || !QUIZ_STYLEABLE.has(hit.type)) return null;
  const node = editor.state.doc.nodeAt(hit.pos);
  if (!node) return null;
  const a = node.attrs as Record<string, unknown>;
  return {
    qVariant: typeof a.qVariant === 'string' && /^v(?:1[0-2]|[1-9])$/.test(a.qVariant) ? (a.qVariant as string) : 'v1',
    answerAt: a.answerAt === 'end' || a.answerAt === 'none' ? (a.answerAt as string) : 'mark',
    showAnswer: a.showAnswer !== false,
    points: a.points === undefined || a.points === null ? '' : String(a.points),
    mcqLayout: a.layout === 'grid' ? 'grid' : 'stacked',
    qAccent: (a.qAccent as string) || '',
    qChip: (a.qChip as string) || '',
    qGap: (a.qGap as string) || '',
    answerText: (a.answerText as string) || '',
    nodePos: hit.pos,
    nodeType: hit.type,
  };
}

function QuestionStyleModalInner({ editor, state, onClose }: {
  editor: Editor; state: QuestionStyleState; onClose: () => void;
}) {
  const [s, setS] = useState<QuestionStyleState>(state);
  const patch = (p: Partial<QuestionStyleState>) => setS((prev) => ({ ...prev, ...p }));

  const apply = () => {
    try {
      const node = editor.state.doc.nodeAt(s.nodePos);
      if (!node) { onClose(); return; }
      editor.view.dispatch(editor.state.tr.setNodeMarkup(s.nodePos, undefined, {
        ...node.attrs,
        qVariant: s.qVariant,
        answerAt: s.answerAt,
        showAnswer: s.answerAt !== 'none',
        points: Math.max(0, Number(s.points) || 0),
        qAccent: s.qAccent,
        qChip: s.qChip,
        qGap: s.qGap,
        /* تشریحی/کوتاه: the end-of-block answer line text — longAnswerBlock
           now DECLARES the attr (schema) so setNodeMarkup persists it */
        answerText: s.answerText,
        ...(s.nodeType === 'mcqBlock' ? { layout: s.mcqLayout === 'grid' ? 'grid' : 'stacked' } : {}),
      }));
      onClose();
    } catch {
      onClose();
    }
  };

  return (
    <SidePanel open onClose={onClose} title="شخصی‌سازی سوال">
      <div className="space-y-4">
        {/* قالب — ۱۲ طرح آماده با سمپل زنده */}
        <section>
          <span className="mb-1.5 block text-[12px] font-medium text-ink-600 dark:text-ink-400">قالب سوال</span>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-ink-200 p-1.5 dark:border-ink-700">
            {QUIZ_VARIANTS.map((v) => (
              <button
                key={v.v}
                type="button"
                title={v.desc}
                onClick={() => patch({ qVariant: v.v })}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] transition-colors ${
                  s.qVariant === v.v
                    ? 'bg-accent-50 font-semibold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
                    : 'text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800'
                }`}
              >
                <VariantSample v={v.v} />
                <span className="flex flex-col items-start leading-tight">
                  {v.label}
                  <span className="text-[10px] font-normal text-ink-400">{v.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* نمره + چیدمان */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-400">نمره سوال</span>
            <input
              type="number"
              min={0}
              step={0.25}
              inputMode="decimal"
              dir="ltr"
              value={s.points}
              onChange={(e) => patch({ points: e.target.value })}
              placeholder="بدون نمره"
              className="h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm outline-none transition-colors placeholder:text-ink-300 focus:border-[#0070f3] dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
            />
          </label>
          {s.nodeType === 'mcqBlock' && (
            <div>
              <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-400">چیدمان گزینه‌ها</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={() => patch({ mcqLayout: 'stacked' })}
                  className={`h-9 rounded-lg border text-[12px] transition-colors ${s.mcqLayout === 'stacked' ? 'border-[#0070f3] bg-accent-50 font-semibold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300' : 'border-ink-200 text-ink-500 dark:border-ink-700'}`}>
                  ۴ زیر هم
                </button>
                <button type="button" onClick={() => patch({ mcqLayout: 'grid' })}
                  className={`h-9 rounded-lg border text-[12px] transition-colors ${s.mcqLayout === 'grid' ? 'border-[#0070f3] bg-accent-50 font-semibold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300' : 'border-ink-200 text-ink-500 dark:border-ink-700'}`}>
                  ۲×۲
                </button>
              </div>
            </div>
          )}
        </div>

        {/* اکسان + چیپ + فاصله */}
        <section>
          <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-400">رنگ اکسان سوال (چیپ‌ها و خطوط)</span>
          <Swatches value={s.qAccent} colors={TITLE_PALETTE} defaultLabel="رنگ قالب" onPick={(c) => patch({ qAccent: c })} />
        </section>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-400">شکل شماره گزینه</span>
            <div className="grid grid-cols-4 gap-1.5">
              {([['', 'قالب'], ['circle', 'دایره'], ['square', 'مربع'], ['none', 'حاشیه‌دار']] as Array<[string, string]>).map(([cv, cl]) => (
                <button key={cv} type="button" onClick={() => patch({ qChip: cv })}
                  className={`h-8 rounded-md border text-[11.5px] transition-colors ${s.qChip === cv ? 'border-[#0070f3] bg-accent-50 font-semibold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300' : 'border-ink-200 text-ink-500 dark:border-ink-700'}`}>
                  {cl}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-400">فاصله گزینه‌ها</span>
            <div className="grid grid-cols-3 gap-1.5">
              {([['', 'معمولی'], ['tight', 'فشرده'], ['wide', 'باز']] as Array<[string, string]>).map(([gv, gl]) => (
                <button key={gv} type="button" onClick={() => patch({ qGap: gv })}
                  className={`h-8 rounded-md border text-[11.5px] transition-colors ${s.qGap === gv ? 'border-[#0070f3] bg-accent-50 font-semibold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300' : 'border-ink-200 text-ink-500 dark:border-ink-700'}`}>
                  {gl}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* متن پاسخ — کوتاه/تشریحی: the end-of-block answer line content */}
        {(s.nodeType === 'longAnswerBlock' || s.nodeType === 'questionBlock') && (
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-400">متن پاسخ (خط انتهای سوال)</span>
            <input
              value={s.answerText}
              onChange={(e) => patch({ answerText: e.target.value })}
              placeholder="خالی = بدون خط پاسخ"
              dir="rtl"
              className="h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-[13px] outline-none transition-colors placeholder:text-ink-300 focus:border-[#0070f3] dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
            />
            {s.answerText && s.answerAt !== 'end' && (
              <span className="mt-1 block text-[11px] text-amber-600 dark:text-amber-400">برای نمایش این پاسخ، جایگاه پاسخ را روی «انتهای سوال» بگذارید.</span>
            )}
          </label>
        )}

        {/* جایگاه پاسخ — MCQ + TF only */}
        {s.nodeType !== 'longAnswerBlock' && (
          <section>
            <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-400">جایگاه پاسخ صحیح</span>
            <div className="flex gap-1.5">
              {QUIZ_ANSWER_AT.map((d) => (
                <button
                  key={d.v}
                  type="button"
                  title={d.desc}
                  onClick={() => patch({ answerAt: d.v, showAnswer: d.v !== 'none' })}
                  className={`h-8 flex-1 rounded-md border text-[11.5px] transition-colors ${
                    s.answerAt === d.v
                      ? 'border-[#0070f3] bg-accent-50 font-semibold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
                      : 'border-ink-200 text-ink-500 dark:border-ink-700'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {s.answerAt === 'end' && (
              <p className="mt-1.5 text-[11px] leading-5 text-ink-500 dark:text-ink-400">
                پاسخ به‌صورت یک خط کوچک در «انتهای کادر» نمایش داده می‌شود — خود گزینه رنگی نمی‌شود تا جواب لو نرود.
              </p>
            )}
          </section>
        )}
      </div>

      <div className="pn-side-footer mt-auto flex shrink-0 justify-end gap-2.5 border-t border-ink-100 pt-4 dark:border-ink-800">
        <Button variant="secondary" onClick={onClose}>انصراف</Button>
        <Button onClick={apply}>اعمال</Button>
      </div>
    </SidePanel>
  );
}

/** wrapper so the modal can persist text edits on اعمال */
function EduBlockStyleModalContainer({ editor, state, onClose }: {
  editor: Editor; state: StyleState; onClose: () => void;
}) {
  const [, bump] = useState(0);
  useEffect(() => {
    const h = () => bump((n) => n + 1);
    editor.on('transaction', h);
    return () => { editor.off('transaction', h); };
  }, [editor]);

  const handleClose = ({ commit, live }: { commit: boolean; live: StyleState }) => {
    if (commit) {
      /* title + body replace the styled node in ONE undoable transaction */
      try {
        const node = editor.state.doc.nodeAt(live.nodePos);
        if (node) {
          const a = node.attrs as Record<string, unknown>;
          const tr = editor.state.tr;
          if ((a[live.titleAttr] as string) !== live.titleText) {
            tr.setNodeMarkup(live.nodePos, undefined, { ...a, [live.titleAttr]: live.titleText });
          }
          if (live.bodyText !== live.bodyText0) {
            tr.replaceWith(
              live.nodePos + 1,
              live.nodePos + 1 + (node.content.firstChild?.nodeSize ?? 1),
              live.bodyText
                ? editor.state.schema.nodes.paragraph.create(null, editor.state.schema.text(live.bodyText))
                : editor.state.schema.nodes.paragraph.create(),
            );
          }
          if (tr.docChanged || tr.storedMarks !== undefined) editor.view.dispatch(tr);
        }
      } catch { /* node gone — nothing to commit */ }
    }
    onClose();
  };

  return (
    <EduBlockStyleModalInner
      editor={editor}
      state={state}
      onClose={handleClose}
    />
  );
}
