import {
  Trash2, Copy, Maximize2, Minus, Plus, Type, StickyNote, Image as ImageIcon, Square, Circle,
  Palette, AlignRight, AlignCenter, AlignLeft, AlignJustify, Wand2, ArrowRight, MessageSquare,
} from 'lucide-react';
import type { ContextualTool } from '../types';
import { h4 } from '../icons';
import type { FloatingElement } from '@/components/editor/FloatingLayer';
import {
  type ContextProvider, type SelectableObject, type ObjectCapabilities,
  type ContextualTab, type ContextualGroup, type ContextualAction,
} from '../types';
import {
  FILL_PALETTE, BORDER_PALETTE, TEXT_PALETTE, STICKY_PALETTE,
  FONT_FAMILIES, FONT_SIZES, BORDER_STYLES, IMAGE_FILTERS,
  FLOAT_PRESETS, applyFloatPreset, SHAPE_TYPES,
} from '@/editor/floatStyle';

/* ══════════════════════════════════════════════════════════════════════════
   Floating context — shapes (rect/ellipse/diamond), text boxes, sticky notes
   and floating images. Selected via the FloatingLayer → selection store
   bridge; every command writes through the FloatingLayer's onChange (the
   real floating state, persisted with the note and included in print/PDF).

   Formatting model (Batch D): object-type-aware tool groups + rich
   appearance/text/image panels modeled on the EduBlock customization modal
   (same palettes, same slider language, same live-preview pattern). Every
   patch commits immediately (live preview, §10) through the real list state
   — no Apply workflow, no full-document serialization.
   ══════════════════════════════════════════════════════════════════════════ */

export const FLOAT_CONTEXT_ID = 'context.floating';

/** attrs published by the FloatingLayer for a selected floating object. */
export interface FloatAttrs extends Record<string, unknown> {
  element: FloatingElement;
  pageId: string;
  /** usable content box of the owning page (page-local px) — for alignment */
  usable: { w: number; h: number };
  patch: (patch: Partial<FloatingElement>) => void;
  remove: () => void;
  duplicate: () => void;
  all: FloatingElement[];
  bringToFront: () => void;
  sendToBack: () => void;
}

const isShape = (t: string) => t === 'rect' || t === 'ellipse' || t === 'diamond';
const isTextual = (t: string) => t === 'textBox' || t === 'sticky';

/** family label for the tab strip / multi-select chip */
export function floatLabel(type: string): string {
  if (type === 'textBox') return 'جعبه متن'; /* legacy objects only */
  if (type === 'sticky') return 'یادداشت';
  if (type === 'image') return 'تصویر شناور';
  if (type === 'rect') return 'مستطیل';
  if (type === 'roundedRect') return 'مستطیل گرد';
  if (type === 'circle') return 'دایره';
  if (type === 'ellipse') return 'بیضی';
  if (type === 'diamond') return 'لوزی';
  if (type === 'arrow') return 'فلش';
  if (type === 'callout') return 'حباب گفتار';
  return 'شکل';
}

export function floatIcon(type: string) {
  const cls = 'h-4 w-4';
  if (type === 'textBox') return <Type className={cls} />;
  if (type === 'sticky') return <StickyNote className={cls} />;
  if (type === 'image') return <ImageIcon className={cls} />;
  if (type === 'circle' || type === 'ellipse') return <Circle className={cls} />;
  if (type === 'diamond') return <Square className={`${cls} rotate-45`} />;
  if (type === 'arrow') return <ArrowRight className={cls} />;
  if (type === 'callout') return <MessageSquare className={cls} />;
  return <Square className={cls} />;
}

function patchAction(
  key: string, title: string, icon: React.ReactNode, label: string | undefined,
  obj: SelectableObject, patch: Partial<FloatingElement>,
): ContextualAction {
  const a = obj.attrs as FloatAttrs;
  return { key, title, icon, label, run: () => a.patch(patch) };
}

