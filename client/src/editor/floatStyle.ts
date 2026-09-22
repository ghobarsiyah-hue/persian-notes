/* ══════════════════════════════════════════════════════════════════════════
   floatStyle — the FORMATTING half of the floating-object system.

   One interpreter from FloatingElement → CSS, shared by:
     • FloatingLayer render (the actual objects)
     • the contextual-ribbon float panels (live preview chips)
     • future export surfaces (print/PDF reuse page-HTML that embeds these)

   All properties are OPTIONAL on the element — legacy saved documents keep
   rendering exactly as before (backward compatible, no migration).
   ══════════════════════════════════════════════════════════════════════════ */

import { createElement, type ReactNode } from 'react';
import type { FloatingElement, FloatingElementType } from '@/components/editor/FloatingLayer';

export type FloatStyle = React.CSSProperties;

const isTextual = (el: FloatingElement) => el.type === 'textBox' || el.type === 'sticky';
const isImage = (el: FloatingElement) => el.type === 'image';

/** whole-object border CSS (width + style + color), or 'none' */
export function floatBorder(el: FloatingElement): string {
  if (el.borderWidth <= 0) return 'none';
  return `${el.borderWidth}px ${el.borderColorStyle || 'solid'} ${el.borderColor}`;
}

/** transform: rotation (+ flip for images/shapes) — diamond handled by the layer */
export function floatTransform(el: FloatingElement, extra = ''): string {
  const rot = `rotate(${el.rotation || 0}deg)`;
  const flip =
    el.flip === 'h' ? ' scaleX(-1)' :
    el.flip === 'v' ? ' scaleY(-1)' :
    el.flip === 'hv' ? ' scale(-1,-1)' : '';
  return rot + flip + extra;
}

/** full style object for a floating element (object box + text formatting) */
export function floatElementStyle(el: FloatingElement): FloatStyle {
  const textual = isTextual(el);
  const style: FloatStyle = {
    opacity: el.opacity ?? 1,
    boxShadow: el.shadow ? '0 6px 16px rgba(0,0,0,0.18)' : 'none',
  };
  if (!isImage(el)) {
    /* BUG-1 (no background bleed): a transparent SHAPE is still an object on
       the page — its interior shows the sheet surface, never the notebook
       ruling. Legacy textual boxes stay transparent ON PURPOSE: typing on
       the ruled lines is the intended notebook workflow. The sheet color
       travels through --page-surface set by .page-paper (light/dark). */
    style.background = el.bgColor !== 'transparent'
      ? el.bgColor
      : textual ? 'transparent' : 'var(--page-surface, #ffffff)';
    style.border = floatBorder(el);
  }
  if (el.type !== 'ellipse') style.borderRadius = el.borderRadius;
  if (textual) {
    style.fontFamily = el.fontFamily;
    style.fontSize = el.fontSize;
    style.fontWeight = el.fontWeight ?? 400;
    style.fontStyle = el.italic ? 'italic' : undefined;
    style.textDecoration = el.underline ? 'underline' : undefined;
    style.color = el.fontColor;
    style.lineHeight = el.lineHeight ?? 1.7;
    style.letterSpacing = (el.letterSpacing ?? 0) + 'px';
    style.padding = el.padding ?? (el.type === 'sticky' ? 10 : 8);
    style.textAlign = el.hAlign ?? 'right';
    style.direction = el.direction ?? 'rtl';
    style.justifyContent =
      (el.vAlign ?? 'top') === 'center' ? 'center' :
      (el.vAlign ?? 'top') === 'bottom' ? 'flex-end' : 'flex-start';
  }
  return style;
}

/** object-specific inner <img> style */
export function floatImageStyle(el: FloatingElement): FloatStyle {
  return {
    width: '100%',
    height: '100%',
    objectFit: el.objectFit ?? 'fill',
    borderRadius: el.borderRadius || 0,
    filter: el.filter || undefined,
    userSelect: 'none',
    display: 'block',
  };
}

/* ── unified shape family (§1: text lives INSIDE the shape) ──
   Restored shared vocabulary for the unified object family: one type list,
   one text-capability rule, ONE per-shape geometry/paint interpreter used
   by the layer, the ribbon previews and future export surfaces. */

export const SHAPE_TYPES: readonly string[] = [
  'rect', 'roundedRect', 'circle', 'ellipse', 'diamond', 'arrow', 'callout',
];

/** which object types can carry inner text — every object except images
 *  (§1: legacy textBox/sticky + every shape are one text family) */
export function hasTextCapability(type: FloatingElementType): boolean {
  return type !== 'image';
}

/** shape interior fill — for SHAPES, transparent means the SHEET surface
 *  (BUG-1: never see-through to the notebook ruling). Legacy textual boxes
 *  keep true transparency on purpose: typing on the ruled lines is the
 *  intended notebook workflow. */
