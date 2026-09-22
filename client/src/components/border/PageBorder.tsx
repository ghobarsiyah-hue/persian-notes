import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { BorderSettings } from '@/types';
import { faDigits } from '@/utils/fa';

interface PageBorderProps {
  settings: BorderSettings;
  subject?: string;
  chapter?: string;
  title?: string;
  pageNumber?: number;
  totalPages?: number;
}

const DEFAULT_NAVY = '#1e3a5f';
const DEFAULT_GOLD = '#c5a24d';
const DEFAULT_FILL = '#b8d8e8';

/* stroke width scales (multiplied by settings.thickness) */
const OUTER_W = 3;
const INNER_W = 2.5;
const EXTRA_W = 1.5;

/** Viewport for the ornamental border. 1000 x 1414 keeps the A4 ratio (210/297). */
const VW = 1000;
const VH = 1414;

/**
 * On-screen A4 sheet height at 96dpi (297mm). The editor border is drawn as a
 * repeating background so it tiles once per A4 sheet — every section of a long
 * note keeps its own complete frame instead of the waves stretching apart.
 */
export const A4_PAGE_H_PX = 1123;

interface WavyPoints {
  path: string;
  coords: Array<{ x: number; y: number }>;
}

function wavyLine(
  x1: number, y1: number, x2: number, y2: number,
  amplitude: number, frequency: number, seed: number,
): WavyPoints {
  const isHorizontal = Math.abs(y2 - y1) < Math.abs(x2 - x1);
  const len = isHorizontal ? Math.abs(x2 - x1) : Math.abs(y2 - y1);
  const steps = Math.max(20, Math.floor(len / 8));
  const coords: Array<{ x: number; y: number }> = [];
  const parts: string[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wave = Math.sin(t * Math.PI * 2 * frequency + seed) * amplitude;
    const wave2 = Math.sin(t * Math.PI * 2 * frequency * 2.3 + seed * 1.7) * amplitude * 0.3;
    const w = wave + wave2;

    let x: number, y: number;
    if (isHorizontal) { x = x1 + (x2 - x1) * t; y = y1 + w; }
    else { x = x1 + w; y = y1 + (y2 - y1) * t; }
    coords.push({ x, y });
    parts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return { path: parts.join(' '), coords };
}

function wavyFill(a: WavyPoints, b: WavyPoints): string {
  const fwd = a.coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const bwd = b.coords.slice().reverse().map((p) => `L ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  return `${fwd} ${bwd} Z`;
}

interface Stroke {
  path: string;
  color: string;
  width: number;
  opacity: number;
}

interface EdgeGeom {
  fillPath: string | null;
  /** color of the tinted band between the wavy lines (null = no fill) */
  fillColor: string | null;
  strokes: Stroke[];
}

/** Slice a horizontal wavy polyline (x monotonic) between xa and xb with
 *  EXACT interpolated endpoints — both pieces are phases of ONE continuous
 *  wave, so strokes rejoining across the page-number tab never jump. */
function sliceX(line: WavyPoints, xa: number, xb: number): WavyPoints {
  const yAt = (x: number): number => {
    const c = line.coords;
    for (let i = 1; i < c.length; i++) {
      if (c[i].x >= x) {
        const dx = c[i].x - c[i - 1].x;
        return dx ? c[i - 1].y + ((x - c[i - 1].x) / dx) * (c[i].y - c[i - 1].y) : c[i].y;
      }
    }
    return c[c.length - 1].y;
  };
  const coords = [
    { x: xa, y: yAt(xa) },
    ...line.coords.filter((p) => p.x > xa && p.x < xb),
    { x: xb, y: yAt(xb) },
  ];
  return {
    path: coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '),
    coords,
  };
}

/** Semicircular dome bulging UP from the bottom edge between xa..xb — the
 *  page-number tab. Built from a TRUE semicircle (x = cx + R·cos θ,
 *  y = yBase − R·sin θ, height = R) with a small RADIAL wiggle that vanishes
 *  at both ends — the silhouette stays a clean semicircle while keeping the
 *  frame's hand-drawn character. Endpoints land EXACTLY on (xa, yStart) /
 *  (xb, yEnd) so the rings continue the sliced bottom-edge strokes. */
function wavyDome(
  xa: number, xb: number, height: number,
  yStart: number, yEnd: number, seed: number,
  steps = 72,
): WavyPoints {
  const coords: Array<{ x: number; y: number }> = [];
  const parts: string[] = [];
  const cx = (xa + xb) / 2;
  const Rx = (xb - xa) / 2;
  const yb = (yStart + yEnd) / 2;
  /* the cut endpoints aren't perfectly level (they carry the edge wave) —
     tilt the whole semicircle so it starts/ends exactly on them */
  const tilt = (yEnd - yStart) / (xb - xa);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const th = Math.PI * (1 - u); // π → 0 : left → right
    const env = Math.sin(Math.PI * u); // wiggle vanishes at both ends
    const w = env * (1.6 * Math.sin(2 * Math.PI * 2 * u + seed) + 0.6 * Math.sin(2 * Math.PI * 4.6 * u + seed * 1.7));
    const x = cx + (Rx + w) * Math.cos(th);
    const y = yb - (height + w) * Math.sin(th) + tilt * (x - cx);
    coords.push({ x, y });
    parts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return { path: parts.join(' '), coords };
}

/** Raw wavy polylines for one frame edge — shared by edgeGeom and the
 *  bottom-edge slicer so both stay bit-identical. */
function edgeParts(
  x1: number, y1: number, x2: number, y2: number,
  goldSeed: number, navySeed: number, fillSeed: number,
  dx: number, dy: number,
) {
  const gx = dx ?? 0; const gy = dy ?? 0;
  return {
    outer: wavyLine(x1 + gx, y1 + gy, x2 + gx, y2 + gy, 2.2, 2.5, goldSeed),
    inner: wavyLine(x1 - gx, y1 - gy, x2 - gx, y2 - gy, 2.2, 3.2, navySeed),
    fo: wavyLine(x1 + gx, y1 + gy, x2 + gx, y2 + gy, 2.8, 3.8, fillSeed),
    fi: wavyLine(x1 - gx, y1 - gy, x2 - gx, y2 - gy, 2.8, 4.5, fillSeed + 1.3),
    // a third, more outward curve for heavier styles
    extra: wavyLine(x1 + 2 * gx, y1 + 2 * gy, x2 + 2 * gx, y2 + 2 * gy, 2.5, 4.0, goldSeed + 0.7),
  };
}

/**
 * Build the wavy "edge" geometry for one side of the page.
 *  - outer stroke  -> secondaryColor (thick)
 *  - inner stroke  -> primaryColor   (thin)
 *  - fill          -> between the two curves (the signature ice-blue tint)
 *  - extra stroke  -> only for double / ornate styles
 */
function edgeGeom(
  x1: number, y1: number, x2: number, y2: number,
  goldSeed: number, navySeed: number, fillSeed: number,
  dx: number, dy: number,
  style: BorderSettings['style'],
  primary: string,
  secondary: string,
  thickness: number,
): EdgeGeom {
  const p = edgeParts(x1, y1, x2, y2, goldSeed, navySeed, fillSeed, dx, dy);
  const fillPath = wavyFill(p.fo, p.fi);

  if (style === 'minimal') {
    // clean: single thin primary stroke, no fill, no outer shell
    return {
      fillPath: null,
      fillColor: null,
      strokes: [{ path: p.inner.path, color: primary, width: INNER_W * thickness * 0.8, opacity: 0.7 }],
    };
  }

  const strokes: Stroke[] = [
    { path: p.outer.path, color: secondary, width: OUTER_W * thickness, opacity: 1 },
    { path: p.inner.path, color: primary, width: INNER_W * thickness, opacity: 1 },
  ];

  /* the third, OUTER stroke belongs to the ornate style only — giving it to
     'double' too made both styles render identically (fixed) */
  if (style === 'ornate') {
    strokes.push({ path: p.extra.path, color: primary, width: EXTRA_W * thickness, opacity: 0.85 });
  }

  return { fillPath, fillColor: null as string | null, strokes };
}

interface BorderArt {
  edges: EdgeGeom[];
  /** 'double' style: a second, thin frame inset INSIDE the main one
   *  (line-only — never receives the fill band) */
  innerFrame: EdgeGeom[];
  /** 'ornate' style: diamond ornaments on the four frame corners */
  cornerDots: Array<{ x: number; y: number; c1: string; c2: string }>;
  sideText: { label: string; x: number; y: number } | null;
  /** bottom-center wavy dome holding the auto page number */
  pageTab: {
    cx: number;
    y: number;
    /** visible ring path(s) — precomputed wavy domes */
    outer: string;
    inner: string | null;
    c1: string;
    c2: string;
    w1: number;
    w2: number;
    number: string;
  } | null;
}

/**
 * Resolve the decorative label that runs vertically along the left edge of the
 * page: the user's custom sideLabel (from the طراحی tab) wins, otherwise
 * subject -> chapter -> title -> default.
 */
function resolveSideLabel(
  settings: BorderSettings,
  subject?: string,
  chapter?: string,
  title?: string,
): string {
  const label = (settings.sideLabel || '').trim() || subject || chapter || title || 'پرشین‌نوت';
  return label.length > 30 ? `${label.slice(0, 30)}\u2026` : label;
}

/**
 * Pure builder shared by the on-screen React component and the PDF string
 * renderer so the border is pixel-identical in the preview and in the export.
 */
function buildBorderArt(
  settings: BorderSettings,
  subject?: string,
  chapter?: string,
  title?: string,
  pageNumber?: number,
): BorderArt {
  const { style = 'classic', primaryColor, secondaryColor, thickness } = settings;
  const primary = primaryColor || DEFAULT_NAVY;
  const secondary = secondaryColor || DEFAULT_GOLD;
  const th = thickness || 1;
  /* the tinted band between the wavy lines — user-changeable, 'none' removes it */
  const fill = (settings.fillColor || DEFAULT_FILL) as string;
  const fillColor = fill === 'none' ? null : fill;

  /* The frame sits ≈5mm from the sheet edge — close enough that the border
     doesn't eat into the page (the editable area starts just a few mm inside
     its inner edge, see .page-paper padding in index.css), but pulled in a
     touch from the very corner so it doesn't stick to the sheet edge. */
  const leftX = VW * 0.024;
  const rightX = VW * 0.976;
  const topY = VH * 0.014;
  const bottomY = VH * 0.986;
  const midY = (topY + bottomY) / 2;
  const gapHalf = 70; // half-height of the gap cut in the left edge

  /* ── bottom-center page-number tab ──
     The bottom edge is ONE continuous wave built across the full span and
     SLICED around the tab notch — both pieces are phases of the same wave,
     so the strokes meet the dome without any jump or offset. The dome is
     wavy like the frame itself (hand-drawn look, no clean geometric arc)
     and hosts the auto page number (ساحل font). */
  const tabR = 28;
  const tabCx = VW / 2;
  const xaCut = tabCx - tabR;
  const xbCut = tabCx + tabR;
  const bottomParts = edgeParts(leftX, bottomY, rightX, bottomY, 1.1, 3.4, 8.5, 0, 4);
  const bottomEdge = (xa: number, xb: number): EdgeGeom => {
    if (xa <= leftX + 0.5 && xb >= rightX - 0.5) {
      return edgeGeom(leftX, bottomY, rightX, bottomY, 1.1, 3.4, 8.5, 0, 4, style, primary, secondary, th);
    }
    const fillPath = wavyFill(sliceX(bottomParts.fo, xa, xb), sliceX(bottomParts.fi, xa, xb));
    if (style === 'minimal') {
      return {
        fillPath: null,
        fillColor: null,
        strokes: [{ path: sliceX(bottomParts.inner, xa, xb).path, color: primary, width: INNER_W * th * 0.8, opacity: 0.7 }],
      };
    }
    const strokes: Stroke[] = [
      { path: sliceX(bottomParts.outer, xa, xb).path, color: secondary, width: OUTER_W * th, opacity: 1 },
      { path: sliceX(bottomParts.inner, xa, xb).path, color: primary, width: INNER_W * th, opacity: 1 },
    ];
    if (style === 'ornate') {
      strokes.push({ path: sliceX(bottomParts.extra, xa, xb).path, color: primary, width: EXTRA_W * th, opacity: 0.85 });
    }
    return { fillPath, fillColor: null as string | null, strokes };
  };
  const edges: EdgeGeom[] = [
    edgeGeom(leftX, topY, leftX, midY - gapHalf, 0.5, 2.8, 5, 4, 0, style, primary, secondary, th),
    edgeGeom(leftX, midY + gapHalf, leftX, bottomY, 0.5, 2.8, 5, 4, 0, style, primary, secondary, th),
    edgeGeom(rightX, topY, rightX, bottomY, 1.9, 4.1, 6.2, 4, 0, style, primary, secondary, th),
    edgeGeom(leftX, topY, rightX, topY, 0.3, 2.1, 7.1, 0, 4, style, primary, secondary, th),
    ...(pageNumber != null
      ? [bottomEdge(leftX, xaCut), bottomEdge(xbCut, rightX)]
      : [bottomEdge(leftX, rightX)]),
  ];

  /* ── style-specific extras (silhouette-visible, unlike the old 4px extra) ──
     'double' → a second thin frame inset ~14 units (≈10px) INSIDE the main
                one, drawn line-only so the fill band never leaks onto it.
     'ornate' → a small diamond ornament on each of the four corners. */
  const inset = 14;
  const innerFrame: EdgeGeom[] = style === 'double'
    ? [
        edgeGeom(leftX + inset, topY + inset, leftX + inset, bottomY - inset, 1.4, 3.1, 9, 0, 0, 'minimal', primary, secondary, th * 0.8),
        edgeGeom(rightX - inset, topY + inset, rightX - inset, bottomY - inset, 2.4, 4.4, 9.5, 0, 0, 'minimal', primary, secondary, th * 0.8),
        edgeGeom(leftX + inset, topY + inset, rightX - inset, topY + inset, 1.7, 2.5, 10, 0, 0, 'minimal', primary, secondary, th * 0.8),
        edgeGeom(leftX + inset, bottomY - inset, rightX - inset, bottomY - inset, 2.1, 3.8, 10.5, 0, 0, 'minimal', primary, secondary, th * 0.8),
      ]
    : [];

  const cornerDots: Array<{ x: number; y: number; c1: string; c2: string }> = style === 'ornate'
    ? [
        { x: leftX, y: topY, c1: secondary, c2: primary },
        { x: rightX, y: topY, c1: primary, c2: secondary },
        { x: leftX, y: bottomY, c1: primary, c2: secondary },
        { x: rightX, y: bottomY, c1: secondary, c2: primary },
      ]
    : [];

  // no decorative label on the clean minimal style
  const sideText = style === 'minimal' ? null : { label: resolveSideLabel(settings, subject, chapter, title), x: leftX, y: midY };

  /* Dome rings continue the SAME sliced waves: the gold ring starts/ends on
     the bottom-outer line's cut endpoints, the navy ring on the bottom-inner
     ones — no inset, no phase jump, so dome and line read as one stroke.
     No tint/white fill inside the dome ('آبی کم‌رنگ' dropped). */
  /* full semicircle: dome height = radius, so width = 2 × height */
  const domeH = tabR;
  const yAt = (line: WavyPoints, x: number): number => {
    const c = line.coords;
    for (let i = 1; i < c.length; i++) {
      if (c[i].x >= x) {
        const dx = c[i].x - c[i - 1].x;
        return dx ? c[i - 1].y + ((x - c[i - 1].x) / dx) * (c[i].y - c[i - 1].y) : c[i].y;
      }
    }
    return c[c.length - 1].y;
  };
  const goldDome = wavyDome(xaCut, xbCut, domeH, yAt(bottomParts.outer, xaCut), yAt(bottomParts.outer, xbCut), 1.1);
  const navyDome = wavyDome(xaCut, xbCut, domeH - 3.5, yAt(bottomParts.inner, xaCut), yAt(bottomParts.inner, xbCut), 3.4);

  const pageTab = pageNumber != null
    ? {
        cx: tabCx,
        y: bottomY,
        outer: goldDome.path,
        inner: style === 'minimal' ? null : navyDome.path,
        c1: style === 'minimal' ? primary : secondary,
        c2: primary,
        w1: style === 'minimal' ? INNER_W * th * 0.8 : OUTER_W * th,
        w2: style === 'minimal' ? 0 : INNER_W * th,
        number: faDigits(pageNumber),
      }
    : null;

  if (fillColor !== null) for (const e of edges) e.fillColor = fillColor;

  return { edges, innerFrame, cornerDots, sideText, pageTab };
}

/**
 * Serialize the border art (edges + side label + corner badges) to SVG markup.
 * Shared by the PDF string renderer and the on-screen tiling background so the
 * editor and the export stay pixel-identical.
 */
function borderSvgInner(art: BorderArt): string {
  const edges = art.edges
    .map((e) => {
      const fills = e.fillPath && e.fillColor
        ? `<path d="${e.fillPath}" fill="${e.fillColor}" opacity="0.9"/>`
        : '';
      const strokes = e.strokes
        .map((s) => `<path d="${s.path}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-linecap="round" opacity="${s.opacity}"/>`)
        .join('');
      return `${fills}${strokes}`;
    })
    .join('');

  const sideText = art.sideText
    ? `<text x="${art.sideText.x}" y="${art.sideText.y}" text-anchor="middle" fill="${DEFAULT_NAVY}" font-size="14" font-family="'Sahel', Tahoma, sans-serif" font-weight="700" opacity="0.85" transform="rotate(-90, ${art.sideText.x}, ${art.sideText.y})" letter-spacing="0.05em">${escapeXml(art.sideText.label)}</text>`
    : '';

  const pageTab = art.pageTab
    ? (() => {
        const { cx, y, outer, inner, c1, c2, w1, w2, number } = art.pageTab;
        return (
          `<path d="${outer}" fill="none" stroke="${c1}" stroke-width="${w1}" stroke-linecap="round"/>` +
          (inner && w2 > 0 ? `<path d="${inner}" fill="none" stroke="${c2}" stroke-width="${w2}" stroke-linecap="round"/>` : '') +
          /* baseline sits just above the bottom border line — the number
             rests LOW inside the dome, right on the frame */
          `<text x="${cx}" y="${(y - 2).toFixed(2)}" text-anchor="middle" fill="${DEFAULT_NAVY}" font-size="15" font-family="'Sahel', Tahoma, sans-serif" font-weight="800" opacity="0.95">${number}</text>`
        );
      })()
    : '';

  /* 'double' → thin inset frame drawn with the same wavy seralization */
  const innerFrame = art.innerFrame
    .map((e) => e.strokes.map((s) => `<path d="${s.path}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-linecap="round" opacity="${Math.min(0.75, s.opacity)}"/>`).join(''))
    .join('');

  /* 'ornate' → diamond ornaments (two nested rotated squares) on the corners */
  const cornerDots = (art.cornerDots ?? [])
    .map((d) => `<g transform="translate(${d.x} ${d.y})"><rect x="-5" y="-5" width="10" height="10" transform="rotate(45)" fill="${d.c1}"/><rect x="-2.5" y="-2.5" width="5" height="5" transform="rotate(45)" fill="${d.c2}"/></g>`)
    .join('');

  return `${edges}${innerFrame}${cornerDots}${sideText}${pageTab}`;
}

