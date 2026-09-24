import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import * as prosemirrorState from 'prosemirror-state';
import katex from 'katex';
import { premiumSvg } from '@/components/editor/iconAssets';

/* Reentrancy guard shared with Page.tsx's beforeinput trap: the execCommand
   calls in the span keydown handlers below fire synthetic beforeinput events
   again; the flag makes those pass through the trap untouched (no loop). */
let pnNestedEditApplying = false;

/* ------------------------------------------------------------------ */
/* Educational blocks for Persian study notes                          */
/*                                                                     */
/* Every block exposes its title/question/term as an editable span     */
/* (NodeView) whose edits are persisted via setNodeMarkup — nothing    */
/* evaporates on re-render, and the exported HTML mirrors the editor.  */
/* Titles carry a small premium (Phosphor) icon instead of raw unicode */
/* glyphs, and all body content flows through real ProseMirror nodes.  */
/* ------------------------------------------------------------------ */

/** docs saved while styleBorderWidth defaulted to 0 (the old "inherit"
    sentinel) must not render borderless — normalize to inherit */
export function normalizeLegacyStyleAttrs(node: { attrs: Record<string, unknown> }): void {
  const a = node.attrs;
  if (a.styleBorderWidth === 0 && !a.styleBorder && !a.styleBorderStyle) {
    a.styleBorderWidth = -1;
  }
}

export const CALLOUT_KINDS = {
  definition: { label: 'تعریف', icon: 'book-open', cls: 'edu-definition' },
  important: { label: 'نکته مهم', icon: 'lightbulb', cls: 'edu-important' },
  exam: { label: 'نکته امتحانی', icon: 'graduation-cap', cls: 'edu-exam' },
  warning: { label: 'توجه', icon: 'warning', cls: 'edu-warning' },
  summary: { label: 'خلاصه', icon: 'chart-bar', cls: 'edu-summary' },
  comparison: { label: 'مقایسه', icon: 'chart-bar', cls: 'edu-comparison' },
  timeline: { label: 'زمان‌خط', icon: 'clock', cls: 'edu-timeline' },
  footnote: { label: 'یادداشت پاورقی', icon: 'note-pencil', cls: 'edu-footnote' },
  longanswer: { label: 'پاسخ تشریحی', icon: 'pencil-simple', cls: 'edu-longanswer' },
  highlight: { label: 'جعبه برجسته', icon: 'star', cls: 'edu-highlight' },
  reference: { label: 'منبع', icon: 'book', cls: 'edu-reference' },
  procon: { label: 'موافق و مخالف', icon: 'thumbs-up', cls: 'edu-procon' },
} as const;

export type CalloutKind = keyof typeof CALLOUT_KINDS;

/** small phosphor icon (currentColor → inherits the title color) */
const EDU_ICON_IDS: Record<string, string> = {
  definition: 'book-open', important: 'lightbulb', exam: 'graduation-cap',
  warning: 'warning', summary: 'chart-bar', comparison: 'chart-bar',
  timeline: 'clock', footnote: 'note-pencil', longanswer: 'pencil-simple',
  highlight: 'star', reference: 'book', procon: 'thumbs-up',
  question: 'chat-circle-text', example: 'flask', keyterm: 'bookmark-simple',
  codeoutput: 'monitor',
  quizessay: 'pencil-simple', truefalse: 'check-circle', mcq: 'mcq',
};

/** four-bullet list icon (phosphor style, currentColor) — the four-option
 *  question mark has no matching asset in the downloaded premium set */
export const MCQ_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 256 256" fill="currentColor"><path d="M84,64a12,12,0,1,1-12-12A12,12,0,0,1,84,64Zm140,0a8,8,0,0,1-8,8H120a8,8,0,0,1,0-16h96A8,8,0,0,1,224,64Zm-8,64H120a8,8,0,0,0,0,16h96a8,8,0,0,0,0-16Zm0,72H120a8,8,0,0,0,0,16h96a8,8,0,0,0,0-16ZM84,128a12,12,0,1,1-12-12A12,12,0,0,1,84,128Zm-12,52a12,12,0,1,0,12,12A12,12,0,0,0,72,180Z"/></svg>';

function eduIconSvg(key: string): string {
  const raw = key === 'mcq' ? MCQ_ICON_SVG : (premiumSvg(EDU_ICON_IDS[key] ?? 'book-open') ?? '');
  return raw.replace(/width="1em" height="1em"/, 'width="0.85em" height="0.85em"');
}
export { eduIconSvg };

/** build an element from an html string (usable inside PM render arrays) */
function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild as HTMLElement;
}

/* ── per-block visual overrides (شخصی‌سازی هر کادر) ────────────────────
   Every edu block carries optional style attrs; '' / 0 / -1 = inherit the
   family + global defaults. The SAME values flow into the NodeView (editor)
   and the static renderHTML (print/PDF/Word export) so a customized block
   renders identically everywhere. */
export interface EduStyleAttrs {
  styleBg: string;          /** background color override ('' = default) */
  styleBorder: string;      /** border color override ('' = default) */
  styleBorderWidth: number; /** -1 = inherit family, 0 = borderless, >0 = px */
  styleBorderStyle: string; /** solid | dashed | dotted ('' = solid) */
  styleRadius: number;      /** corner radius px (-1 = default 4) */
  styleTitle: string;       /** title color override ('' = family color) */
}

/** shared attr definitions — spread into every edu node's addAttributes */
function styleAttrs(): EduStyleAttrs {
  return {
    styleBg: { default: '' },
    styleBorder: { default: '' },
    styleBorderWidth: { default: -1 },
    styleBorderStyle: { default: '' },
    styleRadius: { default: -1 },
    styleTitle: { default: '' },
  } as unknown as EduStyleAttrs;
}

/** whether any style attr is customized (styleBorderWidth: -1 inherits) */
export function hasStyleAttrs(attrs: Record<string, unknown>): boolean {
  return Boolean(
    attrs.styleBg || attrs.styleBorder || attrs.styleBorderStyle ||
    (attrs.styleRadius as number) >= 0 || attrs.styleTitle,
  );
}

/** CSS style string for the wrapper div ('' = nothing to override) */
function styleCss(attrs: Record<string, unknown>): string {
  const css: string[] = [];
  if (attrs.styleBg) css.push(`background:${attrs.styleBg}`);
  const w = attrs.styleBorderWidth as number;
  const c = attrs.styleBorder as string;
  const st = (attrs.styleBorderStyle as string) || 'solid';
  if (w === 0) {
    css.push('border:none');
  } else if (c && w > 0) {
    css.push(`border:${w}px ${st} ${c}`);
  } else if (c && w < 0) {
    /* only a color override — keep the family width/style */
    css.push(`border-color:${c}`);
    if ((attrs.styleBorderStyle as string)) css.push(`border-style:${st}`);
  } else if (w > 0) {
    css.push(`border-width:${w}px;border-style:${st}`);
  const accent = attrs.qAccent as string | undefined;
  if (accent) css.push(`--q-accent:${accent}`);
  }
  const r = attrs.styleRadius as number;
  if (r >= 0) css.push(`border-radius:${r}px`);
  return css.join(';');
}

/** merge base attrs + the style string into renderHTML's wrapper attrs */
function wrapperAttrs(node: { attrs: Record<string, unknown> }, base: Record<string, unknown>): Record<string, unknown> {
  const css = styleCss(node.attrs);
  return css ? { ...base, style: css } : base;
}

/** icon + editable-text spans of an .edu-title (shared by editor & export) */
function titleChildren(iconKey: string, text: string, placeholder: string, titleColor?: string): unknown[] {
  return [
    ['span', { class: 'edu-title-icon', contenteditable: 'false' }, el(eduIconSvg(iconKey))],
    ['span', { class: 'edu-title-text', 'data-ph': placeholder, ...(titleColor ? { style: `color:${titleColor}` } : {}) }, text],
  ];
}

/* ────────────────────────────────────────────────────────────────────────
   Generic NodeView factory: a block with an editable, PERSISTED title
   (setNodeMarkup — not the broken direct-attrs mutation) plus a real
   contentDOM so the body content is ordinary ProseMirror nodes.
   ──────────────────────────────────────────────────────────────────────── */
/** the (نمره) suffix shown next to the question title — empty when the
 *  user has not set a mark, so nothing renders (no "0 نمره") */
