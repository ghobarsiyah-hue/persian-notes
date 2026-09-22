import katex from 'katex';
import type { DocumentOutline, OutlineItem } from '@/types';

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function faDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'همین حالا';
  if (min < 60) return `${faDigits(min)} دقیقه پیش`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${faDigits(hours)} ساعت پیش`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${faDigits(days)} روز پیش`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${faDigits(months)} ماه پیش`;
  return `${faDigits(Math.floor(months / 12))} سال پیش`;
}

export function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ---------- document analysis ----------

interface JsonNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  text?: string;
}

export function collectText(node: JsonNode): string {
  let out = node.text ?? '';
  /* guard: foreign/legacy payloads may carry a non-array `content`
     (a text-only node with content:null crashed the whole editor page) */
  if (Array.isArray(node.content)) for (const c of node.content) out += ' ' + collectText(c);
  return out;
}

export function countWords(node: JsonNode): number {
  return collectText(node).split(/\s+/).filter(Boolean).length;
}

/** outline from TipTap JSON: headings + educational block titles */
export function analyzeDocument(node: JsonNode | Record<string, unknown> | null | undefined): DocumentOutline {
  const root = node as JsonNode | null;
  const items: OutlineItem[] = [];
  let blockCount = 0;

  const walk = (n: JsonNode, idBase: string) => {
    if (n.type === 'heading') {
      const level = Number(n.attrs?.level ?? 2);
      const text = collectText(n).trim() || 'بدون عنوان';
      items.push({ id: idBase, level, text });
    } else if (['calloutBlock', 'questionBlock', 'exampleBlock', 'keyTermBlock', 'comparisonTable', 'timeline', 'footnoteBlock', 'longAnswerBlock', 'highlightBox', 'referenceBlock', 'proConBlock', 'codeOutputBlock'].includes(n.type)) {
      blockCount++;
      const title =
        (n.attrs?.title as string) ||
        (n.attrs?.question as string) ||
        (n.attrs?.term as string) ||
        (n.attrs?.leftLabel as string) ||
        (n.attrs?.label as string) ||
        collectText(n).slice(0, 40);
      const prefix = n.type === 'timeline' ? '◷' : n.type === 'footnoteBlock' ? '◆' : n.type === 'longAnswerBlock' ? '✎' : n.type === 'comparisonTable' ? '⚖' : n.type === 'highlightBox' ? '◉' : n.type === 'referenceBlock' ? '▦' : n.type === 'proConBlock' ? '⚖' : n.type === 'codeOutputBlock' ? '⌨' : '◆';
      items.push({ id: idBase, level: 3, text: `${prefix} ${String(title).slice(0, 60)}` });
    }
    if (Array.isArray(n.content)) n.content.forEach((c, i) => walk(c, `${idBase}-${i}`));
  };

  if (Array.isArray(root?.content)) root.content.forEach((c, i) => walk(c, `sec-${i}`));

  const wordCount = root ? countWords(root) : 0;
  return {
    items,
    wordCount,
    charCount: root ? collectText(root).length : 0,
    blockCount,
    pageEstimate: Math.max(1, Math.ceil(wordCount / 300)),
  };
}

/** path (root → leaf) for a nested subject tree */
export function subjectPath(subjects: { _id: string; name: string; parentId: string | null }[], id?: string | null): string {
  if (!id) return '';
  const parts: string[] = [];
  let current = subjects.find((s) => s._id === id);
  let guard = 0;
  while (current && guard++ < 10) {
    parts.unshift(current.name);
    current = current.parentId ? subjects.find((s) => s._id === current!.parentId) : undefined;
  }
  return parts.join(' ← ');
}

/** render a LaTeX formula to HTML with KaTeX; falls back to plain code on error */
export function renderFormula(latex: string, displayMode = true): string {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: false, output: 'html' });
  } catch {
    return `<code>${escapeHtml(latex)}</code>`;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