/**
 * On-screen editor border, rendered as a repeating background image so the
 * ornamental frame tiles once per A4 sheet (1123px). When the note grows
 * taller than a single page the next frame starts below — the border always
 * wraps the page exactly like the printed/PDF output instead of stretching.
 */
export function pageBorderBackgroundStyle(
  settings: BorderSettings,
  subject?: string,
  chapter?: string,
  title?: string,
  pageNumber?: number,
): CSSProperties | undefined {
  if (!settings.enabled || settings.style === 'none') return undefined;
  const art = buildBorderArt(settings, subject, chapter, title, pageNumber);
  const svg = `<svg viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${borderSvgInner(art)}</svg>`;
  return {
    backgroundImage: `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`,
    backgroundSize: `100% ${A4_PAGE_H_PX}px`,
    backgroundRepeat: 'repeat-y',
    backgroundPosition: 'top center',
  };
}

export function PageBorder({ settings, subject, chapter, title, pageNumber, totalPages }: PageBorderProps) {
  const background = useMemo(
    () => pageBorderBackgroundStyle(settings, subject, chapter, title, pageNumber),
    // primitive deps: the settings object is re-created on every parent render
    [settings.enabled, settings.style, settings.primaryColor, settings.secondaryColor, settings.fillColor, settings.thickness, settings.sideLabel, subject, chapter, title, pageNumber],
  );
  if (!background) return null;

  return <div className="page-border" style={background} aria-hidden="true" />;
}