function capabilities(obj: SelectableObject): ObjectCapabilities {
  const t = obj.type;
  const isImg = t === 'image';
  const shape = isShape(t);
  return {
    canMove: true,
    canResize: true,
    canRotate: true,
    canChangeBackground: !isImg,
    canChangeColor: isTextual(t),
    canChangeFont: isTextual(t),
    canChangeBorder: shape || isTextual(t),
    canChangeOpacity: true,
    canChangeSpacing: isTextual(t),
    canChangeLayout: true,
    canAlign: true,
    canDuplicate: true,
    canDelete: true,
    canChangePosition: true,
    'float:text': isTextual(t),
    'float:image': isImg,
    'float:shape': shape,
  };
}

/* ── shared panel primitives (EduBlock modal design language) ─────────── */

function Swatches({ value, colors, defaultLabel, onPick }: {
  value: string; colors: string[]; defaultLabel: string; onPick: (c: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {colors.map((c, i) => (
        <button
          key={i}
          type="button"
          title={c === '' ? defaultLabel : c}
          onClick={() => onPick(c)}
          className={`h-6 w-6 rounded-md border ${c === '' ? 'border-dashed border-ink-400 text-[9px] font-bold text-ink-500' : 'border-black/10'} ${value === c ? 'ring-2 ring-[#0070f3] ring-offset-1 dark:ring-offset-ink-900' : ''}`}
          style={{ background: c === '' ? 'repeating-linear-gradient(45deg,#fff 0 3px,#eee 3px 6px)' : c }}
        >
          {c === '' ? '✓' : ''}
        </button>
      ))}
      <input
        type="color"
        title="رنگ دلخواه"
        className="h-6 w-6 cursor-pointer rounded-md border border-ink-200 dark:border-ink-700"
        onChange={(e) => onPick(e.target.value)}
      />
    </div>
  );
}

function Slider({ label, display, min, max, step, value, onChange }: {
  label: string; display: string; min: number; max: number; step: number;
  value: number; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-[12px] font-medium text-ink-600 dark:text-ink-400">
        {label}
        <span className="tabular-nums text-ink-500">{display}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink-200 accent-[#0070f3] dark:bg-ink-700"
      />
    </label>
  );
}

function SegButtons<T extends string | number>({ value, options, onPick, render }: {
  value: T;
  options: Array<{ value: T; label?: string; title?: string; node?: React.ReactNode }>;
  onPick: (v: T) => void;
  render?: (o: { value: T; label?: string; node?: React.ReactNode }) => React.ReactNode;
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={String(o.value)}
            type="button"
            title={o.title ?? o.label}
            onClick={() => onPick(o.value)}
            className={`flex h-8 flex-1 items-center justify-center rounded-md border px-1.5 text-[11px] transition-colors ${
              active
                ? 'border-[#0070f3] bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
                : 'border-ink-200 text-ink-500 dark:border-ink-700'
            }`}
          >
            {render ? render(o) : (o.node ?? o.label)}
          </button>
        );
      })}
    </div>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
      <h3 className="mb-2.5 text-[13px] font-bold text-ink-900 dark:text-ink-100">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function FontSelect({ value, onPick }: { value: string; onPick: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onPick(e.target.value)}
      className="h-8 w-full rounded-md border border-ink-200 bg-white px-2 text-[12px] outline-none focus:border-[#0070f3] dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
    >
      {FONT_FAMILIES.map((f) => (
        <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
      ))}
    </select>
  );
}

/* ── live-preview mini replicas ─────────────────────────────────────────── */

function AppearancePreview({ el }: { el: FloatingElement }) {
  return (
    <div className="flex min-h-[64px] items-center justify-center rounded-xl bg-white p-4 shadow-inner ring-1 ring-ink-100 dark:bg-ink-950 dark:ring-ink-800">
      <div
        style={{
          width: 96, height: 56,
          background: el.bgColor,
          border: el.borderWidth > 0 ? `${el.borderWidth}px ${el.borderColorStyle || 'solid'} ${el.borderColor}` : 'none',
          borderRadius: el.type === 'ellipse' ? '50%' : el.borderRadius,
          opacity: el.opacity ?? 1,
          boxShadow: el.shadow ? '0 4px 10px rgba(0,0,0,0.2)' : 'none',
        }}
      />
    </div>
  );
}

