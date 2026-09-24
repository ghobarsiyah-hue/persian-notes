import { useEffect, useMemo, useState } from 'react';
import { SidePanel, Button } from '@/components/ui';
import { useApp } from '@/store/AppProvider';
import { faDigits } from '@/utils/fa';
import type { EduBlocksSettings } from '@/types';
import {
  DEFAULT_EDU_BLOCKS,
  EDU_FAMILIES,
  EDU_PRESETS,
  FAMILY_LABEL,
  FAMILY_TINT_DEFAULT,
  FAMILY_TITLE_DEFAULT,
  tintHex,
  type EduFamily,
} from '@/utils/eduBlocks';
import { premiumSvg } from '@/components/editor/iconAssets';
import { MCQ_ICON_SVG } from '@/editor/extensions/blocks';

/* ────────────────────────────────────────────────────────────────────────
   شخصی‌سازی کادرهای آموزشی — the full customization studio.

   Tabs:
     • تم‌ها    — one-click presets (full objects, no stale overrides)
     • سبک کادر — base, border (width/style/color), radius, padding,
                  shadow, accent bar, title bar, title typography, icons
     • رنگ‌ها   — per-family fill / title / accent colors + reset-family
   Live preview renders real .edu-block markup on a paper sheet; every
   change is local draft state until «ذخیره».
   ──────────────────────────────────────────────────────────────────────── */

const PALETTE = [
  '#0070f3', '#175e7d', '#7928ca', '#b45309', '#dc2626', '#0a7d4f',
  '#c5a24d', '#1e3a5f', '#64748b', '#171717', '#f5a623', '#ef4444',
  '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#94a3b8',
];

/** mini inline SVG icon of a family (the same premium set blocks use) */
function FamilyIcon({ family, color, size = '0.85em' }: { family: EduFamily; color: string; size?: string }) {
  const raw = family === 'mcq' ? MCQ_ICON_SVG : premiumSvg(FAMILY_ICON_ID[family]);
  if (!raw) return null;
  const svg = raw.includes('currentColor')
    ? raw.replace(/currentColor/g, color)
    : raw.replace('<svg', `<svg fill="${color}"`);
  return (
    <span
      className="edu-title-icon"
      style={{ color }}
      dangerouslySetInnerHTML={{ __html: svg.replace(/width="1em" height="1em"/, `width="${size}" height="${size}"`) }}
    />
  );
}

const FAMILY_ICON_ID: Record<EduFamily, string> = {
  definition: 'book-open', important: 'lightbulb', exam: 'graduation-cap',
  warning: 'warning', summary: 'chart-bar', question: 'chat-circle-text',
  example: 'flask', keyterm: 'bookmark-simple', formula: 'math-operations',
  highlight: 'star', reference: 'book', footnote: 'note-pencil',
  truefalse: 'check-circle', mcq: 'mcq',
};

/* ── preview building blocks ─────────────────────────────────────────── */

function previewFill(settings: EduBlocksSettings, family: EduFamily): string | undefined {
  if (settings.base === 'minimal' || settings.tint === 'none') return undefined;
  const hex = settings.fillColors?.[family] || FAMILY_TINT_DEFAULT[family];
  const alpha = settings.tint === 'strong' ? 0.12 : 0.055;
  return tintHex(hex, alpha) || undefined;
}

function previewShadow(settings: EduBlocksSettings): string | undefined {
  if (settings.accentBar !== 'none') {
    const family = 'definition' as EduFamily;
    const c = settings.accentColors?.[family] || settings.titleColors?.[family] || FAMILY_TITLE_DEFAULT[family];
    const bar = `inset ${settings.accentBar === 'start' ? '-' : ''}3px 0 0 0 ${c}`;
    return settings.shadow === 'none' ? bar : `${bar}, 0 1px 3px rgba(0,0,0,0.07)`;
  }
  if (settings.shadow === 'soft') return '0 1px 3px rgba(0,0,0,0.07), 0 2px 8px rgba(0,0,0,0.05)';
  if (settings.shadow === 'raised') return '0 2px 4px rgba(0,0,0,0.1), 0 8px 20px rgba(0,0,0,0.09)';
  return settings.borderWidth === 0 ? 'inset 0 0 0 1px rgba(0,0,0,0.14)' : undefined;
}

