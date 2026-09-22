import type {
  ContextProvider, ObjectCapabilities,
  ContextualTab, ContextualGroup, ContextualAction,
} from '../types';
import { h4 } from '../icons';
import type { Editor } from '@tiptap/core';
import { Copy, Trash2, Repeat, GraduationCap, BookOpen, Star, AlertCircle, HelpCircle, Hash, FlaskConical, Lightbulb, Paintbrush, Palette, CheckCircle, ListChecks } from 'lucide-react';
import { openEduBlockStyleModal } from './eduBlockStyleModalHost';

/* ══════════════════════════════════════════════════════════════════════════
   EduBlock context — the dedicated tab for the کادرهای آموزشی family
   (calloutBlock, questionBlock, exampleBlock, keyTermBlock, longAnswerBlock…).

   Word-style object tab, registration not architecture:
   • تغییر نوع — convert BETWEEN block kinds with real schema commands
     (callout kind swap is a setNodeMarkup; a question → callout is a real
     replaceWith that PRESERVES the body content).
   • نمره — the longAnswer block's نقاط attribute is edited from the tab.
   • تکثیر / حذف — whole-block object commands (the generic Block tab keeps
     handling blockquote / codeBlock, which have no edu-specific tools).

   The converter dropdown is NOT persistent: picking a kind is a single
   decisive action (unlike symbol pickers), so it closes after the pick.
   ══════════════════════════════════════════════════════════════════════════ */

export const EDUBLOCK_CONTEXT_ID = 'context.edublock';

/** edu node types that resolve to this tab (probe's OBJECT_NODE_TYPES ∩ edu) */
const EDU_BLOCK_TYPES = new Set([
  'calloutBlock', 'questionBlock', 'exampleBlock', 'keyTermBlock',
  'longAnswerBlock', 'footnoteBlock', 'highlightBox', 'referenceBlock',
  'trueFalseBlock', 'mcqBlock',
]);

interface EduBlockAttrs extends Record<string, unknown> {
  editor: Editor;
  /** calloutBlock: definition | important | exam | warning | summary | … */
  kind?: string;
  /** longAnswerBlock */
  points?: number;
  [key: string]: unknown;
}

function capabilities(): ObjectCapabilities {
  return {
    canDelete: true,
    canDuplicate: true,
    canEditText: true,
    canChangeLayout: true,
    'edu:convert': true,
    'edu:points': true,
  };
}

const act = (key: string, title: string, icon: React.ReactNode, run: () => void, label?: string, active?: boolean): ContextualAction =>
  ({ key, title, icon, run, label, active });

/* ── callout kinds — the SAME labels the منوی درج uses ─────────────────── */

const CALLOUT_KINDS: Array<{ kind: string; label: string; icon: React.ReactNode }> = [
  { kind: 'definition', label: 'تعریف', icon: h4(BookOpen) },
  { kind: 'important', label: 'نکته مهم', icon: h4(Lightbulb) },
  { kind: 'exam', label: 'نکته امتحانی', icon: h4(GraduationCap) },
  { kind: 'warning', label: 'توجه', icon: h4(AlertCircle) },
  { kind: 'summary', label: 'خلاصه', icon: h4(BookOpen) },
  { kind: 'highlight', label: 'جعبه برجسته', icon: h4(Star) },
  { kind: 'reference', label: 'منبع', icon: h4(BookOpen) },
];

/* ── convert between edu block TYPES while keeping the body ───────────── */

type EduType =
  | 'calloutBlock' | 'questionBlock' | 'exampleBlock' | 'keyTermBlock'
  | 'longAnswerBlock' | 'trueFalseBlock' | 'mcqBlock';

const TYPE_LABEL: Record<EduType, string> = {
  calloutBlock: 'کادر (تعریف/نکته/…)',
  questionBlock: 'سوال و پاسخ',
  exampleBlock: 'مثال',
  keyTermBlock: 'اصطلاح کلیدی',
  longAnswerBlock: 'پاسخ تشریحی',
  trueFalseBlock: 'درست / نادرست',
  mcqBlock: 'چهارگزینه‌ای',
};

const TYPE_ICON: Record<EduType, React.ReactNode> = {
  calloutBlock: h4(BookOpen),
  questionBlock: h4(HelpCircle),
  exampleBlock: h4(FlaskConical),
  keyTermBlock: h4(Hash),
  longAnswerBlock: h4(GraduationCap),
  trueFalseBlock: h4(CheckCircle),
  mcqBlock: h4(ListChecks),
};

