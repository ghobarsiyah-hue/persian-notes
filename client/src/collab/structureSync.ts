/* ═══════════════════════════════════════════════════════════════════════
   structureSync — SEMANTIC page-structure collaboration (§2–§6).

   Responsibilities (and NOTHING else):
     OUT (local user actions)  → semantic ops on the session doc:
                                 CREATE_PAGE / DELETE_PAGE / MOVE_PAGE /
                                 UPDATE_PAGE_KIND / UPDATE_PAGE_AUTO_STATE
     IN  (remote canonical ops) → reconcile the EditorPage pages state with
                                  the semantic structure (pageOrder+pageMeta)
                                 — deterministic, no setTimeout ordering: the
                                 Y.Doc IS the synchronization authority and
                                 this module only PROJECTS it into React.

   Rules honored (§22/§23/§24):
     - pageId is the ONLY identity; pageNumber is derived (idx+1) at reconcile
     - remote structural changes never touch local editors' yjs fragments
       directly — new pages start with an EMPTY fragment that the owner's
       text ops fill (fragment binding is page:<id>, so content follows
       through the normal CRDT path with no special ordering)
     - deleted pages are dropped from React state; stale local transactions
       against them are impossible because the editor unmounts (stable key)
     - never replaces the whole local pages array when nothing changed
       (identity-stable reconcile → no global re-render, §25)
   ═══════════════════════════════════════════════════════════════════════ */

import type { CollabSession, PageStructureEntry } from './session';
import type { PageKind } from '@/types';

/** structural identity of EditorPage's DocPage — kept structurally
 *  compatible (content may be null in legacy rows; floats are loosely
 *  typed) so the reconcile output assigns straight back into DocPage[] */
interface PageLike {
  id: string;
  pageNumber: number;
  content: Record<string, unknown> | null;
  floatingElements: unknown[];
  kind: PageKind;
  auto?: boolean;
}

/** OUT: CREATE_PAGE — call AFTER the local page object exists in React so
 *  the fragment binding (collabFragment) mounts immediately. */
export function structureCreatePage(
  session: CollabSession,
  pageId: string,
  kind: string,
  auto: boolean,
  afterId?: string
): void {
  session.opCreatePage(pageId, kind, auto, afterId);
}

/** OUT: DELETE_PAGE */
export function structureDeletePage(session: CollabSession, pageId: string): void {
  session.opDeletePage(pageId);
}

/** OUT: MOVE_PAGE — pageId placed after afterId (null = end) */
export function structureMovePage(session: CollabSession, pageId: string, afterId: string | null): void {
  session.opMovePage(pageId, afterId);
}

/** OUT: UPDATE_PAGE_KIND */
export function structureUpdateKind(session: CollabSession, pageId: string, kind: string): void {
  session.opUpdatePageMeta(pageId, { kind });
}

/** OUT: UPDATE_PAGE_AUTO_STATE */
export function structureUpdateAuto(session: CollabSession, pageId: string, auto: boolean): void {
  session.opUpdatePageMeta(pageId, { auto });
}

/**
 * IN: reconcile the local pages state from the semantic structure.
 * Returns the SAME array reference when nothing changed (identity-stable —
 * callers can skip setPages entirely and avoid re-renders, §25).
 */
export function reconcilePagesFromStructure<T extends { id: string; pageNumber: number; content: Record<string, unknown> | null; floatingElements: unknown[]; kind: PageKind; auto?: boolean; coverAttrs?: unknown }>(
  session: CollabSession,
  current: T[]
): T[] | null {
  const order = session.readPageOrder();
  if (order.length === 0) return null;
  const sameShape =
    order.length === current.length &&
    order.every((id, i) => id === current[i].id) &&
    order.every((id) => {
      const meta = session.readPageMeta(id);
      const page = current.find((p) => p.id === id);
      return page && page.kind === meta.kind && page.auto === meta.auto;
    });
  if (sameShape) return null;

  /* deterministic projection: order + meta WIN (canonical remote state —
     §23); content/floats of surviving pages are PRESERVED (existing page
     objects are reused by id so React keys and editor instances survive) */
  return order.map((id, i) => {
    const meta = session.readPageMeta(id);
    const existing = current.find((p) => p.id === id);
    return {
      id,
      pageNumber: i + 1,
      content: existing?.content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
      floatingElements: existing?.floatingElements ?? [],
      kind: (meta.kind === 'blank' || meta.kind === 'notebook' || meta.kind === 'booklet' || meta.kind === 'cover' || meta.kind === 'toc' ? meta.kind : 'framed') as PageKind,
      auto: meta.auto,
      /* PRESERVE cover metadata — the reconcile rebuilds the page list from
         structure alone; dropping this field wiped every cover sheet on
         each remote structural op (reconile runs on any room change) */
      coverAttrs: existing?.coverAttrs,
    };
  }) as unknown as T[];
}

/** semantic structure entries (for the legacy mirror upkeep) */
export function structureEntries(session: CollabSession): PageStructureEntry[] {
  return session.readStructure();
}

/**
 * SYSTEM op (§20): apply a restored §4 document to the LOCAL editor state.
 * The server already applied it to the room; this only re-projects the
 * local React pages from the restored JSON (split happens in EditorPage —
 * it owns splitDocIntoPages). Returns the restored page list, or null when
 * the payload is not a valid doc.
 */
export function pagesFromRestoredDoc(
  restoredDoc: Record<string, unknown> | null | undefined,
  split: (doc: Record<string, unknown> | null) => Array<{ id?: string; content: Record<string, unknown>; kind: PageKind; auto: boolean }>
): Array<{ id?: string; content: Record<string, unknown>; kind: PageKind; auto: boolean }> | null {
  if (!restoredDoc || typeof restoredDoc !== 'object' || restoredDoc.type !== 'doc') return null;
  return split(restoredDoc);
}
