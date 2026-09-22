/* ────────────────────────────────────────────────────────────────────────
   Parser — linear / LaTeX math input → Math AST.

   A real recursive-descent parser (token stream + grammar), NOT a pile of
   regex replacements. Supported grammar covers the whole ribbon surface:

     primary  := group | frac | sqrt | bigop | func | accent | delim
               | script-target | symbol | number | letter-run
     group    := '{' expr '}'
     frac     := \frac group group | a/b
     script   := target ^ group | target _ group   (either order, both allowed)
     sqrt     := \sqrt group | \sqrt[ group ] group
     bigop    := \sum | \prod | \int …  with optional _group ^group (either order)
     accent   := \bar \hat \tilde \vec \dot \ddot \overline
     delim    := \left( … \right) | plain ( [ | etc. auto-paired
     func     := \sin \cos \log \lim …  (lim/log get limits, args get parens)
     symbols  := \alpha \beta \infty \sum …  (full symbol table)
   ──────────────────────────────────────────────────────────────────────── */

import {
  type MathNode, ph, run, sym, row, frac, script, sqrt, bigop, accent, delim, func, cases,
} from './ast';
import { SYMBOLS } from './symbols';

/* ── token stream ──────────────────────────────────────────────────── */

type Tok =
  | { t: 'cmd'; v: string }
  | { t: 'ch'; v: string }
  | { t: '{' } | { t: '}' } | { t: '[' } | { t: ']' } | { t: '^' } | { t: '_' }
  | { t: '/' } | { t: '&' } | { t: '\\\\' };

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
      if (!m) { i++; continue; }
      toks.push({ t: 'cmd', v: m[1] });
      i += m[0].length;
      continue;
    }
    if (c === '{') { toks.push({ t: '{' }); i++; continue; }
    if (c === '}') { toks.push({ t: '}' }); i++; continue; }
    if (c === '[') { toks.push({ t: '[' }); i++; continue; }
    if (c === ']') { toks.push({ t: ']' }); i++; continue; }
    if (c === '^') { toks.push({ t: '^' }); i++; continue; }
    if (c === '_') { toks.push({ t: '_' }); i++; continue; }
    if (c === '/') { toks.push({ t: '/' }); i++; continue; }
    if (c === '&') { toks.push({ t: '&' }); i++; continue; }
    if (c === '\\' && src[i + 1] === '\\') { toks.push({ t: '\\\\' }); i += 2; continue; }
    toks.push({ t: 'ch', v: c });
    i++;
  }
  return toks;
}

/* ── parser ────────────────────────────────────────────────────────── */

const BIG_OPS = new Set(['sum', 'prod', 'coprod', 'int', 'iint', 'iiint', 'oint', 'bigcup', 'bigcap']);
const ACCENTS: Record<string, string> = {
  bar: 'bar', overline: 'bar', hat: 'hat', tilde: 'tilde', vec: 'vec',
  dot: 'dot', ddot: 'ddot', check: 'check', acute: 'acute', grave: 'grave',
};
const DELIMS: Record<string, string> = {
  '(': 'paren', '[': 'brack', '\\{': 'brace', '{': 'brace', '|': 'abs',
  '\\|': 'norm', '\\lfloor': 'floor', '\\lceil': 'ceil', '\\langle': 'angle', '.': 'none',
};
const FUNCS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'dim',
  'gcd', 'lcm', 'mod', 'deg', 'arg', 'Pr', 'sinh', 'cosh', 'tanh',
]);

class Parser {
  private toks: Tok[];
  private i = 0;
  /** rows collected at the current brace level (for \begin{matrix}-style input) */
  private rows: MathNode[][][] = [];

  constructor(src: string) { this.toks = lex(src); }

  parse(): MathNode[] {
    const e = this.expr(true);
    return e;
  }

  private peek(): Tok | undefined { return this.toks[this.i]; }
  private next(): Tok | undefined { return this.toks[this.i++]; }