/** the title/question/term attr of each edu type — carried over on convert */
const TITLE_ATTR: Record<EduType, string> = {
  calloutBlock: 'title',
  questionBlock: 'question',
  exampleBlock: 'title',
  keyTermBlock: 'term',
  longAnswerBlock: 'question',
  trueFalseBlock: 'question',
  mcqBlock: 'qTitle',
};

function convertType(editor: Editor, from: EduType, to: EduType, extraAttrs: Record<string, unknown> = {}) {
  const { state } = editor;
  /* locate the edu ancestor: NodeSelection of the block itself OR the
     nearest edu node walking up from the caret */
  let pos = -1;
  const sel = state.selection as { node?: { type: { name: string }; nodeSize: number } };
  if (sel.node && sel.node.type.name === from) {
    pos = state.selection.from;
  } else {
    for (let d = state.selection.$from.depth; d >= 1; d--) {
      if (state.selection.$from.node(d).type.name === from) {
        pos = state.selection.$from.before(d);
        break;
      }
    }
  }
  if (pos < 0) return;
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== from) return;

  const title = node.attrs[TITLE_ATTR[from]] ?? '';
  const tr = state.tr.replaceWith(
    pos,
    pos + node.nodeSize,
    state.schema.nodes[to].create(
      { [TITLE_ATTR[to]]: title, ...extraAttrs },
      node.content,
    ),
  );
  editor.view.dispatch(tr);
  /* keep the caret inside the converted block (title end → body) */
  try {
    editor.commands.setTextSelection(Math.min(pos + 2, editor.state.doc.content.size - 1));
    editor.commands.focus();
  } catch { /* best effort */ }
}

/** type name of the edu block the selection resolves to (caret-inside OR
 *  node-selected); '' when none — mirrors documentProbe's walk */
function eduTypeOf(a: EduBlockAttrs): EduType | '' {
  const ed = a.editor;
  const sel = ed.state.selection as { node?: { type: { name: string } } };
  if (sel.node && EDU_BLOCK_TYPES.has(sel.node.type.name)) return sel.node.type.name as EduType;
  for (let d = ed.state.selection.$from.depth; d >= 1; d--) {
    const name = ed.state.selection.$from.node(d).type.name;
    if (EDU_BLOCK_TYPES.has(name)) return name as EduType;
  }
  return '';
}

/* ── QUIZ variant + answer controls (سه قالب سوال + سوال کوتاه) ────────── */

const QUIZ_TYPES = new Set<EduType | ''>(['questionBlock', 'trueFalseBlock', 'mcqBlock', 'longAnswerBlock']);

/** live mini-sample of one question variant — the same markup + data-qv the
 *  editor renders, scaled down; shown beside each ready-made template so the
 *  user SEES the design before applying (parity with the table templates) */
function VariantSample({ v }: { v: string }) {
  return (
    <span aria-hidden className="vsample" data-qv={v}>
      <span className="vsample-title" />
      <span className="vsample-row"><span className="vsample-num" /><span className="vsample-line w1" /></span>
      <span className="vsample-row"><span className="vsample-num" /><span className="vsample-line w2" /></span>
    </span>
  );
}

const VARIANT_DEFS: Array<{ v: string; label: string; desc: string }> = [
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
];

const ANSWER_AT_DEFS: Array<{ v: string; label: string; desc: string }> = [
  { v: 'mark', label: 'روی گزینه', desc: 'گزینه صحیح سبز می‌شود (جواب سریع)' },
  { v: 'end', label: 'انتهای سوال', desc: 'خط پاسخ بعد از سوال — بدون اسپویل' },
  { v: 'none', label: 'بدون پاسخ', desc: 'برگه سوال بدون پاسخ' },
];

function patchQuizAttrs(ed: Editor, type: EduType, patch: Record<string, unknown>) {
  const { state } = ed;
  let pos = -1;
  const sel = state.selection as { node?: { type: { name: string } } };
  if (sel.node && sel.node.type.name === type) pos = state.selection.from;
  else {
    for (let d = state.selection.$from.depth; d >= 1; d--) {
      if (state.selection.$from.node(d).type.name === type) { pos = state.selection.$from.before(d); break; }
    }
  }
  if (pos < 0) return;
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== type) return;
  ed.view.dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }));
}

/** doc position of the edu ancestor the selection resolves to (caret-inside
 *  OR node-selected); -1 when none. Whole-block ops (duplicate/delete) MUST
 *  run on the NODE, not the raw selection — a caret inside the block makes
 *  insertContentAt/deleteSelection target only the text range, which is why
 *  تکثیر/حذف did nothing for quiz blocks. */