function pointsSuffix(node: { attrs: Record<string, unknown> }): string {
  const raw = Number(node.attrs.points ?? 0);
  return raw > 0 ? `(${raw} نمره)` : '';
}

interface EditableTitleSpec {
  name: string;
  attr: string;
  dataType: string;
  blockCls: string | ((node: any) => string);
  iconKey: string | ((node: any) => string);
  fallback: string;
  suffix?: (node: any) => string;
  extraAttrs?: (node: any) => Record<string, string>;
  /** build the area under the title; returns the contentDOM (default: plain body) */
  buildBody?: (node: any, wrapper: HTMLElement, editor: any, getPos: any, els: Record<string, HTMLElement>) => HTMLElement;
  /** called after every successful update() — lets compound blocks (quiz
   *  MCQ options, true/false state) re-sync their attr-driven DOM without
   *  recreating editable spans (typing keeps its caret). */
  onUpdate?: (updated: any, els: Record<string, HTMLElement>, editor: any, getPos: any) => void;
}

function editableTitleView(spec: EditableTitleSpec) {
  return ({ node, editor, getPos }: any) => {
    normalizeLegacyStyleAttrs(node);
    const resolve = <T,>(v: T | ((n: any) => T)): T => (typeof v === 'function' ? (v as any)(node) : v);

    const wrapper = document.createElement('div');
    wrapper.className = resolve(spec.blockCls);
    wrapper.setAttribute('data-type', spec.dataType);
    for (const [k, v] of Object.entries(resolve(spec.extraAttrs) ?? {})) wrapper.setAttribute(k, v);

    /* per-block visual overrides — applied live and re-applied on update */
    const applyStyle = (attrs: Record<string, unknown>) => {
      const css = styleCss(attrs);
      if (css) wrapper.setAttribute('style', css);
      else wrapper.removeAttribute('style');
      const tc = attrs.styleTitle as string;
      text.style.color = tc || '';
    };

    const title = document.createElement('div');
    title.className = 'edu-title';
    const icon = document.createElement('span');
    icon.className = 'edu-title-icon';
    icon.setAttribute('contenteditable', 'false');
    icon.innerHTML = eduIconSvg(resolve(spec.iconKey));
    const text = document.createElement('span');
    text.className = 'edu-title-text';
    text.setAttribute('data-ph', spec.fallback);
    try { text.contentEditable = 'plaintext-only'; } catch { text.contentEditable = 'true'; }
    text.textContent = node.attrs[spec.attr] || '';
    title.append(icon, text);
    applyStyle(node.attrs);
    if (spec.suffix) {
      const suffix = document.createElement('span');
      suffix.className = 'edu-title-suffix';
      suffix.setAttribute('contenteditable', 'false');
      suffix.textContent = spec.suffix(node);
      title.appendChild(suffix);
    }
    wrapper.appendChild(title);

    /* attr-driven secondary UI (MCQ option rows, TF buttons) lives outside
       the contentDOM and re-syncs through this hook on every update */
    const els: Record<string, HTMLElement> = {};

    /* content area under the title */
    const contentDOM = spec.buildBody
      ? spec.buildBody(node, wrapper, editor, getPos, els)
      : appendBody(wrapper);

    /* persist edits through the document (setNodeMarkup), never lost.
       WHY a MutationObserver: Chromium retargets beforeinput/input events of
       the nested contenteditable span to the PM ROOT (the nearest plain
       contenteditable host), so 'input' listeners on the span NEVER fire and
       PM's own DOMObserver ignores the mutation (title is outside contentDOM).
       A characterData/childList observer on the span catches every edit path
       (typing, execCommand, paste, cut) regardless of event retargeting. */
    let syncing = false;
    const sync = () => {
      if (syncing) return;
      const pos = typeof getPos === 'function' ? getPos() : null;
      if (pos == null) return;
      const cur = editor.state.doc.nodeAt(pos);
      const val = text.textContent ?? '';
      if (!cur || cur.attrs[spec.attr] === val) return;
      /* CARET PRESERVATION: dispatching inside this observer lets PM/native
         selection normalization YANK the DOM caret out of the span and drop
         it at PM's internal selection (the body paragraph) — mid-word the
         user's next chars then land BELOW the question («حرف می‌پره بیرون»).
         Capture the caret state before the dispatch and restore it after. */
      const sel = window.getSelection();
      const anchor = sel?.anchorNode ?? null;
      const hadCaret = anchor != null && text.contains(anchor);
      const offsetInSpan = hadCaret && anchor === text
        ? sel!.anchorOffset
        : -1;
      const textNodeOffset = hadCaret && anchor instanceof Text
        ? sel!.anchorOffset
        : -1;
      syncing = true;
      try {
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, [spec.attr]: val }));
      } finally {
        syncing = false;
      }
      if (hadCaret) {
        const sel2 = window.getSelection();
        const stillIn = sel2?.anchorNode != null && text.contains(sel2.anchorNode);
        if (!stillIn && text.firstChild instanceof Text) {
          try {
            const range = document.createRange();
            const off = textNodeOffset >= 0 ? Math.min(textNodeOffset, text.firstChild.length) : text.firstChild.length;
            range.setStart(text.firstChild, off);
            range.collapse(true);
            sel2!.removeAllRanges();
            sel2!.addRange(range);
          } catch { /* best effort — typing continues from PM's caret */ }
        }
      }
    };
    const titleObserver = new MutationObserver(() => sync());
    titleObserver.observe(text, { characterData: true, childList: true, subtree: true });
    text.addEventListener('blur', sync);
    text.addEventListener('paste', (e: ClipboardEvent) => {
      e.preventDefault();
      const t = e.clipboardData?.getData('text/plain') ?? '';
      document.execCommand('insertText', false, t);
      sync();
    });
    text.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        sync();
        /* Enter/ArrowDown: move BELOW the block (never inside it — the user
           expects to leave the question box, not dive into its body, and a
           blind pos+2 could split/delete the node when the body is empty).
           TextSelection near the block end lands in the doc-level gap after
           it; Selection.near guarantees a VALID caret there. */
        try {
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos != null) {
            const $end = editor.state.doc.resolve(Math.min(pos + editor.state.doc.nodeAt(pos)!.nodeSize, editor.state.doc.content.size));
            const target = prosemirrorState.Selection.near($end, 1);
            editor.chain().setTextSelection(target).scrollIntoView().focus().run();
          }
        } catch { /* ignore */ }
      } else if (e.key === 'Backspace' && (text.textContent ?? '') === '' && window.getSelection()?.isCollapsed) {
        /* Backspace in an EMPTY title must never eat the block itself —
           hop the caret to the paragraph BEFORE the block instead. */
        e.preventDefault();
        try {
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos != null && pos > 0) {
            const $before = editor.state.doc.resolve(pos - 1);
            const target = prosemirrorState.Selection.near($before, -1);
            editor.chain().setTextSelection(target).focus().run();
          }
        } catch { /* ignore */ }
      }
    });

    return {
      dom: wrapper,
      contentDOM,
      update(updated: any) {
        if (updated.type.name !== spec.name) return false;
        /* VALUE-EQUAL GUARD: only reassign when the DOM actually differs.
           The caret anchor (activeElement) is the PM ROOT while typing in a
           nested span — the old activeElement check was always true, so any
             unrelated transaction (engine pass, remote op, option toggle)
           re-assigned textContent even when EQUAL, killing the caret, and
           when a sync raced a keystroke, ERASING the just-typed text. */
        const liveSel = window.getSelection();
        const selInText = liveSel?.anchorNode != null && text.contains(liveSel.anchorNode);
        const nextTitle = updated.attrs[spec.attr] || '';
        if ((text.textContent ?? '') !== nextTitle && !selInText) {
          text.textContent = nextTitle;
        }
        if (document.activeElement !== text) {
          const s = title.querySelector<HTMLElement>('.edu-title-suffix');
          if (s && spec.suffix) s.textContent = spec.suffix(updated);
        }
        /* per-block style overrides live-update with the attrs */
        applyStyle(updated.attrs);
        /* attr-driven wrapper data attrs (data-qv / data-layout / data-answer…)
           must track the updated node exactly like create time — without this
           the live NodeView kept the FIRST variant painted on it forever
           (static renders updated, the editing surface did not). Runs BEFORE
           onUpdate so policy-aware overrides (true/false data-answer) win. */
        const nextExtras = (typeof spec.extraAttrs === 'function' ? spec.extraAttrs(updated) : spec.extraAttrs) ?? {};
        for (const [k, v] of Object.entries(nextExtras)) {
          if (wrapper.getAttribute(k) !== v) wrapper.setAttribute(k, v);
        }
        if (document.activeElement !== text) {
          /* attrs may CHANGE the visual identity (callout kind, converted block
             type): keep class + icon in sync, exactly like the static renderHTML */
          const nextCls = resolve(spec.blockCls);
          if (nextCls !== wrapper.className) {
            wrapper.className = nextCls;
            if (spec.name === 'calloutBlock') wrapper.setAttribute('data-kind', updated.attrs.kind);
          }
          const nextIcon = eduIconSvg(resolve(spec.iconKey));
          if (icon.innerHTML !== nextIcon) icon.innerHTML = nextIcon;
        }
        spec.onUpdate?.(updated, els, editor, getPos);
        return true;
      },
      /* only title mutations are ours; PM owns everything inside contentDOM */
      ignoreMutation: (m: { target: unknown }) =>
        !(contentDOM && (contentDOM === m.target || contentDOM.contains(m.target as globalThis.Node))),
      stopEvent: (e: Event) => title.contains(e.target as globalThis.Node),
    };
  };
}

