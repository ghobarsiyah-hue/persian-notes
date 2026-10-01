/* ═══════════════════════════════════════════════════════════════════════
   yjs room registry — one shared Y.Doc per note (the collaboration state).

   ONE canonical document (task §ARCHITECTURAL PRINCIPLE): the room's Y.Doc
   is the merge point for concurrent edits; the Note model remains the
   PERSISTENCE source of truth and is refreshed FROM the room on an
   interval through a MONOTONIC GENERATION-GUARDED flush (see the
   DURABILITY CONTRACT on CollabRoom). The existing baseRevision/409 REST
   contract is untouched — the room's own flushes use an ATOMIC conditional
   Mongo update guarded on (trashed, revision, roomGeneration) so a REST
   autosave and a room flush can never silently overwrite each other.

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
import { ROOM_PERSIST_INTERVAL_MS, SERVER_SHUTDOWN_FLUSH_TIMEOUT_MS } from './constants.js';
import { seedPageFragment, jsonBlockToYElement } from './seedJson.js';
import { validateNoteDocument } from './validateDoc.js';
import { docJsonFromYRoom } from './roomDoc.js';
import { plainTextOf, wordCountOf } from './docJson.js';

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

  /* ── DURABILITY CONTRACT (§ reliability milestone) ─────────────────────
     roomGeneration is a MONOTONIC, SERVER-AUTHORITATIVE counter (never
     wall-clock, never client-supplied). Every canonical state that is (or
     could be) persisted carries one generation. The chain is:
       local edit → yjs canonical room state → roomGeneration++
         → pending snapshot → Mongo write (generation-guarded)
         → durableRevision acknowledged
     An async Mongo write captures an IMMUTABLE snapshot {generation, doc,
     title}; on completion it may only commit when the room's generation
     is STILL the snapshot's generation (or newer durable state has not
     already superseded it). A delayed older write can NEVER overwrite a
     newer one — generation 17 finishing after generation 18 is dropped. */
  roomGeneration: number;
  /** generation whose Mongo write SUCCEEDED (≤ roomGeneration; the gap is
   *  the unsaved window a crash could lose) */
  durableGeneration: number;
  /** Note.revision at the last successful persist — published to clients
   *  through the 'server.ack' persistence frame so THEIR next autosave
   *  bases on the fresh revision instead of racing into a 409 */
  persistedRevision: number;
  /** the pending immutable snapshot awaiting/undergoing a Mongo write */
  pendingWrite: PersistSnapshot | null;
}

/** An immutable snapshot of a canonical room state, captured at flush
 *  start. After capture the async persistence NEVER reads mutable room
 *  state — completion only compares generation numbers. */