function shapeFill(el: FloatingElement): string {
  if (el.bgColor && el.bgColor !== 'transparent') return el.bgColor;
  const legacyTextual = el.type === 'textBox' || el.type === 'sticky';
  return legacyTextual ? 'transparent' : 'var(--page-surface, #ffffff)';
}

function shapeStroke(el: FloatingElement): { stroke: string; strokeWidth: number; dash?: string } {
  if (!el.borderWidth || el.borderWidth <= 0) return { stroke: 'none', strokeWidth: 0 };
  const style = el.borderColorStyle || 'solid';
  return {
    stroke: el.borderColor || '#171717',
    strokeWidth: el.borderWidth,
    dash: style === 'dashed' ? '6 4' : style === 'dotted' ? '1.5 3' : undefined,
  };
}

/** per-shape transform suffix + SVG paint (fill/border read the SAME
 *  formatting model as every other object — one interpreter) */
export function shapeGeometry(el: FloatingElement): {
  extra: string;
  paint: (gw: number, gh: number, el: FloatingElement) => ReactNode;
} {
  const extra = el.type === 'diamond' ? ' rotate(45deg) scale(0.707)' : '';
  const paint = (gw: number, gh: number, e: FloatingElement): ReactNode => {
    const { stroke, strokeWidth, dash } = shapeStroke(e);
    const common = {
      fill: shapeFill(e),
      stroke,
      strokeWidth: strokeWidth || undefined,
      strokeDasharray: dash,
    };
    switch (e.type) {
      case 'roundedRect':
        return createElement('rect', {
          x: 1, y: 1, width: Math.max(1, gw - 2), height: Math.max(1, gh - 2),
          rx: e.borderRadius || 12, ry: e.borderRadius || 12, ...common,
        });
      case 'circle':
      case 'ellipse':
        return createElement('ellipse', {
          cx: gw / 2, cy: gh / 2, rx: Math.max(1, gw / 2 - 1), ry: Math.max(1, gh / 2 - 1), ...common,
        });
      case 'diamond':
        return createElement('polygon', {
          points: `${gw / 2},1 ${gw - 1},${gh / 2} ${gw / 2},${gh - 1} 1,${gh / 2}`, ...common,
        });
      case 'arrow': {
        const head = Math.max(18, Math.min(gh, gw * 0.35));
        const shaftH = Math.max(8, gh * 0.4);
        const y0 = (gh - shaftH) / 2;
        return createElement('polygon', {
          points: `1,${y0} ${gw - head},${y0} ${gw - head},1 ${gw - 1},${gh / 2} ${gw - head},${gh - 1} ${gw - head},${y0 + shaftH} 1,${y0 + shaftH}`,
          ...common,
        });
      }
      case 'callout': {
        const r = e.borderRadius || 10;
        const tail = Math.max(12, gh * 0.18);
        return createElement('g', null,
          createElement('rect', {
            x: 1, y: 1, width: Math.max(1, gw - 2), height: Math.max(1, gh - tail),
            rx: r, ry: r, ...common,
          }),
          createElement('polygon', {
            points: `${gw * 0.22},${gh - tail} ${gw * 0.3},${gh - 1} ${gw * 0.38},${gh - tail}`,
            fill: shapeFill(e), stroke: 'none',
          }),
        );
      }
      default:
        return createElement('rect', {
          x: 1, y: 1, width: Math.max(1, gw - 2), height: Math.max(1, gh - 2), ...common,
        });
    }
  };
  return { extra, paint };
}

/* ── palettes / option lists (shared vocabulary with the EduBlock modal) ── */

export const FILL_PALETTE = [
  '', // = شفاف (transparent)
  '#ffffff', '#fef9c3', '#fef3c7', '#dbeafe', '#e0f2fe', '#dcfce7',
  '#fae8ff', '#f3e8ff', '#ffe4e6', '#fee2e2', '#f5f5f4', '#1e3a5f', '#171717',
  '#0070f3',
];

export const BORDER_PALETTE = [
  '', // = بدون خط
  '#171717', '#1e3a5f', '#0070f3', '#7928ca', '#dc2626', '#b45309',
  '#0a7d4f', '#c5a24d', '#64748b', '#94a3b8',
];

export const TEXT_PALETTE = [
  '#171717', '#1e3a5f', '#0070f3', '#7928ca', '#dc2626', '#b45309',
  '#0a7d4f', '#ffffff',
];

export const STICKY_PALETTE = [
  '#fef9c3', '#fef3c7', '#dbeafe', '#e0f2fe', '#dcfce7', '#fae8ff', '#ffe4e6', '#ffffff',
];

