import { getSchema, getHTMLFromFragment, type Extensions } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { buildEditorExtensions } from '@/components/editor/Page';

let cachedSchema: Schema | null = null;

/** Build (and cache) a ProseMirror schema node-for-node IDENTICAL to the
 *  live page editors' — built from the SAME extension factory
 *  (buildEditorExtensions), so every custom node (edu blocks, equations,
 *  formula, table design attrs, inline icons, list markers, …) serializes
 *  exactly like editor.getHTML() does. Returns null if extension setup
 *  throws (defensive; callers degrade to a plain-paragraph fallback). */
function staticSchema(): Schema | null {
  if (cachedSchema) return cachedSchema;
  try {
    cachedSchema = getSchema(buildEditorExtensions() as Extensions);
  } catch {
    cachedSchema = null;
  }
  return cachedSchema;
}

/** Static JSON→HTML projection of a page's TipTap JSON — the no-editor
 *  fallback that keeps `pageHtmlRef` warm for save/export when a page's
 *  editor is not mounted. Accepts a full doc ({type:'doc',…}) or a single
 *  top node (wrapped into a doc automatically). Output matches
 *  editor.getHTML() for the same document, so unmounted pages export
 *  structurally identical markup to mounted ones. Degradation: '' only
 *  when the JSON is unusable — callers substitute an empty doc. */
export function docJsonToHtml(doc: Record<string, unknown> | null | undefined): string {
  const schema = staticSchema();
  if (!schema) return '';
  try {
    const json =
      (doc as { type?: string } | null)?.type === 'doc' ? doc : { type: 'doc', content: [doc] };
    const node = schema.nodeFromJSON(json as never);
    return getHTMLFromFragment(node.content, schema);
  } catch {
    return '';
  }
}
