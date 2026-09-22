/* ────────────────────────────────────────────────────────────────────────
   Structures — the catalog behind the ribbon's Structures menu.

   Each entry is a REAL AST factory: inserting runs insertStructure() which
   splices the produced node into the equation tree and drops the caret into
   its first placeholder. `make` optionally accepts existing content (used
   when inserting into a matrix cell that already holds something).
   ──────────────────────────────────────────────────────────────────────── */

import {
  type MathNode, ph, frac, script, sqrt, bigop, accent, delim, func, matrix, cases,
} from './ast';

export type StructureGroupId =
  | 'frac' | 'script' | 'radical' | 'integral' | 'bigop' | 'bracket'
  | 'accent' | 'func' | 'limit' | 'matrix' | 'cases';

export const STRUCTURE_GROUPS: Array<{ id: StructureGroupId; label: string }> = [
  { id: 'frac', label: 'کسر' },
  { id: 'script', label: 'اندیس‌ها' },
  { id: 'radical', label: 'رادیکال' },
  { id: 'integral', label: 'انتگرال' },
  { id: 'bigop', label: 'عملگر بزرگ' },
  { id: 'bracket', label: 'پرانتزها' },
  { id: 'accent', label: 'تزئین‌ها' },
  { id: 'func', label: 'توابع' },
  { id: 'limit', label: 'حد و لگاریتم' },
  { id: 'matrix', label: 'ماتریس' },
  { id: 'cases', label: 'حالت‌ها (تکه‌ای)' },
];

export interface StructureDef {
  key: string;
  label: string;
  group: StructureGroupId;
  /** small preview shown in the menu (unicode approximation) */
  preview: string;
  /** build the AST node; `content` = existing content to wrap (matrix cells) */
  make: (content?: MathNode[]) => MathNode;
}

const first = (c?: MathNode[]): MathNode[] | undefined => (c && c.length ? c : undefined);

