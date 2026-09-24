import { useEffect, useMemo, useState } from 'react';
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
  /** ── item 16: top-left header slot ── a notch cut in the TOP edge near
   *  the left corner plus the lesson/chapter label resting inside it. The
   *  user types the subject there (قالب tab → «سربرگ درس»); empty label =
   *  no notch, the frame stays continuous. */
  headerSlot: { x: number; y: number; w: number; label: string } | null;
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

  /* ── item 16: top-left header slot ──
     A shallow notch in the TOP edge near the left corner (same slicing trick
     as the page-number dome: one continuous wave, two phases) hosting the
     lesson/chapter label. v2 — user feedback: the previous 300-unit slot +
     30-unit hanging well fought the frame's rhythm and ate both width and
     height. Now: a COMPACT 210-unit notch and the text sits ON the frame
     line itself (no hanging well, no extra depth below the border) — the
     frame's own thickness is the only vertical cost. */
  const headerLabel = (settings.headerLabel ?? '').trim();
  /* v3 — user feedback: the fixed 210-unit notch ate page width even for short
     labels, the label hung BELOW the frame line, and the gold hairline under it
     landed exactly on the content's top padding (overflowing the first line).
     Now: the notch hugs the label (width ∝ text), the text is vertically
     CENTERED ON the frame band, and nothing is drawn under it — the only
     footprint is the band the frame lines already occupy. */
  const slotLabel = headerLabel.length > 18 ? `${headerLabel.slice(0, 18)}…` : headerLabel;
  const slotW = Math.min(320, Math.max(130, Math.round(slotLabel.length * 9) + 34));
  const slotXa = leftX + 20;
  const slotXb = slotXa + slotW;
  const topParts = edgeParts(leftX, topY, rightX, topY, 0.3, 2.1, 7.1, 0, 4);
  const topEdgeSliced = (xa: number, xb: number): EdgeGeom => ({
    fillPath: wavyFill(sliceX(topParts.fo, xa, xb), sliceX(topParts.fi, xa, xb)),
    fillColor: fillColor,
    strokes: [
      { path: sliceX(topParts.outer, xa, xb).path, color: secondary, width: OUTER_W * th, opacity: 1 },
      { path: sliceX(topParts.inner, xa, xb).path, color: primary, width: INNER_W * th, opacity: 1 },
      ...(style === 'ornate' ? [{ path: sliceX(topParts.extra, xa, xb).path, color: primary, width: EXTRA_W * th, opacity: 0.85 }] : []),
    ],
  });
  let headerSlot: BorderArt['headerSlot'] = null;
  if (headerLabel) {
    /* swap the continuous top edge for two phases around the notch */
    const topIdx = edges.findIndex((e) => e === edges[3]);
    if (topIdx >= 0) {
      edges[topIdx] = topEdgeSliced(slotXb, rightX);
      edges.splice(topIdx, 0, topEdgeSliced(leftX, slotXa));
    }
    /* the label rides ON the top edge: baseline such that the text's optical
       center sits on the wavy band (topY) — no dip, no rule, no depth */
    headerSlot = {
      x: slotXa,
      y: topY - 2,
      w: slotW,
      label: slotLabel,
    };
  }

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

  return { edges, innerFrame, cornerDots, sideText, pageTab, headerSlot };
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

  /* item 16: top-left header slot — label centered ON the frame band inside
     the notch (baseline = band center + half x-height), NO rule underneath:
     zero footprint beyond the band the frame lines already occupy. */
  const headerSlot = art.headerSlot
    ? (() => {
        const { x, y, w, label } = art.headerSlot;
        /* v4 — raised 2px: the text rides ON the band's upper line rather
           than dipping toward the lower one (user feedback: «متن پایین‌تر
           از خطوط قاب است»). Baseline = band center − half x-height. */
        return (
          `<text x="${x + w / 2}" y="${y + 7}" text-anchor="middle" fill="${DEFAULT_NAVY}" font-size="13" font-family="'Sahel', Tahoma, sans-serif" font-weight="700" opacity="0.92">${escapeXml(label)}</text>`
        );
      })()
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

  return `${edges}${innerFrame}${cornerDots}${sideText}${headerSlot}${pageTab}`;
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
    [settings.enabled, settings.style, settings.primaryColor, settings.secondaryColor, settings.fillColor, settings.thickness, settings.sideLabel, settings.headerLabel, subject, chapter, title, pageNumber],
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

