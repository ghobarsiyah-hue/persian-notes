/* ═══════════════════════════════════════════════════════════════════════
   yjs room registry — one shared Y.Doc per note (the collaboration state).

   ONE canonical document (task §ARCHITECTURAL PRINCIPLE): the room's Y.Doc
   is the merge point for concurrent edits; the Note model remains the
   PERSISTENCE source of truth and is refreshed FROM the room (room → Note
   PATCH-equivalent) on an interval. The existing baseRevision/409 REST
   contract is untouched — collaboration writes go through a dedicated
   internal bumpNoteContent() that mirrors what the REST PATCH does
   (content/html/plainText/wordCount/revision+1) without fighting the
   client autosave.

   ROOM LAYOUT (the multi-page contract §4):
     Y.Map 'metadata'      → title (+ future collab metadata ONLY)
     Y.Array 'pageOrder'   → the ordered pageIds (SEMANTIC structure:
                             CREATE_PAGE/DELETE_PAGE/REORDER operate on
                             entries — never a full-array replace)
     Y.Map 'pageMeta'      → pageId → { kind, auto } (UPDATE_PAGE_KIND /
                             UPDATE_PAGE_AUTO_STATE)
     Y.Map 'structure'     → compatibility + bookkeeping mirror: 'pages'
                             (derived snapshot for legacy readers),
                             lastSavedDoc/pendingDoc/lastSavedRevision
     Y.XmlFragment 'page:<pageId>'  → ONE fragment per A4 sheet
     Y.Map 'floatObj:<pageId>'      → objectId → Y.Map of properties
                             (per-OBJECT semantic float state — property
                             level merge, never a full-array replace)
     Y.Map 'floats:<pageId>'        → legacy 'list' mirror (kept in sync for
                             the §4 persistence projection only)

   pageId identity: pages are addressed by their STABLE DocPage id (derived
   deterministically from the persisted §4 doc — 'p1', the pageBreak
   'pid' attr, else the ordinal 'p<N>'; see EditorPage.splitDocIntoPages),
   never by array index — a remote edit on page 7 can never touch page 1
   (task §PAGE ARCHITECTURE).
   ═══════════════════════════════════════════════════════════════════════ */

import * as Y from 'yjs';
import { Note } from '../models/Note.js';
import { ROOM_PERSIST_INTERVAL_MS } from './constants.js';
import { seedPageFragment, jsonBlockToYElement } from './seedJson.js';

export interface CollabRoom {
  noteId: string;
  doc: Y.Doc;
  /** SEMANTIC page order — Y.Array of pageIds (reorder/create/delete are
   *  entry-level ops; pageNumber is DERIVED UI info, never identity) */
  pageOrder: Y.Array<string>;
  /** pageId → { kind, auto } — semantic per-page attributes */
  pageMeta: Y.Map<unknown>;
  /** serialized page structure (doc-level: ids/kinds/auto + per-page floats
   *  base) — versioned so clients detect structural drift cheaply */
  structure: Y.Map<unknown>;
  /** per-note single-flight persistence */
  persisting: boolean;
  dirtySince: number;
  /** Mongo revision the room was last persisted at (conflict bookkeeping) */
  lastRevision: number;
  connections: Set<string>;
  /** in-memory only — rooms without connections are dropped */
  createdAt: number;
}

const rooms = new Map<string, CollabRoom>();

export function getRoom(noteId: string): CollabRoom | undefined {
  return rooms.get(noteId);
}

export function createRoom(noteId: string, initialContent: unknown, revision: number): CollabRoom {
  const doc = new Y.Doc();
  const structure = doc.getMap('structure');
  const existing = rooms.get(noteId);
  if (existing) return existing;

  const room: CollabRoom = {
    noteId,
    doc,
    pageOrder: doc.getArray('pageOrder'),
    pageMeta: doc.getMap('pageMeta'),
    structure,
    persisting: false,
    dirtySince: 0,
    lastRevision: revision,
    connections: new Set(),
    createdAt: Date.now(),
  };
  rooms.set(noteId, room);

  /* seed from the persisted Note when the room is created on the first
     connect: page structure + float objects ride in Y.Maps keyed by pageId,
     the TEXT content is NOT seeded here — the first editor client sends
     its yjs update (the room is authoritative for yjs content once live).
     Restarts: the newest autosaved Note reloads below. */
  try {
    seedRoomFromNote(room, initialContent);
  } catch (err) {
    console.error('[collab] room seed failed', noteId, err);
  }
  return room;
}