function TextPreview({ el }: { el: FloatingElement }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-inner ring-1 ring-ink-100 dark:bg-ink-950 dark:ring-ink-800">
      <div
        dir={el.direction ?? 'rtl'}
        style={{
          background: el.bgColor,
          border: el.borderWidth > 0 ? `${el.borderWidth}px ${el.borderColorStyle || 'solid'} ${el.borderColor}` : 'none',
          borderRadius: el.borderRadius,
          opacity: el.opacity ?? 1,
          fontFamily: el.fontFamily,
          fontSize: Math.min(18, el.fontSize),
          fontWeight: el.fontWeight ?? 400,
          fontStyle: el.italic ? 'italic' : undefined,
          textDecoration: el.underline ? 'underline' : undefined,
          color: el.fontColor,
          lineHeight: el.lineHeight ?? 1.7,
          letterSpacing: (el.letterSpacing ?? 0) + 'px',
          padding: el.padding ?? 10,
          textAlign: el.hAlign ?? 'right',
        }}
      >
        نمونهٔ متن فارسی
      </div>
    </div>
  );
}

function ImagePreview({ el }: { el: FloatingElement }) {
  return (
    <div className="flex min-h-[64px] items-center justify-center rounded-xl bg-white p-4 shadow-inner ring-1 ring-ink-100 dark:bg-ink-950 dark:ring-ink-800">
      {el.src ? (
        <img
          src={el.src}
          alt=""
          style={{
            width: 96, height: 56,
            objectFit: el.objectFit ?? 'fill',
            borderRadius: el.borderRadius || 0,
            filter: el.filter || undefined,
            opacity: el.opacity ?? 1,
            transform: el.flip === 'h' ? 'scaleX(-1)' : el.flip === 'v' ? 'scaleY(-1)' : el.flip === 'hv' ? 'scale(-1,-1)' : undefined,
          }}
        />
      ) : (
        <div className="text-[11px] text-ink-400">بدون تصویر</div>
      )}
    </div>
  );
}

/* ── dropdown panels ────────────────────────────────────────────────────── */

function appearancePanel(a: FloatAttrs): ContextualTool {
  const el = a.element;
  return {
    key: 'float.panel.appearance',
    title: 'ظاهر (پر کردن، خط، سایه، شفافیت)',
    label: 'ظاهر',
    icon: h4(Palette),
    dropdown: {
      /* live panel — always renders the CURRENT element (see types.ts) */
      live: true,
      
      width: 290,
      render: () => (
        <div dir="rtl" className="space-y-3 p-1.5">
          <PanelSection title="پر کردن">
            <Swatches
              value={el.bgColor}
              colors={el.type === 'sticky' ? STICKY_PALETTE : FILL_PALETTE}
              defaultLabel="شفاف"
              onPick={(c) => a.patch({ bgColor: c === '' ? 'transparent' : c })}
            />
          </PanelSection>
          <PanelSection title="خط دور">
            <div>
              <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-400">رنگ خط</span>
              <Swatches
                value={el.borderColor}
                colors={BORDER_PALETTE}
                defaultLabel="بدون خط"
                onPick={(c) => a.patch({ borderColor: c, borderWidth: c && el.borderWidth <= 0 ? 1.5 : el.borderWidth })}
              />
            </div>
            <Slider
              label="ضخامت" display={el.borderWidth <= 0 ? 'بدون خط' : `${el.borderWidth} پیکسل`}
              min={0} max={8} step={0.5} value={el.borderWidth}
              onChange={(v) => a.patch({ borderWidth: v })}
            />
            <div>
              <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-400">نوع خط</span>
              <SegButtons
                value={el.borderColorStyle || 'solid'}
                options={BORDER_STYLES.map((s) => ({ value: s.value, title: s.label, node: <span style={{ display: 'block', width: 26, borderTop: `2px ${s.value} currentColor` }} /> }))}
                onPick={(v) => a.patch({ borderColorStyle: v, borderWidth: Math.max(1.5, el.borderWidth || 1.5) })}
              />
            </div>
          </PanelSection>
          <PanelSection title="سایه و شفافیت">
            <SegButtons
              value={el.shadow ? 'on' : 'off'}
              options={[
                { value: 'off', label: 'بدون سایه' },
                { value: 'on', label: 'سایه' },
              ]}
              onPick={(v) => a.patch({ shadow: v === 'on' })}
            />
            <Slider
              label="شفافیت" display={`${Math.round((el.opacity ?? 1) * 100)}٪`}
              min={0.1} max={1} step={0.05} value={el.opacity ?? 1}
              onChange={(v) => a.patch({ opacity: v })}
            />
          </PanelSection>
          <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-600 dark:text-ink-400">پیش‌نمایش زنده</span>
            <AppearancePreview el={el} />
          </div>
        </div>
      ),
    },
  };
}