/** default body: plain .edu-body div that holds the block content */
function appendBody(wrapper: HTMLElement): HTMLElement {
  const body = document.createElement('div');
  body.className = 'edu-body';
  wrapper.appendChild(body);
  return body;
}

/**
 * MCQ option lettering (Persian ۱/۲/۳/۴) — shared by the MCQ NodeView
 * (per-option deletion / correct-marking) and the static export HTML.
 */
export function mcqOptionLabel(i: number): string {
  return ['۱', '۲', '۳', '۴'][i] ?? String(i + 1);
}

/** generic callout box: تعریف / نکته مهم / نکته امتحانی / توجه / خلاصه */
export const CalloutBlock = Node.create({
  name: 'calloutBlock',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return {
      kind: { default: 'important' },
      title: { default: '' },
      ...styleAttrs(),
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ node }) {
    const kind = (node.attrs.kind as CalloutKind) ?? 'important';
    const meta = CALLOUT_KINDS[kind];
    return [
      'div',
      mergeAttributes(wrapperAttrs(node, { 'data-type': 'callout', 'data-kind': kind, class: `edu-block ${meta?.cls ?? 'edu-important'}` })),
      ['div', { class: 'edu-title', 'data-title': node.attrs.title }, ...titleChildren(meta?.icon ?? 'book-open', node.attrs.title || meta?.label || '', meta?.label ?? '', node.attrs.styleTitle as string)],
      ['div', { class: 'edu-body' }, 0],
    ];
  },
  addNodeView() {
    return editableTitleView({
      name: 'calloutBlock',
      attr: 'title',
      dataType: 'callout',
      blockCls: (node) => `edu-block ${CALLOUT_KINDS[(node.attrs.kind as CalloutKind)]?.cls ?? 'edu-important'}`,
      iconKey: (node) => CALLOUT_KINDS[(node.attrs.kind as CalloutKind)]?.icon ?? 'book-open',
      fallback: '',
      extraAttrs: (node) => ({ 'data-kind': node.attrs.kind }),
    });
  },
});

/**
 * Question blocks — SHARED QUIZ ATTRS
 * ───────────────────────────────────
 * `qVariant`   : per-block visual identity (v1 | v2 | v3) — each family has
 *                three distinct looks (see .quiz-v* in index.css), so a
 *                ورقه of questions can mix styles per question.
 * `showAnswer` : whether the ANSWER UI exists at all (گزینه‌ها can be
 *                answered OR unanswered: a نمونه سوال stays clean).
 * `answerAt`   : WHERE the correct answer is marked — 'mark' paints the
 *                option/button itself (inside the flow), 'end' shows the
 *                correct answer as a small line at the END of the block
 *                (spoiler-safe for practice sheets), 'none' hides it.
 */
export interface QuizExtraAttrs {
  qVariant: string;   /** 'v1' | 'v2' | 'v3' — '' = v1 (default look) */
  showAnswer: boolean;
  answerAt: string;   /** 'mark' (paint option) | 'end' (answer line) | 'none' */
}

function quizAttrs() {
  return {
    points: { default: 0 },
    qVariant: { default: '' },
    showAnswer: { default: true },
    answerAt: { default: 'mark' },
    qAccent: { default: '' },
    qChip: { default: '' },      /** '' | circle | square | none — the option number chip */
    qGap: { default: '' },       /** '' | tight | wide — option row spacing */
  };
}

/** wrapper data attrs + class for the quiz variant — shared by all four
 *  question families so the CSS can key off one attribute */
const QVARIANTS = new Set(['v1','v2','v3','v4','v5','v6','v7','v8','v9','v10','v11','v12']);
function quizWrapperExtras(node: { attrs: Record<string, unknown> }): Record<string, string> {
  const v = typeof node.attrs.qVariant === 'string' && QVARIANTS.has(node.attrs.qVariant) ? node.attrs.qVariant : 'v1';
  const extras: Record<string, string> = { 'data-qv': v };
  if (node.attrs.qChip) extras['data-chip'] = String(node.attrs.qChip);
  if (node.attrs.qGap) extras['data-gap'] = String(node.attrs.qGap);
  return extras;
}

/** whether the answer should be visible, and where — central policy:
 *  showAnswer=false → nothing at all; answerAt='none' → hidden even when
 *  enabled; 'end' → a dedicated answer line AFTER the question flow. */
function answerPolicy(node: { attrs: Record<string, unknown> }): { on: boolean; mode: 'mark' | 'end' } {
  const on = node.attrs.showAnswer !== false && node.attrs.answerAt !== 'none';
  return { on, mode: node.attrs.answerAt === 'end' ? 'end' : 'mark' };
}

/** correct-option index (or -1) honoring the policy: 'end' mode still knows
 *  the answer internally but does NOT paint the option green */
function effectiveCorrect(node: { attrs: Record<string, unknown> }): number {
  const pol = answerPolicy(node);
  const correct = typeof node.attrs.correct === 'number' ? node.attrs.correct : -1;
  return pol.on && pol.mode === 'mark' ? correct : -1;
}

/** the end-of-block answer line (static + NodeView share the text) */
function endAnswerLine(kind: 'mcq' | 'truefalse' | 'short', node: { attrs: Record<string, unknown> }): string {
  if (kind === 'mcq') {
    const c = typeof node.attrs.correct === 'number' ? node.attrs.correct : -1;
    return c >= 0 ? `پاسخ صحیح: گزینه ${mcqOptionLabel(c)}` : '';
  }
  if (kind === 'truefalse') {
    const a = node.attrs.answer as string;
    return a === 'true' ? 'پاسخ صحیح: درست' : a === 'false' ? 'پاسخ صحیح: نادرست' : '';
  }
  const ans = String(node.attrs.answerText ?? '').trim();
  return ans ? `پاسخ: ${ans}` : '';
}

/** question + answer */
export const QuestionBlock = Node.create({
  name: 'questionBlock',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return { question: { default: '' }, answerText: { default: '' }, ...quizAttrs(), ...styleAttrs() };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="question"]' }];
  },
  renderHTML({ node }) {
    normalizeLegacyStyleAttrs(node);
    const pol = answerPolicy(node);
    const ansLine = pol.on && pol.mode === 'end' ? endAnswerLine('short', node) : '';
    return [
      'div',
      mergeAttributes(wrapperAttrs(node, { 'data-type': 'question', class: 'edu-block edu-question', ...quizWrapperExtras(node) })),
      ['div', { class: 'edu-title', 'data-question': node.attrs.question },
        ...titleChildren('question', node.attrs.question, 'سوال را بنویسید…', node.attrs.styleTitle as string),
        ['span', { class: 'edu-title-suffix', contenteditable: 'false' }, pointsSuffix(node)]],
      ['div', 0],
      ...(pol.on && pol.mode === 'end' && ansLine
        ? [['div', { class: 'quiz-end-answer', contenteditable: 'false' }, ansLine]]
        : []),
    ];
  },
  addNodeView() {
    return editableTitleView({
      name: 'questionBlock',
      attr: 'question',
      dataType: 'question',
      blockCls: 'edu-block edu-question',
      iconKey: 'question',
      fallback: 'سوال را بنویسید…',
      suffix: pointsSuffix,
      extraAttrs: (node) => quizWrapperExtras(node),
      buildBody: (_node, wrapper, _ed, _pos, els) => { els.qWrapper = wrapper; return appendBody(wrapper); },
      onUpdate: (updated, els) => {
        /* the end-answer line tracks attrs (answerText / visibility) */
        const pol = answerPolicy(updated);
        const txt = pol.on && pol.mode === 'end' ? endAnswerLine('short', updated) : '';
        const host = els.qWrapper as HTMLElement | undefined;
        if (!host) return;
        let line = host.querySelector<HTMLElement>(':scope > .quiz-end-answer');
        if (txt) {
          if (!line) { line = document.createElement('div'); line.className = 'quiz-end-answer'; line.setAttribute('contenteditable', 'false'); host.appendChild(line); }
          if (line.textContent !== txt) line.textContent = txt;
        } else if (line) line.remove();
      },
    });
  },
});