function previewTitleBar(settings: EduBlocksSettings, family: EduFamily): React.CSSProperties | undefined {
  if (settings.titleBar === 'none') return undefined;
  const c = settings.titleColors?.[family] || FAMILY_TITLE_DEFAULT[family];
  const bg = tintHex(c, settings.titleBar === 'full' ? 0.1 : 0.06) || undefined;
  return settings.titleBar === 'full'
    ? { background: bg, borderRadius: 3, padding: '5px 10px', margin: '-2px -6px 0.4em -6px' }
    : { background: bg, borderRadius: 3, padding: '2px 8px', margin: '-2px -4px 0.3em -4px' };
}

/** one sample .edu-block rendered exactly like the editor renders it */
function PreviewBlock({ family, settings, showIcon }: { family: EduFamily; settings: EduBlocksSettings; showIcon: boolean }) {
  const titleColor = settings.titleColors?.[family] || FAMILY_TITLE_DEFAULT[family];
  const fill = previewFill(settings, family);
  const edge = settings.borderColor ? tintHex(settings.borderColor, 0.85) ?? 'rgba(0,0,0,0.14)' : 'rgba(0,0,0,0.14)';
  const hidden = settings.hideIcons?.[family] || !showIcon;

  return (
    <div
      className="edu-block"
      style={{
        border: settings.borderWidth === 0 ? 'none' : `${settings.borderWidth}px ${settings.borderStyle} ${edge}`,
        borderRadius: settings.radius,
        padding: settings.padding > 0 ? `${settings.padding}px ${Math.round(settings.padding * 1.5)}px` : undefined,
        boxShadow: previewShadow(settings),
        background: fill ?? 'transparent',
        margin: 0,
      }}
    >
      <div
        className="edu-title"
        style={{ fontWeight: settings.titleWeight, fontSize: `${settings.titleSize / 100}em`, color: titleColor, ...previewTitleBar(settings, family) }}
      >
        {!hidden && <FamilyIcon family={family} color={titleColor} />}
        <span className="edu-title-text">{FAMILY_LABEL[family]}</span>
      </div>
      <div className="text-[0.9em] leading-6 text-ink-600 dark:text-ink-300">
        متن نمونه کادر آموزشی — {FAMILY_LABEL[family]}
      </div>
    </div>
  );
}

/* ── generic controls ────────────────────────────────────────────────── */

