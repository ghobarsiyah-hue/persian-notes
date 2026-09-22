/**
 * Color Token Registry — the ONE place colors are defined (§10/§12).
 *
 * Sources (project Wiki / design spec, NOT invented):
 *   • client/src/docs/vercel-design.md §2 — the ink ramp, ship/preview/
 *     develop accents and the petrol accent scale are THE project palette.
 *   • tailwind.config.ts mirrors the same hex values as Tailwind tokens.
 *   • editor highlight swatches were already these hues (THEME_COLORS in
 *     ColorPalette) — they now derive from here instead of being re-declared.
 *
 * Semantic tokens carry an optional dark-mode variant and a foreground that
 * preserves contrast (§13: never rely on color alone; keep the palette and
 * fix the text treatment instead).
 *
 * Future layers (user preferences, group/club themes) should RESOLVE to
 * these tokens — the editor/UI consumes only this registry, so a theme can
 * be swapped in one place without touching components.
 */

export interface ColorToken {
  /** semantic name — the only identifier components ever see */
  name: string;
  /** light-mode value */
  light: string;
  /** dark-mode value (defaults to light when identical) */
  dark: string;
  /** readable foreground for text/background pairs (contrast, §13) */
  fg: string;
  /** Persian display label (RTL-friendly UI) */
  label: string;
}

/* ── highlight family — the text-marker swatches (existing editor hues) ── */
export const HIGHLIGHT_TOKENS = {
  yellow: { name: 'highlight.yellow', light: '#fde68a', dark: '#78530b', fg: '#171717', label: 'زرد' },
  green: { name: 'highlight.green', light: '#bbf7d0', dark: '#14532d', fg: '#171717', label: 'سبز' },
  blue: { name: 'highlight.blue', light: '#bfdbfe', dark: '#1e3a8a', fg: '#171717', label: 'آبی' },
  pink: { name: 'highlight.pink', light: '#fbcfe8', dark: '#831843', fg: '#171717', label: 'صورتی' },
  purple: { name: 'highlight.purple', light: '#ddd6fe', dark: '#4c1d95', fg: '#171717', label: 'بنفش' },
  orange: { name: 'highlight.orange', light: '#fed7aa', dark: '#7c2d12', fg: '#171717', label: 'نارنجی' },
} as const satisfies Record<string, ColorToken>;

export type HighlightTokenName = keyof typeof HIGHLIGHT_TOKENS;

export const HIGHLIGHT_TOKEN_LIST: readonly ColorToken[] = Object.values(HIGHLIGHT_TOKENS);

/* ── system palette from the design spec (vercel-design.md §2) ──────────── */
export const SYSTEM_TOKENS = {
  ink900: { name: 'ink.900', light: '#171717', dark: '#171717', fg: '#ffffff', label: 'مشکی' },
  ink500: { name: 'ink.500', light: '#6f6f6f', dark: '#6f6f6f', fg: '#ffffff', label: 'خاکستری' },
  white: { name: 'surface.white', light: '#ffffff', dark: '#ffffff', fg: '#171717', label: 'سفید' },
  surface: { name: 'surface.50', light: '#fafafa', dark: '#fafafa', fg: '#171717', label: 'سطح' },
  ship: { name: 'status.ship', light: '#ff5b4f', dark: '#ff5b4f', fg: '#ffffff', label: 'قرمز' },
  preview: { name: 'status.preview', light: '#de1d8d', dark: '#de1d8d', fg: '#ffffff', label: 'سرخابی' },
  develop: { name: 'status.develop', light: '#0a72ef', dark: '#0a72ef', fg: '#ffffff', label: 'آبی' },
  petrol300: { name: 'accent.300', light: '#74b2c7', dark: '#74b2c7', fg: '#171717', label: 'آبی نفتی' },
  petrol500: { name: 'accent.500', light: '#1f7396', dark: '#1f7396', fg: '#ffffff', label: 'آبی نفتی پررنگ' },
  petrol700: { name: 'accent.700', light: '#114b64', dark: '#114b64', fg: '#ffffff', label: 'آبی نفتی تیره' },
  amber: { name: 'status.warning', light: '#d97706', dark: '#d97706', fg: '#ffffff', label: 'کهربایی' },
  gray: { name: 'ink.400', light: '#a3a3a3', dark: '#a3a3a3', fg: '#171717', label: 'نقره‌ای' },
  silver: { name: 'ink.300', light: '#d9d9d9', dark: '#d9d9d9', fg: '#171717', label: 'روشن' },
  teal: { name: 'accent.400', light: '#4490ad', dark: '#4490ad', fg: '#ffffff', label: 'فیروزه‌ای' },
  navy: { name: 'accent.600', light: '#175e7d', dark: '#175e7d', fg: '#ffffff', label: 'سرمه‌ای' },
} as const satisfies Record<string, ColorToken>;

export type SystemTokenName = keyof typeof SYSTEM_TOKENS;

export const SYSTEM_TOKEN_LIST: readonly ColorToken[] = Object.values(SYSTEM_TOKENS);

/* ── lookup / resolution ────────────────────────────────────────────────── */

const ALL: Record<string, ColorToken> = { ...HIGHLIGHT_TOKENS, ...SYSTEM_TOKENS } as Record<string, ColorToken>;

export function tokenByName(name: string): ColorToken | undefined {
  return ALL[name];
}

/** resolve a token to its current value (dark-mode aware).
 *  Raw hex values pass through untouched — existing documents that stored
 *  arbitrary colors keep rendering exactly as before (§11 compat). */
export function resolveToken(tokenOrHex: string, dark: boolean): string {
  const t = ALL[tokenOrHex];
  if (!t) return tokenOrHex;
  return dark ? t.dark : t.light;
}

/** foreground for a token (or the given hex's usual companion) */
export function tokenForeground(tokenOrHex: string): string {
  return ALL[tokenOrHex]?.fg ?? '#171717';
}

/** every highlight swatch as `{value,label}` rows for pickers */
export function highlightSwatchOptions(dark: boolean): Array<{ value: string; label: string }> {
  return HIGHLIGHT_TOKEN_LIST.map((t) => ({ value: dark ? t.dark : t.light, label: t.label }));
}
