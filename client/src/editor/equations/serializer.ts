/* ────────────────────────────────────────────────────────────────────────
   Serializer — Math AST → LaTeX. The inverse of the parser.

   Used for: "Copy as LaTeX", round-tripping through the document model,
   and the Convert ▸ Linear view (professional AST → linear string).
   ──────────────────────────────────────────────────────────────────────── */

import type { MathNode } from './ast';
import { isPh } from './ast';
import { SYMBOLS } from './symbols';

/** wrap in braces when the serialized form is longer than one token */
function atom(s: string): string {
  return s.length <= 1 ? s : `{${s}}`;
}

export function toLatex(ns: MathNode[]): string {
  return ns.map(toLatexOne).join('');
}

function toLatexOne(n: MathNode): string {
  if (n.type === 'ph') return '\\square';
  if (n.type === 'run') return n.text ?? '';
  if (n.type === 'sym') {
    // symbols inserted from the library remember their semantic id or LaTeX
    // command — look it back up so Convert ▸ Linear round-trips exactly
    if (n.sym && n.sym.startsWith('\\')) return n.sym;
    const rec = SYMBOLS.find((x) => x.id === n.sym) ?? SYMBOLS.find((x) => x.cmd === n.sym);
    if (rec?.cmd) return `\\${rec.cmd}`;
    return n.text ?? '';
  }
  if (n.type === 'frac') {
    return `\\frac{${toLatex(n.parts![0])}}{${toLatex(n.parts![1])}}`;
  }
  if (n.type === 'script') {
    let s = atom(toLatex(n.parts![0]));
    if (n.parts![2]) s += `_{${toLatex(n.parts![2])}}`;
    if (n.parts![1]) s += `^{${toLatex(n.parts![1])}}`;
    return s;
  }
  if (n.type === 'sqrt') {
    const rad = toLatex(n.parts![0]);
    return n.parts![1] ? `\\sqrt[${toLatex(n.parts![1])}]{${rad}}` : `\\sqrt{${rad}}`;
  }
  if (n.type === 'bigop') {
    const cmd = BIGOP_LATEX[n.name ?? ''] ?? n.name ?? '\\sum';
    let s = cmd;
    if (n.lower) s += `_{${toLatex(n.lower)}}`;
    if (n.upper) s += `^{${toLatex(n.upper)}}`;
    return s;
  }
  if (n.type === 'accent') {
    const cmd = ACCENT_LATEX[n.kind ?? 'bar'] ?? '\\bar';
    return `${cmd}{${toLatex(n.parts![0])}}`;
  }
  if (n.type === 'delim') {
    const [l, r] = DELIM_LATEX[n.kind ?? 'paren'] ?? ['(', ')'];
    return `\\left${l}${toLatex(n.parts![0])}\\right${r}`;
  }
  if (n.type === 'func') {
    let s = `\\${n.name}`;
    if (n.lower) s += `_{${toLatex(n.lower)}}`;
    if (n.upper) s += `^{${toLatex(n.upper)}}`;
    if (n.children) s += `\\left(${toLatex(n.children)}\\right)`;
    return s;
  }
  if (n.type === 'matrix') {
    const rows = (n.rows ?? []).map((r) => r.map(toLatexOne).join(' & ')).join(' \\\\ ');
    return `\\begin{matrix}${rows}\\end{matrix}`;
  }
  if (n.type === 'cases') {
    const rows = (n.rows ?? []).map((r) => r.map(toLatexOne).join(' & ')).join(' \\\\ ');
    return `\\begin{cases}${rows}\\end{cases}`;
  }
  if (n.type === 'row') return (n.children ?? []).map(toLatexOne).join('');
  if (n.type === 'numbered') return toLatex(n.children ?? []);
  return '';
}

const BIGOP_LATEX: Record<string, string> = {
  '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod', '∫': '\\int', '∬': '\\iint',
  '∭': '\\iiint', '∮': '\\oint', '⋃': '\\bigcup', '⋂': '\\bigcap',
};

const ACCENT_LATEX: Record<string, string> = {
  bar: '\\bar', hat: '\\hat', tilde: '\\tilde', vec: '\\vec',
  dot: '\\dot', ddot: '\\ddot', check: '\\check', acute: '\\acute', grave: '\\grave',
};

const DELIM_LATEX: Record<string, [string, string]> = {
  paren: ['(', ')'], brack: ['[', ']'], brace: ['\\{', '\\}'],
  abs: ['|', '|'], norm: ['\\|', '\\|'], floor: ['\\lfloor', '\\rfloor'],
  ceil: ['\\lceil', '\\rceil'], angle: ['\\langle', '\\rangle'], none: ['.', '.'],
};

/** human-readable linear form (same as LaTeX here — the linear mode IS the
 *  LaTeX-ish input syntax, exactly like Word's Professional ↔ Linear) */
export const toLinear = toLatex;

/** does the subtree contain a placeholder? (used to warn before copying) */
export function hasPlaceholder(ns: MathNode[]): boolean {
  return ns.some(function walk(n): boolean {
    if (isPh(n)) return true;
    if (n.children?.some(walk) || n.parts?.some((p) => p.some(walk))) return true;
    if (n.rows?.some((r) => r.some(walk))) return true;
    if (n.lower?.some(walk) || n.upper?.some(walk)) return true;
    return false;
  });
}