function textPanel(a: FloatAttrs): ContextualTool {
  const el = a.element;
  return {
    key: 'float.panel.text',
    title: 'متن (فونت، رنگ، چینش)',
    label: 'متن',
    icon: h4(Type),
    dropdown: {
      /* live panel — always renders the CURRENT element (see types.ts) */
      live: true,
      
      width: 300,
      render: () => (
        <div dir="rtl" className="space-y-3 p-1.5">
          <PanelSection title="فونت">
            <FontSelect value={el.fontFamily} onPick={(v) => a.patch({ fontFamily: v })} />
            <SegButtons
              value={el.fontSize}
              options={FONT_SIZES.slice(0, 6).map((s) => ({ value: s, label: String(s) }))}
              onPick={(v) => a.patch({ fontSize: v })}
            />
            <Slider
              label="اندازه فونت" display={`${el.fontSize} پیکسل`}
              min={8} max={72} step={1} value={el.fontSize}
              onChange={(v) => a.patch({ fontSize: v })}
            />
            <SegButtons
              value={el.fontWeight ?? 400}
              options={[
                { value: 400, label: 'عادی' },
                { value: 600, label: 'نیمه‌ضخیم' },
                { value: 700, label: 'ضخیم' },
              ]}
              onPick={(v) => a.patch({ fontWeight: v })}
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                title="مورب"
                onClick={() => a.patch({ italic: !el.italic })}
                className={`h-8 w-9 rounded-md border text-[13px] italic ${el.italic ? 'border-[#0070f3] bg-accent-50 text-accent-700' : 'border-ink-200 text-ink-500 dark:border-ink-700'}`}
              >I</button>
              <button
                type="button"
                title="زیرخط"
                onClick={() => a.patch({ underline: !el.underline })}
                className={`h-8 w-9 rounded-md border text-[13px] underline ${el.underline ? 'border-[#0070f3] bg-accent-50 text-accent-700' : 'border-ink-200 text-ink-500 dark:border-ink-700'}`}
              >U</button>
            </div>
          </PanelSection>
          <PanelSection title="رنگ متن">
            <Swatches value={el.fontColor} colors={TEXT_PALETTE} defaultLabel="رنگ" onPick={(c) => a.patch({ fontColor: c })} />
          </PanelSection>
          <PanelSection title="چینش و جهت">
            <div>
              <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-400">چینش افقی</span>
              <SegButtons
                value={el.hAlign ?? 'right'}
                options={[
                  { value: 'right', title: 'راست‌چین', node: <AlignRight className="h-4 w-4" /> },
                  { value: 'center', title: 'وسط‌چین', node: <AlignCenter className="h-4 w-4" /> },
                  { value: 'left', title: 'چپ‌چین', node: <AlignLeft className="h-4 w-4" /> },
                  { value: 'justify', title: 'هم‌تراز', node: <AlignJustify className="h-4 w-4" /> },
                ]}
                onPick={(v) => a.patch({ hAlign: v })}
              />
            </div>
            <div>
              <span className="mb-1 block text-[12px] font-medium text-ink-600 dark:text-ink-400">جهت متن</span>
              <SegButtons
                value={el.direction ?? 'rtl'}
                options={[
                  { value: 'rtl', label: 'راست به چپ' },
                  { value: 'ltr', label: 'چپ به راست' },
                ]}
                onPick={(v) => a.patch({ direction: v })}
              />
            </div>
            <Slider
              label="ارتفاع خط" display={String(el.lineHeight ?? 1.7)}
              min={1} max={3} step={0.1} value={el.lineHeight ?? 1.7}
              onChange={(v) => a.patch({ lineHeight: v })}
            />
            <Slider
              label="فاصلهٔ حروف" display={`${el.letterSpacing ?? 0} پیکسل`}
              min={-1} max={6} step={0.5} value={el.letterSpacing ?? 0}
              onChange={(v) => a.patch({ letterSpacing: v })}
            />
            <Slider
              label="فاصلهٔ داخلی" display={`${el.padding ?? 10} پیکسل`}
              min={0} max={32} step={1} value={el.padding ?? 10}
              onChange={(v) => a.patch({ padding: v })}
            />
          </PanelSection>
          <PanelSection title="چینش عمودی">
            <SegButtons
              value={el.vAlign ?? 'top'}
              options={[
                { value: 'top', label: 'بالا' },
                { value: 'center', label: 'وسط' },
                { value: 'bottom', label: 'پایین' },
              ]}
              onPick={(v) => a.patch({ vAlign: v })}
            />
          </PanelSection>
          <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-600 dark:text-ink-400">پیش‌نمایش زنده</span>
            <TextPreview el={el} />
          </div>
        </div>
      ),
    },
  };
}

