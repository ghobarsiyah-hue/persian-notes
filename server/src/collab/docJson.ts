/** Server-side TipTap-JSON text extraction (mirrors the client's
 *  plainTextOf in Page.tsx — plain recursive text walk, no DOM). Kept in
 *  ONE place so persistence always derives plainText/wordCount the same
 *  way the REST autosave does. */
export function plainTextOf(json: unknown): string {
  let out = '';
  const walk = (n: unknown) => {
    const node = n as { text?: string; content?: unknown[] } | null;
    if (node && typeof node.text === 'string') out += node.text + ' ';
    if (node && Array.isArray(node.content)) node.content.forEach(walk);
  };
  const root = json as { content?: unknown[] } | null;
  if (Array.isArray(root?.content)) root!.content.forEach(walk);
  return out.trim();
}

/** word-count heuristic consistent with the client's fa.ts analyzer
 *  (whitespace split on the plain text projection). */
export function wordCountOf(json: unknown): number {
  const t = plainTextOf(json);
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}