/* ═════════════════════════════════════════════════════════════════════
   Booklet page template (خیلی سبز) — kind = 'booklet'

   A quiet, professional study-booklet frame inspired by a fine
   hand-drawn reference sheet:
     • two thin near-parallel frame lines (one fine double-ruled band)
     • subtle decorative corners
     • a small flourish ornament centered on the TOP edge
     • bottom center: a circle holding the REAL page number (Persian
       digits, faDigits — same numbering system as PageBorder's tab)
       flanked by two tiny ornamental waveform/heartbeat strokes
     • right mid-edge: a small tab box extending OUTSIDE the frame,
       filled with a fine diagonal hatch, holding LogoT.png

   COLOR SOURCE OF TRUTH: settings.primaryColor of the SAME
   BorderSettings every other template uses (قالب tab → color picker).
   secondaryColor drives the second frame line so the whole template
   re-tints coherently through the existing color system. NO parallel
   state, NO new picker.

   GEOMETRY: pure SVG in the sheet's own viewBox (0 0 794 1123) laid over
   the page like PageBorder — positioning is page-relative by
   construction, so every zoom level renders identically, and the
   floating-object bounds stay governed by pageCapacity.ts alone.

   RENDERING LAYER: this is page chrome — it never enters the
   ProseMirror document, creates no nodes/text, participates in no
   transaction, and is aria-hidden. Same guarantees as PageBorder.
   ═════════════════════════════════════════════════════════════════════ */

/* the REAL LogoT.png — same file, no duplicate asset. The editor chrome
   renders as an SVG background-image (SVG-as-image mode) where browsers
   BLOCK external resource references, so the PNG must ride INSIDE the SVG
   as a data URI. `?inline` already yields a data URI in production builds;
   in dev it is a plain URL — then the logo is fetched and converted to a
   data URI asynchronously (fire-and-forget: the very first booklet sheets
   may briefly lack the logo, and re-render as soon as it lands). No
   top-level await: the vite/es2020 build target forbids it. */
import orn7AssetUrl from '@/assets/brand/007.png?inline';
import { A4_W_PX, A4_H_PX, BOOKLET_GEOMETRY, BOOKLET_INNER_INSET } from '@/editor/pageCapacity';

/** 007.png — the right-edge ornament art (rotated 90° in the chrome). Same
 *  data-URI pipeline as the old LogoT (SVG-as-image blocks external refs;
 *  dev fetches + converts async and re-renders). */
let orn7DataUri =
  typeof orn7AssetUrl === 'string' && orn7AssetUrl.startsWith('data:')
    ? orn7AssetUrl
    : '';
const bookletLogoListeners = new Set<() => void>();
if (!orn7DataUri) {
  void fetch(orn7AssetUrl)
    .then((res) => res.blob())
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => reject(fr.error);
          fr.readAsDataURL(blob);
        }),
    )
    .then((uri) => {
      orn7DataUri = uri;
      bookletLogoListeners.forEach((fn) => fn()); // re-render open sheets
    })
    .catch(() => { /* chrome renders without the logo, never crashes */ });
}

/** Booklet viewBox — the sheet's own pixel space (matches A4_W/H_PX). */
const BW = A4_W_PX;
const BH = A4_H_PX;

/** default tint — a very soft blueprint blue (the reference sheet's tone);
 *  replaced wholesale once the user picks a template color */
const BOOKLET_DEFAULT_PRIMARY = '#a8c6e2';

/** booklet hand-drawn wobble for frame lines (viewBox units, ±w) */
function bookletWobble(x: number, y: number, len: number, horizontal: boolean, seed: number): string {
  const steps = Math.max(8, Math.floor(len / 26));
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const w = 0.9 * Math.sin(t * Math.PI * 3.1 + seed) + 0.5 * Math.sin(t * Math.PI * 7.3 + seed * 1.9);
    const px = horizontal ? x + len * t : x + w;
    const py = horizontal ? y + w : y + len * t;
    parts.push(`${i === 0 ? 'M' : 'L'} ${px.toFixed(2)},${py.toFixed(2)}`);
  }
  return parts.join(' ');
}

