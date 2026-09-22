/* ═══════════════════════════════════════════════════════════════════════
   Editor ⇄ session sync bridge (the F in the task's implementation order:
   the collaboration adapter boundary).

   EditorPage owns the pages array and the per-page TipTap editors; this
   module owns the conversation between that world and the CollabSession's
   yjs document. Everything here is adapter plumbing — NO editor internals
   are re-implemented (no second autosave, no second page model).

   Loop prevention (task §CRITICAL — LOCAL/REMOTE/SYSTEM distinction):
     LOCAL  editor transaction → yjs type ops (y-prosemirror) → doc
            'update' event with origin !== 'server' → broadcastLocalUpdate
     REMOTE ws frame → Y.applyUpdate(doc, …, 'server') → y-prosemirror
            applies a remote PM transaction (isChangeOrigin) — the observer
            sees origin 'server' and does NOT re-broadcast
     SYSTEM seat/structure changes go through writeStructure/commitFloats
            with origin 'local' — small maps, cheap to broadcast
   The document NEVER travels as full JSON on the typing path; the only
   full-JSON frame is the deliberate persistence submission (§doc frame),
   produced by the EXISTING autosave builder.
   ═══════════════════════════════════════════════════════════════════════ */

import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import type { CollabSession, PageStructureEntry } from './session';

/** Wire the session's yjs doc so LOCAL updates fan out to the transport.
 *  Returns the unsubscribe function. Origin-tagged so remote ('server')
 *  updates are never echoed back — the echo loop is structurally absent. */
export function wireDocObserver(session: CollabSession, isEditorOnly: () => boolean): () => void {
  const handler = (update: Uint8Array, origin: unknown) => {
    if (origin === 'server') return; // remote frame — already arrived via ws
    if (isEditorOnly()) return;     // e.g. personal notes: no transport
    session.broadcastLocalUpdate(update);
  };
  session.doc.on('update', handler);
  return () => { session.doc.off('update', handler); };
}

/** Publish the current page STRUCTURE (order/kind/auto + float lists) into
 *  the shared doc so late joiners rebuild the page list deterministically.
 *  Called by EditorPage on load and on structural changes (add/delete/
 *  reorder). Page identity is the stable DocPage.id — never an index. */
export function publishStructure(
  session: CollabSession | null,
  pages: PageStructureEntry[],
  floatsByPage: Record<string, Array<Record<string, unknown>>>
): void {
  if (!session) return;
  session.doc.transact(() => {
    session.structure.set('pages', pages);
    for (const p of pages) {
      const floats = floatsByPage[p.id];
      if (floats) session.doc.getMap(`floats:${p.id}`).set('list', floats);
    }
  }, 'local');
}

/** Convert the §4-stored TipTap page JSON into the page's yjs fragment —
 *  used when THIS client is the first to open a note (room empty) so the
 *  seed happens exactly once and every other member converges to it. */
export function seedPageFragmentFromJson(session: CollabSession, pageId: string, pageJson: Record<string, unknown> | null): boolean {
  const frag = session.fragmentFor(pageId);
  if (frag.length > 0) return false; // room already has content for this page
  const blocks = Array.isArray(pageJson?.content) ? pageJson.content : [];
  const ytypes: Y.XmlElement[] = [];
  for (const b of blocks as Array<Record<string, unknown>>) {
    ytypes.push(jsonBlockToYElement(b));
  }
  session.doc.transact(() => {
    frag.insert(0, ytypes.length ? ytypes : [newParagraphYElement()]);
  }, 'local');
  return true;
}

function newParagraphYElement(): Y.XmlElement {
  return new Y.XmlElement('paragraph');
}

/** recursive TipTap JSON → y-prosemirror-compatible yjs XML.
 *  Marks become nested XmlElements named after the mark (y-prosemirror's
 *  own convention, verified: `<bold>text</bold>` round-trips); attrs are
 *  set as yjs attributes; text runs become Y.XmlText with delta marks.
 *  Equations/edu blocks/tables keep their FULL attr objects (the AST rides
 *  attrs — never flattened, task §EQUATIONS/§EDUCATIONAL BLOCKS). */
export function jsonBlockToYElement(block: Record<string, unknown>): Y.XmlElement {
  const el = new Y.XmlElement(String(block.type ?? 'paragraph'));
  const attrs = (block.attrs ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(attrs)) {
    const v: unknown = attrs[k];
    if (v !== null && v !== undefined) el.setAttribute(k, v as unknown as string);
  }
  const children: Array<Y.XmlElement | Y.XmlText> = [];
  const inner = Array.isArray(block.content) ? block.content : [];
  for (const c of inner as Array<Record<string, unknown>>) {
    if (c.type === 'text' && typeof c.text === 'string') {
      const text: string = c.text;
      const t = new Y.XmlText();
      const marks = Array.isArray(c.marks) ? c.marks : [];
      if (marks.length) {
        const attributes: Record<string, Record<string, unknown>> = {};
        for (const m of marks as Array<Record<string, unknown>>) {
          attributes[String(m.type)] = (m.attrs ?? {}) as Record<string, unknown>;
        }
        t.applyDelta([{ insert: text, attributes }]);
      } else {
        t.applyDelta([{ insert: text }]);
      }
      children.push(t);
    } else if (c.type === 'hardBreak') {
      const br = new Y.XmlElement('hardBreak');
      children.push(br);
    } else {
      children.push(jsonBlockToYElement(c));
    }
  }
  if (children.length) el.insert(0, children);
  return el;
}

/** Read one page's fragment back as TipTap JSON (client-side authoritative
 *  merge for autosave — the live editor's getJSON is primary; this is for
 *  pages whose editor is not mounted). */
export function pageJsonFromFragment(session: CollabSession, pageId: string): Record<string, unknown> | null {
  const frag = session.fragmentFor(pageId);
  if (frag.length === 0) return null;
  /* yXmlFragmentToProsemirrorJSON needs no schema — the generic JSON shape
     ({ type, attrs, content }) is what the autosave merge already handles */
  try {
    const json = yXmlFragmentToProsemirrorJSON(frag) as unknown as Record<string, unknown>;
    return json;
  } catch {
    return null;
  }
}