/**
 * MCQ option structure — one editable line (div.quiz-opt) per option.
 * `data-correct="true"` paints the option green (editor + PDF/print).
 * Structure mirrors .edu-procon: options live in ATTRS (not PM children)
 * so they round-trip through save/export exactly like pro/con text.
 */
function mcqOptionRows(node: { attrs: Record<string, unknown> }): unknown[] {
  const a = node.attrs;
  const opts = Array.from({ length: 4 }, (_, i) => (a.options as string[] | undefined)?.[i] ?? '');
  const correct = effectiveCorrect(node);
  return [
    'div',
    { class: `quiz-opts quiz-opts-${a.layout === 'grid' ? 'grid' : 'stacked'}` },
    ...opts.map((opt, i) => [
      'div',
      { class: 'quiz-opt', 'data-correct': String(correct === i) },
      ['span', { class: 'quiz-opt-num', contenteditable: 'false' }, mcqOptionLabel(i)],
      ['span', { class: 'quiz-opt-text', 'data-ph': 'گزینه…' }, opt],
    ]),
  ];
}

/**
 * True/False question — editable statement + two درست/نادرست buttons
 * (single-select, stored in attrs so it persists and exports).
 */
export const TrueFalseBlock = Node.create({
  name: 'trueFalseBlock',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return {
      question: { default: '' },
      answer: { default: 'none' },  /** 'true' | 'false' | 'none' */
      ...quizAttrs(),
      ...styleAttrs(),
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="truefalse"]' }];
  },
  renderHTML({ node }) {
    normalizeLegacyStyleAttrs(node);
    const pol = answerPolicy(node);
    const ansAttr = pol.on && pol.mode === 'mark' ? String(node.attrs.answer ?? 'none') : 'none';
    const ansLine = pol.on && pol.mode === 'end' ? endAnswerLine('truefalse', node) : '';
    return [
      'div',
      mergeAttributes(wrapperAttrs(node, {
        'data-type': 'truefalse',
        class: 'edu-block edu-truefalse',
        'data-answer': ansAttr,
        ...quizWrapperExtras(node),
      })),
      ['div', { class: 'edu-title', 'data-question': node.attrs.question },
        ...titleChildren('truefalse', node.attrs.question, 'جمله درست / نادرست را بنویسید…', node.attrs.styleTitle as string),
        ['span', { class: 'edu-title-suffix', contenteditable: 'false' }, pointsSuffix(node)]],
      ['div', { class: 'quiz-tf-row', 'data-answer': ansAttr },
        ['span', { class: 'quiz-tf-btn quiz-tf-true', contenteditable: 'false' }, 'درست'],
        ['span', { class: 'quiz-tf-btn quiz-tf-false', contenteditable: 'false' }, 'نادرست']],
      ['div', 0],
      ...(ansLine ? [['div', { class: 'quiz-end-answer', contenteditable: 'false' }, ansLine]] : []),
    ];
  },
  addNodeView() {
    return editableTitleView({
      name: 'trueFalseBlock', attr: 'question', dataType: 'truefalse',
      blockCls: 'edu-block edu-truefalse',
      iconKey: 'truefalse',
      fallback: 'جمله درست / نادرست را بنویسید…',
      suffix: pointsSuffix,
      /* data-qv/chip/gap MUST ride the wrapper (with data-answer) — the
         variant picker paints TF through the same data-qv CSS the other
         question families use; missing them kept TF stuck on the base look */
      extraAttrs: (node) => ({
        'data-answer': String(node.attrs.answer ?? 'none'),
        ...quizWrapperExtras(node),
      }),
      buildBody: (node, wrapper, editor, getPos, els) => {
        const row = document.createElement('div');
        row.className = 'quiz-tf-row';
        row.setAttribute('contenteditable', 'false');
        els.tfRow = row;
        els.tfWrapper = wrapper;
        const paint = (n: { attrs: Record<string, unknown> }) => {
          const pol = answerPolicy(n);
          const shown = pol.on && pol.mode === 'mark' ? String(n.attrs.answer ?? 'none') : 'none';
          row.setAttribute('data-answer', shown);
          wrapper.setAttribute('data-answer', shown);
          syncEndAnswer(wrapper, 'truefalse', n.attrs);
        };
        paint(node);
        const mk = (val: 'true' | 'false', label: string) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `quiz-tf-btn quiz-tf-${val}`;
          b.textContent = label;
          /* keep ProseMirror from stealing the click (node selection) */
          b.addEventListener('mousedown', (e) => e.preventDefault());
          b.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pos = typeof getPos === 'function' ? getPos() : null;
            if (pos == null) return;
            const cur = editor.state.doc.nodeAt(pos);
            if (!cur) return;
            const next = cur.attrs.answer === val ? 'none' : val;
            const patch: Record<string, unknown> = { answer: next };
            /* same feedback guarantee as MCQ: marking while hidden reveals */
            if (next !== 'none' && (cur.attrs.showAnswer === false || cur.attrs.answerAt === 'none')) {
              patch.showAnswer = true;
              patch.answerAt = 'mark';
            }
            editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...patch }));
          });
          return b;
        };
        row.append(mk('true', 'درست'), mk('false', 'نادرست'));
        wrapper.appendChild(row);
        return appendBody(wrapper);
      },
      onUpdate: (updated, els) => {
        const shown = answerPolicy(updated).on && updated.attrs.answerAt !== 'end'
          ? String(updated.attrs.answer ?? 'none')
          : 'none';
        els.tfRow?.setAttribute('data-answer', shown);
        els.tfWrapper?.setAttribute('data-answer', shown);
        syncEndAnswer(els.tfWrapper as HTMLElement, 'truefalse', updated.attrs);
      },
    });
  },
});

/**
 * Four-option MCQ — layout selectable (۴ گزینه زیر هم | دو گزینه دو ستون),
 * options are editable single-line spans, each deletable, correct option
 * toggle-marked via its number badge. All state rides attrs (persistence
 * + export + print are automatic, like every other edu block).
 */