/* Print/PDF export */
export function pageBorderSvgString(
  settings: BorderSettings,
  subject?: string,
  chapter?: string,
  pageNumber?: number,
  totalPages?: number,
  title?: string,
): string {
  if (!settings.enabled || settings.style === 'none') return '';

  const art = buildBorderArt(settings, subject, chapter, title, pageNumber);

  return `<svg viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1" xmlns="http://www.w3.org/2000/svg">\n  ${borderSvgInner(art)}\n</svg>`;
}

/* ═════════════════════════════════════════════════════════════════════
   Word (.doc HTML) export — the ornamental frame as VML.

   Word cannot render SVG or data-URI images in HTML documents, but it
   renders its own vector format (VML) — and VML polylines map 1:1 onto
   the border's pure M/L wave paths. The group is placed in the Word PAGE
   HEADER (mso-element:header) positioned relative to the page, so the
   frame repeats behind the text on EVERY page exactly like the editor
   sheet and the PDF. The page number itself comes from a real PAGE field
   in the footer (see buildWordHeaderFooter in utils/wordExport.ts), so
   the number is always correct regardless of Word's own pagination.
   ═════════════════════════════════════════════════════════════════════ */

/** A4 in DTP points — the @page box Word uses */
const A4_W_PT = 595.3;
const A4_H_PT = 841.9;
/** viewBox unit → pt (uniform: both axes span A4) */
const UNIT_PT = A4_W_PT / VW;