function imagePanel(a: FloatAttrs): ContextualTool {
  const el = a.element;
  return {
    key: 'float.panel.image',
    title: 'تصویر (نمایش، افکت، برگرداندن)',
    label: 'تصویر',
    icon: h4(ImageIcon),
    dropdown: {
      /* live panel — always renders the CURRENT element (see types.ts) */
      live: true,

      width: 290,
      /* Presentation-only redesign (§4): ONE calm column, quiet section
         headings instead of nested boxed cards, the same ink/accent design
         language. Controls mirror EXACTLY the implemented capabilities:
         objectFit, borderRadius, filter, flip, opacity — nothing more. */
      render: () => (
        <div dir="rtl" className="space-y-4 p-2">
          {/* live preview first — the change is visible next to its control */}
          <div className="overflow-hidden rounded-lg bg-white ring-1 ring-ink-100 dark:bg-ink-950 dark:ring-ink-800">
            <div className="flex h-28 items-center justify-center p-3">
              <ImagePreview el={el} />
            </div>
          </div>

          <section>
            <h3 className="mb-1.5 text-[12px] font-bold text-ink-900 dark:text-ink-100">نمایش در قاب</h3>
            <div className="space-y-2.5">
              <SegButtons
                value={el.objectFit ?? 'fill'}
                options={[
                  { value: 'fill', label: 'پرکردن' },
                  { value: 'contain', label: 'کامل' },
                  { value: 'cover', label: 'پرکردن قاب' },
                ]}
                onPick={(v) => a.patch({ objectFit: v })}
              />
              <Slider
                label="گردی گوشه‌ها" display={`${el.borderRadius} پیکسل`}
                min={0} max={60} step={1} value={el.borderRadius}
                onChange={(v) => a.patch({ borderRadius: v })}
              />
            </div>
          </section>

          <section>
            <h3 className="mb-1.5 text-[12px] font-bold text-ink-900 dark:text-ink-100">افکت رنگی</h3>
            <SegButtons
              value={el.filter || ''}
              options={IMAGE_FILTERS}
              onPick={(v) => a.patch({ filter: v })}
            />
          </section>

          <section>
            <h3 className="mb-1.5 text-[12px] font-bold text-ink-900 dark:text-ink-100">جهت</h3>
            <SegButtons
              value={el.flip || ''}
              options={[
                { value: '', label: 'عادی' },
                { value: 'h', label: 'افقی' },
                { value: 'v', label: 'عمودی' },
                { value: 'hv', label: 'هردو' },
              ]}
              onPick={(v) => a.patch({ flip: v as FloatingElement['flip'] })}
            />
          </section>

          <section>
            <h3 className="mb-1.5 text-[12px] font-bold text-ink-900 dark:text-ink-100">شفافیت</h3>
            <Slider
              label="شفافیت" display={`${Math.round((el.opacity ?? 1) * 100)}٪`}
              min={0.1} max={1} step={0.05} value={el.opacity ?? 1}
              onChange={(v) => a.patch({ opacity: v })}
            />
          </section>
        </div>
      ),
    },
  };
}

