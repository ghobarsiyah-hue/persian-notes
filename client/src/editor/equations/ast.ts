/* ────────────────────────────────────────────────────────────────────────
   Math AST — the structured representation of an equation.

   An equation is NOT text: it is a tree of typed nodes
   (fraction → numerator/denominator, scripts → base/sup/sub, radical →
   radicand, matrices → grid of cells, …). The parser turns linear/LaTeX
   input into this tree, the renderer lays it out as professional math,
   and the editor mutates it directly — structures stay editable forever.

   Placeholder rule: a structural slot that has no content yet contains a
   single `ph` node. It renders as □, is selectable, and typing over it
   replaces it. A slot whose ONLY content is `ph` is "empty".
   ──────────────────────────────────────────────────────────────────────── */

/** every math node type */
export type MathNodeType =
  | 'run'        // plain run of characters (variables / digits / operators)
  | 'sym'        // a single mathematical symbol with semantics (from the symbol library)
  | 'func'       // named function: sin, cos, log, lim, … (name may carry a subscript)
  | 'frac'       // fraction: numerator / denominator
  | 'script'     // base with optional sup / sub
  | 'sqrt'       // radical: √radicand or ⁿ√radicand (index)
  | 'bigop'      // large operator with lower/upper limits: ∑ ∏ ∫ ∬ ∭ ∮ ⋃ ⋂
  | 'accent'     // decorated base: bar hat tilde vec dot ddot
  | 'delim'      // bracket pair around content: ( ) [ ] | ‖ ⌊ ⌈ { }
  | 'cases'      // piecewise: left brace + N rows
  | 'matrix'     // m×n grid of cells
  | 'numbered'   // display row with an equation number — architecture for numbering
  | 'row'        // horizontal sequence (root / matrix cell / case row)
  | 'ph';        // empty placeholder □

export interface MathNode {
  type: MathNodeType;
  /** run: the characters; sym: the symbol char; func: the name */
  text?: string;
  /** sym: machine id from the symbol library (semantic identity) */
  sym?: string;
  /** func: display name; bigop: operator char */
  name?: string;
  children?: MathNode[];
  /** frac: [num, den] · script: [base, sup?, sub?] · sqrt: [radicand] or [radicand, index] */
  parts?: MathNode[][];
  /** bigop / func(lim): lower & upper limit rows */
  lower?: MathNode[] | null;
  upper?: MathNode[] | null;
  /** accent kind · delim pair · matrix dims · cases rows */
  kind?: string;
  rows?: MathNode[][];
  cols?: number;
  /** display equation alignment: left | center | right */
  align?: 'left' | 'center' | 'right';
  /** display equation number: true = auto, string = manual label */
  numbered?: boolean | string;
  /** visual emphasis (from the ribbon) */
  color?: string | null;
  /** run: italic math variables by default; upright for numbers/operators */
  upright?: boolean;
}

/* ── constructors ──────────────────────────────────────────────────── */

export const ph = (): MathNode => ({ type: 'ph' });

export const run = (text: string, upright = false): MathNode => ({ type: 'run', text, upright });

export const sym = (char: string, id?: string): MathNode => ({ type: 'sym', text: char, sym: id ?? char });

export const row = (children: MathNode[] = []): MathNode => ({ type: 'row', children });

/** a slot: keeps children, or a single placeholder when empty */
export const slot = (children?: MathNode[]): MathNode[] =>
  children && children.length ? children : [ph()];

export const isPh = (n: MathNode): boolean => n.type === 'ph';

/** a structural slot is empty when it only holds the placeholder */
export const isSlotEmpty = (children: MathNode[] | null | undefined): boolean =>
  !children || children.length === 0 || (children.length === 1 && isPh(children[0]));

export const frac = (num?: MathNode[], den?: MathNode[]): MathNode =>
  ({ type: 'frac', parts: [slot(num), slot(den)] });

export const script = (base: MathNode[], sup?: MathNode[], sub?: MathNode[]): MathNode => {
  const n: MathNode = { type: 'script', parts: [slot(base)] };
  if (sup && sup.length) n.parts![1] = slot(sup);
  if (sub && sub.length) n.parts![2] = slot(sub);
  return n;
};

export const sqrt = (radicand?: MathNode[], index?: MathNode[]): MathNode => {
  const n: MathNode = { type: 'sqrt', parts: [slot(radicand)] };
  if (index && index.length) n.parts![1] = slot(index);
  return n;
};

export const bigop = (name: string, lower?: MathNode[], upper?: MathNode[]): MathNode => {
  const n: MathNode = { type: 'bigop', name };
  if (lower && lower.length) n.lower = lower;
  if (upper && upper.length) n.upper = upper;
  return n;
};

export const accent = (kind: string, base?: MathNode[]): MathNode =>
  ({ type: 'accent', kind, parts: [slot(base)] });

export const delim = (kind: string, body?: MathNode[]): MathNode =>
  ({ type: 'delim', kind, parts: [slot(body)] });

export const func = (name: string, arg?: MathNode[], sub?: MathNode[]): MathNode => {
  const n: MathNode = { type: 'func', name };
  if (sub && sub.length) n.lower = sub;
  if (arg && arg.length) n.children = arg;
  return n;
};

export const matrix = (rows: MathNode[][], cols: number): MathNode =>
  ({ type: 'matrix', rows, cols });

export const cases = (rows: MathNode[][]): MathNode =>
  ({ type: 'cases', rows });

export const numbered = (body: MathNode[], no: boolean | string = true, align: MathNode['align'] = 'center'): MathNode =>
  ({ type: 'numbered', children: body, numbered: no, align });

