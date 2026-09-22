/* ────────────────────────────────────────────────────────────────────────
   Symbol library — categorized mathematical symbols.

   Every entry carries: the glyph, its LaTeX command (so parse + serialize
   round-trip), an optional stable id, and the category it appears under.
   Symbols inserted from the ribbon become real `sym` AST nodes with the
   LaTeX command recorded, so Convert ▸ Linear keeps working both ways.
   ──────────────────────────────────────────────────────────────────────── */

export interface MathSymbol {
  ch: string;
  cmd?: string;   // LaTeX command without backslash (round-trips through the parser)
  id?: string;    // stable semantic id
}

export type SymbolCategoryId =
  | 'basic' | 'greek' | 'operators' | 'relations' | 'arrows' | 'sets'
  | 'logic' | 'calculus' | 'geometry' | 'stats' | 'probability'
  | 'physics' | 'chemistry' | 'special';

export const SYMBOL_CATEGORIES: Array<{ id: SymbolCategoryId; label: string }> = [
  { id: 'basic', label: 'ریاضیات پایه' },
  { id: 'greek', label: 'حروف یونانی' },
  { id: 'operators', label: 'عملگرها' },
  { id: 'relations', label: 'رابطه‌ها' },
  { id: 'arrows', label: 'پیکان‌ها' },
  { id: 'sets', label: 'نظریه مجموعه‌ها' },
  { id: 'logic', label: 'منطق' },
  { id: 'calculus', label: 'حسابان' },
  { id: 'geometry', label: 'هندسه' },
  { id: 'stats', label: 'آمار' },
  { id: 'probability', label: 'احتمال' },
  { id: 'physics', label: 'فیزیک' },
  { id: 'chemistry', label: 'شیمی' },
  { id: 'special', label: 'نمادهای ویژه' },
];

const S = (ch: string, cmd?: string | null, id?: string): MathSymbol => ({ ch, cmd: cmd ?? undefined, id });