export const McqBlock = Node.create({
  name: 'mcqBlock',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return {
      qTitle: { default: '' },
      layout: { default: 'stacked' },   /** 'stacked' (زیر هم) | 'grid' (۲×۲) */
      options: { default: ['', '', '', ''] },
      correct: { default: -1 },         /** index 0..3, -1 = بی‌پاسخ */
      ...quizAttrs(),
      ...styleAttrs(),
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="mcq"]' }];
  },
  renderHTML({ node }) {
    normalizeLegacyStyleAttrs(node);
    const a = node.attrs;
    const pol = answerPolicy(node);
    const ansLine = pol.on && pol.mode === 'end' ? endAnswerLine('mcq', node) : '';
    return [
      'div',
      mergeAttributes(wrapperAttrs(node, {
        'data-type': 'mcq',
        class: 'edu-block edu-mcq',
        'data-layout': a.layout === 'grid' ? 'grid' : 'stacked',
        ...quizWrapperExtras(node),
      })),
      ['div', { class: 'edu-title', 'data-question': a.qTitle },
        ...titleChildren('mcq', a.qTitle, 'صورت سوال…', node.attrs.styleTitle as string),
        ['span', { class: 'edu-title-suffix', contenteditable: 'false' }, pointsSuffix(node)]],
      /* mcqOptionRows builds ONE [tag, attrs, ...children] spec — spread it
         here; a raw nested array inside the parent spec makes prosemirror-view
         throw "Invalid array passed to renderSpec" and white-screen the app */
      mcqOptionRows(node) as unknown,
      ['div', 0],
      ...(ansLine ? [['div', { class: 'quiz-end-answer', contenteditable: 'false' }, ansLine]] : []),
    ];
  },
  addNodeView() {
    return editableTitleView({
      name: 'mcqBlock', attr: 'qTitle', dataType: 'mcq',
      blockCls: 'edu-block edu-mcq',
      iconKey: 'mcq',
      fallback: 'صورت سوال…',
      suffix: pointsSuffix,
      extraAttrs: (node) => ({
        'data-layout': node.attrs.layout === 'grid' ? 'grid' : 'stacked',
        ...quizWrapperExtras(node),
      }),
      buildBody: (node, wrapper, editor, getPos, els) => {
        const optsBox = document.createElement('div');
        optsBox.className = 'quiz-opts';
        /* NOTE: deliberately NOT contenteditable=false. A nested false region
           inside the NodeView makes Chromium retarget IME/typing mutations
           to the PM root and the title span loses its caret mid-sentence. */
        wrapper.appendChild(optsBox);
        els.optsBox = optsBox;
        els.mcqWrapper = wrapper;
        els.editor = editor as unknown as HTMLElement;
        els.getPos = getPos as unknown as HTMLElement;
        renderMcqOptions(optsBox, wrapper, node.attrs as Record<string, unknown>, editor, getPos);
        /* body: empty bottom area — the PM contentDOM (an optional
           توضیح paragraph under the options) */
        return appendBody(wrapper);
      },
      onUpdate: (updated, els, editor, getPos) => {
        updateMcqOptions(els.optsBox as HTMLElement, els.mcqWrapper as HTMLElement, updated.attrs as Record<string, unknown>, typeof getPos === 'function' ? getPos : undefined, editor);
      },
    });
  },
});
function renderMcqOptions(
  optsBox: HTMLElement,
  wrapper: HTMLElement,
  attrs: Record<string, unknown>,
  editor: Editor,
  getPos: () => number | undefined,
) {
  const layout = attrs.layout === 'grid' ? 'grid' : 'stacked';
  wrapper.setAttribute('data-layout', layout);
  optsBox.className = `quiz-opts quiz-opts-${layout}`;
  optsBox.textContent = '';
  const opts = Array.from({ length: 4 }, (_, i) => (attrs.options as string[] | undefined)?.[i] ?? '');
  const correctShown = effectiveCorrect({ attrs } as never);
  const spanRefs: HTMLElement[] = [];
  opts.forEach((opt, i) => {
    const row = document.createElement('div');
    row.className = 'quiz-opt';
    row.setAttribute('data-correct', String(correctShown === i));

    /* number badge — click toggles the correct-answer mark */
    const num = document.createElement('button');
    num.type = 'button';
    num.className = 'quiz-opt-num';
    num.title = 'علامت‌گذاری پاسخ درست';
    num.textContent = mcqOptionLabel(i);
    num.addEventListener('mousedown', (e) => e.preventDefault());
    num.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = getPos();
      if (pos == null) return;
      const cur = editor.state.doc.nodeAt(pos);
      if (!cur) return;
      /* answer policy rides with the node: toggling while showAnswer=false
         also enables the mark so the click always gives visible feedback */
      const enabling = cur.attrs.correct !== i;
      const patch: Record<string, unknown> = { correct: enabling ? i : -1 };
      if (enabling && (cur.attrs.showAnswer === false || cur.attrs.answerAt === 'none')) {
        patch.showAnswer = true;
        patch.answerAt = 'mark';
      }
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...patch }));
    });

    /* option text — single line, persisted through a REAL transaction
       (history + autosave fire, exactly like the editable title sync) */
    const txt = document.createElement('span');
    txt.className = 'quiz-opt-text';
    txt.setAttribute('data-ph', 'گزینه…');
    try { txt.contentEditable = 'plaintext-only'; } catch { txt.contentEditable = 'true'; }
    txt.textContent = opt;
    spanRefs.push(txt);
    /* option text sync — MutationObserver (NOT an input listener): the
       nested-contenteditable beforeinput trap in Page.tsx applies the char
       itself and the retargeted input event never reaches this span; the
       observer sees every DOM edit path regardless. Same caret-preservation
       pattern as the title sync above. */
    const syncOpt = () => {
      const pos = getPos();
      if (pos == null) return;
      const cur = editor.state.doc.nodeAt(pos);
      if (!cur) return;
      const val = txt.textContent ?? '';
      const arr = [...(cur.attrs.options as string[] ?? ['', '', '', ''])];
      while (arr.length < 4) arr.push('');
      if (arr[i] === val) return;
      const sel = window.getSelection();
      const anchor = sel?.anchorNode ?? null;
      const hadCaret = anchor != null && txt.contains(anchor);
      const textNodeOffset = hadCaret && anchor instanceof Text ? sel!.anchorOffset : -1;
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, options: arr.map((v, j) => (j === i ? val : v)) }),
      );
      if (hadCaret) {
        const sel2 = window.getSelection();
        const stillIn = sel2?.anchorNode != null && txt.contains(sel2.anchorNode);
        if (!stillIn && txt.firstChild instanceof Text) {
          try {
            const range = document.createRange();
            range.setStart(txt.firstChild, textNodeOffset >= 0 ? Math.min(textNodeOffset, txt.firstChild.length) : txt.firstChild.length);
            range.collapse(true);
            sel2!.removeAllRanges();
            sel2!.addRange(range);
          } catch { /* best effort */ }
        }
      }
    };
    new MutationObserver(() => syncOpt()).observe(txt, { characterData: true, childList: true, subtree: true });
    txt.addEventListener('blur', syncOpt);
    /* keydown contract for the option span — Enter never inserts a line;
       Backspace/Delete are applied HERE and stopped before the PM root:
       PM's keydown (retargeted) preventDefaults from its own doc selection
       and deletes nothing (same root cause as the editable titles) */
    txt.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); return; }
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      pnNestedEditApplying = true;
      try {
        if (window.getSelection()?.isCollapsed) {
          document.execCommand(e.key === 'Backspace' ? 'delete' : 'forwardDelete', false);
        } else {
          document.execCommand('delete', false);
        }
      } finally { pnNestedEditApplying = false; }
    });

    /* delete — remove the option (its slot stays, 4 rows are structural) */
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'quiz-opt-del';
    del.title = 'خالی کردن گزینه';
    del.setAttribute('contenteditable', 'false');
    del.textContent = '×';
    del.addEventListener('mousedown', (e) => e.preventDefault());
    del.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = getPos();
      if (pos == null) return;
      const cur = editor.state.doc.nodeAt(pos);
      if (!cur) return;
      const arr = [...(cur.attrs.options as string[] ?? ['', '', '', ''])];
      while (arr.length < 4) arr.push('');
      arr[i] = '';
      const patch: Record<string, unknown> = { options: arr };
      if (cur.attrs.correct === i) patch.correct = -1;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...patch }));
    });

    row.append(num, txt, del);
    optsBox.appendChild(row);
  });


  /* remember the text spans so the surgical updater can refresh values
     without rebuilding (a rebuild would kill the typing caret) */
  (optsBox as HTMLElement & { _spans?: HTMLElement[] })._spans = spanRefs;
  optsBox.setAttribute('data-sig', `${layout}|${String(attrs.correct)}|${String(effectiveCorrect({ attrs } as never))}`);
}

/**
 * Surgical attr sync from transactions: rebuilds the rows only when the
 * option STRUCTURE changed (layout / correct mark); pure text edits just
 * refresh the non-focused spans in place — the caret in the span being
 * typed in never moves.
 */
function updateMcqOptions(optsBox: HTMLElement, wrapper: HTMLElement, attrs: Record<string, unknown>, getPos?: () => number | undefined, editor?: Editor) {
  const layout = attrs.layout === 'grid' ? 'grid' : 'stacked';
  wrapper.setAttribute('data-layout', layout);
  const shown = effectiveCorrect({ attrs } as never);
  const sig = `${layout}|${String(shown)}`;
  const spans = (optsBox as HTMLElement & { _spans?: HTMLElement[] })._spans;
  if (!spans || optsBox.getAttribute('data-sig') !== sig) {
    /* structural change (or first update) — the full builder re-runs on the
       next transaction; do the visual bits that don't need the editor here */
    optsBox.setAttribute('data-sig', sig);
    optsBox.className = `quiz-opts quiz-opts-${layout}`;
    const opts = Array.from({ length: 4 }, (_, i) => (attrs.options as string[] | undefined)?.[i] ?? '');
    spans?.forEach((s, i) => { if (document.activeElement !== s) s.textContent = opts[i]; });
    /* correct-mark repaint without rebuild */
    const rows = optsBox.querySelectorAll<HTMLElement>('.quiz-opt');
    rows.forEach((row, i) => row.setAttribute('data-correct', String(shown === i)));
    syncEndAnswer(wrapper, 'mcq', attrs);
    return;
  }
  const opts = Array.from({ length: 4 }, (_, i) => (attrs.options as string[] | undefined)?.[i] ?? '');
  spans.forEach((s, i) => { if (document.activeElement !== s) s.textContent = opts[i]; });
  syncEndAnswer(wrapper, 'mcq', attrs);
}