/* ── Note ⇄ room mapping ──────────────────────────────────────────────────
   The persisted Note.content is ONE TipTap doc with pageBreak separators +
   a floatingElements key (§4). The client adapter owns split/merge — the
   SERVER only stores/returns it. Persistence keeps that exact shape. */

/** seed the room from the persisted Note (§4 storage shape): SEMANTIC page
 *  structure (pageOrder Y.Array + pageMeta Y.Map) + ONE yjs fragment per page
 *  (deterministic server-side seeding — clients never race over who seeds;
 *  task §PAGE ARCHITECTURE). Floats are seeded per-object into floatObj
 *  Y.Maps so property-level merge works from the very first frame. */
function seedRoomFromNote(room: CollabRoom, content: unknown): void {
  const structure = room.structure;
  const doc = content as { content?: Array<Record<string, unknown>>; attrs?: Record<string, unknown> } | null;
  const blocks = Array.isArray(doc?.content) ? doc!.content : [];
  /* the structure doc mirror keeps the LAST-SAVED full document so a late
     joiner can render instantly even before any yjs fragment exists */
  structure.set('lastSavedDoc', content ?? null);
  structure.set('lastSavedRevision', room.lastRevision);
  /* split into pages exactly like the client's splitDocIntoPages: top-level
     pageBreak nodes separate sheets; floats key rides the whole content */
  const floats = Array.isArray((content as Record<string, unknown>)?.floatingElements)
    ? (content as Record<string, unknown>).floatingElements as Array<Record<string, unknown>>
    : [];
  const pages: Array<{ id: string; kind: string; auto: boolean; nodes: Array<Record<string, unknown>> }> = [];
  let current = { id: `p1`, kind: 'framed', auto: false, nodes: [] as Array<Record<string, unknown>> };
  const firstKind = doc?.attrs?.pageKind;
  if (typeof firstKind === 'string' && firstKind) current.kind = firstKind;
  let ordinal = 1;
  for (const b of blocks) {
    if (b?.type === 'pageBreak') {
      pages.push(current);
      const attrs = (b.attrs ?? {}) as Record<string, unknown>;
      /* page ids are DERIVED IDENTICALLY to the client (client/src/pages/
         EditorPage.tsx splitDocIntoPages): the persisted `pid` attr when
         present, else the deterministic ordinal `p<N>`. Both sides must
         agree or their editors bind to different yjs fragments and edits
         never converge (the invariant documented in the HANDOFF). */
      ordinal += 1;
      current = {
        id: typeof attrs.pid === 'string' && attrs.pid ? attrs.pid : `p${ordinal}`,
        kind: typeof attrs.kind === 'string' && attrs.kind ? attrs.kind : 'framed',
        auto: attrs.auto === true,
        nodes: [],
      };
      continue;
    }
    current.nodes.push(b);
  }
  pages.push(current);
  /* page ids: DERIVED deterministically from the persisted pageBreak attrs
     (`pid` attr, else `p<N>` ordinal) — the SAME derivation the client uses
     at load, so a client's `page:p1` fragment IS the room's `page:p1`. */
  structure.set('pages', pages.map(({ id, kind, auto }) => ({ id, kind, auto })));
  /* SEMANTIC structure: pageOrder entries + per-page meta (kind/auto) */
  room.doc.transact(() => {
    for (const p of pages) {
      room.pageOrder.push([p.id]);
      room.pageMeta.set(p.id, { kind: p.kind, auto: p.auto });
    }
  }, 'local');
  for (const p of pages) {
    seedPageFragment(room.doc, p.id, { type: 'doc', content: p.nodes });
    /* seed the page's legacy 'floats' mirror key so legacy readers see it */
    if (!room.doc.getMap(`floats:${p.id}`).get('list')) {
      room.doc.getMap(`floats:${p.id}`).set('list', []);
    }
  }
  /* floats are note-scoped in the §4 storage shape (one flat array on the
     first page block) — seed per-object maps on the first page (clients own
     the split across pages at runtime; server keeps the whole-array mirror
     for the §4 projection) */
  if (floats.length) {
    const objMap = room.doc.getMap(`floatObj:p1`);
    room.doc.transact(() => {
      for (const f of floats) {
        const oid = String((f as Record<string, unknown>)?.id ?? '');
        if (!oid) continue;
        const yobj = objMap.get(oid) as Y.Map<unknown> | undefined;
        const props = yobj ?? objMap.set(oid, new Y.Map<unknown>()) as Y.Map<unknown>;
        if (!yobj) {
          for (const [k, v] of Object.entries(f as Record<string, unknown>)) {
            if (v !== null && v !== undefined) props.set(k, v);
          }
        }
      }
      room.doc.getMap(`floats:p1`).set('list', floats);
    }, 'local');
  }
  structure.set('pageCount', pages.length);
}

