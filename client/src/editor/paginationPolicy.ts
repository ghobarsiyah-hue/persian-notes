/**
 * paginationPolicy — object-specific pagination rules.
 *
 * One declarative table that answers, per node type, how the flow engine
 * (overflowFlow.ts) may break and re-join the node across A4 pages:
 *
 *   • how it may SPLIT when it doesn't fit the remaining page height
 *   • how it RE-JOINS when deletion frees space (backward flow)
 *   • what must be REPEATED on the continuation page (table header)
 *   • which "page context" attrs survive the move (numbering `start`,
 *     page kind, auto flag) — the engine copies them onto the split result
 *
 * The engine implements the mechanisms (line split, item split, row split,
 * container flow, atomic move); the policy only DECIDES. That keeps the
 * rules auditable and the engine generic — exactly the separation the
 * "Document model → layout → object-aware fragmentation → A4 viewports"
 * architecture calls for.
 */

import type { Node as PMNode } from 'prosemirror-model';

/* ── kinds ──────────────────────────────────────────────────────────── */

/** How a node may break across the page boundary. */
export type BreakKind =
  | 'line' //  split at rendered text-line boundary (paragraphs, lists)
  | 'item' //  whole children move (list items)
  | 'rows' //  whole table rows move, header repeats
  | 'container' // inside a container: children break per their own rules
  | 'atomic'; //  never split — whole node moves or nothing does

/** How a node re-joins when free space appears BEFORE it (backward flow). */
export type JoinKind =
  | 'none' //   never re-joins (atomic objects)
  | 'lines' //  merges with the previous textblock at line level
  | 'items' //  items of a same-type list merge into the previous list
  | 'rows' //   rows merge back into the previous part of the same table
  | 'container'; // container re-joins if the previous page ends in the same container

export interface BreakPolicy {
  break: BreakKind;
  join: JoinKind;
  /** repeat-attribute contract for 'rows' (tables): header row repeats */
  repeatHeader: boolean;
  /** attrs copied onto BOTH halves of a split so the engine can later
   *  re-join them (numbering start, page kind / auto markers, …) */
  keepAttrs: string[];
  /** false → children of this node break per their own rules (containers) */
  selfBreak: boolean;
}

const TEXT: BreakPolicy = {
  break: 'line',
  join: 'lines',
  repeatHeader: false,
  keepAttrs: [],
  selfBreak: true,
};

const LIST: BreakPolicy = {
  break: 'item',
  join: 'items',
  repeatHeader: false,
  keepAttrs: ['start'],
  selfBreak: true,
};

const ATOMIC: BreakPolicy = {
  break: 'atomic',
  join: 'none',
  repeatHeader: false,
  keepAttrs: [],
  selfBreak: true,
};

/** Named edu containers (calloutBlock, questionBlock, …) — FLOW containers:
 *  their inner blocks break per their own rules, the frame redraws on both
 *  pages. `selfBreak:false` is what distinguishes them from images/shapes. */
const CONTAINER: BreakPolicy = {
  break: 'container',
  join: 'container',
  repeatHeader: false,
  keepAttrs: ['title', 'term', 'question', 'label', 'topic', 'variant', 'kind'],
  selfBreak: false,
};

/** Default for anything not listed: behaves like flowing text at block
 *  granularity — safe for unknown custom nodes. */
const DEFAULT_POLICY: BreakPolicy = {
  break: 'atomic',
  join: 'none',
  repeatHeader: false,
  keepAttrs: [],
  selfBreak: true,
};

/* ── registry ───────────────────────────────────────────────────────── */

const REGISTRY: Record<string, BreakPolicy> = {
  /* flow text — splits at rendered line boundaries */
  paragraph: TEXT,
  blockquote: TEXT,
  formulaBlock: TEXT, // display LaTeX textblock — behaves like a paragraph

  /* lists — items are the unit; ordered numbering carries over via `start` */
  bulletList: LIST,
  orderedList: LIST,
  taskList: { ...LIST, keepAttrs: [] },

  /* tables — rows are the unit, header row repeats on continuation pages */
  table: {
    break: 'rows',
    join: 'rows',
    repeatHeader: true,
    keepAttrs: [],
    selfBreak: true,
  },

  /* heading + code: flow-ish but never orphaned (keep-with-next) */
  heading: {
    break: 'line',
    join: 'lines',
    repeatHeader: false,
    keepAttrs: [],
    selfBreak: true,
    /** engine: heading split only with keep-with-next satisfied */
    keepWithNext: true,
  } as BreakPolicy & { keepWithNext: boolean },
  codeBlock: {
    break: 'line',
    join: 'lines',
    repeatHeader: false,
    keepAttrs: [],
    selfBreak: true,
    keepWithNext: true,
  } as BreakPolicy & { keepWithNext: boolean },

  /* edu / callout boxes — FLOW containers (content splits, frame redraws) */
  calloutBlock: CONTAINER,
  questionBlock: CONTAINER,
  exampleBlock: CONTAINER,
  keyTermBlock: CONTAINER,
  comparisonTable: CONTAINER,
  timeline: CONTAINER,
  footnoteBlock: CONTAINER,
  longAnswerBlock: CONTAINER,
  highlightBox: CONTAINER,
  referenceBlock: CONTAINER,
  proConBlock: CONTAINER,
  codeOutputBlock: CONTAINER,
  /* quiz families behave like every other edu container: the question
     frame may straddle the page boundary (title/options redraw per page);
     ATOMIC would bounce whole questions and fight the AutoFlow engine */
  trueFalseBlock: CONTAINER,
  mcqBlock: CONTAINER,

  /* genuinely atomic objects — never split, never re-join */
  image: ATOMIC,
  equation: ATOMIC, // display equation
  equationInline: ATOMIC, // participates in LINE layout as an inline atom
  inlineIcon: ATOMIC,
  pageBreak: ATOMIC,
  horizontalRule: ATOMIC,
};

export function policyFor(node: PMNode | { type: { name: string } } | null | undefined): BreakPolicy {
  if (!node) return DEFAULT_POLICY;
  return REGISTRY[node.type?.name] ?? DEFAULT_POLICY;
}

/** Flow text that may split at line boundaries (paragraph-like textblocks). */
export function isFlowTextblock(node: PMNode): boolean {
  if (!node.isTextblock) return false;
  const p = policyFor(node);
  return p.break === 'line' && !(p as BreakPolicyLike).keepWithNext;
}

/** Lists whose items are the break unit. */
export function isListKind(node: PMNode): boolean {
  const p = policyFor(node);
  return p.break === 'item';
}

/** Type shape used by callers that attach engine-only flags. */
export type BreakPolicyLike = BreakPolicy & { keepWithNext?: boolean };