export interface PersistSnapshot {
  generation: number;
  noteId: string;
  doc: Record<string, unknown>;
  html: string;
  plainText: string;
  wordCount: number;
  title: string | null;
  /** base revision used for the conditional Mongo update (the Note must
   *  still be at this revision — or already newer-and-equal) */
  baseRevision: number;
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
    roomGeneration: 1,
    durableGeneration: 0,
    persistedRevision: revision,
    pendingWrite: null,
  };
  rooms.set(noteId, room);

  /* seed from the persisted Note when the room is created on the first
     connect: page structure + float objects ride in Y.Maps keyed by pageId,
     the TEXT content is NOT seeded here — the first editor client sends
     its yjs update (the room is authoritative for yjs content once live).
     Restarts: the newest autosaved Note reloads below.
     CORRUPTION DEFENSE (§19): the persisted Note is UNTRUSTED input — a
     malformed document must not poison the room. On invalid input the
     room is created EMPTY (the durable Note row is left untouched as the
     last-known-good; recovery/repair happens client-side). */
  const validation = validateNoteDocument(initialContent);
  if (validation.ok) {
    try {
      seedRoomFromNote(room, initialContent);
    } catch (err) {
      console.error('[collab] room seed failed', noteId, (err as Error)?.message);
    }
  } else {
    console.error(`[collab] room ${noteId}: persisted snapshot rejected (${validation.reason}) — room seeded empty; durable Note left untouched.`);
    structure.set('lastSavedDoc', null);
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
/* ── CANONICAL SNAPSHOT CAPTURE ─────────────────────────────────────────
   One coherent §4 state: content + floats + title come from the SAME
   generation (never structure of gen 20 with title of gen 19). Called
   ONLY at flush time — never per keystroke (hot-path posture preserved). */
function captureSnapshot(room: CollabRoom, nowRevision: number, pendingTitle: string | null): PersistSnapshot | null {
  const doc = docJsonFromYRoom(room);
  if (!doc) return null;
  const v = validateNoteDocument(doc);
  if (!v.ok) {
    /* a corrupted projection never reaches Mongo (§19): log safe metadata
       only — NEVER document content — and keep the room dirty so the
       problem surfaces instead of silently writing garbage */
    console.error(`[collab] room ${room.noteId}: flush skipped — invalid projection (${v.reason})`);
    return null;
  }
  return {
    generation: room.roomGeneration,
    noteId: room.noteId,
    doc,
    html: '',
    plainText: plainTextOf(doc),
    wordCount: wordCountOf(doc),
    title: pendingTitle,
    baseRevision: nowRevision,
  };
}

/**
 * Persist ONE immutable snapshot with a MONOTONIC GENERATION GUARD.
 *
 * Ordering rules (the core anti-stale-write guarantee):
 *  1. Mongo is updated CONDITIONALLY: `revision: snapshot.baseRevision`
 *     (or ≥ it when another writer legitimately advanced the note — the
 *     room then re-reads and only commits if the stored generation is not
 *     newer). An unconditional last-write-wins never happens.
 *  2. Completion commits bookkeeping ONLY while
 *     `snapshot.generation >= room.durableGeneration`. A delayed write
 *     for generation 17 that finishes after generation 18 succeeded is
 *     DROPPED — it can neither overwrite the Note nor regress room state.
 *  3. A failed write leaves the room dirty (the flush loop retries); the
 *     snapshot is discarded — the RETRY re-captures a FRESH snapshot at
 *     the then-current generation, so a retry can never resurrect an
 *     older state either.
 *  4. A trashed/deleted note aborts the write (persistRoom refuses — the
 *     §29 no-resurrection guarantee) and drops the pending snapshot.
 */
export async function persistRoom(room: CollabRoom): Promise<void> {
  const note = await Note.findById(room.noteId).select('revision trashed title roomGeneration');
  if (!note || note.trashed) {
    room.pendingWrite = null; /* deleted → nothing may resurrect it */
    return;
  }

  const snapshot = captureSnapshot(room, note.revision ?? 0, typeof room.structure.get('pendingTitle') === 'string' ? (room.structure.get('pendingTitle') as string) : null);
  if (!snapshot) return; /* invalid projection — room stays dirty */

  /* IDEMPOTENCE (§17): skip when the canonical state is already durable —
     no revision churn, no needless 409 exposure. The room is CLEAN only
     when its content matches what was last persisted. */
  const lastSaved = room.structure.get('lastSavedDoc');
  const sameDoc = lastSaved === snapshot.doc || JSON.stringify(lastSaved) === JSON.stringify(snapshot.doc);
  const titleChanged = Boolean(snapshot.title && snapshot.title.trim() && snapshot.title !== note.title);
  if (sameDoc && !titleChanged) {
    room.durableGeneration = Math.max(room.durableGeneration, snapshot.generation);
    return;
  }

  room.pendingWrite = snapshot;
  const noteDoc = note as unknown as { roomGeneration?: number };
  const storedGeneration = typeof noteDoc.roomGeneration === 'number' ? noteDoc.roomGeneration : 0;
  if (snapshot.generation < storedGeneration) {
    /* Mongo already holds a NEWER durable snapshot than this candidate —
       the in-memory room lost the race against a later writer; adopt the
       durable state instead of regressing it (§8: no stale resurrection). */
    room.pendingWrite = null;
    console.warn(`[collab] room ${room.noteId}: in-memory generation ${snapshot.generation} behind durable ${storedGeneration} — flush aborted, re-sync required.`);
    return;
  }

  const title = snapshot.title && snapshot.title.trim() ? snapshot.title : note.title;
  /* ATOMIC CONDITIONAL UPDATE — never a read-modify-write over a whole
     document: the update lands only while the note is at the revision we
     captured (or was untouched by anyone else). A concurrent REST autosave
     that bumped `revision` makes this write a documented no-op; the next
     flush re-captures a fresh snapshot against the new revision. */
  const res = await Note.updateOne(
    {
      _id: room.noteId,
      trashed: { $ne: true },
      $or: [{ revision: snapshot.baseRevision }, { revision: { $lt: snapshot.baseRevision } }],
    },
    {
      $set: {
        content: snapshot.doc,
        html: snapshot.html,
        plainText: snapshot.plainText,
        wordCount: snapshot.wordCount,
        title,
        roomGeneration: snapshot.generation,
      },
      $inc: { revision: 1 },
    }
  );
  if (res.modifiedCount === 0) {
    room.pendingWrite = null;
    /* someone else (REST autosave / restore) advanced the note: NOT an
       error — the room stays dirty and the NEXT flush re-captures against
       the newer revision. Never blind-retry the stale payload. */
    console.warn(`[collab] room ${room.noteId}: flush generation ${snapshot.generation} skipped — note advanced concurrently (revision ${snapshot.baseRevision} → re-capture next tick).`);
    return;
  }

  /* SUCCESS — commit bookkeeping only if no newer state has taken over
     while the write was in flight (generation 10 finishing after 11 is
     dropped here, both in memory and — by construction — in Mongo). */
  if (snapshot.generation >= room.durableGeneration) {
    room.durableGeneration = snapshot.generation;
    /* the REAL post-write revision — re-read instead of assuming base+1:
       a concurrent writer may have $inc'd between our write and now, and
       the ack published to clients must be monotonic and truthful */
    const fresh = await Note.findById(room.noteId).select('revision');
    room.persistedRevision = Math.max(
      room.persistedRevision,
      fresh?.revision ?? 0,
      snapshot.baseRevision + 1
    );
    room.lastRevision = room.persistedRevision;
    room.structure.set('lastSavedDoc', snapshot.doc);
    room.structure.set('lastSavedRevision', room.persistedRevision);
    if (snapshot.title) room.structure.set('lastSavedTitle', snapshot.title);
    room.pendingWrite = null;
    console.log(`[collab] room ${room.noteId}: generation ${snapshot.generation} persisted (revision ${room.persistedRevision}).`);
  } else {
    room.pendingWrite = null;
    console.log(`[collab] room ${room.noteId}: generation ${snapshot.generation} write completed but ${room.durableGeneration} is already durable — dropped.`);
  }
}

/** throttled persistence entry — the hub calls markRoomDirty(room) on every
 *  merged-document submission; an interval flushes at most every
 *  ROOM_PERSIST_INTERVAL_MS. */
export function markRoomDirty(room: CollabRoom): void {
  if (!room.dirtySince) room.dirtySince = Date.now();
}

/** interval tick — persist dirty rooms (single-flight per room).
    RETRY-SAFE (§17): a failed persistence keeps `dirtySince` set so the
    next tick retries — a transient Mongo failure can never silently drop
    the room's unsaved collaborative state. Each retry re-captures a FRESH
    snapshot at the current generation (never replays the failed payload). */
export async function flushDirtyRooms(flushRoom?: (room: CollabRoom) => Promise<void>): Promise<void> {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.persisting || !room.dirtySince) continue;
    if (now - room.dirtySince < ROOM_PERSIST_INTERVAL_MS) continue;
    room.persisting = true;
    try {
      if (flushRoom) await flushRoom(room);
      else await persistRoom(room);
      /* success → clean ONLY when the room's canonical generation is fully
         durable. A skipped/aborted flush (concurrent REST write, stale
         generation, invalid projection) leaves durable < current and the
         room dirty — it is retried next tick, never silently dropped. */
      if (room.durableGeneration >= room.roomGeneration) room.dirtySince = 0;
    } catch (err) {
      console.error('[collab] room persist failed', room.noteId, (err as Error)?.message);
      /* dirtySince intentionally KEPT — retried on the next tick with a
         FRESH snapshot (the failed one is discarded by the capture) */
    } finally {
      room.persisting = false;
    }
  }
}