/** keep the trailing quiz-end-answer line (answerAt='end') in sync inside
 *  the live NodeView — mirrors the static renderHTML branch exactly */
function syncEndAnswer(wrapper: HTMLElement, kind: 'mcq' | 'truefalse' | 'short', attrs: Record<string, unknown>) {
  const pol = answerPolicy({ attrs } as never);
  const txt = pol.on && pol.mode === 'end' ? endAnswerLine(kind, { attrs } as never) : '';
  let line = wrapper.querySelector<HTMLElement>(':scope > .quiz-end-answer');
  if (txt) {
    if (!line) { line = document.createElement('div'); line.className = 'quiz-end-answer'; line.setAttribute('contenteditable', 'false'); wrapper.appendChild(line); }
    if (line.textContent !== txt) line.textContent = txt;
  } else if (line) line.remove();
}

/** worked example */
export const ExampleBlock = Node.create({
  name: 'exampleBlock',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return { title: { default: '' }, ...styleAttrs() };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="example"]' }];
  },
  renderHTML({ node }) {
    normalizeLegacyStyleAttrs(node);
    return [
      'div',
      mergeAttributes(wrapperAttrs(node, { 'data-type': 'example', class: 'edu-block edu-example' })),
      ['div', { class: 'edu-title', 'data-title': node.attrs.title },
        ...titleChildren('example', node.attrs.title, 'مثال', node.attrs.styleTitle as string)],
      ['div', 0],
    ];
  },
  addNodeView() {
    return editableTitleView({
      name: 'exampleBlock', attr: 'title', dataType: 'example',
      blockCls: 'edu-block edu-example', iconKey: 'example', fallback: 'مثال',
    });
  },
});

/** key term + explanation */
export const KeyTermBlock = Node.create({
  name: 'keyTermBlock',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return { term: { default: '' }, ...styleAttrs() };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="keyterm"]' }];
  },
  renderHTML({ node }) {
    normalizeLegacyStyleAttrs(node);
    return [
      'div',
      mergeAttributes(wrapperAttrs(node, { 'data-type': 'keyterm', class: 'edu-block edu-keyterm' })),
      ['div', { class: 'edu-title', 'data-term': node.attrs.term },
        ...titleChildren('keyterm', node.attrs.term, 'اصطلاح کلیدی', node.attrs.styleTitle as string)],
      ['div', 0],
    ];
  },
  addNodeView() {
    return editableTitleView({
      name: 'keyTermBlock', attr: 'term', dataType: 'keyterm',
      blockCls: 'edu-block edu-keyterm', iconKey: 'keyterm', fallback: 'اصطلاح کلیدی',
    });
  },
});


/**
 * formula block — LaTeX source stored as text content,
 * rendered live with KaTeX in the NodeView; the exporter post-processes
 * the static HTML and replaces the source with rendered KaTeX markup.
 */
export const FormulaBlock = Node.create({
  name: 'formulaBlock',
  group: 'block',
  content: 'text*',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="formula"]' }];
  },
  renderHTML({ node }) {
    normalizeLegacyStyleAttrs(node);
    return [
      'div',
      mergeAttributes({ 'data-type': 'formula', class: 'edu-block edu-formula' }),
      ['div', { class: 'edu-katex-src' }, node.textContent],
    ];
  },
  addNodeView() {
    return ({ node, editor }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'edu-block edu-formula';
      wrapper.setAttribute('data-type', 'formula');

      const render = document.createElement('div');
      render.className = 'edu-katex-render';
      const renderKatex = (latex: string) => {
        render.innerHTML = katex.renderToString(latex || '', {
          displayMode: true,
          throwOnError: false,
        });
      };
      renderKatex(node.textContent);

      // the LaTeX source IS the node content; hidden until "edit" is pressed
      const src = document.createElement('div');
      src.className = 'edu-latex-src';
      src.setAttribute('dir', 'ltr');
      src.contentEditable = 'true';
      src.style.cssText =
        'direction:ltr;text-align:left;font-family:Consolas,monospace;font-size:13px;background:rgba(148,163,184,.12);border-radius:6px;padding:4px 8px;margin-top:6px;display:none;';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.textContent = 'ویرایش فرمول';
      toggle.style.cssText =
        'position:absolute;top:6px;left:8px;font-size:11px;border:none;background:transparent;color:#64748b;cursor:pointer;font-family:inherit;user-select:none;';
      /* stopPropagation on mousedown keeps ProseMirror from stealing the
         click (node selection / focus), so the button always works */
      toggle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        src.style.display = src.style.display === 'none' ? 'block' : 'none';
        if (src.style.display === 'block') {
          /* focus after the layout settles so the caret lands in the source */
          requestAnimationFrame(() => {
            src.focus();
            const sel = window.getSelection();
            if (sel) sel.selectAllChildren(src);
          });
        }
      });

      wrapper.append(toggle, render, src);

      let current = node;
      return {
        dom: wrapper,
        contentDOM: src,
        /* events on the edit button belong to the node view, not PM —
           without this PM's mousedown handler swallows the click and
           the edit area never opens */
        stopEvent: (event: Event) => toggle.contains(event.target as globalThis.Node),
        update: (updated: typeof node) => {
          if (updated.type.name !== 'formulaBlock') return false;
          if (updated.textContent !== current.textContent) renderKatex(updated.textContent);
          current = updated;
          return true;
        },
        // ignore mutations caused by our own KaTeX rendering (outside contentDOM),
        // let ProseMirror handle the text edits inside contentDOM
        ignoreMutation: (m: MutationRecord | { target: unknown }) =>
          !src.contains(m.target as globalThis.Node),
      };
    };
  },
});

/**
 * Replaces formula sources in exported HTML with rendered KaTeX so the
 * print/PDF output shows real math.
 */
export function renderFormulasInHtml(html: string): string {
  return html.replace(
    /<div class="edu-katex-src"[^>]*>([\s\S]*?)<\/div>/g,
    (_m, latex: string) => {
      const decoded = latex
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      try {
        return katex.renderToString(decoded, { displayMode: true, throwOnError: false });
      } catch {
        return `<code>${decoded}</code>`;
      }
    }
  );
}

/**
 * Renders STRUCTURED EQUATIONS (data-type="equation" / equationInline) for
 * print/PDF/HTML export: the exported HTML carries the LaTeX source as text
 * content (the round-trip), and this pass replaces it with real KaTeX
 * markup — professionally typeset fractions, radicals, scripts, matrices.
 * Display equations wrap in a centered block; inline stays inline.
 */
export function renderEquationsInHtml(html: string): string {
  const decode = (s: string) => s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  /* display: <div ... data-type="equation" ...>SOURCE</div> (no nested divs in the payload) */
  html = html.replace(
    /<div ([^>]*data-type="equation"[^>]*)>([\s\S]*?)<\/div>/g,
    (_m, attrStr: string, src: string) => {
      const latex = decode(src).trim();
      const align = /data-align="(\w+)"/.exec(attrStr)?.[1] ?? 'center';
      const numbered = /data-numbered="(\w+)"/.exec(attrStr)?.[1] ?? 'none';
      let rendered: string;
      try {
        rendered = katex.renderToString(latex, { displayMode: false, throwOnError: false, output: 'html' });
      } catch {
        rendered = `<code>${latex}</code>`;
      }
      const no = numbered === 'auto' ? '(n)' : numbered !== 'none' ? numbered : '';
      return `<div class="mq-export-display mq-export-align-${align}">${rendered}${no ? `<span class="mq-export-no">${no}</span>` : ''}</div>`;
    },
  );

  /* inline: <span ... data-type="equationInline" ...>SOURCE</span> */
  html = html.replace(
    /<span ([^>]*data-type="equationInline"[^>]*)>([\s\S]*?)<\/span>/g,
    (_m, _attrStr: string, src: string) => {
      const latex = decode(src).trim();
      try {
        return katex.renderToString(latex, { displayMode: false, throwOnError: false, output: 'html' });
      } catch {
        return `<code>${latex}</code>`;
      }
    },
  );

  return html;
}