function eduNodePos(ed: Editor, type: EduType): number {
  const { state } = ed;
  const sel = state.selection as { node?: { type: { name: string } }; from?: number };
  if (sel.node && sel.node.type.name === type) return state.selection.from;
  for (let d = state.selection.$from.depth; d >= 1; d--) {
    if (state.selection.$from.node(d).type.name === type) return state.selection.$from.before(d);
  }
  return -1;
}

function quizAttrsOf(ed: Editor, type: EduType): { qVariant: string; showAnswer: boolean; answerAt: string } | null {
  const { state } = ed;
  let pos = -1;
  const sel = state.selection as { node?: { type: { name: string } } };
  if (sel.node && sel.node.type.name === type) pos = state.selection.from;
  else {
    for (let d = state.selection.$from.depth; d >= 1; d--) {
      if (state.selection.$from.node(d).type.name === type) { pos = state.selection.$from.before(d); break; }
    }
  }
  if (pos < 0) return null;
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== type) return null;
  const a = node.attrs as Record<string, unknown>;
  return {
    qVariant: typeof a.qVariant === 'string' && /^v(?:1[0-2]|[1-9])$/.test(a.qVariant) ? (a.qVariant as string) : 'v1',
    showAnswer: a.showAnswer !== false,
    answerAt: a.answerAt === 'end' || a.answerAt === 'none' ? (a.answerAt as string) : 'mark',
  };
}