/* ═════════════════════════════════════════════════════════════════════
   GRACEFUL SHUTDOWN (§12) — flush every dirty room, bounded.

   Called by server/src/index.ts on SIGTERM/SIGINT BEFORE Mongo goes
   away. Guarantees:
     - every dirty room gets ONE final flush attempt (fresh snapshot)
     - the wait is BOUNDED (SERVER_SHUTDOWN_FLUSH_TIMEOUT_MS) — a dead
       Mongo can never hang the process exit
     - when Mongo is unavailable the failure is LOGGED and the shutdown
       proceeds; the loss window is then bounded by the same interval as
       a hard crash (honest failure, not a fake success)
   ═════════════════════════════════════════════════════════════════════ */
export async function flushAllRoomsOnShutdown(): Promise<{ flushed: number; skipped: number; failed: number }> {
  const dirty = [...rooms.values()].filter((r) => r.dirtySince && !r.persisting);
  let flushed = 0;
  let skipped = 0;
  let failed = 0;
  await Promise.race([
    Promise.all(
      dirty.map(async (room) => {
        room.persisting = true;
        try {
          await persistRoom(room);
          if (room.durableGeneration >= room.roomGeneration) {
            room.dirtySince = 0;
            flushed++;
          } else {
            /* honest accounting: the write was skipped (concurrent writer /
               stale generation) — the durable state stays authoritative */
            skipped++;
          }
        } catch (err) {
          failed++;
          console.error(`[collab] shutdown flush failed for room ${room.noteId}: ${(err as Error)?.message}`);
        } finally {
          room.persisting = false;
        }
      })
    ),
    new Promise<void>((resolve) => setTimeout(resolve, SERVER_SHUTDOWN_FLUSH_TIMEOUT_MS).unref()),
  ]);
  const timedOut = dirty.length - flushed - skipped - failed;
  console.log(`[collab] shutdown flush: ${flushed} persisted, ${skipped} skipped (newer durable state), ${failed} failed, ${timedOut} timed out (bounded at ${SERVER_SHUTDOWN_FLUSH_TIMEOUT_MS}ms).`);
  return { flushed, skipped, failed };
}