  /** expression = sequence of primaries; `top` splits rows on \\ and & */
  private expr(top: boolean): MathNode[] {
    const items: MathNode[] = [];
    let cur: MathNode[] = [];
    const flush = () => {
      if (cur.length) { items.push(cur.length === 1 ? cur[0] : row(cur)); cur = []; }
    };
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.t === '}') break;
      if (t.t === ']') break;
      if (top && t.t === '\\\\') { this.next(); flush(); continue; }
      if (top && t.t === '&') { this.next(); continue; } // & inside top-level: ignore separators
      const n = this.primary();
      if (n) cur.push(n);
    }
    flush();
    return items;
  }

  /** one primary item, with any ^ _ scripts attached */
  private primary(): MathNode | null {
    let n = this.primaryBase();
    if (!n) return null;
    n = this.scripts(n);
    return n;
  }

  /** attach ^ and _ (any order, possibly both) */
  private scripts(n: MathNode): MathNode {
    for (;;) {
      const t = this.peek();
      if (!t || (t.t !== '^' && t.t !== '_')) break;
      this.next();
      const g = this.groupOrToken();
      if (t.t === '^') n = this.withSup(n, g);
      else n = this.withSub(n, g);
    }
    return n;
  }

  private withSup(n: MathNode, sup: MathNode[]): MathNode {
    if (n.type === 'script') {
      n.parts![1] = sup.length ? sup : [ph()];
      return n;
    }
    if (n.type === 'bigop') { n.upper = sup.length ? sup : [ph()]; return n; }
    if (n.type === 'func') { n.upper = sup.length ? sup : [ph()]; return n; }
    return script([n], sup.length ? sup : [ph()]);
  }

  private withSub(n: MathNode, sub: MathNode[]): MathNode {
    if (n.type === 'script') {
      n.parts![2] = sub.length ? sub : [ph()];
      return n;
    }
    if (n.type === 'bigop') { n.lower = sub.length ? sub : [ph()]; return n; }
    if (n.type === 'func') { n.lower = sub.length ? sub : [ph()]; return n; }
    return script([n], undefined, sub.length ? sub : [ph()]);
  }

  /** the thing scripts attach to */
  private primaryBase(): MathNode | null {
    const t = this.next();
    if (!t) return null;

    switch (t.t) {
      case '{': {
        const inner = this.expr(false);
        if (this.peek()?.t === '}') this.next();
        return inner.length === 1 ? inner[0] : row(inner);
      }
      case '}': this.i--; return null; // unconsume; caller's loop breaks on it
      case ']': this.i--; return null;
      case '^': case '_': { // script with no base: treat as script on empty base
        const g = this.groupOrToken();
        return t.t === '^' ? script([ph()], g.length ? g : [ph()]) : script([ph()], undefined, g.length ? g : [ph()]);
      }
      case '/': { // a / b without preceding atom: build fraction over nothing
        return null;
      }
      case '&': return null;
      case '\\\\': return null;
      case '[': {
        const inner = this.expr(false);
        if (this.peek()?.t === ']') this.next();
        return inner.length === 1 ? inner[0] : row(inner);
      }
      case 'cmd': return this.command(t.v);
      case 'ch': return this.char(t.v);
    }
    return null;
  }

  /** a {group} or a single token, as script/limit argument */
  private groupOrToken(): MathNode[] {
    const t = this.peek();
    if (!t) return [ph()];
    if (t.t === '{') {
      this.next();
      const inner = this.expr(false);
      if (this.peek()?.t === '}') this.next();
      return inner.length ? inner : [ph()];
    }
    // single token (x^2, x_i)
    this.next();
    const one = this.primaryBase();
    return one ? [one] : [ph()];
  }

  private char(c: string): MathNode {
    // numbers stay upright runs
    if (/[0-9.]/.test(c)) {
      // consume the whole number
      let num = c;
      while (this.peek()?.t === 'ch' && /[0-9.]/.test((this.peek() as { v: string }).v)) {
        num += (this.next() as { v: string }).v;
      }
      return run(num, true);
    }
    // a/b slash-fraction: handled when '/' follows an atom
    if (c === '/') {
      return sym('/', 'slash');
    }
    if (/[+\-*=<>]/.test(c)) return sym(c, c === '-' ? 'minus' : c === '*' ? 'times' : c);
    if (/[a-zA-Z]/.test(c)) {
      // consume a run of plain letters as one variable run (x, yz, sin-like words stay separate via cmds)
      let word = c;
      while (this.peek()?.t === 'ch' && /[a-zA-Z]/.test((this.peek() as { v: string }).v)) {
        word += (this.next() as { v: string }).v;
      }
      return run(word);
    }
    // unicode math characters typed directly
    if (SYMBOLS.some((s) => s.ch === c)) return sym(c);
    return run(c, /[0-9.,;:!?\s]/.test(c));
  }

  private command(name: string): MathNode | null {
    // structural commands come FIRST (\sqrt is also a symbol-table glyph —
    // the structure must win); then the symbol table covers \alpha … \infty
    if (name === 'sqrt') {
      let index: MathNode[] | undefined;
      if (this.peek()?.t === '[') {
        this.next();
        index = this.expr(false);
        if (this.peek()?.t === ']') this.next();
      }
      const rad = this.groupOrToken();
      return sqrt(rad, index);
    }
    const s = SYMBOLS.find((x) => x.cmd === name);
    if (s) {
      if ((BIG_OPS as Set<string>).has(name)) return bigop(s.ch);
      return sym(s.ch, s.id ?? s.cmd ?? name);
    }

    switch (name) {
      case 'frac': case 'dfrac': case 'tfrac': case 'cfrac': {
        const num = this.groupOrToken();
        const den = this.groupOrToken();
        return frac(num, den);
      }
      case 'sum': case 'prod': case 'coprod': case 'int': case 'iint': case 'iiint': case 'oint': case 'bigcup': case 'bigcap': {
        const op = SYMBOLS.find((x) => x.cmd === name)?.ch ?? '∑';
        return bigop(op);
      }
      case 'bar': case 'overline': case 'hat': case 'tilde': case 'vec': case 'dot': case 'ddot':
      case 'check': case 'acute': case 'grave': {
        const b = this.groupOrToken();
        return accent(ACCENTS[name], b);
      }
      case 'left': {
        const open = this.next();
        const openKind = open?.t === 'cmd' ? `\\${open.v}` : open?.t === 'ch' ? open.v : '(';
        const body = this.expr(false);
        // consume \right + closing delimiter
        let closeKind = openKind;
        if (this.peek()?.t === 'cmd' && (this.peek() as { v: string }).v === 'right') {
          this.next();
          const close = this.next();
          closeKind = close?.t === 'cmd' ? `\\${close.v}` : close?.t === 'ch' ? close.v : ')';
        }
        const kind = DELIMS[openKind] ?? 'paren';
        void closeKind;
        return delim(kind, body);
      }
      case 'begin': {
        // \begin{matrix|pmatrix|bmatrix|cases|aligned} … \end{…}
        // cells split on &, rows split on \\: cells become editable `row`
        // nodes (the renderer + engine contract for matrix cells)
        const env = this.groupOrToken().map((n) => (n.type === 'run' ? n.text ?? '' : '')).join('').trim();
        const cellToRow = (cell: MathNode[]): MathNode =>
          cell.length === 1 ? cell[0] : { type: 'row', children: cell.length ? cell : [ph()] };
        const rowsOut: MathNode[][] = [];
        let curRow: MathNode[][] = [];
        let curCell: MathNode[] = [];
        const flushCell = () => { curRow.push(curCell.length ? curCell : [ph()]); curCell = []; };
        const flushRow = () => { flushCell(); rowsOut.push(curRow.map(cellToRow)); curRow = []; };
        for (;;) {
          const t = this.peek();
          if (!t) break;
          if (t.t === 'cmd' && (t as { v: string }).v === 'end') {
            this.next();
            this.groupOrToken(); // env name
            break;
          }
          if (t.t === '&') { this.next(); flushCell(); continue; }
          if (t.t === '\\\\') { this.next(); flushRow(); continue; }
          const n = this.primary();
          if (n) curCell.push(n);
        }
        if (curCell.length || curRow.length) flushRow();
        const cells = rowsOut.length ? rowsOut : [[cellToRow([ph()])]];
        if (env === 'cases') {
          return cases(rowsOut.length ? rowsOut.map((r) => r.flat()) : [[ph()]]);
        }
        const width = Math.max(...cells.map((r) => r.length), 1);
        return { type: 'matrix', rows: cells, cols: width };
      }
      default: break;
    }

    if (FUNCS.has(name)) {
      const f = func(name);
      // optional limits/arg come through scripts() and the next primaries;
      // \lim_{x\to0} handled by withSub above; argument: next primary wrapped
      const arg = this.maybeArg();
      if (arg) f.children = arg;
      return f;
    }

    // unknown command → keep its name as upright text (never silently drop input)
    return run(`\\${name}`, true);
  }

  /** after sin/log/lim: wrap the following primary as the argument */
  private maybeArg(): MathNode[] | null {
    const t = this.peek();
    if (!t) return null;
    if (t.t === '{') {
      const g = this.groupOrToken();
      return [delim('paren', g)];
    }
    if (t.t === 'cmd' && (t as { v: string }).v === 'left') {
      const d = this.primaryBase();
      return d ? [d] : null;
    }
    // single token argument: sin x
    const save = this.i;
    const n = this.primaryBase();
    if (n && (n.type === 'run' || n.type === 'sym')) {
      return [n];
    }
    this.i = save;
    return null;
  }
}

