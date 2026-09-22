import type { EduBlocksSettings } from '@/types';

/**
 * کادرهای آموزشی — shared resolution + CSS generation.
 *
 * The editor (index.css), the print preview and the PDF/Word export must all
 * render the SAME block styling, so the rules are generated from ONE place:
 * `eduBlocksCss()` emits a scoped stylesheet consumed by:
 *   - EditorPage (light + `.dark` variants, injected over the document pages)
 *   - printCss() (light only, inlined into the standalone print document)
 * Legacy settings that carry the old 'minimal' | 'tinted' string are
 * migrated by resolveEduBlocks().
 *
 * Non-customized values intentionally REPRODUCE the shipped index.css
 * palette (same alphas per family) so a fresh user's export stays
 * pixel-identical to the pre-customization output.
 */

/** the customizable block families — key → human label */
export const EDU_FAMILIES = [
  'definition', 'important', 'exam', 'warning', 'summary', 'question',
  'example', 'keyterm', 'formula', 'highlight', 'reference', 'footnote',
  'truefalse', 'mcq',
] as const;

export type EduFamily = (typeof EDU_FAMILIES)[number];

/** CSS classes the families map to (index.css block classes) */
export const FAMILY_CLASS: Record<EduFamily, string> = {
  definition: 'edu-definition',
  important: 'edu-important',
  exam: 'edu-exam',
  warning: 'edu-warning',
  summary: 'edu-summary',
  question: 'edu-question',
  example: 'edu-example',
  keyterm: 'edu-keyterm',
  formula: 'edu-formula',
  highlight: 'edu-highlight',
  reference: 'edu-reference',
  footnote: 'edu-footnote',
  truefalse: 'edu-truefalse',
  mcq: 'edu-mcq',
};

/** Persian labels for the customization modal */
export const FAMILY_LABEL: Record<EduFamily, string> = {
  definition: 'تعریف',
  important: 'نکته مهم',
  exam: 'نکته امتحانی',
  warning: 'توجه',
  summary: 'خلاصه',
  question: 'سوال',
  example: 'مثال',
  keyterm: 'اصطلاح کلیدی',
  formula: 'فرمول',
  highlight: 'جعبه برجسته',
  reference: 'منبع',
  footnote: 'پاورقی',
  truefalse: 'درست / نادرست',
  mcq: 'چهارگزینه‌ای',
};

export const DEFAULT_EDU_BLOCKS: EduBlocksSettings = {
  base: 'minimal',
  borderColor: '',
  borderWidth: 1.5,
  borderStyle: 'solid',
  radius: 4,
  padding: 0,
  shadow: 'none',
  accentBar: 'none',
  titleBar: 'none',
  titleWeight: 600,
  titleSize: 90,
  iconsVisible: true,
  tint: 'soft',
  fillColors: {},
  titleColors: {},
  accentColors: {},
  hideIcons: {},
};

/**
 * Preset themes — complete EduBlocksSettings the user can apply in one
 * click from the modal's گالری تم. Each is a full object (no partials)
 * so applying a preset can never leave stale per-family overrides.
 */