/** debug/diagnostic — current durability state of one room (never content) */
export function roomDurability(noteId: string): { roomGeneration: number; durableGeneration: number; persistedRevision: number; dirty: boolean } | null {
  const r = rooms.get(noteId);
  if (!r) return null;
  return { roomGeneration: r.roomGeneration, durableGeneration: r.durableGeneration, persistedRevision: r.persistedRevision, dirty: Boolean(r.dirtySince) };
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

/** diagnostic/ack snapshot of live rooms (never content) */
export function roomsSnapshot(): CollabRoom[] {
  return [...rooms.values()];
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
  /* CORRUPTION DEFENSE (§19): a restored snapshot is untrusted input.
     An invalid version payload must NEVER become the room's canonical
     state — the durable pre-restore Note stays the last-known-good and
     the restore route surfaces the error to the user. */
  const v = validateNoteDocument(restoredDoc);
  if (!v.ok) throw new Error(`restore rejected: ${v.reason}`);

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

    /* 4. bookkeeping: the restore is a NEW canonical generation — any older
          async flush still in flight is invalidated by the generation guard
          (its snapshot is now older than the restored state and can never
          commit). lastSavedDoc is deliberately NOT touched here: it is the
          DURABLE mirror and only a successful persistRoom may advance it.
          Setting it to the restored doc would make the next flush see
          pending==lastSaved, skip as "idempotent" and leave the restore
          unpersisted (a real bug the reliability test caught). */
    room.roomGeneration += 1;
  }, 'local');
  markRoomDirty(room);
}
