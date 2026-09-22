/**
 * TipTap JSON builders used to generate template & seed-note content.
 */

export type TNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

export const doc = (...nodes: TNode[]): TNode => ({ type: 'doc', content: nodes });

export const p = (text?: string, marks?: TNode['marks']): TNode => ({
  type: 'paragraph',
  ...(text ? { content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] } : {}),
});

export const bold = (text: string): TNode => ({
  type: 'text',
  text,
  marks: [{ type: 'bold' }],
});

export const h = (level: 1 | 2 | 3 | 4, text: string): TNode => ({
  type: 'heading',
  attrs: { level, textAlign: 'right' },
  content: [{ type: 'text', text }],
});

export const callout = (
  kind: 'definition' | 'important' | 'exam' | 'warning' | 'summary',
  title: string,
  paragraphs: string[]
): TNode => ({
  type: 'calloutBlock',
  attrs: { kind, title },
  content: paragraphs.map((t) => p(t)),
});

export const question = (q: string, a: string): TNode => ({
  type: 'questionBlock',
  attrs: { question: q },
  content: [p(a)],
});

export const keyTerm = (term: string, explanation: string): TNode => ({
  type: 'keyTermBlock',
  attrs: { term },
  content: [p(explanation)],
});

export const example = (title: string, paragraphs: string[]): TNode => ({
  type: 'exampleBlock',
  attrs: { title },
  content: paragraphs.map((t) => p(t)),
});

export const formula = (latex: string, caption?: string): TNode => ({
  type: 'formulaBlock',
  attrs: { latex },
  ...(caption ? { content: [p(caption)] } : {}),
});

/** structured equation object (the REAL editable math AST node) */
export const equation = (latex: string, opts?: { display?: boolean; align?: string; numbered?: boolean }): TNode => ({
  type: opts?.display === false ? 'equationInline' : 'equation',
  attrs: {
    ast: [{ type: 'latex', latex }],
    display: opts?.display !== false,
    mode: 'professional',
    align: opts?.align ?? 'center',
    numbered: opts?.numbered ?? false,
  },
});

/** inline equation flowing inside a paragraph: pInline('متن', eq('x^2')) */
export const pInline = (parts: Array<string | TNode>): TNode => ({
  type: 'paragraph',
  attrs: { textAlign: 'right' },
  content: parts.map((part) => (typeof part === 'string' ? { type: 'text', text: part } : part)),
});

export const bullet = (text: string): TNode => ({
  type: 'bulletList',
  content: [{ type: 'listItem', content: [p(text)] }],
});

export const ul = (...items: string[]): TNode => ({
  type: 'bulletList',
  content: items.map((t) => ({ type: 'listItem', content: [p(t)] })),
});

export const ol = (...items: string[]): TNode => ({
  type: 'orderedList',
  content: items.map((t) => ({ type: 'listItem', content: [p(t)] })),
});

export const table = (headers: string[], rows: string[][]): TNode => ({
  type: 'table',
  content: [
    {
      type: 'tableRow',
      content: headers.map((c) => ({
        type: 'tableHeader',
        attrs: { textAlign: 'right' },
        content: [p(c)],
      })),
    },
    ...rows.map((row) => ({
      type: 'tableRow',
      content: row.map((c) => ({ type: 'tableCell', attrs: { textAlign: 'right' }, content: [p(c)] })),
    })),
  ],
});

export const hr = (): TNode => ({ type: 'horizontalRule' });

/* ── additional edu blocks (used by the physiology booklet seed) ─────── */

export const longAnswer = (question: string, answer: string[], points: number): TNode => ({
  type: 'longAnswerBlock',
  attrs: { question, points },
  content: answer.map((t) => p(t)),
});

export const timeline = (title: string, events: string[]): TNode => ({
  type: 'timeline',
  attrs: { title },
  content: events.map((t) => p(t)),
});

export const footnote = (label: string, text: string): TNode => ({
  type: 'footnoteBlock',
  attrs: { label },
  content: [p(text)],
});

export const highlight = (title: string, paragraphs: string[]): TNode => ({
  type: 'highlightBox',
  attrs: { title },
  content: paragraphs.map((t) => p(t)),
});

export const reference = (authors: string, year: string, title: string, url: string): TNode => ({
  type: 'referenceBlock',
  attrs: { authors, year, title, url },
  content: [p('')],
});

export const proCon = (topic: string, pro: string, con: string): TNode => ({
  type: 'proConBlock',
  attrs: { topic, proText: pro, conText: con },
  content: [p('')],
});

/** per-block visual overrides — rendered identically in editor & print */
export interface BlockStyle {
  styleBg?: string;
  styleBorder?: string;
  styleBorderWidth?: number;
  styleBorderStyle?: 'solid' | 'dashed' | 'dotted';
  styleRadius?: number;
  styleTitle?: string;
}

export const styled = (node: TNode, style: BlockStyle): TNode => ({
  ...node,
  attrs: { ...(node.attrs ?? {}), ...style },
});

/** body text in latin paragraphs inside RTL docs */
export const pLtr = (text: string): TNode => ({
  type: 'paragraph',
  attrs: { textAlign: 'left' },
  content: [{ type: 'text', text }],
});