function Slider({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  format?: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[13px] font-medium text-ink-700 dark:text-ink-300">
        {label}
        <span className="tabular-nums text-ink-500">{format ? format(value) : faDigits(value)}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink-200 accent-[#0070f3] dark:bg-ink-700"
      />
    </label>
  );
}

/** segmented control (بولد — چندگزینه‌ای کوچک) */
function Segmented<T extends string>({ label, value, options, onChange }: {
  label?: string; value: T; options: Array<{ value: T; label: string; title?: string }>; onChange: (v: T) => void;
}) {
  return (
    <div>
      {label && <span className="mb-1 block text-[13px] font-medium text-ink-700 dark:text-ink-300">{label}</span>}
      <div className="flex gap-1 rounded-lg bg-ink-100 p-1 dark:bg-ink-800">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`min-h-7 flex-1 rounded-md px-2 text-[12px] font-medium transition-colors ${
              value === o.value
                ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-950 dark:text-ink-100'
                : 'text-ink-500 hover:text-ink-800 dark:text-ink-400'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorSwatches({ value, onChange, allowClear = true }: { value: string | undefined; onChange: (hex: string | undefined) => void; allowClear?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allowClear && (
        <button
          type="button"
          title="پیش‌فرض"
          onClick={() => onChange(undefined)}
          className={`h-6 w-6 rounded-md border text-[10px] font-bold ${!value ? 'ring-2 ring-[#0070f3] ring-offset-1 dark:ring-offset-ink-900' : 'border-ink-200 dark:border-ink-700'}`}
          style={{ background: 'linear-gradient(135deg, #fff 45%, #e5e5e5 45%)' }}
        >
          {value ? '' : '✓'}
        </button>
      )}
      {PALETTE.map((hex) => (
        <button
          key={hex}
          type="button"
          title={hex}
          onClick={() => onChange(hex)}
          className={`h-6 w-6 rounded-md ${value === hex ? 'ring-2 ring-[#0070f3] ring-offset-1 dark:ring-offset-ink-900' : ''}`}
          style={{ background: hex }}
        />
      ))}
      <input
        type="color"
        value={value ?? '#0070f3'}
        onChange={(e) => onChange(e.target.value)}
        title="رنگ دلخواه"
        className="h-6 w-6 cursor-pointer rounded-md border border-ink-200 dark:border-ink-700"
      />
    </div>
  );
}

/* ── the modal ───────────────────────────────────────────────────────── */

type ModalTab = 'presets' | 'style' | 'colors' | 'icons';

export function EduBlocksModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, saveEduBlocks, toast } = useApp();
  const current = settings?.editor.eduBlocks;
  const initial = useMemo<EduBlocksSettings>(
    () => (current && typeof current === 'object' ? { ...DEFAULT_EDU_BLOCKS, ...current } : DEFAULT_EDU_BLOCKS),
    [current],
  );

  const [draft, setDraft] = useState<EduBlocksSettings>(initial);
  const [tab, setTab] = useState<ModalTab>('presets');
  const [activeFamily, setActiveFamily] = useState<EduFamily>('definition');
  const [activePreset, setActivePreset] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setDraft(initial); setTab('presets'); setActivePreset(''); }
  }, [open, initial]);

  const patch = (p: Partial<EduBlocksSettings>) => { setDraft((d) => ({ ...d, ...p })); setActivePreset(''); };
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const save = async () => {
    setBusy(true);
    try {
      await saveEduBlocks(draft);
      toast('شخصی‌سازی کادرهای آموزشی ذخیره شد.', 'success');
      onClose();
    } catch (e) {
      toast('ذخیره ناموفق بود: ' + (e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = (id: string) => {
    const preset = EDU_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setDraft(JSON.parse(JSON.stringify(preset.settings)) as EduBlocksSettings);
    setActivePreset(id);
  };

  const setFill = (hex: string | undefined) =>
    setDraft((d) => {
      const fills = { ...d.fillColors };
      if (hex) fills[activeFamily] = hex; else delete fills[activeFamily];
      return { ...d, fillColors: fills };
    });
  const setTitle = (hex: string | undefined) =>
    setDraft((d) => {
      const titles = { ...d.titleColors };
      if (hex) titles[activeFamily] = hex; else delete titles[activeFamily];
      return { ...d, titleColors: titles };
    });
  const setAccent = (hex: string | undefined) =>
    setDraft((d) => {
      const accents = { ...d.accentColors };
      if (hex) accents[activeFamily] = hex; else delete accents[activeFamily];
      return { ...d, accentColors: accents };
    });
  const toggleIcon = () =>
    setDraft((d) => {
      const hides = { ...d.hideIcons };
      if (hides[activeFamily]) delete hides[activeFamily];
      else hides[activeFamily] = true;
      return { ...d, hideIcons: hides };
    });
  const resetFamily = () =>
    setDraft((d) => {
      const drop = <T extends Record<string, unknown>>(o: T): T => {
        const c = { ...o };
        delete (c as Record<string, unknown>)[activeFamily];
        return c;
      };
      return { ...d, fillColors: drop(d.fillColors), titleColors: drop(d.titleColors), accentColors: drop(d.accentColors), hideIcons: drop(d.hideIcons) };
    });
  const familyIsReset = !draft.fillColors?.[activeFamily] && !draft.titleColors?.[activeFamily]
    && !draft.accentColors?.[activeFamily] && !draft.hideIcons?.[activeFamily];

  const TABS: Array<{ id: ModalTab; label: string }> = [
    { id: 'presets', label: 'تم‌ها' },
    { id: 'style', label: 'سبک کادر' },
    { id: 'colors', label: 'رنگ‌ها' },
    { id: 'icons', label: 'آیکون‌ها' },
  ];

  return (
    <SidePanel open={open} onClose={onClose} title="شخصی‌سازی کادرهای آموزشی">
      <div className="grid gap-5 md:grid-cols-[1fr_280px]">
        {/* ── controls ── */}
        <div className="space-y-4">
          <div className="flex gap-1 rounded-lg bg-ink-100 p-1 dark:bg-ink-800">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`min-h-8 flex-1 rounded-md px-2 text-[12.5px] font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-950 dark:text-ink-100'
                    : 'text-ink-500 hover:text-ink-800 dark:text-ink-400'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ═══ تم‌ها ═══ */}
          {tab === 'presets' && (
            <div className="grid grid-cols-2 gap-2">
              {EDU_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={`rounded-xl border p-3 text-right transition-all ${
                    activePreset === p.id
                      ? 'border-[#0070f3] bg-accent-50/60 dark:bg-accent-900/20'
                      : 'border-ink-200 hover:border-ink-300 dark:border-ink-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-ink-900 dark:text-ink-100">{p.label}</span>
                    <span className="flex gap-0.5">
                      {p.swatch.map((c, i) => (
                        <span key={i} className="h-3.5 w-3.5 rounded-full border border-black/10" style={{ background: c }} />
                      ))}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] leading-4 text-ink-500">{p.desc}</div>
                </button>
              ))}
              <p className="col-span-2 text-[11px] leading-4 text-ink-400">
                هر تم، همه تنظیمات را بازنویسی می‌کند — بعد از انتخاب می‌توانید در تب‌های بعدی جزئیات را تغییر دهید.
              </p>
            </div>
          )}

          {/* ═══ سبک کادر ═══ */}
          {tab === 'style' && (
            <div className="space-y-4">
              <Segmented
                label="حالت پایه"
                value={draft.base}
                onChange={(v) => patch({ base: v })}
                options={[
                  { value: 'minimal', label: 'حداقلی', title: 'خط ساده، بدون پس‌زمینه' },
                  { value: 'tinted', label: 'رنگی', title: 'پس‌زمینه ملایم' },
                  { value: 'strong', label: 'پررنگ', title: 'پس‌زمینه واضح' },
                ]}
              />

              <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                <Slider label="ضخامت خط" value={draft.borderWidth} min={0} max={4} step={0.5}
                  format={(v) => (v === 0 ? 'بدون خط' : faDigits(v))} onChange={(v) => patch({ borderWidth: v })} />
                <Slider label="گردی گوشه‌ها" value={draft.radius} min={0} max={24} step={1}
                  format={(v) => `${faDigits(v)} پیکسل`} onChange={(v) => patch({ radius: v })} />
                <Slider label="فاصله داخلی" value={draft.padding} min={0} max={24} step={1}
                  format={(v) => (v === 0 ? 'پیش‌فرض' : `${faDigits(v)} پیکسل`)} onChange={(v) => patch({ padding: v })} />
                <Slider label="اندازه عنوان" value={draft.titleSize} min={60} max={140} step={5}
                  format={(v) => `${faDigits(v)}٪`} onChange={(v) => patch({ titleSize: v })} />
              </div>

              <Segmented
                label="خط کادر"
                value={draft.borderStyle}
                onChange={(v) => patch({ borderStyle: v })}
                options={[
                  { value: 'solid', label: 'یکسره' },
                  { value: 'dashed', label: 'خط‌چین' },
                  { value: 'dotted', label: 'نقطه‌چین' },
                ]}
              />

              <div>
                <span className="mb-1.5 block text-[13px] font-medium text-ink-700 dark:text-ink-300">رنگ خط کادر</span>
                <ColorSwatches value={draft.borderColor || undefined} onChange={(hex) => patch({ borderColor: hex ?? '' })} />
              </div>

              <Segmented
                label="سایه"
                value={draft.shadow}
                onChange={(v) => patch({ shadow: v })}
                options={[
                  { value: 'none', label: 'بدون سایه' },
                  { value: 'soft', label: 'ملایم' },
                  { value: 'raised', label: 'برجسته' },
                ]}
              />

              <Segmented
                label="نوار رنگی لبه"
                value={draft.accentBar}
                onChange={(v) => patch({ accentBar: v })}
                options={[
                  { value: 'none', label: 'بدون' },
                  { value: 'start', label: 'راست' },
                  { value: 'end', label: 'چپ' },
                ]}
              />

              <Segmented
                label="نوار عنوان"
                value={draft.titleBar}
                onChange={(v) => patch({ titleBar: v })}
                options={[
                  { value: 'none', label: 'ساده' },
                  { value: 'soft', label: 'پس‌زمینه ملایم' },
                  { value: 'full', label: 'نوار پررنگ' },
                ]}
              />

              <div>
                <span className="mb-1 block text-[13px] font-medium text-ink-700 dark:text-ink-300">وزن عنوان</span>
                <div className="flex gap-1">
                  {[400, 500, 600, 700, 800].map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => patch({ titleWeight: w })}
                      className={`h-8 flex-1 rounded-md border text-[12px] transition-colors ${
                        draft.titleWeight === w
                          ? 'border-[#0070f3] bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
                          : 'border-ink-200 text-ink-500 hover:bg-ink-100 dark:border-ink-700 dark:hover:bg-ink-800'
                      }`}
                      style={{ fontWeight: w }}
                    >
                      {faDigits(w / 100)}۰۰
                    </button>
                  ))}
                </div>
              </div>

              {draft.base !== 'minimal' && (
                <Segmented
                  label="شدت رنگ پس‌زمینه"
                  value={draft.tint}
                  onChange={(v) => patch({ tint: v })}
                  options={[
                    { value: 'none', label: 'بدون رنگ' },
                    { value: 'soft', label: 'ملایم' },
                    { value: 'strong', label: 'پررنگ' },
                  ]}
                />
              )}
            </div>
          )}

          {/* ═══ رنگ‌ها ═══ */}
          {tab === 'colors' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {EDU_FAMILIES.map((f) => {
                  const customized = draft.fillColors?.[f] || draft.titleColors?.[f] || draft.accentColors?.[f];
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setActiveFamily(f)}
                      className={`flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors ${
                        activeFamily === f
                          ? 'border-[#0070f3] bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
                          : 'border-ink-200 text-ink-600 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800'
                      }`}
                    >
                      <FamilyIcon family={f} color={draft.titleColors?.[f] || FAMILY_TITLE_DEFAULT[f]} />
                      {FAMILY_LABEL[f]}
                      {customized && <span className="h-1.5 w-1.5 rounded-full bg-[#0070f3]" title="شخصی‌سازی‌شده" />}
                    </button>
                  );
                })}
              </div>

              <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-ink-900 dark:text-ink-100">{FAMILY_LABEL[activeFamily]}</span>
                  <button
                    type="button"
                    onClick={resetFamily}
                    disabled={familyIsReset}
                    className="rounded-md px-2 py-1 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    بازنشانی این کادر
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <span className="mb-1.5 block text-[12px] font-medium text-ink-600 dark:text-ink-400">رنگ عنوان</span>
                    <ColorSwatches value={draft.titleColors?.[activeFamily]} onChange={setTitle} />
                  </div>
                  {draft.base !== 'minimal' && (
                    <div>
                      <span className="mb-1.5 block text-[12px] font-medium text-ink-600 dark:text-ink-400">رنگ پس‌زمینه</span>
                      <ColorSwatches value={draft.fillColors?.[activeFamily]} onChange={setFill} />
                    </div>
                  )}
                  {draft.accentBar !== 'none' && (
                    <div>
                      <span className="mb-1.5 block text-[12px] font-medium text-ink-600 dark:text-ink-400">
                        رنگ نوار لبه <span className="text-ink-400">(خالی = هم‌رنگ عنوان)</span>
                      </span>
                      <ColorSwatches value={draft.accentColors?.[activeFamily]} onChange={setAccent} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ═══ آیکون‌ها ═══ */}
          {tab === 'icons' && (
            <div className="space-y-4">
              <Segmented
                label="آیکون عنوان‌ها"
                value={draft.iconsVisible ? 'on' : 'off'}
                onChange={(v) => patch({ iconsVisible: v === 'on' })}
                options={[
                  { value: 'on', label: 'نمایش آیکون‌ها' },
                  { value: 'off', label: 'بدون آیکون' },
                ]}
              />
              {draft.iconsVisible && (
                <div className="grid grid-cols-3 gap-1.5">
                  {EDU_FAMILIES.map((f) => {
                    const hidden = !!draft.hideIcons?.[f];
                    const color = draft.titleColors?.[f] || FAMILY_TITLE_DEFAULT[f];
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => { setActiveFamily(f); toggleIcon(); }}
                        title={hidden ? 'آیکون مخفی است — کلیک: نمایش' : 'آیکون نمایان است — کلیک: مخفی'}
                        className={`flex flex-col items-center gap-1 rounded-lg border p-2 transition-colors ${
                          hidden
                            ? 'border-ink-100 opacity-40 dark:border-ink-800'
                            : 'border-ink-200 hover:border-ink-300 dark:border-ink-700'
                        }`}
                      >
                        <span className="text-lg" style={{ color }}>
                          <FamilyIcon family={f} color={color} size="1.1em" />
                        </span>
                        <span className="text-[10.5px] font-medium text-ink-600 dark:text-ink-300">{FAMILY_LABEL[f]}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {draft.iconsVisible && (
                <p className="text-[11px] leading-4 text-ink-400">
                  روی هر کادر کلیک کنید تا آیکونش مخفی/نمایان شود — مفید برای جزوه‌های چاپی یا سبک‌های رسمی.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── live preview ── */}
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink-700 dark:text-ink-300">پیش‌نمایش زنده</div>
          <div className="edu-preview space-y-3 rounded-xl bg-white p-4 shadow-inner ring-1 ring-ink-100 dark:bg-ink-950 dark:ring-ink-800">
            {EDU_FAMILIES.filter((f) => f !== 'formula').map((f) => (
              <PreviewBlock key={f} family={f} settings={draft} showIcon={draft.iconsVisible} />
            ))}
            <button
              type="button"
              onClick={() => { setDraft({ ...DEFAULT_EDU_BLOCKS, fillColors: {}, titleColors: {}, accentColors: {}, hideIcons: {} }); setActivePreset('default'); }}
              className="mt-1 w-full rounded-lg border border-dashed border-ink-300 py-2 text-[12px] font-medium text-ink-500 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-900"
            >
              بازنشانی به پیش‌فرض
            </button>
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="mt-5 flex items-center justify-between border-t border-ink-100 pt-4 dark:border-ink-800">
        <span className="text-[12px] text-ink-500">
          {dirty ? 'تغییرات ذخیره نشده' : 'هماهنگ با تنظیمات فعلی'} — استایل در چاپ و PDF هم اعمال می‌شود.
        </span>
        <div className="flex gap-2.5">
          <Button variant="secondary" onClick={onClose}>انصراف</Button>
          <Button disabled={!dirty || busy} onClick={() => void save()}>
            ذخیره
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}