/** comparison table: دو ستون مقایسه با عنوان هر کدام */
export const ComparisonTable = Node.create({
  name: 'comparisonTable',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return { leftLabel: { default: '' }, rightLabel: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="comparison"]' }];
  },
  renderHTML({ node }) {
    normalizeLegacyStyleAttrs(node);
    return [
      'div',
      mergeAttributes({ 'data-type': 'comparison', class: 'edu-block edu-comparison' }),
      ['div', { class: 'cmp-head' }, ['div', { class: 'cmp-label' }, node.attrs.leftLabel || 'بخش اول'], ['div', { class: 'cmp-vs' }, 'در مقابل'], ['div', { class: 'cmp-label' }, node.attrs.rightLabel || 'بخش دوم']],
      ['div', { class: 'cmp-body-pm' }, 0],
    ];
  },
  addNodeView() {
    return ({ node, editor, getPos }: any) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'edu-block edu-comparison';
      wrapper.setAttribute('data-type', 'comparison');

      const head = document.createElement('div');
      head.className = 'cmp-head flex';

      /* labels persist via setNodeMarkup — they used to mutate node.attrs
         directly, which silently evaporated on every re-render */
      const makeLabel = (attr: 'leftLabel' | 'rightLabel', fallback: string, extraCls: string) => {
        const label = document.createElement('div');
        label.className = `cmp-label grow ${extraCls} rounded-t-md border border-ink-200 bg-ink-100 px-3 py-1.5 text-sm font-semibold text-ink-900 dark:bg-ink-800 dark:text-ink-100`;
        try { label.contentEditable = 'plaintext-only'; } catch { label.contentEditable = 'true'; }
        label.setAttribute('data-ph', fallback);
        label.textContent = node.attrs[attr] || '';
        let syncing = false;
        const sync = () => {
          if (syncing) return;
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos == null) return;
          const cur = editor.state.doc.nodeAt(pos);
          const val = label.textContent ?? '';
          if (!cur || cur.attrs[attr] === val) return;
          syncing = true;
          try {
            editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, [attr]: val }));
          } finally { syncing = false; }
        };
        label.addEventListener('input', sync);
        label.addEventListener('blur', sync);
        label.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter') e.preventDefault();
        });
        return label;
      };

      const vs = document.createElement('div');
      vs.className = 'cmp-vs flex items-center justify-center px-2 text-xs font-bold text-ink-500 dark:text-ink-400';
      vs.textContent = 'در مقابل';

      head.append(makeLabel('leftLabel', 'بخش اول', 'border-r-0'), vs, makeLabel('rightLabel', 'بخش دوم', 'border-l-0'));

      const body = document.createElement('div');
      body.className = 'cmp-body-pm min-h-[3em] pt-2';
      wrapper.append(head, body);

      return {
        dom: wrapper,
        contentDOM: body,
        ignoreMutation: (m: { target: unknown }) =>
          !(body === m.target || body.contains(m.target as globalThis.Node)),
        stopEvent: (e: Event) => head.contains(e.target as globalThis.Node),
      };
    };
  },
});

/** timeline — title + real editable content (each paragraph = one رویداد) */
export const Timeline = Node.create({
  name: 'timeline',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return { title: { default: '' }, ...styleAttrs() };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="timeline"]' }];
  },
  renderHTML({ node }) {
    normalizeLegacyStyleAttrs(node);
    return [
      'div',
      mergeAttributes(wrapperAttrs(node, { 'data-type': 'timeline', class: 'edu-block edu-timeline' })),
      ['div', { class: 'edu-title', 'data-title': node.attrs.title },
        ...titleChildren('timeline', node.attrs.title, 'زمان‌خط', node.attrs.styleTitle as string)],
      ['div', 0],
    ];
  },
  addNodeView() {
    return editableTitleView({
      name: 'timeline', attr: 'title', dataType: 'timeline',
      blockCls: 'edu-block edu-timeline', iconKey: 'timeline', fallback: 'زمان‌خط',
      buildBody: (_node, wrapper) => {
        const body = document.createElement('div');
        body.className = 'edu-body timeline-items border-r-2 border-accent-500 pr-3 mt-1';
        wrapper.appendChild(body);
        return body;
      },
    });
  },
});

/** Footnote / margin note */
export const FootnoteBlock = Node.create({
  name: 'footnoteBlock',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return { label: { default: '' }, ...styleAttrs() };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="footnote"]' }];
  },
  renderHTML({ node }) {
    normalizeLegacyStyleAttrs(node);
    return [
      'aside',
      mergeAttributes(wrapperAttrs(node, { 'data-type': 'footnote', class: 'edu-block edu-footnote' })),
      ['div', { class: 'edu-title', 'data-footnote': node.attrs.label },
        ...titleChildren('footnote', node.attrs.label, 'یادداشت پاورقی', node.attrs.styleTitle as string)],
      ['div', 0],
    ];
  },
  addNodeView() {
    return editableTitleView({
      name: 'footnoteBlock', attr: 'label', dataType: 'footnote',
      blockCls: 'edu-block edu-footnote', iconKey: 'footnote', fallback: 'یادداشت پاورقی',
    });
  },
});

/** Long answer / 서술형 پاسخ — برای پرسش‌های آزاد */
export const LongAnswerBlock = Node.create({
  name: 'longAnswerBlock',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return { question: { default: '' }, ...quizAttrs(), ...styleAttrs() };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="longanswer"]' }];
  },
  renderHTML({ node }) {
    normalizeLegacyStyleAttrs(node);
    /* answerAt='end' → the answerText shows as the dedicated answer line
       (spoiler-safe answer key for practice sheets) */
    const pol = answerPolicy(node);
    const ansLine = pol.on && pol.mode === 'end' ? endAnswerLine('short', node) : '';
    return [
      'div',
      mergeAttributes(wrapperAttrs(node, {
        'data-type': 'longanswer', class: 'edu-block edu-longanswer',
        ...quizWrapperExtras(node),
      })),
      ['div', { class: 'edu-title', 'data-question': node.attrs.question },
        ...titleChildren('longanswer', node.attrs.question, 'سوال تشریحی', node.attrs.styleTitle as string),
        ['span', { class: 'edu-title-suffix', contenteditable: 'false' }, pointsSuffix(node)]],
      ['div', 0],
      ...(pol.on && pol.mode === 'end' && ansLine
        ? [['div', { class: 'quiz-end-answer', contenteditable: 'false' }, ansLine]]
        : []),
    ];
  },
  addNodeView() {
    return editableTitleView({
      name: 'longAnswerBlock', attr: 'question', dataType: 'longanswer',
      blockCls: 'edu-block edu-longanswer', iconKey: 'longanswer', fallback: 'سوال تشریحی',
      suffix: pointsSuffix,
      extraAttrs: (node) => quizWrapperExtras(node),
      buildBody: (_node, wrapper, _ed, _pos, els) => { els.qWrapper = wrapper; return appendBody(wrapper); },
      onUpdate: (updated, els) => {
        const pol = answerPolicy(updated);
        const txt = pol.on && pol.mode === 'end' ? endAnswerLine('short', updated) : '';
        const host = els.qWrapper as HTMLElement | undefined;
        if (!host) return;
        let line = host.querySelector<HTMLElement>(':scope > .quiz-end-answer');
        if (txt) {
          if (!line) { line = document.createElement('div'); line.className = 'quiz-end-answer'; line.setAttribute('contenteditable', 'false'); host.appendChild(line); }
          if (line.textContent !== txt) line.textContent = txt;
        } else if (line) line.remove();
      },
    });
  },
});