/* ── tool groups ────────────────────────────────────────────────────────── */

function groups(obj: SelectableObject): ContextualGroup[] {
  const a = obj.attrs as FloatAttrs;
  const el = a.element;
  if (!el) return [];
  const t = el.type;
  const tools: ContextualTool[] = [];

  /* ── object family chip (non-destructive) + delete (always available) ── */
  tools.push({
    key: 'float.label',
    title: floatLabel(t),
    label: floatLabel(t),
    icon: floatIcon(t),
    run: () => {},
  });
  tools.push({ separator: true, key: 'sep0' });

  /* ── (§4/§5/§13) Rotation is owned by the selection frame's rotation
     handle; arrange (جلو/عقب) and geometry (Width/Height) live in direct
     object interaction / the right-click menu — none of them are formatting
     controls, so none appear on this tab. ── */
  if (t === 'image' && el.aspectRatio) {
    tools.push({
      key: 'float.size.ratio',
      title: 'بازگشت به نسبت اصلی',
      label: 'نسبت اصلی',
      icon: h4(Maximize2),
      run: () => a.patch({ height: Math.round(el.width / (el.aspectRatio as number)) }),
    });
  }
  tools.push({ separator: true, key: 'sep1' });

  /* ── presets — real one-click EduBlock-language styles for shapes ── */
  if (SHAPE_TYPES.includes(t) || isTextual(t)) {
    tools.push({
      key: 'float.panel.presets',
      title: 'سبک آماده (پرست)',
      label: 'سبک',
      icon: h4(Wand2),
      dropdown: {
      /* live panel — always renders the CURRENT element (see types.ts) */
      live: true,
      
        width: 260,
        render: () => (
          <div dir="rtl" className="p-1.5">
            <div className="grid grid-cols-3 gap-1.5">
              {FLOAT_PRESETS.map((pr) => (
                <button
                  key={pr.key}
                  type="button"
                  onClick={() => a.patch(applyFloatPreset(el, pr.key) === el ? {} : pr.style)}
                  title={pr.label}
                  className="flex h-16 flex-col items-center justify-center gap-1 rounded-lg border border-ink-200 p-1 text-[10px] text-ink-600 transition-colors hover:border-[#0070f3] dark:border-ink-700 dark:text-ink-300"
                >
                  <span
                    className="h-6 w-10 rounded"
                    style={{
                      background: (pr.style.bgColor as string) || '#fff',
                      border: `${pr.style.borderWidth ?? 0}px ${(pr.style.borderColorStyle as string) || 'solid'} ${(pr.style.borderColor as string) || 'transparent'}`,
                    }}
                  />
                  {pr.label}
                </button>
              ))}
            </div>
          </div>
        ),
      },
    });
  }

  /* ── appearance (fill/border/shadow/opacity) — shapes, boxes, notes ── */
  if (t !== 'image') tools.push(appearancePanel(a));

  /* ── text formatting — EVERY text-capable object (§1: shapes included) ── */
  if (t !== 'image') tools.push(textPanel(a));

  /* ── image formatting ── */
  if (t === 'image') tools.push(imagePanel(a));

  /* ── duplicate + delete ── */
  tools.push({
    key: 'float.duplicate',
    title: 'تکثیر',
    icon: h4(Copy),
    run: () => a.duplicate(),
  });
  tools.push({
    key: 'float.delete',
    title: 'حذف',
    icon: h4(Trash2),
    run: () => a.remove(),
  });

  return [{ key: 'float.tools', label: 'ابزارهای شیء شناور', tools }];
}

function tabs(obj: SelectableObject): ContextualTab[] {
  return [
    {
      id: 'context-floating',
      label: 'قالب‌بندی شیء',
      icon: floatIcon(obj.type),
      priority: 5,
      groups: groups(obj),
    },
  ];
}

export const floatProvider: ContextProvider = {
  id: FLOAT_CONTEXT_ID,
  matches: (o) => o.source === 'floating',
  label: 'شیء شناور',
  capabilities,
  tabs,
};