/** pure geometry+color builder — shared verbatim by the editor background
 *  renderer and the print/PDF string renderer (same contract as PageBorder).
 *
 *  GEOMETRY: every coordinate derives from BOOKLET_GEOMETRY (pageCapacity.ts)
 *  — the ONE contract shared with the sheet padding, the float bounds and
 *  the export paddings. No hand-copied values anywhere.
 *
 *  COLOR: the template follows the SAME BorderSettings the other templates
 *  use (قالب tab → the existing color picker). The framed template's DEFAULT
 *  navy/gold pair would read heavy on this design, so exactly those two
 *  DEFAULT values are remapped to the booklet's soft blueprint blue — a
 *  user-chosen color always passes through untouched. LogoT.png is NEVER
 *  recolored: it renders from the asset as-is. */
function buildBookletArt(settings: BorderSettings): {
  primary: string;
  secondary: string;
  lines: Array<{ d: string; w: number; c: string; o: number }>;
  corners: string;
  /** the top-edge lesson-label slot (empty when no label is set) */
  headerSlot: string;
  bottomOrnaments: string;
  logoBox: string;
} {
  const rawP = (settings.primaryColor || '').trim();
  const rawS = (settings.secondaryColor || '').trim();
  const primary = !rawP || rawP.toUpperCase() === '#1E3A5F' ? BOOKLET_DEFAULT_PRIMARY : rawP;
  /* the second frame line: a coherent lighter companion of the SAME choice */
  const secondary = !rawS || rawS.toUpperCase() === '#C5A24D'
    ? blendToward(primary, '#e8f1f9', 0.5)
    : rawS;

  /* every number below flows from the ONE booklet contract */
  const M = BOOKLET_GEOMETRY.frameInset;      // outer frame line inset
  const L = BOOKLET_INNER_INSET;              // inner frame line inset
  const AIR = BOOKLET_GEOMETRY.safeAir;
  const wO = 1.4;          // outer line stroke
  const wI = 1.1;          // inner line stroke
  const o = 0.5;           // base opacity — the frame must stay quieter than content

  const W = BW - 2 * M;
  const H = BH - 2 * M;
  const bottomY = M + H;   // outer bottom line y
  const cx = BW / 2;

  /* ── ornament zones interrupt the frame lines (the reference's rhythm:
     ────◯〰──── bottom, a rotated ornament seated ON the right edge) ── */
  const R = 17;                     // page-number circle radius
  const numGap = R + 3;             // half-width of the bottom-line interruption
  const ornW = BOOKLET_GEOMETRY.rightOrnW;   // ornament slot width (46px)
  const ornH = ornW;                // square slot — the rotated art fills it
  /* seated ON the border: the slot's right edge is FLUSH with the OUTER
     right frame line (x = M + W), spanning outward across both lines */
  const ornX = M + W - ornW;
  const ornY = BH / 2 - ornH / 2;   // ornament y-range on the right edge
  const tabGap = ornH / 2 + 8;      // half-height of the right-line interruption

  /* top edge: sliced around the header slot (same two-phase trick as the
     bottom edge / page-number circle) — an open space, no ornament */
  const headerLabel = (settings.headerLabel ?? '').trim();
  /* slot width hugs the label (v3) — the two phases below use headW/headX */
  const slotLabel2 = headerLabel.length > 18 ? headerLabel.slice(0, 18) + '…' : headerLabel;
  const headW = Math.min(320, Math.max(130, Math.round(slotLabel2.length * 9) + 34));
  const headX = BW / 2 - headW / 2;  // centered on the top edge
  const topParts = edgeParts(M, M, M + W, M, 0.7, 0.7, 0.7, 0, 0);
  const topSeg = (xa: number, xb: number): { d: string; w: number; c: string; o: number } => ({
    d: sliceX(topParts.outer, xa, xb).path,
    w: wO, c: primary, o,
  });

  const lines: Array<{ d: string; w: number; c: string; o: number }> = [
    // top edge — two phases around the header slot
    ...(headerLabel ? [topSeg(M, headX), topSeg(headX + headW, M + W)] : [topSeg(M, M + W)]),
    // left edge — continuous
    { d: bookletWobble(M, M, H, false, 3.9), w: wO, c: primary, o },
    // right outer edge — interrupted where the rotated ornament seats on it
    { d: bookletWobble(M + W, M, ornY - 8 - M, false, 1.3), w: wO, c: primary, o },
    { d: bookletWobble(M + W, ornY + tabGap, bottomY - (ornY + tabGap), false, 1.7), w: wO, c: primary, o },
    // bottom outer edge — interrupted around the page-number circle
    { d: bookletWobble(M, bottomY, cx - numGap - M, true, 2.1), w: wO, c: primary, o },
    { d: bookletWobble(cx + numGap, bottomY, M + W - (cx + numGap), true, 2.4), w: wO, c: primary, o },
    // inner frame — a fine double-ruled band G px inside; the top rule is
    // sliced around the header slot like the outer line
    ...(headerLabel ? [topSeg(L, headX + (L - M)), topSeg(headX + headW - (L - M), BW - L)] : [{ d: bookletWobble(L, L, BW - 2 * L, true, 5.2), w: wI, c: secondary, o }]),
    { d: bookletWobble(L, L, BH - 2 * L, false, 7.5), w: wI, c: secondary, o },
    { d: bookletWobble(BW - L, L, ornY - 8 - L, false, 6.1), w: wI, c: secondary, o },
    { d: bookletWobble(BW - L, ornY + tabGap, BH - L - (ornY + tabGap), false, 6.4), w: wI, c: secondary, o },
    { d: bookletWobble(L, BH - L, cx - numGap - L, true, 6.8), w: wI, c: secondary, o },
    { d: bookletWobble(cx + numGap, BH - L, BW - L - (cx + numGap), true, 7.1), w: wI, c: secondary, o },
  ];

  /* ── corners: subtle double corner ticks (hand-ruled, no heavy medallions) */
  const T = 26; // tick length
  const corner = (x: number, y: number, sx: 1 | -1, sy: 1 | -1): string =>
    `<path d="M ${x + sx * T} ${y} L ${x} ${y} L ${x} ${y + sy * T}" fill="none" stroke="${primary}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.62"/>`
    + `<path d="M ${x + sx * (T + 5)} ${y + sy * 5} L ${x + sx * 5} ${y + sy * 5} L ${x + sx * 5} ${y + sy * (T + 5)}" fill="none" stroke="${secondary}" stroke-width="1" stroke-linecap="round" opacity="0.5"/>`;
  const corners =
    corner(M, M, 1, 1) + corner(M + W, M, -1, 1)
    + corner(M, bottomY, 1, -1) + corner(M + W, bottomY, -1, -1);

  /* ── top HEADER SLOT: the mid-top flourish design is REMOVED (user
     request) — instead the top edge opens a quiet header space (same
     slicing trick as the page-number circle: one continuous wave, two
     phases) where the lesson label rests. Driven by the EXISTING
     BorderSettings.headerLabel field (قالب tab → «سربرگ درس»); empty label
     = a clean open gap, no ornament drawn. */

  /* the slot itself: the label centered ON the top frame line (band center
     y = M+2), no underline, no well — zero footprint beyond the frame band.
     Width already computed above (headW hugs the text, v3 feedback). */
  const headerSlot = headerLabel
    ? (() => {
        return `<g>`
          + `<text x="${BW / 2}" y="${M + 6}" text-anchor="middle" dominant-baseline="central" fill="${blendToward(primary, '#17324a', 0.45)}" font-size="12" font-family="'Sahel', Tahoma, sans-serif" font-weight="700" opacity="0.9">${escapeXml(slotLabel2)}</text>`
          + `</g>`;
      })()
    : '';

  /* ── bottom ornaments: the page-number circle centered IN the bottom-edge
     gap + two tiny waveform/heartbeat strokes filling the line on both
     sides — exactly the reference's ────◯〰──── cadence. No fill in the
     waves, same template color, stroke as fine as the frame itself. */
  const waveform = (dir: 1 | -1): string => {
    const x0 = cx + dir * numGap;
    const x1 = cx + dir * (numGap + 38);
    const mid = (x0 + x1) / 2;
    return `<path d="M ${x0} ${bottomY} L ${mid - dir * 9} ${bottomY} L ${mid - dir * 4.5} ${bottomY - 6.5} L ${mid + dir * 2} ${bottomY + 7} L ${mid + dir * 5.5} ${bottomY} L ${x1} ${bottomY}" fill="none" stroke="${primary}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>`;
  };
  const bottomOrnaments =
    waveform(1) + waveform(-1)
    + `<circle cx="${cx}" cy="${bottomY}" r="${R}" fill="#ffffff" stroke="${primary}" stroke-width="1.4" opacity="0.9"/>`
    + `<circle cx="${cx}" cy="${bottomY}" r="${R - 3.5}" fill="none" stroke="${secondary}" stroke-width="0.8" opacity="0.55"/>`;

  /* ── right ornament: the rotated 007.png art, NO box — seated directly ON
     the right border lines (right edge FLUSH with the outer line, spanning
     inward across both rules like a tab in the reference). Text edge stops
     safeAir px left of the slot (BOOKLET_PADDING.right = outer line + slot
     + AIR) — no overlap whatever the user types. The PNG is NEVER
     recolored; renders from the asset as-is. Static page chrome:
     pointer-events none, NOT an object, never enters the ProseMirror
     document.
     v2 — measured placement (no guessing): 007.png's visible ink sits at
     102,190..634,445 inside its 740×624 canvas (large white margins), and
     the canvas-level 'meet' fit let those margins float the art away from
     the frame band and partially OUTSIDE the outer line. Now the INK box
     itself is fitted: the drawn scale puts the ink's post-rotation
     page-width on the frame band ((M+L)/2 centerline) and the art's
     vertical center on the slot's center — در یک راستا با خطوط قاب. */
  const ornArt = orn7DataUri
    ? (() => {
        /* measured ink constants of 007.png (740×624) — see note above */
        const CANVAS_W = 740, CANVAS_H = 624;
        const INK = { x: 102, y: 190, w: 533, h: 256 };
        /* the frame band the art must read ON: outer→inner right lines */
        const bandCenter = BW - (M + L) / 2;          // ≈773 (band 770..776)
        const slotCx = ornX + ornW / 2;
        /* ink page-width target: the band (6px) + optical air on both
           sides — reads as a stripe riding the two rules */
        const inkPageW = 13;
        const scale = inkPageW / INK.h;               // post-rotate: ink page-w ← ink source-h
        const drawnW = CANVAS_W * scale;
        const drawnH = CANVAS_H * scale;
        /* pre-rotation slot coords: rotate +90° maps a point at slot-local
           y to page-x = ornX + ornW − y, so seating the ink's center on the
           band (page-x = BW − (M+L)/2) needs slot-y center = (L−M)/2. The
           ink's slot-x centers on the slot; imgLeft/imgTop are the drawn
           image's top-left offsets INSIDE the slot. */
        const inkSlotYCenter = (L - M) / 2;
        const inkSlotXC = ornW / 2;   // slot-local: ink centers on the slot
        /* «یکم بالاتر»: post-rotation page-y mirrors pre-rotation slot-x,
           so shifting the drawn image LEFT inside the slot moves the ink UP
           on the page. Named constant — user-tuned optical raise (px). */
        const LOGO_RAISE_PX = 7;
        /* top-left offsets of the drawn image inside the slot (slot-local) */
        const imgLeft = inkSlotXC - (INK.x + INK.w / 2) * scale - LOGO_RAISE_PX;
        const imgTop = inkSlotYCenter - (INK.y + INK.h / 2) * scale;
        const cxo = ornX + ornW / 2;
        const cyo = ornY + ornH / 2;
        return `<g transform="rotate(90 ${cxo.toFixed(2)} ${cyo.toFixed(2)})">`
          + `<image href="${orn7DataUri}" x="${(cxo - ornW / 2 + imgLeft).toFixed(2)}" y="${(cyo - ornH / 2 + imgTop).toFixed(2)}" width="${drawnW.toFixed(2)}" height="${drawnH.toFixed(2)}" preserveAspectRatio="xMidYMid meet"/>`
          + `</g>`;
      })()
    : '';
  const logoBox = ornArt;

  return { primary, secondary, lines, corners, headerSlot, bottomOrnaments, logoBox };
}