export const EDU_PRESETS: Array<{ id: string; label: string; desc: string; swatch: string[]; settings: EduBlocksSettings }> = [
  {
    id: 'default',
    label: 'پیش‌فرض',
    desc: 'خط ظریف، بدون پس‌زمینه — سبک اصلی برنامه',
    swatch: ['#1e3a5f', '#ffffff', '#0070f3'],
    settings: { ...DEFAULT_EDU_BLOCKS },
  },
  {
    id: 'pastel',
    label: 'پاستیلی',
    desc: 'پس‌زمینه رنگی ملایم با گوشه‌های گرد',
    swatch: ['#dbeafe', '#fce7f3', '#fde68a'],
    settings: {
      ...DEFAULT_EDU_BLOCKS,
      base: 'tinted', radius: 12, titleBar: 'soft',
      fillColors: { definition: '#3b82f6', question: '#8b5cf6', keyterm: '#8b5cf6', warning: '#ef4444', important: '#f59e0b', highlight: '#f59e0b' },
    },
  },
  {
    id: 'accent',
    label: 'نوار رنگی',
    desc: 'نوار رنگی عمودی در لبه هر کادر',
    swatch: ['#0070f3', '#7928ca', '#ef4444'],
    settings: { ...DEFAULT_EDU_BLOCKS, accentBar: 'start', shadow: 'soft', radius: 8 },
  },
  {
    id: 'exam',
    label: 'امتحانی',
    desc: 'نوار عنوان پررنگ — مناسب برگه و جزوه امتحانی',
    swatch: ['#175e7d', '#b45309', '#dc2626'],
    settings: { ...DEFAULT_EDU_BLOCKS, base: 'tinted', tint: 'strong', titleBar: 'full', titleWeight: 700, radius: 6 },
  },
  {
    id: 'notebook',
    label: 'دفترچه‌ای',
    desc: 'خط‌چین با رنگ‌های شاد و سایه نرم',
    swatch: ['#f59e0b', '#10b981', '#3b82f6'],
    settings: {
      ...DEFAULT_EDU_BLOCKS,
      base: 'tinted', borderStyle: 'dashed', borderColor: '#94a3b8', radius: 10, shadow: 'soft', titleBar: 'soft',
      fillColors: { definition: '#10b981', summary: '#10b981', example: '#f59e0b', highlight: '#f59e0b', question: '#3b82f6' },
    },
  },
  {
    id: 'print',
    label: 'چاپی',
    desc: 'بدون رنگ و سایه — کم‌مصرف در جوهر چاپ',
    swatch: ['#e5e5e5', '#f5f5f5', '#171717'],
    settings: { ...DEFAULT_EDU_BLOCKS, base: 'minimal', borderStyle: 'solid', borderWidth: 1, iconsVisible: false, titleWeight: 700 },
  },
  {
    id: 'dark-ink',
    label: 'مرکبی',
    desc: 'کادر پررنگ سرمه‌ای با عنوان درشت',
    swatch: ['#1e3a5f', '#c5a24d', '#ffffff'],
    settings: { ...DEFAULT_EDU_BLOCKS, borderColor: '#1e3a5f', borderWidth: 2, titleWeight: 800, titleSize: 100, shadow: 'soft' },
  },
  {
    id: 'minimal-plus',
    label: 'مینیمال+',
    desc: 'مینیمال با گوشه‌های کاملاً گرد و بدون خط کناری',
    swatch: ['#f4f4f5', '#e4e4e7', '#a1a1aa'],
    settings: { ...DEFAULT_EDU_BLOCKS, borderWidth: 0, radius: 16, titleBar: 'soft', shadow: 'soft' },
  },
];

/** legacy 'minimal' | 'tinted' string → EduBlocksSettings (null when already modern / unset) */
export function resolveEduBlocks(raw: unknown): EduBlocksSettings | null {
  if (raw && typeof raw === 'object') {
    /* forward-compat: merge in fields added later so an older saved object
       never leaves the generator reading undefined */
    return { ...DEFAULT_EDU_BLOCKS, ...(raw as EduBlocksSettings) };
  }
  if (raw === 'minimal') return { ...DEFAULT_EDU_BLOCKS, base: 'minimal' };
  if (raw === 'tinted') return { ...DEFAULT_EDU_BLOCKS, base: 'tinted' };
  return null;
}

export function isTinted(s: EduBlocksSettings): boolean {
  return s.base !== 'minimal';
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** hex → rgba() string (for dark mode / paper show-through) */
function rgba(hex: string, alpha: number): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/** mix `hex` over white at `alpha` (0..1) → solid rgb() usable in print too */
export function tintHex(hex: string, alpha: number): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const mix = (c: number) => Math.round(c * alpha + 255 * (1 - alpha));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/** shipped default tint per family (the minimal-design palette) */
export const FAMILY_TINT_DEFAULT: Record<EduFamily, string> = {
  definition: '#0070f3',
  important: '#f5a623',
  exam: '#1f7396',
  warning: '#ef4444',
  summary: '#0070f3',
  question: '#7928ca',
  example: '#1f7396',
  keyterm: '#7928ca',
  formula: '#0070f3',
  highlight: '#f5a623',
  reference: '#7928ca',
  footnote: '#1f7396',
  truefalse: '#1f7396',
  mcq: '#7928ca',
};

/** shipped default title color per family (index.css light theme) */
export const FAMILY_TITLE_DEFAULT: Record<EduFamily, string> = {
  definition: '#0070f3',
  important: '#b45309',
  exam: '#175e7d',
  warning: '#dc2626',
  summary: '#0070f3',
  question: '#7928ca',
  example: '#175e7d',
  keyterm: '#7928ca',
  formula: '#0070f3',
  highlight: '#b45309',
  reference: '#7928ca',
  footnote: '#175e7d',
  truefalse: '#175e7d',
  mcq: '#7928ca',
};

/** EXACT light-theme fill alphas of index.css `.edu-tinted` (shipped look) */
const TINT_ALPHA_LIGHT: Record<EduFamily, number> = {
  definition: 0.04, important: 0.06, exam: 0.06, warning: 0.05,
  summary: 0.04, question: 0.05, example: 0.05, keyterm: 0.05,
  formula: 0.03, highlight: 0.06, reference: 0.04, footnote: 0.04,
  truefalse: 0.05, mcq: 0.04,
};

/** EXACT dark-theme fill alphas of index.css `.dark .edu-tinted` */
const TINT_ALPHA_DARK: Record<EduFamily, number> = {
  definition: 0.08, important: 0.08, exam: 0.08, warning: 0.08,
  summary: 0.08, question: 0.08, example: 0.08, keyterm: 0.08,
  formula: 0.06, highlight: 0.08, reference: 0.06, footnote: 0.06,
  truefalse: 0.07, mcq: 0.06,
};

/** multiplies the shipped alphas for the «پررنگ» strength */
const STRONG_MULT = 2;

/** effective fill alpha for one family */
function fillAlpha(family: EduFamily, tint: EduBlocksSettings['tint'], dark: boolean): number {
  if (tint === 'none') return 0;
  const base = dark ? TINT_ALPHA_DARK[family] : TINT_ALPHA_LIGHT[family];
  return tint === 'strong' ? Math.min(0.2, base * STRONG_MULT) : base;
}

/** effective border/hairline color for the current mode */
function edgeColor(settings: EduBlocksSettings, dark: boolean): string {
  const custom = (settings.borderColor || '').trim();
  if (custom && hexToRgb(custom)) return rgba(custom, dark ? 0.55 : 0.85)!;
  return dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.14)';
}

