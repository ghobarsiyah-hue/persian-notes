/* ═══════════════════════════════════════════════════════════════════════
   TipTap JSON → y-prosemirror-compatible yjs XML (server side).

   The hub uses this when creating a room so the shared document is seeded
   deterministically from the persisted Note (§4 storage shape) — no client
   races over who seeds. Same convention as the client's collab/editorSync:
   marks become nested XmlElements, attrs ride the Y.XmlElement, text runs
   are Y.XmlText deltas. Edu-block/equation/table attrs pass through whole
   (never flattened — task §EQUATIONS/§EDUCATIONAL BLOCKS).
   ═══════════════════════════════════════════════════════════════════════ */

import * as Y from 'yjs';

export function jsonBlockToYElement(block: Record<string, unknown>): Y.XmlElement {
  const el = new Y.XmlElement(String(block.type ?? 'paragraph'));
  const attrs = (block.attrs ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(attrs)) {
    const v: unknown = attrs[k];
    if (v !== null && v !== undefined) el.setAttribute(k, v as string);
  }
  const children: Array<Y.XmlElement | Y.XmlText> = [];
  const inner = Array.isArray(block.content) ? block.content : [];
  for (const c of inner as Array<Record<string, unknown>>) {
    if (c && c.type === 'text' && typeof c.text === 'string') {
      const text: string = c.text;
      const marks = Array.isArray(c.marks) ? c.marks : [];
      if (marks.length) {
        const attributes: Record<string, Record<string, unknown>> = {};
        for (const m of marks as Array<Record<string, unknown>>) {
          attributes[String(m.type)] = (m.attrs ?? {}) as Record<string, unknown>;
        }
        children.push(textNodeWithMarks(text, attributes));
      } else {
        children.push(textNodeWithMarks(text, {}));
      }
    } else if (c && c.type === 'hardBreak') {
      children.push(new Y.XmlElement('hardBreak'));
    } else if (c) {
      children.push(jsonBlockToYElement(c));
    }
  }
  if (children.length) el.insert(0, children);
  return el;
}

/** build a text node with marks — the ytype must ALREADY be integrated in
 *  the document for the XML string to materialize, but the delta content
 *  is preserved either way (applyDelta on a detached type, then integrate). */
function textNodeWithMarks(text: string, attributes: Record<string, Record<string, unknown>>): Y.XmlText {
  const t = new Y.XmlText();
  if (Object.keys(attributes).length) {
    t.applyDelta([{ insert: text, attributes }]);
  } else {
    t.insert(0, text);
  }
  return t;
}

/** Seed ONE page fragment from its TipTap page doc. Idempotent: a fragment
 *  that already has content is left untouched (first-writer wins). */
export function seedPageFragment(doc: Y.Doc, pageId: string, pageJson: Record<string, unknown> | null): boolean {
  const frag = doc.getXmlFragment(`page:${pageId}`);
  if (frag.length > 0) return false;
  const blocks = Array.isArray(pageJson?.content) ? pageJson.content : [];
  const els = (blocks as Array<Record<string, unknown>>).map(jsonBlockToYElement);
  doc.transact(() => {
    frag.insert(0, els.length ? els : [new Y.XmlElement('paragraph')]);
  }, 'local');
  return true;
}

/** Convenience overload used by tests: build a seeded fragment in a
 *  throwaway doc (fragment name follows the same `page:<id>` convention). */
export function seedPageFragmentDetached(pageJson: Record<string, unknown>): Y.XmlFragment {
  const doc = new Y.Doc();
  void seedPageFragment(doc, 'detached', pageJson);
  return doc.getXmlFragment('page:detached');
}