export const STRUCTURES: StructureDef[] = [
  /* ── fractions ─────────────────────────────────────────────────────── */
  { key: 'frac', group: 'frac', label: 'کسر', preview: '□/□', make: (c) => frac(first(c)) },
  { key: 'frac.stacked', group: 'frac', label: 'کسر روی‌هم', preview: 'ᵃ⁄ᵦ', make: (c) => frac(first(c)) },
  { key: 'frac.slash', group: 'frac', label: 'کسر مورب', preview: 'a⁄b', make: (c) => ({ ...frac(first(c)), kind: 'slash' }) },

  /* ── scripts ───────────────────────────────────────────────────────── */
  { key: 'sup', group: 'script', label: 'توان', preview: '□²', make: (c) => script(first(c) ?? [ph()], [ph()]) },
  { key: 'sub', group: 'script', label: 'زیرنویس', preview: '□₁', make: (c) => script(first(c) ?? [ph()], undefined, [ph()]) },
  { key: 'subsup', group: 'script', label: 'زیرنویس و توان', preview: '□₁²', make: (c) => script(first(c) ?? [ph()], [ph()], [ph()]) },

  /* ── radicals ──────────────────────────────────────────────────────── */
  { key: 'sqrt', group: 'radical', label: 'جذر', preview: '√□', make: (c) => sqrt(first(c)) },
  { key: 'sqrt.nth', group: 'radical', label: 'جذر درجه n', preview: 'ⁿ√□', make: (c) => sqrt(first(c), [ph()]) },

  /* ── integrals ─────────────────────────────────────────────────────── */
  { key: 'int', group: 'integral', label: 'انتگرال', preview: '∫', make: () => bigop('∫') },
  { key: 'int.lim', group: 'integral', label: 'انتگرال با کران', preview: '∫ᵇₐ', make: () => bigop('∫', [ph()], [ph()]) },
  { key: 'iint', group: 'integral', label: 'انتگرال دوگانه', preview: '∬', make: () => bigop('∬') },
  { key: 'iiint', group: 'integral', label: 'انتگرال سه‌گانه', preview: '∭', make: () => bigop('∭') },
  { key: 'oint', group: 'integral', label: 'انتگرال خطی بسته', preview: '∮', make: () => bigop('∮') },

  /* ── large operators ───────────────────────────────────────────────── */
  { key: 'sum', group: 'bigop', label: 'سیگما', preview: '∑', make: () => bigop('∑') },
  { key: 'sum.lim', group: 'bigop', label: 'سیگما با کران', preview: 'ᵈ∑ᵢ', make: () => bigop('∑', [ph()], [ph()]) },
  { key: 'prod.lim', group: 'bigop', label: 'ضرب با کران', preview: 'ᵈ∏ᵢ', make: () => bigop('∏', [ph()], [ph()]) },
  { key: 'coprod.lim', group: 'bigop', label: 'کوپروداک', preview: 'ᵈ∐ᵢ', make: () => bigop('∐', [ph()], [ph()]) },
  { key: 'bigcup.lim', group: 'bigop', label: 'اجتماع بزرگ', preview: 'ᵈ⋃ᵢ', make: () => bigop('⋃', [ph()], [ph()]) },
  { key: 'bigcap.lim', group: 'bigop', label: 'اشتراک بزرگ', preview: 'ᵈ⋂ᵢ', make: () => bigop('⋂', [ph()], [ph()]) },

  /* ── brackets ──────────────────────────────────────────────────────── */
  { key: 'paren', group: 'bracket', label: 'پرانتز', preview: '(□)', make: (c) => delim('paren', first(c)) },
  { key: 'brack', group: 'bracket', label: 'براکت', preview: '[□]', make: (c) => delim('brack', first(c)) },
  { key: 'brace', group: 'bracket', label: 'آکولاد', preview: '{□}', make: (c) => delim('brace', first(c)) },
  { key: 'abs', group: 'bracket', label: 'قدر مطلق', preview: '|□|', make: (c) => delim('abs', first(c)) },
  { key: 'norm', group: 'bracket', label: 'نُرم', preview: '‖□‖', make: (c) => delim('norm', first(c)) },
  { key: 'floor', group: 'bracket', label: 'کف', preview: '⌊□⌋', make: (c) => delim('floor', first(c)) },
  { key: 'ceil', group: 'bracket', label: 'سقف', preview: '⌈□⌉', make: (c) => delim('ceil', first(c)) },
  { key: 'angle', group: 'bracket', label: 'زاویه‌دار', preview: '⟨□⟩', make: (c) => delim('angle', first(c)) },

  /* ── accents ───────────────────────────────────────────────────────── */
  { key: 'acc.bar', group: 'accent', label: 'خط بالا', preview: 'x̄', make: (c) => accent('bar', first(c)) },
  { key: 'acc.hat', group: 'accent', label: 'کلاه', preview: 'x̂', make: (c) => accent('hat', first(c)) },
  { key: 'acc.tilde', group: 'accent', label: 'موج', preview: 'x̃', make: (c) => accent('tilde', first(c)) },
  { key: 'acc.vec', group: 'accent', label: 'بردار', preview: 'v⃗', make: (c) => accent('vec', first(c)) },
  { key: 'acc.dot', group: 'accent', label: 'نقطه', preview: 'ẋ', make: (c) => accent('dot', first(c)) },
  { key: 'acc.ddot', group: 'accent', label: 'دو نقطه', preview: 'ẍ', make: (c) => accent('ddot', first(c)) },

  /* ── functions ─────────────────────────────────────────────────────── */
  ...['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'exp', 'max', 'min', 'det', 'dim', 'gcd', 'lim'].map(
    (name): StructureDef => ({
      key: `fn.${name}`, group: 'func', label: name, preview: `${name} □`,
      make: (c) => func(name, first(c) ?? [ph()]),
    }),
  ),

  /* ── limits / logs ─────────────────────────────────────────────────── */
  { key: 'lim.below', group: 'limit', label: 'حد با کران', preview: 'limₓ→₀', make: () => func('lim', [ph()], [ph()]) },
  { key: 'log.base', group: 'limit', label: 'لگاریتم با پایه', preview: 'log₂□', make: (c) => func('log', first(c) ?? [ph()], [ph()]) },

  /* ── matrices ──────────────────────────────────────────────────────── */
  ...([1, 2, 3, 4] as const).flatMap((r) =>
    ([1, 2, 3, 4] as const).map((c): StructureDef => ({
      key: `matrix.${r}x${c}`, group: 'matrix', label: `ماتریس ${r}×${c}`,
      preview: `${r}×${c}`,
      make: () => makeMatrix(r, c),
    })),
  ),

  /* ── cases / piecewise ─────────────────────────────────────────────── */
  { key: 'cases.2', group: 'cases', label: 'تابع تکه‌ای (۲ حالت)', preview: '{□', make: () => cases([[ph()], [ph()]]) },
  { key: 'cases.3', group: 'cases', label: 'تابع تکه‌ای (۳ حالت)', preview: '{□', make: () => cases([[ph()], [ph()], [ph()]]) },
];

export function structureByKey(key: string): StructureDef | undefined {
  return STRUCTURES.find((s) => s.key === key);
}

/** an r×c matrix of editable cells (each cell is a `row` node holding a placeholder) */
export function makeMatrix(r: number, c: number): MathNode {
  return matrix(
    Array.from({ length: Math.max(1, r) }, () =>
      Array.from({ length: Math.max(1, c) }, () => ({ type: 'row', children: [ph()] }) as MathNode)),
    Math.max(1, c),
  );
}