/** title accent color for one family (user override → shipped default) */
function titleColorOf(f: EduFamily, settings: EduBlocksSettings): string {
  return settings.titleColors?.[f] || FAMILY_TITLE_DEFAULT[f];
}

/** accent-bar color for one family (explicit accent → title color) */
function accentColorOf(f: EduFamily, settings: EduBlocksSettings): string {
  return settings.accentColors?.[f] || titleColorOf(f, settings);
}

/**
 * Generate the scoped stylesheet.
 *
 * @param prefix  CSS scope — e.g. '.document-pages' for the editor,
 *                '.pn-sheet-content' for the print/export document.
 *                Empty string = unscoped (plain .edu-* selectors).
 * @param dark    emit the dark-paper variants (in-app dark theme).
 *                Print/PDF paper is always white → use light there.
 */
export function eduBlocksCss(
  settings: EduBlocksSettings,
  opts: { prefix?: string; dark?: boolean } = {},
): string {
  const { prefix = '', dark = false } = opts;
  const p = prefix ? `${prefix} ` : '';
  const rules: string[] = [];
  const edge = edgeColor(settings, dark);

  /* ── base geometry + border (same values both modes; colors differ) ── */
  const borderChanged =
    settings.borderWidth !== DEFAULT_EDU_BLOCKS.borderWidth ||
    settings.borderStyle !== DEFAULT_EDU_BLOCKS.borderStyle ||
    ((settings.borderColor || '').trim() !== '' && !!hexToRgb(settings.borderColor));
  if (borderChanged) {
    const style = settings.borderWidth === 0 ? 'none' : settings.borderStyle;
    rules.push(
      `${p}.edu-block { border: ${settings.borderWidth}px ${style} ${edge}; }`,
    );
  }
  if (settings.borderWidth === 0) {
    rules.push(`${p}.edu-block { box-shadow: inset 0 0 0 1px ${edge}; }`);
  }
  if (settings.radius !== DEFAULT_EDU_BLOCKS.radius) {
    rules.push(`${p}.edu-block { border-radius: ${settings.radius}px; }`);
  }
  if (settings.padding > 0) {
    rules.push(`${p}.edu-block { padding: ${settings.padding}px ${Math.round(settings.padding * 1.5)}px; }`);
  }

  /* ── box shadow ── */
  if (settings.shadow === 'soft') {
    rules.push(`${p}.edu-block { box-shadow: 0 1px 3px rgba(0,0,0,${dark ? 0.5 : 0.07}), 0 2px 8px rgba(0,0,0,${dark ? 0.4 : 0.05}); }`);
  } else if (settings.shadow === 'raised') {
    rules.push(`${p}.edu-block { box-shadow: 0 2px 4px rgba(0,0,0,${dark ? 0.55 : 0.1}), 0 8px 20px rgba(0,0,0,${dark ? 0.45 : 0.09}); }`);
  }
  /* border-width 0 pushes the hairline inset above — combine with shadow */
  if (settings.borderWidth === 0 && settings.shadow !== 'none') {
    rules.push(
      `${p}.edu-block { box-shadow: inset 0 0 0 1px ${edge}, ${settings.shadow === 'soft'
        ? `0 1px 3px rgba(0,0,0,${dark ? 0.5 : 0.07})`
        : `0 2px 4px rgba(0,0,0,${dark ? 0.55 : 0.1})`}; }`,
    );
  }

  /* ── title typography ── */
  if (settings.titleWeight !== DEFAULT_EDU_BLOCKS.titleWeight || settings.titleSize !== DEFAULT_EDU_BLOCKS.titleSize) {
    rules.push(
      `${p}.edu-title { font-weight: ${settings.titleWeight}; font-size: ${(settings.titleSize / 100).toFixed(2)}em; }`,
    );
  }

  /* ── title bar (soft wash / full colored band behind the title) ── */
  if (settings.titleBar === 'soft') {
    for (const f of EDU_FAMILIES) {
      const c = titleColorOf(f, settings);
      const bg = dark ? rgba(c, 0.12) : tintHex(c, 0.06);
      if (bg) rules.push(`${p}.${FAMILY_CLASS[f]} .edu-title { background: ${bg}; border-radius: 3px; padding: 2px 8px; margin: -2px -4px 0.3em -4px; }`);
    }
  } else if (settings.titleBar === 'full') {
    for (const f of EDU_FAMILIES) {
      const c = titleColorOf(f, settings);
      const bg = dark ? rgba(c, 0.16) : tintHex(c, 0.1);
      if (bg) rules.push(`${p}.${FAMILY_CLASS[f]} .edu-title { background: ${bg}; border-radius: 3px; padding: 5px 10px; margin: -2px -6px 0.4em -6px; }`);
    }
  }

  /* ── accent bar — colored inset ring on one edge of every family box ── */
  if (settings.accentBar !== 'none') {
    for (const f of EDU_FAMILIES) {
      const c = accentColorOf(f, settings);
      const side = settings.accentBar === 'start' ? 'right' : 'left'; /* RTL start = راست */
      const alpha = dark ? 0.65 : 0.8;
      rules.push(
        `${p}.${FAMILY_CLASS[f]} { box-shadow: inset ${settings.accentBar === 'start' ? '-' : ''}3px 0 0 0 ${rgba(c, alpha) ?? c}; }`,
      );
      /* keep the documented side for clarity in generated CSS comments */
      void side;
    }
  }
  /* accent bar + box shadow can coexist: accent wins the inset layer */
  if (settings.accentBar !== 'none' && settings.shadow !== 'none') {
    const shadow = settings.shadow === 'soft'
      ? `0 1px 3px rgba(0,0,0,${dark ? 0.5 : 0.07}), 0 2px 8px rgba(0,0,0,${dark ? 0.4 : 0.05})`
      : `0 2px 4px rgba(0,0,0,${dark ? 0.55 : 0.1}), 0 8px 20px rgba(0,0,0,${dark ? 0.45 : 0.09})`;
    const last = rules.pop(); /* drop the accent-only rule we just emitted */
    void last;
    for (const f of EDU_FAMILIES) {
      const c = accentColorOf(f, settings);
      const bar = `inset ${settings.accentBar === 'start' ? '-' : ''}3px 0 0 0 ${rgba(c, dark ? 0.65 : 0.8) ?? c}`;
      rules.push(`${p}.${FAMILY_CLASS[f]} { box-shadow: ${bar}, ${shadow}; }`);
    }
  }

  /* ── icon visibility ── */
  if (!settings.iconsVisible) {
    rules.push(`${p}.edu-title-icon { display: none; }`);
  }

  /* ── fills: only when a tinted base is active (minimal = index.css default) ── */
  if (isTinted(settings)) {
    for (const f of EDU_FAMILIES) {
      const cls = FAMILY_CLASS[f];
      const hex = settings.fillColors?.[f] || FAMILY_TINT_DEFAULT[f];
      const alpha = fillAlpha(f, settings.tint, dark);
      if (alpha <= 0) continue;
      const bg = dark ? rgba(hex, alpha) : tintHex(hex, alpha);
      if (bg) rules.push(`${p}.${cls} { background: ${bg}; }`);
    }
  }

  /* ── per-family title colors: ONLY customized families (defaults keep
     the index.css rules, including their dark variants) ── */
  for (const f of EDU_FAMILIES) {
    const user = settings.titleColors?.[f];
    if (user && hexToRgb(user)) rules.push(`${p}.${FAMILY_CLASS[f]} .edu-title { color: ${user}; }`);
  }
  /* ...but title-bar/accent-bar washes re-tint un-customized families too —
     emit those colors explicitly so the wash matches each family's hue */
  if (settings.titleBar !== 'none' || settings.accentBar !== 'none') {
    for (const f of EDU_FAMILIES) {
      if (settings.titleColors?.[f]) continue; /* already emitted above */
      rules.push(`${p}.${FAMILY_CLASS[f]} .edu-title { color: ${titleColorOf(f, settings)}; }`);
    }
  }

  /* ── per-family hidden icons ── */
  const hidden = EDU_FAMILIES.filter((f) => settings.hideIcons?.[f]);
  if (hidden.length) {
    rules.push(
      hidden.map((f) => `${p}.${FAMILY_CLASS[f]} .edu-title-icon`).join(', ') + ' { display: none; }',
    );
  }

  return rules.join('\n');
}