/** number → string rounded to 2 decimals (VML coordinates) */
function round2(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/** hex → solid hex blended over white at `alpha` (VML has no fill alpha) */
function blendHex(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return hex || '#000000';
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c * alpha + 255 * (1 - alpha));
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** SVG polyline path ("M x,y L x,y … Z") → VML points ("x,y x,y …") */
function vmlPoints(path: string): string {
  return path
    .replace(/[MZz]/g, ' ')
    .trim()
    .replace(/[ML]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

function vmlStroke(s: Stroke): string {
  return `<v:polyline points="${vmlPoints(s.path)}" filled="f" stroked="t" strokecolor="${blendHex(s.color, s.opacity)}" strokeweight="${(s.width * UNIT_PT).toFixed(2)}pt"/>`;
}

function vmlFill(e: EdgeGeom): string {
  if (!e.fillPath || !e.fillColor) return '';
  return `<v:polyline points="${vmlPoints(e.fillPath)}" filled="t" fillcolor="${blendHex(e.fillColor, 0.9)}" stroked="f"/>`;
}

/**
 * The ornamental page frame as a VML group — drop into the Word page
 * header. One buildBorderArt call shared with the SVG renderer keeps the
 * Word frame wave-identical to the editor sheet and the PDF.
 */
export function pageBorderVmlString(
  settings: BorderSettings,
  subject?: string,
  chapter?: string,
  title?: string,
): string {
  if (!settings.enabled || settings.style === 'none') return '';

  /* a page number placeholder is passed so the bottom edge gets its page
     tab (dome) cut — the number itself renders from a PAGE field in the
     Word footer, positioned inside the dome */
  const art = buildBorderArt(settings, subject, chapter, title, 1);

  const fills = art.edges.map(vmlFill).join('');
  const strokes = art.edges.flatMap((e) => e.strokes).map(vmlStroke).join('');
  const innerFrame = art.innerFrame.flatMap((e) => e.strokes).map(vmlStroke).join('');

  /* ornate corner diamonds: the SVG's two nested 45°-rotated squares,
     emitted as explicit 4-point polygons (no VML rotation needed) */
  const diamond = (x: number, y: number, r: number, color: string) =>
    `<v:polyline points="${x},${round2(y - r)} ${round2(x + r)},${y} ${x},${round2(y + r)} ${round2(x - r)},${y}" filled="t" fillcolor="${color}" stroked="f"/>`;
  const cornerDots = (art.cornerDots ?? [])
    .map((d) => diamond(d.x, d.y, 5 * Math.SQRT2, d.c1) + diamond(d.x, d.y, 2.5 * Math.SQRT2, d.c2))
    .join('');

  /* page-tab dome rings — same sliced waves as the SVG */
  const pageTab = art.pageTab
    ? (() => {
        const t = art.pageTab;
        let s = `<v:polyline points="${vmlPoints(t.outer)}" filled="f" stroked="t" strokecolor="${blendHex(t.c1, 1)}" strokeweight="${(t.w1 * UNIT_PT).toFixed(2)}pt"/>`;
        if (t.inner && t.w2 > 0) {
          s += `<v:polyline points="${vmlPoints(t.inner)}" filled="f" stroked="t" strokecolor="${blendHex(t.c2, 1)}" strokeweight="${(t.w2 * UNIT_PT).toFixed(2)}pt"/>`;
        }
        return s;
      })()
    : '';

  /* vertical side label — a rotated VML textbox centered on the SVG text
     anchor (rotate 270° clockwise ≡ SVG rotate(-90)) */
  const sideText = art.sideText
    ? (() => {
        const w = 320;
        const h = 60;
        const { x, y, label } = art.sideText;
        return (
          `<v:rect style="position:absolute;left:${round2(x - w / 2)};top:${round2(y - h / 2)};width:${w};height:${h};rotation:270;z-index:-90" filled="f" stroked="f">` +
          `<v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text:f"><div style="text-align:center;font-family:Sahel,Tahoma,sans-serif;font-size:8pt;font-weight:700;color:${DEFAULT_NAVY};direction:rtl">${escapeXml(label)}</div></v:textbox>` +
          `</v:rect>`
        );
      })()
    : '';

  return (
    `<v:group id="pnPageBorder" style="position:absolute;left:0;top:0;width:${A4_W_PT}pt;height:${A4_H_PT}pt;mso-position-horizontal-relative:page;mso-position-vertical-relative:page;z-index:-100" coordorigin="0,0" coordsize="${VW},${VH}">` +
    fills + strokes + innerFrame + pageTab + cornerDots + sideText +
    `</v:group>`
  );
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