/** blend `hex` toward `target` by `t` ∈ [0,1] — keeps the template's second
 *  line a coherent companion of the user's color choice */
function blendToward(hex: string, target: string, t: number): string {
  const parse = (h: string): [number, number, number] => {
    const m = /^#?([0-9a-f]{6})$/i.exec((h || '').trim());
    if (!m) return [168, 198, 226];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const a = parse(hex); const b = parse(target);
  const mix = a.map((c, i) => Math.round(c * (1 - t) + b[i] * t));
  return `#${mix.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')}`;
}

/** inner SVG fragments of the booklet template (shared by both renderers) */
function bookletSvgInner(settings: BorderSettings, pageNumber?: number): string {
  const art = buildBookletArt(settings);
  /* page number: Persian digits of the REAL page index (faDigits — the same
     utility the pages sidebar and PageBorder's tab use); no hardcoded value.
     Baseline derives from the frame geometry (outer bottom line + optical
     half of the digit height) — no hand-measured offset. */
  /* digits take the template color too — darkened toward ink so they stay
     readable on any tint (the circle ring itself is art.primary) */
  const numY = BOOKLET_GEOMETRY.frameInset + (BH - 2 * BOOKLET_GEOMETRY.frameInset) + 4.5;
  const num = pageNumber != null && settings.showPageNumbers !== false
    ? `<text x="${BW / 2}" y="${numY.toFixed(2)}" text-anchor="middle" fill="${blendToward(art.primary, '#17324a', 0.5)}" font-size="12" font-family="'Sahel', Tahoma, sans-serif" font-weight="700" opacity="0.95">${faDigits(pageNumber)}</text>`
    : '';
  return art.lines.map((l) => `<path d="${l.d}" fill="none" stroke="${l.c}" stroke-width="${l.w}" opacity="${l.o}"/>`).join('')
    + art.corners + (art.headerSlot ?? '') + art.bottomOrnaments + num + art.logoBox;
}

/**
 * On-screen booklet chrome, tiled once per A4 sheet exactly like PageBorder's
 * background (repeat-y + 1123px size) — page-relative positioning by
 * construction, so every editor zoom renders identically.
 */
export function bookletBackgroundStyle(
  settings: BorderSettings,
  pageNumber?: number,
): CSSProperties {
  const svg = `<svg viewBox="0 0 ${BW} ${BH}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${bookletSvgInner(settings, pageNumber)}</svg>`;
  return {
    backgroundImage: `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`,
    backgroundSize: `100% ${A4_PAGE_H_PX}px`,
    backgroundRepeat: 'repeat-y',
    backgroundPosition: 'top center',
  };
}

/** Booklet chrome element — page chrome, aria-hidden, outside the editor DOM.
 *  Honors the shared «قاب» master switch (settings.enabled) like PageBorder.
 *  Re-renders once when the dev-mode ornament data URI lands (see orn7AssetUrl). */
export function BookletChrome({ settings, pageNumber }: { settings: BorderSettings; pageNumber?: number }) {
  const [logoTick, setLogoTick] = useState(0);
  useEffect(() => {
    if (orn7DataUri) return;
    const rerender = () => setLogoTick((t) => t + 1);
    bookletLogoListeners.add(rerender);
    return () => { bookletLogoListeners.delete(rerender); };
  }, []);
  const style = useMemo(
    () => bookletBackgroundStyle(settings, pageNumber),
    [settings.enabled, settings.primaryColor, settings.secondaryColor, settings.showPageNumbers, settings.headerLabel, pageNumber, logoTick],
  );
  if (!settings.enabled) return null;
  return <div className="page-border" style={style} aria-hidden="true" />;
}

/** Print/PDF export — same geometry in the sheet's own SVG space (the print
 *  pipeline maps px→mm uniformly, see pageModelExport.mmpx). */
export function bookletSvgString(settings: BorderSettings, pageNumber?: number): string {
  if (!settings.enabled) return '';
  return `<svg viewBox="0 0 ${BW} ${BH}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n  ${bookletSvgInner(settings, pageNumber)}\n</svg>`;
}