export const SYMBOLS: Array<MathSymbol & { cat: SymbolCategoryId }> = [
  /* basic */
  ...[
    S('+', '+', 'plus'), S('−', '-', 'minus'), S('×', 'times', 'times'), S('÷', 'div', 'div'),
    S('=', '=', 'eq'), S('±', 'pm', 'pm'), S('∓', 'mp', 'mp'), S('/', null, 'slash'),
    S('·', 'cdot', 'cdot'), S('∗', 'ast', 'ast'), S('⋆', 'star', 'star'),
    S('!', null, 'factorial'), S('%', '%', 'percent'), S('‰', 'perthousand', 'perthousand'),
  ].map((s) => ({ ...s, cat: 'basic' as const })),

  /* greek — lower */
  ...[
    S('α', 'alpha'), S('β', 'beta'), S('γ', 'gamma'), S('δ', 'delta'), S('ε', 'varepsilon'),
    S('ϵ', 'epsilon'), S('ζ', 'zeta'), S('η', 'eta'), S('θ', 'theta'), S('ϑ', 'vartheta'),
    S('ι', 'iota'), S('κ', 'kappa'), S('λ', 'lambda'), S('μ', 'mu'), S('ν', 'nu'),
    S('ξ', 'xi'), S('ο', 'omicron'), S('π', 'pi'), S('ϖ', 'varpi'), S('ρ', 'rho'),
    S('ϱ', 'varrho'), S('σ', 'sigma'), S('ς', 'varsigma'), S('τ', 'tau'), S('υ', 'upsilon'),
    S('φ', 'phi'), S('ϕ', 'varphi'), S('χ', 'chi'), S('ψ', 'psi'), S('ω', 'omega'),
    /* upper */
    S('Γ', 'Gamma'), S('Δ', 'Delta'), S('Θ', 'Theta'), S('Λ', 'Lambda'), S('Ξ', 'Xi'),
    S('Π', 'Pi'), S('Σ', 'Sigma'), S('Υ', 'Upsilon'), S('Φ', 'Phi'), S('Ψ', 'Psi'), S('Ω', 'Omega'),
  ].map((s) => ({ ...s, cat: 'greek' as const })),

  /* operators */
  ...[
    S('∑', 'sum', 'sum'), S('∏', 'prod', 'prod'), S('∐', 'coprod', 'coprod'),
    S('∫', 'int', 'int'), S('∬', 'iint', 'iint'), S('∭', 'iiint', 'iiint'),
    S('∮', 'oint', 'oint'), S('⋃', 'bigcup', 'bigcup'), S('⋂', 'bigcap', 'bigcap'),
    S('⋁', 'bigvee'), S('⋀', 'bigwedge'), S('⨁', 'bigoplus'), S('⨂', 'bigotimes'),
    S('√', 'sqrt', 'sqrt-sym'), S('∂', 'partial', 'partial'), S('∇', 'nabla', 'nabla'),
    S('Δ', 'Delta', 'increment'), S('∘', 'circ', 'compose'), S('⊕', 'oplus'), S('⊗', 'otimes'),
  ].map((s) => ({ ...s, cat: 'operators' as const })),

  /* relations */
  ...[
    S('≠', 'neq', 'neq'), S('≈', 'approx', 'approx'), S('≡', 'equiv', 'equiv'), S('≅', 'cong'),
    S('≤', 'leq', 'leq'), S('≥', 'geq', 'geq'), S('≪', 'll'), S('≫', 'gg'),
    S('≶', 'lesseqgtr'), S('∝', 'propto', 'propto'), S('∼', 'sim'),
    S('≼', 'preceq'), S('≽', 'succeq'), S('⊂', 'subset', 'subset-strict'),
    S('⊆', 'subseteq', 'subset'), S('⊃', 'supset'), S('⊇', 'supseteq'),
    S('∈', 'in', 'in'), S('∉', 'notin', 'notin'), S('∋', 'ni'), S('∴', 'therefore'), S('∵', 'because'),
  ].map((s) => ({ ...s, cat: 'relations' as const })),

  /* arrows */
  ...[
    S('→', 'to', 'to'), S('←', 'leftarrow', 'gets'), S('↔', 'leftrightarrow', 'leftrightarrow'),
    S('⇒', 'Rightarrow', 'implies'), S('⇐', 'Leftarrow', 'impliedby'), S('⇔', 'Leftrightarrow', 'iff'),
    S('↦', 'mapsto', 'mapsto'), S('↑', 'uparrow'), S('↓', 'downarrow'),
    S('⇀', 'rightharpoonup'), S('↠', 'twoheadrightarrow'), S('⇉', 'rightrightarrows'),
  ].map((s) => ({ ...s, cat: 'arrows' as const })),

  /* sets */
  ...[
    S('∅', 'emptyset', 'emptyset'), S('∪', 'cup', 'cup'), S('∩', 'cap', 'cap'),
    S('∈', 'in', 'in2'), S('∉', 'notin', 'notin2'), S('⊂', 'subset', 'subset2'),
    S('⊆', 'subseteq', 'subseteq2'), S('⊇', 'supseteq', 'supseteq'),
    S('𝔸', 'mathbb{A}'), S('ℕ', 'mathbb{N}', 'naturals'), S('ℤ', 'mathbb{Z}', 'integers'),
    S('ℚ', 'mathbb{Q}', 'rationals'), S('ℝ', 'mathbb{R}', 'reals'), S('ℂ', 'mathbb{C}', 'complexes'),
    S('∀', 'forall', 'forall'), S('∃', 'exists', 'exists'), S('∄', 'nexists'),
  ].map((s) => ({ ...s, cat: 'sets' as const })),

  /* logic */
  ...[
    S('¬', 'neg', 'neg'), S('∧', 'land', 'and'), S('∨', 'lor', 'or'),
    S('⊕', 'oplus', 'xor'), S('→', 'to', 'then'), S('⇒', 'Rightarrow', 'then2'),
    S('⇔', 'Leftrightarrow', 'iff2'), S('∀', 'forall', 'forall2'), S('∃', 'exists', 'exists2'),
    S('⊤', 'top', 'true'), S('⊥', 'bot', 'false'), S('⊢', 'vdash'), S('⊨', 'models'),
  ].map((s) => ({ ...s, cat: 'logic' as const })),

  /* calculus */
  ...[
    S('∫', 'int', 'int2'), S('∬', 'iint', 'iint2'), S('∭', 'iiint', 'iiint2'),
    S('∮', 'oint', 'oint2'), S('∂', 'partial', 'partial2'), S('∇', 'nabla', 'nabla2'),
    S('∞', 'infty', 'infty'), S('Δ', 'Delta', 'delta2'), S('ℓ', 'ell', 'ell'),
    S('∑', 'sum', 'sum2'), S('∏', 'prod', 'prod2'), S('lim', null, 'lim-word'),
  ].map((s) => ({ ...s, cat: 'calculus' as const })),

  /* geometry */
  ...[
    S('∠', 'angle', 'angle'), S('∡', 'measuredangle'), S('△', 'triangle'),
    S('□', 'square', 'square'), S('▱', null, 'parallelogram'), S('⊙', 'odot', 'circle'),
    S('⊥', 'perp', 'perp'), S('∥', 'parallel', 'parallel'), S('≅', 'cong', 'cong2'),
    S('∼', 'sim', 'sim2'), S('°', 'degree', 'degree'), S('′', 'prime', 'prime'),
    S('″', null, 'second'), S('⌒', null, 'arc'), S('≡', 'equiv', 'congruent'),
  ].map((s) => ({ ...s, cat: 'geometry' as const })),

  /* statistics */
  ...[
    S('x̄', null, 'xbar'), S('μ', 'mu', 'mean'), S('σ', 'sigma', 'stddev'),
    S('σ²', null, 'variance'), S('ρ', 'rho', 'corr'), S('Σ', 'Sigma', 'sum-sigma'),
    S('χ²', null, 'chisq'), S('β̂', null, 'betahat'), S('α̂', null, 'alphahat'),
    S('χ', 'chi', 'chi'), S('ν', 'nu', 'dof'), S('τ', 'tau', 'tau-stat'),
  ].map((s) => ({ ...s, cat: 'stats' as const })),

  /* probability */
  ...[
    S('ℙ', 'mathbb{P}', 'prob'), S('𝔼', 'mathbb{E}', 'expect'), S('Var', null, 'var-word'),
    S('Cov', null, 'cov-word'), S('~', 'sim', 'distributed'), S('≅', 'cong', 'dist-eq'),
    S('⟨', 'langle', 'langle'), S('⟩', 'rangle', 'rangle'),
  ].map((s) => ({ ...s, cat: 'probability' as const })),

  /* physics */
  ...[
    S('ℏ', 'hbar', 'hbar'), S('ħ', null, 'hbar2'), S('ℓ', 'ell', 'ell2'),
    S('∂', 'partial', 'partial3'), S('∇', 'nabla', 'nabla3'), S('∇²', null, 'laplacian'),
    S('ω', 'omega', 'omega-p'), S('Ω', 'Omega', 'ohm'), S('λ', 'lambda', 'wavelength'),
    S('μ₀', null, 'mu0'), S('ε₀', null, 'eps0'), S('Å', null, 'angstrom'),
    S('⇌', 'rightleftharpoons', 'equilibrium'), S('→', 'to', 'yields'),
  ].map((s) => ({ ...s, cat: 'physics' as const })),

  /* chemistry */
  ...[
    S('⇌', 'rightleftharpoons', 'equil2'), S('→', 'to', 'react'),
    S('↑', 'uparrow', 'gas-up'), S('↓', 'downarrow', 'ppt-down'),
    S('Δ', 'Delta', 'heat'), S('∘', 'circ', 'round'), S('°C', null, 'celsius'),
    S('ΔH', null, 'enthalpy'), S('⇒', 'Rightarrow', 'yield2'),
    S('⁺', null, 'sup-plus'), S('⁻', null, 'sup-minus'),
  ].map((s) => ({ ...s, cat: 'chemistry' as const })),

  /* special */
  ...[
    S('∞', 'infty', 'infty2'), S('∂', 'partial', 'partial4'), S('℘', 'wp'),
    S('ℑ', 'Im'), S('ℜ', 'Re'), S('aleph', null, 'aleph-word'),
    S('ℏ', 'hbar', 'hbar3'), S('♭', 'flat'), S('♮', 'natural'), S('♯', 'sharp'),
    S('†', 'dagger'), S('‡', 'ddagger'), S('§', 'S'), S('©', null, 'copyright'),
  ].map((s) => ({ ...s, cat: 'special' as const })),
];

/** symbols used by the parser: matches both \cmd and bare unicode char */
export function symbolForCommand(cmd: string): MathSymbol | undefined {
  return SYMBOLS.find((s) => s.cmd === cmd);
}