/** called by the hub when a client submits a FULL merged doc JSON produced
 *  from its live pages (persistence integration — the payload shape is
 *  exactly what the existing autosave builds). */
export function noteDocumentForPersistence(room: CollabRoom): Record<string, unknown> | null {
  const last = room.structure.get('lastSavedDoc');
  return (last as Record<string, unknown>) ?? null;
}

/** Persist the room's latest merged document into the Note model —
 *  mirrors the REST PATCH fields; bumps `revision` monotonically so the
 *  existing optimistic-concurrency bookkeeping stays coherent. Also carries
 *  the collaborative title ('pendingTitle' from the metadata frame) when a
 *  seat holder edited it since the last flush. */
export async function persistRoom(room: CollabRoom, doc: Record<string, unknown>, html: string, plainText: string, wordCount: number): Promise<void> {
  const note = await Note.findById(room.noteId).select('revision trashed title');
  if (!note || note.trashed) return; // note deleted → nothing to persist
  note.content = doc as object;
  note.html = html;
  note.plainText = plainText;
  note.wordCount = wordCount;
  const pendingTitle = room.structure.get('pendingTitle');
  if (typeof pendingTitle === 'string' && pendingTitle.trim()) note.title = pendingTitle;
  note.revision = (note.revision ?? 0) + 1;
  await note.save();
  room.lastRevision = note.revision;
  room.structure.set('lastSavedDoc', doc);
  room.structure.set('lastSavedRevision', note.revision);
  if (typeof pendingTitle === 'string') room.structure.set('lastSavedTitle', pendingTitle);
}

/** throttled persistence entry — the hub calls markRoomDirty(room) on every
 *  merged-document submission; an interval flushes at most every
 *  ROOM_PERSIST_INTERVAL_MS. */
export function markRoomDirty(room: CollabRoom): void {
  if (!room.dirtySince) room.dirtySince = Date.now();
}

/** interval tick — persist dirty rooms (single-flight per room) */
export async function flushDirtyRooms(flushRoom: (room: CollabRoom) => Promise<void>): Promise<void> {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.persisting || !room.dirtySince) continue;
    if (now - room.dirtySince < ROOM_PERSIST_INTERVAL_MS) continue;
    room.persisting = true;
    try {
      await flushRoom(room);
    } catch (err) {
      console.error('[collab] room persist failed', room.noteId, err);
    } finally {
      room.persisting = false;
      room.dirtySince = 0;
    }
  }
}

/** drop a room when nobody is connected (its doc is already persisted or
 *  will be by the final flush before the last socket leaves) */
export function destroyRoomIfIdle(noteId: string): boolean {
  const room = rooms.get(noteId);
  if (!room) return false;
  if (room.connections.size > 0) return false;
  rooms.delete(noteId);
  try { room.doc.destroy(); } catch { /* already destroyed */ }
  return true;
}

export function roomCount(): number {
  return rooms.size;
}

/* ═════════════════════════════════════════════════════════════════════
   SYSTEM ops — version restore through the live room (§20).

   A restore must NEVER be a plain REST PUT while the room keeps running:
   connected clients would keep editing the old yjs state and the next
   flush would overwrite the restored Note. Instead the restore APPLIES the
   restored §4 document INTO the room's yjs doc (explicit system
   replacement — structure + fragments + floats), so every connected
   client converges to the restored state and the next persistence flush
   writes exactly that canonical state. */

/** apply a §4 document into the room as a SYSTEM restore operation.
 *  Returns the projected canonical doc after the replacement. */