function groups(a: EduBlockAttrs): ContextualGroup[] {
  const ed = a.editor;
  const ch = () => ed.chain().focus();
  const eduType = eduTypeOf(a);

  /* calloutBlock carries its kind in attrs — offer the full kind menu */
  const isCallout = eduType === 'calloutBlock';

  return [
    /* ── تغییر نوع — real conversions (ONE dropdown tool, closes on pick) ── */
    {
      key: 'edu.convert',
      label: 'تغییر نوع',
      tools: isCallout
        ? [
            {
              key: 'edu.kind.picker',
              title: 'تغییر نوع کادر آموزشی',
              label: 'نوع کادر',
              icon: h4(Repeat),
              dropdown: {
                width: 190,
                render: (close) => (
                  <div className="w-[186px] p-1">
                    {CALLOUT_KINDS.map((k) => (
                        <button
                        key={k.kind}
                          type="button"
                        onClick={() => {
                          ch().updateAttributes('calloutBlock', { kind: k.kind }).run();
                          close();
                        }}
                          className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors ${
                          a.kind === k.kind
                              ? 'bg-accent-50 font-semibold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
                              : 'text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800'
                          }`}
                        >
                        {k.icon}
                        {k.label}
                        </button>
                    ))}
                  </div>
                  ),
                },
            },
          ]
        : [
            {
              key: 'edu.type.picker',
              title: 'تبدیل نوع بلوک (محتوا حفظ می‌شود)',
              label: 'تبدیل به',
              icon: h4(Repeat),
              dropdown: {
                width: 210,
                render: (close) => (
                  <div className="w-[206px] p-1">
                    {(Object.keys(TYPE_LABEL) as EduType[])
                      .filter((t) => t !== eduType)
                      .map((t) => (
                          <button
                          key={t}
                            type="button"
                          onClick={() => { if (eduType) convertType(ed, eduType, t); close(); }}
                          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] text-ink-700 transition-colors hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800"
                          >
                          {TYPE_ICON[t]}
                          {TYPE_LABEL[t]}
                          </button>
                      ))}
                  </div>
                  ),
                },
            },
          ],
    },

    /* ── سوال — variant + answer placement (only the quiz families) ── */
    ...(QUIZ_TYPES.has(eduType)
      ? (() => {
          const qa = eduType ? quizAttrsOf(ed, eduType) : null;
          if (!qa) return [];
          const isTF = eduType === 'trueFalseBlock';
          const isMCQ = eduType === 'mcqBlock';
          const answerGroups: ContextualGroup[] = [
            {
              key: 'edu.qvariant',
              label: 'قالب سوال',
              tools: [
                {
                  key: 'edu.qv.picker',
                  title: 'قالب سوال — ۱۲ طرح آماده',
                  label: `قالب: ${VARIANT_DEFS.find((v) => v.v === qa.qVariant)?.label ?? 'خط ظریف'}`,
                  icon: h4(Palette),
                  dropdown: {
                    width: 300,
                    render: (close: () => void) => (
                    <div className="w-[296px] max-h-[340px] overflow-y-auto p-1">
                      {VARIANT_DEFS.map((v) => (
                        <button
                          key={v.v}
                          type="button"
                          title={v.desc}
                          onClick={() => { if (eduType) patchQuizAttrs(ed, eduType, { qVariant: v.v }); close(); }}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] transition-colors ${
                            qa.qVariant === v.v
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
                  ),
                },
              },
              ],
            },
          ];
          /* MCQ layout — the same two options the block itself offers */
          if (isMCQ) {
            answerGroups.push({
              key: 'edu.mcqlayout',
              label: 'چیدمان گزینه‌ها',
              tools: [
                act('edu.mcql.stacked', '۴ گزینه زیر هم', undefined,
                  () => patchQuizAttrs(ed, 'mcqBlock', { layout: 'stacked' }), 'زیر هم', qa && (a.layout ?? 'stacked') === 'stacked'),
                act('edu.mcql.grid', 'دو گزینه کنار هم', undefined,
                  () => patchQuizAttrs(ed, 'mcqBlock', { layout: 'grid' }), '۲×۲', qa && a.layout === 'grid'),
              ],
            } as ContextualGroup);
          }
          /* answer placement + visibility — where does the correct answer
             live? (روی گزینه / انتهای سوال / بدون پاسخ) */
          if (isMCQ || isTF) {
            answerGroups.push({
              key: 'edu.answer',
              label: 'پاسخ',
              tools: ANSWER_AT_DEFS.map((d) =>
                act(`edu.ans.${d.v}`, d.desc, undefined,
                  () => eduType && patchQuizAttrs(ed, eduType, { answerAt: d.v, showAnswer: d.v !== 'none' }),
                  d.label, qa.answerAt === d.v),
              ),
            } as ContextualGroup);
          }
          return answerGroups;
        })()
      : []),

    /* ── نمره — only for پاسخ تشریحی ── */
    ...(eduType === 'longAnswerBlock'
      ? [{
          key: 'edu.points',
          label: 'نمره',
          tools: [0, 1, 2, 3, 5].map((p) =>
            act(`edu.points.${p}`, `نمره ${p === 0 ? 'نامشخص' : p}`, undefined, () =>
              ch().updateAttributes('longAnswerBlock', { points: p }).run(),
              p === 0 ? '—' : String(p), (a.points ?? 0) === p),
          ),
        } as ContextualGroup]
      : []),

    /* ── شخصی‌سازی — per-block visual modal ── */
    {
      key: 'edu.style',
      label: 'شخصی‌سازی این کادر',
      tools: [
        act('edu.style.open', 'شخصی‌سازی این کادر — تیتر، متن، بوردر، پس‌زمینه', h4(Paintbrush), () => {
          openEduBlockStyleModal(ed);
        }, 'شخصی‌سازی…'),
      ],
    },

    /* ── بلوک — object commands ── */
    {
      key: 'edu.tools',
      label: 'بلوک',
      tools: [
        act('edu.duplicate', 'تکثیر بلوک', h4(Copy), () => {
          if (!eduType) return;
          const pos = eduNodePos(ed, eduType);
          if (pos < 0) return;
          const node = ed.state.doc.nodeAt(pos);
          if (!node) return;
          ed.view.dispatch(ed.state.tr.insert(pos + node.nodeSize, node.copy(node.content)));
        }, 'تکثیر'),
        act('edu.delete', 'حذف کل بلوک', h4(Trash2), () => {
          if (!eduType) return;
          const pos = eduNodePos(ed, eduType);
          if (pos < 0) return;
          const node = ed.state.doc.nodeAt(pos);
          if (!node) return;
          ed.view.dispatch(ed.state.tr.delete(pos, pos + node.nodeSize));
        }, 'حذف'),
      ],
    },
  ];
}

function tabs(a: EduBlockAttrs): ContextualTab[] {
  return [
    {
      id: 'context-edublock',
      label: 'کادر آموزشی',
      icon: h4(GraduationCap),
      priority: 8,
      groups: groups(a),
    },
  ];
}

export const eduBlockProvider: ContextProvider = {
  id: EDUBLOCK_CONTEXT_ID,
  matches: (o) => o.source === 'document' && EDU_BLOCK_TYPES.has(o.type),
  label: 'کادر آموزشی',
  capabilities: () => capabilities(),
  tabs: (o) => tabs(o.attrs as unknown as EduBlockAttrs),
};