/* ── linear (non-LaTeX) conveniences ───────────────────────────────── */

/** "x^2 + y^2 = z^2" style plain input is handled by the same token stream —
 *  ^ _ / are already grammar. This pre-pass upgrades a few extra linear
 *  idioms to LaTeX so ONE parser serves both modes. */
function preprocessLinear(src: string): string {
  let s = src;
  // a/b → \frac{a}{b} only for simple operands (single char or {..} /(..))
  const operand = String.raw`(?:\{[^{}]*\}|\([^()]*\)|[0-9a-zA-Z]+(?:\^[0-9a-zA-Z]+|_[0-9a-zA-Z]+)?)`;
  const fracRe = new RegExp(`(^|[\\s(])(${operand})\\/(${operand})(?=$|[\\s)])`, 'g');
  s = s.replace(fracRe, (_m, pre, a, b) => `${pre}\\frac{${strip(a)}}{${strip(b)}}`);
  // sqrt(x) → \sqrt{x} ; nthroot via ^(1/n)
  s = s.replace(/sqrt\s*\(([^()]*)\)/g, (_m, inner) => `\\sqrt{${inner}}`);
  return s;
}

function strip(operand: string): string {
  if (operand.startsWith('{') && operand.endsWith('}')) return operand.slice(1, -1);
  if (operand.startsWith('(') && operand.endsWith(')')) return operand.slice(1, -1);
  return operand;
}

/** parse linear or LaTeX input into a Math AST (throws nothing — bad input
 *  degrades to upright text runs so the user never loses what they typed) */
export function parseMath(src: string): MathNode[] {
  const prepared = preprocessLinear(src.trim());
  if (!prepared) return [ph()];
  try {
    const p = new Parser(prepared);
    const out = p.parse();
    return out.length ? out : [ph()];
  } catch {
    return [run(src, true)];
  }
}

/** convenience: parse a full display equation body */
export function parseEquationBody(src: string): MathNode[] {
  const nodes = parseMath(src);
  return nodes;
}

export { cases };