export const FONT_FAMILIES = [
  /* فارسی/عربی */
  { value: 'Sahel', label: 'ساحل' },
  { value: 'B Titr', label: 'ب تیتر' },
  { value: 'Shabnam', label: 'شبنم' },
  { value: 'Dast Nevis', label: 'دست‌نویس' },
  { value: 'Samim', label: 'صمیم' },
  { value: 'Tanha', label: 'تنها' },
  { value: 'Gandom', label: 'گندم' },
  { value: 'Parastoo', label: 'پرستو' },
  { value: 'Lalezar', label: 'لاله‌زار' },
  { value: 'Noto Naskh Arabic', label: 'نسخ (عربی)' },
  { value: 'Markazi Text', label: 'مرکزی' },
  /* انگلیسی */
  { value: 'Inter', label: 'Inter — انگلیسی' },
  { value: 'Merriweather', label: 'Merriweather — انگلیسی' },
  { value: 'Comic Sans', label: 'Comic Sans' },
];

export const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 30, 36, 48];

export const BORDER_STYLES: Array<{ value: 'solid' | 'dashed' | 'dotted'; label: string }> = [
  { value: 'solid', label: 'یکسره' },
  { value: 'dashed', label: 'خط‌چین' },
  { value: 'dotted', label: 'نقطه‌چین' },
];

export const IMAGE_FILTERS: Array<{ label: string; value: string }> = [
  { label: 'عادی', value: '' },
  { label: 'سیاه‌وسفید', value: 'grayscale(1)' },
  { label: 'سپیا', value: 'sepia(0.6)' },
  { label: 'روشن', value: 'brightness(1.15)' },
  { label: 'تیره', value: 'brightness(0.85)' },
  { label: 'کنتراست', value: 'contrast(1.3)' },
  { label: 'اشباع', value: 'saturate(1.4)' },
  { label: 'محو', value: 'blur(2px)' },
];

/* ── Style presets (§7) — real, one-click appearances for shapes ─────────
   Derived from the EduBlock family palette (calm backgrounds from the
   EduBlock fill palette, ink-toned borders, the accent blue reserved for
   state — the «تأکیدی» preset is the ONLY one allowed to touch petrol). */
export interface FloatPreset {
  key: string;
  label: string;
  style: Partial<FloatingElement>;
}

export const FLOAT_PRESETS: FloatPreset[] = [
  { key: 'simple', label: 'ساده', style: { bgColor: '#ffffff', borderColor: '#64748b', borderWidth: 1.5, borderColorStyle: 'solid', opacity: 1, shadow: false, fontColor: '#171717', fontWeight: 400, padding: 10 } },
  { key: 'emphasis', label: 'تأکیدی', style: { bgColor: '#dbeafe', borderColor: '#1e3a5f', borderWidth: 2, borderColorStyle: 'solid', opacity: 1, shadow: false, fontColor: '#1e3a5f', fontWeight: 600, padding: 12 } },
  { key: 'note', label: 'نکته', style: { bgColor: '#fef9c3', borderColor: '#c5a24d', borderWidth: 1.5, borderColorStyle: 'dashed', opacity: 1, shadow: false, fontColor: '#171717', fontWeight: 400, padding: 10 } },
  { key: 'warning', label: 'هشدار', style: { bgColor: '#fee2e2', borderColor: '#dc2626', borderWidth: 2, borderColorStyle: 'solid', opacity: 1, shadow: false, fontColor: '#7f1d1d', fontWeight: 600, padding: 12 } },
  { key: 'question', label: 'سؤال', style: { bgColor: '#e0f2fe', borderColor: '#64748b', borderWidth: 1.5, borderColorStyle: 'dotted', opacity: 1, shadow: false, fontColor: '#1e3a5f', fontWeight: 400, padding: 10 } },
  { key: 'definition', label: 'تعریف', style: { bgColor: '#f5f5f4', borderColor: '#171717', borderWidth: 2, borderColorStyle: 'solid', opacity: 1, shadow: false, fontColor: '#171717', fontWeight: 600, padding: 12 } },
  { key: 'example', label: 'مثال', style: { bgColor: '#dcfce7', borderColor: '#0a7d4f', borderWidth: 1.5, borderColorStyle: 'solid', opacity: 1, shadow: false, fontColor: '#14532d', fontWeight: 400, padding: 10 } },
  { key: 'conclusion', label: 'نتیجه', style: { bgColor: '#1e3a5f', borderColor: '#1e3a5f', borderWidth: 1.5, borderColorStyle: 'solid', opacity: 1, shadow: true, fontColor: '#ffffff', fontWeight: 600, padding: 12 } },
  { key: 'quote', label: 'نقل‌قول', style: { bgColor: '#fae8ff', borderColor: '#7928ca', borderWidth: 0, borderColorStyle: 'solid', opacity: 1, shadow: false, fontColor: '#581c87', fontWeight: 400, padding: 14 } },
];

/** apply a preset on top of the CURRENT element — only style fields the
 *  preset defines are overwritten; geometry/text/z-order survive */
export function applyFloatPreset(el: FloatingElement, presetKey: string): FloatingElement {
  const p = FLOAT_PRESETS.find((x) => x.key === presetKey);
  return p ? { ...el, ...p.style } : el;
}