/** Highlight Box — جعبه برجسته برای نکات کلیدی */
export const HighlightBox = Node.create({
  name: 'highlightBox',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return { title: { default: '' }, icon: { default: '◉' }, ...styleAttrs() };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="highlightbox"]' }];
  },
  renderHTML({ node }) {
    normalizeLegacyStyleAttrs(node);
    return [
      'div',
      mergeAttributes(wrapperAttrs(node, { 'data-type': 'highlightbox', class: 'edu-block edu-highlight' })),
      ['div', { class: 'edu-title' }, ...titleChildren('highlight', node.attrs.title, 'نکته برجسته', node.attrs.styleTitle as string)],
      ['div', 0],
    ];
  },
  addNodeView() {
    return editableTitleView({
      name: 'highlightBox', attr: 'title', dataType: 'highlightbox',
      blockCls: 'edu-block edu-highlight', iconKey: 'highlight', fallback: 'نکته برجسته',
    });
  },
});

/** Reference Block — منبع آکادمیک */
export const ReferenceBlock = Node.create({
  name: 'referenceBlock',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return { authors: { default: '' }, year: { default: '' }, title: { default: '' }, url: { default: '' }, ...styleAttrs() };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="reference"]' }];
  },
  renderHTML({ node }) {
    normalizeLegacyStyleAttrs(node);
    return [
      'div',
      mergeAttributes(wrapperAttrs(node, { 'data-type': 'reference', class: 'edu-block edu-reference' })),
      ['div', { class: 'edu-title' }, ...titleChildren('reference', node.attrs.title, 'منبع', node.attrs.styleTitle as string)],
      ['div', { class: 'edu-ref-meta', 'data-authors': node.attrs.authors, 'data-year': node.attrs.year, 'data-url': node.attrs.url },
        `${node.attrs.authors ? node.attrs.authors + ' ' : ''}${node.attrs.year ? '(' + node.attrs.year + ')' : ''}`],
      ['div', 0],
    ];
  },
  addNodeView() {
    return editableTitleView({
      name: 'referenceBlock', attr: 'title', dataType: 'reference',
      blockCls: 'edu-block edu-reference', iconKey: 'reference', fallback: 'منبع',
      buildBody: (node, wrapper) => {
        const meta = document.createElement('div');
        meta.className = 'edu-ref-meta';
        meta.setAttribute('data-authors', node.attrs.authors);
        meta.setAttribute('data-year', node.attrs.year);
        meta.setAttribute('data-url', node.attrs.url);
        meta.textContent = `${node.attrs.authors ? node.attrs.authors + ' ' : ''}${node.attrs.year ? '(' + node.attrs.year + ')' : ''}`;
        wrapper.appendChild(meta);
        return appendBody(wrapper);
      },
    });
  },
});

/** Pro & Con — موافق و مخالف (columns persist in attrs) */
export const ProConBlock = Node.create({
  name: 'proConBlock',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return { topic: { default: '' }, proText: { default: '' }, conText: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="procon"]' }];
  },
  renderHTML({ node }) {
    normalizeLegacyStyleAttrs(node);
    return [
      'div',
      mergeAttributes({ 'data-type': 'procon', class: 'edu-block edu-procon', 'data-topic': node.attrs.topic }),
      ['div', { class: 'edu-title' }, ...titleChildren('procon', node.attrs.topic, 'موافق و مخالف')],
      ['div', { class: 'edu-procon-cols' },
        ['div', { class: 'edu-procon-col edu-procon-pro' },
          ['div', { class: 'edu-procon-label' }, 'موافق'],
          ['div', { class: 'edu-procon-text' }, node.attrs.proText || '']],
        ['div', { class: 'edu-procon-col edu-procon-con' },
          ['div', { class: 'edu-procon-label' }, 'مخالف'],
          ['div', { class: 'edu-procon-text' }, node.attrs.conText || '']]],
      ['div', 0],
    ];
  },
  addNodeView() {
    return editableTitleView({
      name: 'proConBlock', attr: 'topic', dataType: 'procon',
      blockCls: 'edu-block edu-procon', iconKey: 'procon', fallback: 'موافق و مخالف',
      buildBody: (node, wrapper, editor, getPos) => {
        const makeCol = (cls: string, label: string, attr: 'proText' | 'conText', ph: string) => {
          const col = document.createElement('div');
          col.className = cls;
          const head = document.createElement('div');
          head.className = 'edu-procon-label';
          head.textContent = label;
          const area = document.createElement('div');
          area.className = 'edu-procon-text';
          area.setAttribute('data-ph', ph);
          try { area.contentEditable = 'plaintext-only'; } catch { area.contentEditable = 'true'; }
          area.textContent = node.attrs[attr] || '';
          let syncing = false;
          const sync = () => {
            if (syncing) return;
            const pos = typeof getPos === 'function' ? getPos() : null;
            if (pos == null) return;
            const cur = editor.state.doc.nodeAt(pos);
            const val = area.textContent ?? '';
            if (!cur || cur.attrs[attr] === val) return;
            syncing = true;
            try {
              editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, [attr]: val }));
            } finally { syncing = false; }
          };
          area.addEventListener('input', sync);
          area.addEventListener('blur', sync);
          area.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') e.preventDefault(); });
          col.append(head, area);
          return col;
        };
        const cols = document.createElement('div');
        cols.className = 'edu-procon-cols';
        cols.append(
          makeCol('edu-procon-col edu-procon-pro', 'موافق', 'proText', 'دلایل موافق…'),
          makeCol('edu-procon-col edu-procon-con', 'مخالف', 'conText', 'دلایل مخالف…'),
        );
        wrapper.appendChild(cols);

        /* legacy paragraphs (older docs) still render below the columns */
        const legacy = document.createElement('div');
        legacy.className = 'edu-procon-legacy';
        wrapper.appendChild(legacy);
        return legacy;
      },
    });
  },
});

/** Code with output — کد با خروجی مورد انتظار (code/output persist in attrs) */
export const CodeOutputBlock = Node.create({
  name: 'codeOutputBlock',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return { lang: { default: '' }, label: { default: '' }, codeText: { default: '' }, outText: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="codeoutput"]' }];
  },
  renderHTML({ node }) {
    normalizeLegacyStyleAttrs(node);
    return [
      'div',
      mergeAttributes({ 'data-type': 'codeoutput', class: 'edu-block edu-codeoutput' }),
      ['div', { class: 'edu-title' }, ...titleChildren('codeoutput', node.attrs.label, 'کد و خروجی')],
      ['pre', { class: 'edu-code-area', dir: 'ltr' }, node.attrs.codeText || '# کد خود را اینجا بنویسید'],
      ['div', { class: 'edu-code-out-label' }, '→ خروجی مورد انتظار:'],
      ['pre', { class: 'edu-code-out', dir: 'ltr' }, node.attrs.outText],
      ['div', 0],
    ];
  },
  addNodeView() {
    return editableTitleView({
      name: 'codeOutputBlock', attr: 'label', dataType: 'codeoutput',
      blockCls: 'edu-block edu-codeoutput', iconKey: 'codeoutput', fallback: 'کد و خروجی',
      buildBody: (node, wrapper, editor, getPos) => {
        const makeArea = (cls: string, attr: 'codeText' | 'outText', ph: string) => {
          const area = document.createElement('pre');
          area.className = cls;
          area.setAttribute('dir', 'ltr');
          area.setAttribute('data-ph', ph);
          try { area.contentEditable = 'plaintext-only'; } catch { area.contentEditable = 'true'; }
          area.textContent = node.attrs[attr] || (attr === 'codeText' ? '# کد خود را اینجا بنویسید' : '');
          let syncing = false;
          const sync = () => {
            if (syncing) return;
            const pos = typeof getPos === 'function' ? getPos() : null;
            if (pos == null) return;
            const cur = editor.state.doc.nodeAt(pos);
            const val = area.textContent ?? '';
            if (!cur || cur.attrs[attr] === val) return;
            syncing = true;
            try {
              editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, [attr]: val }));
            } finally { syncing = false; }
          };
          area.addEventListener('input', sync);
          area.addEventListener('blur', sync);
          return area;
        };
        wrapper.appendChild(makeArea('edu-code-area', 'codeText', '# کد خود را اینجا بنویسید'));
        const outLabel = document.createElement('div');
        outLabel.className = 'edu-code-out-label';
        outLabel.textContent = '→ خروجی مورد انتظار:';
        wrapper.appendChild(outLabel);
        wrapper.appendChild(makeArea('edu-code-out', 'outText', ''));

        /* legacy paragraphs (older docs) */
        const legacy = document.createElement('div');
        legacy.className = 'edu-codeoutput-legacy';
        wrapper.appendChild(legacy);
        return legacy;
      },
    });
  },
});