export function applySystemRestore(room: CollabRoom, restoredDoc: Record<string, unknown>): void {
  const structure = room.structure;
  const doc = restoredDoc as { content?: Array<Record<string, unknown>>; attrs?: Record<string, unknown> } | null;
  const blocks = Array.isArray(doc?.content) ? doc!.content : [];
  const floats = Array.isArray(restoredDoc?.floatingElements)
    ? (restoredDoc as Record<string, unknown>).floatingElements as Array<Record<string, unknown>>
    : [];

  /* split pages exactly like seedRoomFromNote (same derivation, same ids) */
  const pages: Array<{ id: string; kind: string; auto: boolean; nodes: Array<Record<string, unknown>> }> = [];
  let current = { id: 'p1', kind: 'framed', auto: false, nodes: [] as Array<Record<string, unknown>> };
  const firstKind = doc?.attrs?.pageKind;
  if (typeof firstKind === 'string' && firstKind) current.kind = firstKind;
  let ordinal = 1;
  for (const b of blocks) {
    if (b?.type === 'pageBreak') {
      pages.push(current);
      const attrs = (b.attrs ?? {}) as Record<string, unknown>;
      ordinal += 1;
      current = {
        id: typeof attrs.pid === 'string' && attrs.pid ? attrs.pid : `p${ordinal}`,
        kind: typeof attrs.kind === 'string' && attrs.kind ? attrs.kind : 'framed',
        auto: attrs.auto === true,
        nodes: [],
      };
      continue;
    }
    current.nodes.push(b);
  }
  pages.push(current);

  room.doc.transact(() => {
    /* 1. semantic structure replacement: truncate pageOrder to the restored
          page list (removing deleted ids drops their fragments), then push
          any NEW ids, then set per-page meta */
    const order = room.pageOrder;
    while (order.length > pages.length) order.delete(order.length - 1, 1);
    pages.forEach((p, i) => {
      if (i < order.length) {
        if (order.get(i) !== p.id) order.delete(i, 1);
      }
    });
    /* re-walk: order may now be shorter than pages (deletions) or have gaps */
    while (order.length > pages.length) order.delete(order.length - 1, 1);
    pages.forEach((p, i) => {
      if (i < order.length && order.get(i) !== p.id) {
        order.insert(i, [p.id]);
        /* the displaced id at i (if any) is either re-ordered later in the
           list or was removed — drop duplicates beyond this point */
        for (let j = i + 1; j < order.length; j++) {
          if (order.get(j) === p.id) order.delete(j, 1);
        }
      } else if (i >= order.length) {
        order.insert(order.length, [p.id]);
      }
      room.pageMeta.set(p.id, { kind: p.kind, auto: p.auto });
    });

    /* 2. content fragments: REPLACE each page's fragment content with the
          restored nodes (system op — full-content replacement is exactly
          the intent here; interactive typing never takes this path) */
    for (const p of pages) {
      const frag = room.doc.getXmlFragment(`page:${p.id}`);
      frag.delete(0, frag.length);
      const els = (Array.isArray(p.nodes) && p.nodes.length ? p.nodes : [{ type: 'paragraph' }])
        .map((n) => jsonBlockToYElement(n as Record<string, unknown>));
      frag.insert(0, els);
    }

    /* 3. floats: clear every page's floatObj map, re-seed from the restored
          array on p1 (same policy as seedRoomFromNote) */
    for (const pid of room.pageOrder.toArray()) {
      room.doc.getMap(`floatObj:${pid}`).clear();
      room.doc.getMap(`floats:${pid}`).set('list', []);
    }
    const objMap = room.doc.getMap('floatObj:p1');
    for (const f of floats) {
      const oid = String((f as Record<string, unknown>)?.id ?? '');
      if (!oid) continue;
      const props = objMap.set(oid, new Y.Map<unknown>()) as Y.Map<unknown>;
      for (const [k, v] of Object.entries(f as Record<string, unknown>)) {
        if (v !== null && v !== undefined) props.set(k, v);
      }
    }
    room.doc.getMap('floats:p1').set('list', floats);

    /* 4. bookkeeping: lastSavedDoc becomes the restored doc */
    structure.set('lastSavedDoc', restoredDoc);
    structure.set('pendingDoc', restoredDoc);
  }, 'local');
}