/* ── tree utilities ────────────────────────────────────────────────── */

/** one path segment: an index into a child list, or a slot marker
 *  ('c' = children, 'p' = parts[i], 'l' = lower, 'u' = upper, 'r' = rows[i]) */
export type PathSeg = number | 'c' | 'p' | 'l' | 'u' | 'r';
/** a path through the tree: [index, marker, index, marker, …, index] */
export type MathPath = PathSeg[];

/** deep clone (JSON-safe — the AST only holds plain data) */
export function cloneMath(n: MathNode): MathNode {
  return JSON.parse(JSON.stringify(n)) as MathNode;
}

export function cloneAll(ns: MathNode[]): MathNode[] {
  return ns.map(cloneMath);
}

/** does the tree contain any real (non-placeholder) content? */
export function hasContent(ns: MathNode[]): boolean {
  return ns.some(function walk(n): boolean {
    if (n.type === 'ph') return false;
    if (n.type === 'run' || n.type === 'sym') return !!n.text;
    if (n.children?.some(walk)) return true;
    if (n.parts?.some((p) => p.some(walk))) return true;
    if (n.rows?.some((r) => r.some(walk))) return true;
    if (n.lower?.some(walk) || n.upper?.some(walk)) return true;
    return false;
  });
}

/** first placeholder path in a subtree — where the caret should land */
export function findFirstPlaceholder(ns: MathNode[]): MathPath | null {
  for (let i = 0; i < ns.length; i++) {
    const n = ns[i];
    if (n.type === 'ph') return [i];
    const inChild = n.children ? findFirstPlaceholder(n.children) : null;
    if (inChild) return [i, 'c', ...inChild];
    if (n.parts) {
      for (let p = 0; p < n.parts.length; p++) {
        const inPart = findFirstPlaceholder(n.parts[p]);
        if (inPart) return [i, 'p', p, ...inPart];
      }
    }
    if (n.lower) {
      const inLower = findFirstPlaceholder(n.lower);
      if (inLower) return [i, 'l', ...inLower];
    }
    if (n.upper) {
      const inUpper = findFirstPlaceholder(n.upper);
      if (inUpper) return [i, 'u', ...inUpper];
    }
    if (n.rows) {
      for (let r = 0; r < n.rows.length; r++) {
        const inRow = findFirstPlaceholder(n.rows[r]);
        if (inRow) return [i, 'r', r, ...inRow];
      }
    }
  }
  return null;
}

/** get the child list at a path ('p' = parts[i], 'l' = lower, 'u' = upper, 'r' = rows[i]) */
export function getListAt(root: MathNode[], path: MathPath): MathNode[] | null {
  let list: MathNode[] = root;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (typeof seg !== 'number') return null;
    const node = list[seg];
    if (!node) return null;
    const kind = path[++i];
    if (kind === undefined) return list;
    if (kind === 'c') { if (!node.children) return null; list = node.children; }
    else if (kind === 'p') { if (!node.parts) return null; list = node.parts[path[++i] as number]; }
    else if (kind === 'l') { if (!node.lower) return null; list = node.lower; }
    else if (kind === 'u') { if (!node.upper) return null; list = node.upper; }
    else if (kind === 'r') { if (!node.rows) return null; list = node.rows[path[++i] as number]; }
    else return null;
    if (!list) return null;
  }
  return list;
}

/** replace the node at `path` (inside `root`, mutated in place) */
export function replaceAt(root: MathNode[], path: MathPath, nodes: MathNode[]): void {
  const parentPath = path.slice(0, -1);
  const idx = path[path.length - 1];
  const list = getListAt(root, parentPath);
  if (!list || typeof idx !== 'number') return;
  list.splice(idx, nodes.length, ...nodes);
}

/** serialize a subtree to plain text (used for word count / search / plain-text export) */
export function mathToText(ns: MathNode[]): string {
  return ns.map(function toStr(n): string {
    if (n.type === 'ph') return '□';
    if (n.text) return n.text;
    if (n.type === 'frac') return `${toStr(n.parts![0][0] ?? ph())}/${toStr(n.parts![1][0] ?? ph())}`;
    if (n.type === 'script') {
      const base = n.parts![0].map(toStr).join('');
      const sup = n.parts![1] ? `^${n.parts![1].map(toStr).join('')}` : '';
      const sub = n.parts![2] ? `_${n.parts![2].map(toStr).join('')}` : '';
      return base + sup + sub;
    }
    if (n.type === 'sqrt') {
      const rad = n.parts![0].map(toStr).join('');
      return n.parts![1] ? `${n.parts![1].map(toStr).join('')}√(${rad})` : `√(${rad})`;
    }
    if (n.type === 'bigop') {
      const l = n.lower ? `_${n.lower.map(toStr).join('')}` : '';
      const u = n.upper ? `^${n.upper.map(toStr).join('')}` : '';
      return `${n.name}${l}${u}`;
    }
    if (n.type === 'accent') return `${n.parts![0].map(toStr).join('')}${n.kind}`;
    if (n.type === 'delim') return `${n.parts![0].map(toStr).join('')}`;
    if (n.type === 'func') {
      const arg = n.children ? n.children.map(toStr).join('') : '';
      const l = n.lower ? `_${n.lower.map(toStr).join('')}` : '';
      return `${n.name}${l}(${arg})`;
    }
    if (n.type === 'matrix') return `[matrix]`;
    if (n.type === 'cases') return `[cases]`;
    if (n.children) return n.children.map(toStr).join('');
    return '';
  }).join('');
}
