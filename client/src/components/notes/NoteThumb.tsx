import { useMemo } from 'react';
import { DEFAULT_BORDER_SETTINGS } from '@/types';
import { docJsonToHtml } from '@/utils/staticSchema';
import { renderEquationsInHtml, renderFormulasInHtml } from '@/editor/extensions/blocks';
import { pageBorderSvgString, bookletSvgString } from '@/components/border/PageBorder';
import { useApp } from '@/store/AppProvider';
import type { Note } from '@/types';

/** A4 @96dpi — same constants the editor sheets use */
const A4_W = 794;
const A4_H = 1123;

const PAGE_KINDS = ['framed', 'blank', 'notebook', 'cover', 'toc', 'booklet'];

/** split the merged note content into its FIRST page — pageBreak marks the
 *  boundary (the same contract splitDocIntoPages uses in the editor), so the
 *  thumbnail shows exactly what sheet 1 of the note looks like */
function firstPageOf(content: Record<string, unknown> | null | undefined): {
  doc: Record<string, unknown>;
  kind: string;
} {
  const attrs = ((content?.attrs ?? {}) as Record<string, unknown>);
  const rawKind = attrs.pageKind;
  const kind = typeof rawKind === 'string' && PAGE_KINDS.includes(rawKind) ? rawKind : 'framed';
  const blocks = Array.isArray(content?.content) ? (content.content as Record<string, unknown>[]) : [];
  const nodes: Record<string, unknown>[] = [];
  for (const b of blocks) {
    if ((b as { type?: string }).type === 'pageBreak') break;
    nodes.push(b);
  }
  return { doc: { type: 'doc', attrs, content: nodes }, kind };
}

/**
 * NoteThumb — a scaled-down A4 sheet preview of the note's FIRST page.
 * Content HTML comes from the static schema (identical serialization to the
 * live editor), KaTeX-rendered, laid out at real editor scale (794px) and
 * CSS-scaled into the thumb. The real frame chrome (framed/booklet SVG)
 * rides on top, so the thumb reads as "this is what page 1 looks like".
 * Purely presentational: pointer-events none, aria-hidden.
 */
export function NoteThumb({ note, width = 84, chrome = true }: {
  note: Note;
  /** rendered width in px — height follows the A4 ratio */
  width?: number;
  /** draw the page frame chrome (framed/booklet templates) */
  chrome?: boolean;
}) {
  const { settings } = useApp();

  const { html, kind, empty } = useMemo(() => {
    const { doc, kind } = firstPageOf(note.content as Record<string, unknown> | undefined);
    let h = docJsonToHtml(doc);
    if (h) {
      try { h = renderFormulasInHtml(renderEquationsInHtml(h)); } catch { /* keep source text */ }
    }
    return { html: h, kind, empty: !h };
  }, [note.content]);

  const svg = useMemo(() => {
    if (!chrome || empty) return '';
    const border = { ...DEFAULT_BORDER_SETTINGS, ...(settings?.border ?? {}) } as typeof DEFAULT_BORDER_SETTINGS;
    if (kind === 'booklet') return bookletSvgString(border, 1);
    if (kind === 'framed') return pageBorderSvgString(border, undefined, undefined, 1, 1);
    return '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, settings?.border, chrome, empty]);

  const scale = width / A4_W;

  return (
    <div
      className="pn-note-thumb shrink-0"
      style={{ width, height: Math.round(width * (A4_H / A4_W)) }}
      aria-hidden="true"
    >
      {svg ? <div className="pn-note-thumb-chrome" dangerouslySetInnerHTML={{ __html: svg }} /> : null}
      {html ? (
        <div
          className="ProseMirror pn-note-thumb-content"
          style={{ width: A4_W, height: A4_H, transform: `scale(${scale})` }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <span className="absolute inset-0 z-[2] flex items-center justify-center text-lg text-ink-300 dark:text-ink-600">▬</span>
      )}
    </div>
  );
}
