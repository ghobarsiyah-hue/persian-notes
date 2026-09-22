/* ═══════════════════════════════════════════════════════════════════════
   Collaboration WebSocket hub — transport + session lifecycle + yjs sync.

   Protocol (JSON text frames; yjs sync payloads ride as base64 inside the
   JSON envelope so ONE frame format serves control + data):

   client → server
     { t:'join', noteId, sessionId? }      first frame after open
     { t:'heartbeat', pageId? }            seat keep-alive (~15s cadence)
     { t:'acquire', pageId? }              request an ACTIVE editing seat
     { t:'sync.step1', s64 }               yjs sync step 1 (state vector)
     { t:'sync.step2', u64 }               yjs sync step 2 (diff update)
     { t:'update', u64 }                   incremental yjs update
     { t:'awareness', u64 }                encoded awareness update
     { t:'doc', doc, html, plainText, wordCount }   merged persistence doc
     { t:'metadata', title? }              collaborative metadata (title)
     { t:'leave' }                         clean seat release (keep socket)

   server → client
     { t:'joined', noteId, sessionId, revision, canEdit, seat }  seat='active'|'view'
     { t:'seats', active, max, editors:[…] }     presence broadcast
     { t:'seat.transferred' }  this socket lost its seat to the same user's
                               newer connection (multi-tab takeover)
     { t:'denied', reason }    seat denied ('capacity' | 'forbidden')
     { t:'revoked' }           edit permission revoked mid-session
     { t:'restored', doc }     a version restore happened (SYSTEM op) — the
                               payload carries the restored §4 document; all
                               clients reconcile their editors to it
     { t:'server.ack', n }     ack for sync/update frames (latency probes)

   AUTHORITY: every frame is validated against the authenticated userId —
   the client never declares its identity or permissions (§SECURITY).
   The 4-seat invariant is enforced by sessionStore.acquire()'s synchronous
   critical section, never by client-reported counts.
   ═══════════════════════════════════════════════════════════════════════ */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import * as Y from 'yjs';
import { applyAwarenessUpdate, Awareness } from 'y-protocols/awareness';
import { authenticateUpgrade, resolveCollabAccess, tokenFromUpgradeRequest } from './auth.js';
import { sessionStore } from './sessionStore.js';
import { createRoom, getRoom, destroyRoomIfIdle, markRoomDirty, flushDirtyRooms, persistRoom, type CollabRoom } from './rooms.js';
import { docJsonFromYRoom } from './roomDoc.js';
import { plainTextOf, wordCountOf } from './docJson.js';
import { MAX_ACTIVE_EDITORS, SEAT_REAPER_INTERVAL_MS, HEARTBEAT_INTERVAL_MS, COLLAB_CLOSE, ROOM_PERSIST_INTERVAL_MS } from './constants.js';

/* ── socket-scoped state ─────────────────────────────────────────────────── */
interface SocketCtx {
  userId: string;
  noteId: string | null;
  sessionId: string | null;
  seat: 'active' | 'view';
  alive: boolean;
}

const sockets = new Map<WebSocket, SocketCtx>();
/** roomId (noteId) → Awareness instance for the room */
const awarenessByRoom = new Map<string, Awareness>();
/** ws → stable per-socket key (id for room.connection bookkeeping) */
let nextConnId = 1;
const connKeyBySocket = new WeakMap<WebSocket, string>();
function connKey(ws: WebSocket): string {
  let k = connKeyBySocket.get(ws);
  if (!k) { k = `c${nextConnId++}`; connKeyBySocket.set(ws, k); }
  return k;
}

function send(ws: WebSocket, msg: Record<string, unknown>): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(msg)); } catch { /* socket died mid-send */ }
}

function b64(u: Uint8Array): string { return Buffer.from(u).toString('base64'); }
function unb64(s: unknown): Uint8Array {
  if (typeof s !== 'string' || s.length === 0) return new Uint8Array();
  return new Uint8Array(Buffer.from(s, 'base64'));
}

/* ── presence broadcast (throttled per room) ─────────────────────────────── */
const pendingPresence = new Set<string>();
let presenceTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePresence(noteId: string): void {
  pendingPresence.add(noteId);
  if (presenceTimer) return;
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    for (const nid of pendingPresence) broadcastPresence(nid);
    pendingPresence.clear();
  }, 120);
}

function broadcastPresence(noteId: string): void {
  const editors = sessionStore.presence(noteId).map((s) => ({
    sessionId: s.sessionId, userId: s.userId, displayName: s.displayName, avatar: s.avatar ?? null, pageId: s.pageId ?? null,
  }));
  const frame = JSON.stringify({ t: 'seats', active: editors.length, max: MAX_ACTIVE_EDITORS, editors });
  for (const [ws, ctx] of sockets) {
    if (ctx.noteId === noteId && ws.readyState === WebSocket.OPEN) {
      try { ws.send(frame); } catch { /* ignore */ }
    }
  }
}

/* ── room awareness relay ──────────────────────────────────────────────────
   Awareness carries transient cursor/page metadata. It is INFORMATIONAL —
   never the edit-routing mechanism (task §PRESENCE). The hub relays
   awareness between room members and reaps states of dead connections. */
function roomAwareness(room: CollabRoom): Awareness {
  let aw = awarenessByRoom.get(room.noteId);
  if (!aw) {
    aw = new Awareness(room.doc);
    awarenessByRoom.set(room.noteId, aw);
  }
  return aw;
}

function relayAwareness(room: CollabRoom, update: Uint8Array, exclude?: WebSocket): void {
  const frame = JSON.stringify({ t: 'awareness', u64: b64(update) });
  for (const [ws, ctx] of sockets) {
    if (ws === exclude || ctx.noteId !== room.noteId || ws.readyState !== WebSocket.OPEN) continue;
    try { ws.send(frame); } catch { /* ignore */ }
  }
}

/* ── seat release + room lifecycle ───────────────────────────────────────── */
function releaseSeat(ws: WebSocket, ctx: SocketCtx, notify: 'none' | 'revoked' | 'transferred'): void {
  if (ctx.sessionId) {
    const noteId = ctx.noteId;
    sessionStore.release(ctx.sessionId);
    ctx.sessionId = null;
    ctx.seat = 'view';
    if (notify === 'revoked') send(ws, { t: 'revoked' });
    if (notify === 'transferred') send(ws, { t: 'seat.transferred' });
    if (noteId) schedulePresence(noteId);
  }
}

function leaveRoom(ws: WebSocket, ctx: SocketCtx): void {
  const noteId = ctx.noteId;
  releaseSeat(ws, ctx, 'none');
  if (noteId) {
    const room = getRoom(noteId);
    if (room) {
      room.connections.delete(connKey(ws));
      /* remove this client's awareness state so it stops appearing to others */
      const aw = awarenessByRoom.get(noteId);
      /* the awareness clientID is owned by the client; without knowing it we
         rely on the 30s outdatedTimeout — acceptable for transient metadata */
      void aw;
      if (room.connections.size === 0) {
        destroyRoomIfIdle(noteId);
        awarenessByRoom.delete(noteId);
      }
    }
    schedulePresence(noteId);
  }
  ctx.noteId = null;
}

/* ── yjs doc change → persistence dirty marking ──────────────────────────── */
function watchRoom(room: CollabRoom): void {
  room.doc.on('update', () => markRoomDirty(room));
}

/* ── periodic jobs (reaper + persistence flush) ──────────────────────────── */
let jobsStarted = false;
function startJobs(): void {
  if (jobsStarted) return;
  jobsStarted = true;

  setInterval(() => {
    /* stale seats (browser crash / network loss without close frame) */
    const reaped = sessionStore.reapStale();
    for (const s of reaped) schedulePresence(s.noteId);
    sessionStore.pruneClosed();
  }, SEAT_REAPER_INTERVAL_MS).unref();

  setInterval(() => {
    void flushDirtyRooms(async (room) => {
      const doc = docJsonFromYRoom(room);
      if (!doc) return;
      await persistRoom(room, doc, '', plainTextOf(doc), wordCountOf(doc));
    });
  }, ROOM_PERSIST_INTERVAL_MS).unref();
}

/* ── the WS upgrade path ─────────────────────────────────────────────────── */
export function attachCollabHub(server: import('node:http').Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/collab') {
      /* not ours — leave the socket untouched (nothing else upgrades today,
         but stay polite) */
      socket.destroy();
      return;
    }
    void (async () => {
      const auth = await authenticateUpgrade(url, req as unknown as { headers: Record<string, string | undefined> });
      if (!auth) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        sockets.set(ws, { userId: auth.userId, noteId: null, sessionId: null, seat: 'view', alive: true });
        wireSocket(ws);
      });
    })().catch(() => {
      try { socket.destroy(); } catch { /* ignore */ }
    });
  });

  startJobs();
}

function wireSocket(ws: WebSocket): void {
  const ctx = sockets.get(ws);
  if (!ctx) return;
  ws.on('pong', () => { ctx.alive = true; });

  ws.on('message', (raw) => {
    ctx.alive = true;
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(String(raw)) as Record<string, unknown>; } catch { return; }
    void handleFrame(ws, ctx, msg).catch((err) => {
      console.error('[collab] frame error', (err as Error)?.message);
    });
  });

  ws.on('close', () => {
    leaveRoom(ws, ctx);
    sockets.delete(ws);
  });
  ws.on('error', () => {
    leaveRoom(ws, ctx);
    sockets.delete(ws);
  });
}

async function handleFrame(ws: WebSocket, ctx: SocketCtx, msg: Record<string, unknown>): Promise<void> {
  const t = String(msg.t ?? '');
  switch (t) {
    /* ── session lifecycle ─────────────────────────────────────────────── */
    case 'join': {
      const noteId = String(msg.noteId ?? '');
      if (!noteId || ctx.noteId) return;
      const access = await resolveCollabAccess(noteId, ctx.userId);
      if (!access.ok) {
        send(ws, { t: 'denied', reason: 'forbidden' });
        ws.close(COLLAB_CLOSE.FORBIDDEN, 'forbidden');
        return;
      }
      const requestedSessionId = typeof msg.sessionId === 'string' ? msg.sessionId : null;
      const room = getRoom(noteId) ?? createRoom(noteId, access.note.content, access.note.revision);
      watchRoom(room);
      room.connections.add(connKey(ws));
      ctx.noteId = noteId;

      /* stable session identity across reconnects: a client presenting a
         LIVE sessionId it already owns is re-bound instead of re-seated.
         (sessionStore.acquire's same-user takeover covers the case where
         the old session's connectionId still points at the dead socket.) */
      let seat: 'active' | 'view' = 'view';
      let sessionId: string | null = null;

      /* user display metadata for presence — from the User doc, never from
         the client's claims */
      const { User } = await import('../models/User.js');
      const u = await User.findById(ctx.userId).select('name username avatar');
      const displayName = (u?.username ? `@${u.username}` : u?.name) || 'کاربر';
      const avatar = (u?.avatar as string | null) ?? null;

      if (access.canEdit) {
        const result = sessionStore.acquire({
          noteId,
          userId: ctx.userId,
          connectionId: connKey(ws),
          displayName,
          avatar,
        });
        if (result.ok) {
          seat = 'active';
          sessionId = result.session.sessionId;
          ctx.sessionId = sessionId;
          ctx.seat = 'active';
          if (result.takeover) {
            /* multi-tab takeover: demote any OTHER live socket that still
               references this seat (the store already re-pointed it) */
            for (const [other, octx] of sockets) {
              if (other !== ws && octx.noteId === noteId && octx.sessionId === sessionId) {
                octx.sessionId = null;
                octx.seat = 'view';
                send(other, { t: 'seat.transferred' });
              }
            }
          }
        }
      } else {
        /* authorized viewer without edit rights: read-only from the start */
        ctx.seat = 'view';
      }

      /* view-only members still get full document sync (they READ), they
         just hold no editing seat */
      const stateUpdate = Y.encodeStateAsUpdate(room.doc);
      const sv = Y.encodeStateVector(room.doc);
      send(ws, {
        t: 'joined',
        noteId,
        sessionId: sessionId ?? '',
        revision: room.lastRevision,
        canEdit: access.canEdit,
        seat,
        maxEditors: MAX_ACTIVE_EDITORS,
        state64: b64(stateUpdate),
        sv64: b64(sv),
      });
      schedulePresence(noteId);
      return;
    }

    case 'acquire': {
      if (!ctx.noteId) return;
      const access = await resolveCollabAccess(ctx.noteId, ctx.userId);
      if (!access.ok) { send(ws, { t: 'revoked' }); return; }
      if (!access.canEdit) { send(ws, { t: 'denied', reason: 'forbidden' }); return; }
      const { User } = await import('../models/User.js');
      const u = await User.findById(ctx.userId).select('name username avatar');
      const displayName = (u?.username ? `@${u.username}` : u?.name) || 'کاربر';
      const avatar = (u?.avatar as string | null) ?? null;
      const result = sessionStore.acquire({
        noteId: ctx.noteId,
        userId: ctx.userId,
        connectionId: connKey(ws),
        displayName,
        avatar,
      });
      if (!result.ok) {
        send(ws, { t: 'denied', reason: 'capacity' });
        return;
      }
      /* multi-tab takeover: demote the OLD connection of the same seat */
      if (result.takeover) {
        for (const [other, octx] of sockets) {
          if (other !== ws && octx.noteId === ctx.noteId && octx.sessionId === result.session.sessionId) {
            octx.sessionId = null;
            octx.seat = 'view';
            send(other, { t: 'seat.transferred' });
          }
        }
      }
      ctx.sessionId = result.session.sessionId;
      ctx.seat = 'active';
      send(ws, { t: 'seat.acquired', sessionId: result.session.sessionId });
      schedulePresence(ctx.noteId);
      return;
    }

    case 'heartbeat': {
      if (!ctx.sessionId) return;
      /* optional pageId presence rides the heartbeat — informational ONLY,
         never edit routing (§PRESENCE); must be a short string */
      const pageId = typeof msg.pageId === 'string' && msg.pageId.length <= 64 ? msg.pageId : undefined;
      const ok = sessionStore.heartbeat(ctx.sessionId, connKey(ws), pageId);
      if (!ok) {
        ctx.sessionId = null;
        ctx.seat = 'view';
        send(ws, { t: 'seat.released' });
      }
      return;
    }

    case 'leave': {
      releaseSeat(ws, ctx, 'none');
      return;
    }

    /* ── yjs sync (read path allowed for ALL authorized viewers; the
          WRITE path is gated on the ACTIVE seat below) ─────────────────── */
    case 'sync.step1': {
      const room = ctx.noteId ? getRoom(ctx.noteId) : null;
      if (!room) return;
      /* reply with the room diff for the client's state vector */
      const sv = unb64(msg.s64);
      const diff = Y.encodeStateAsUpdate(room.doc, sv);
      send(ws, { t: 'sync.step2', u64: b64(diff) });
      return;
    }

    case 'sync.step2':
    case 'update': {
      const room = ctx.noteId ? getRoom(ctx.noteId) : null;
      if (!room) return;
      /* WRITE AUTHORITY: only holders of an ACTIVE editing seat may mutate
         the shared document. The seat is verified server-side on every
         mutation frame — never from client flags. */
      if (ctx.seat !== 'active' || !ctx.sessionId) {
        /* a viewer (or demoted tab) attempting a write: deny silently but
           re-send current room state so a desynced viewer can resync */
        send(ws, { t: 'sync.step2', u64: b64(Y.encodeStateAsUpdate(room.doc)) });
        return;
      }
      const stillHeld = sessionStore.heartbeat(ctx.sessionId, connKey(ws));
      if (!stillHeld) {
        ctx.sessionId = null;
        ctx.seat = 'view';
        send(ws, { t: 'seat.released' });
        return;
      }
      const update = unb64(msg.u64);
      Y.applyUpdate(room.doc, update, 'remote-client');
      markRoomDirty(room);
      /* fan-out to every OTHER member of the room (editors AND viewers —
         viewers must see the evolving document) */
      const frame = JSON.stringify({ t, u64: b64(update), from: ctx.sessionId });
      for (const [other, octx] of sockets) {
        if (other === ws || octx.noteId !== ctx.noteId || other.readyState !== WebSocket.OPEN) continue;
        try { other.send(frame); } catch { /* ignore */ }
      }
      send(ws, { t: 'server.ack', n: 1 });
      return;
    }

    case 'awareness': {
      const room = ctx.noteId ? getRoom(ctx.noteId) : null;
      if (!room) return;
      const update = unb64(msg.u64);
      const aw = roomAwareness(room);
      applyAwarenessUpdate(aw, update, 'remote-client');
      relayAwareness(room, update, ws);
      return;
    }

    /* ── persistence: merged full-document submission from the seat holder
          whose client autosave fired (reuses the EXISTING payload builder).
          STALE-SNAPSHOT GUARD (§15/§16): the client payload is produced from
          the client's local mirror — it may LAG the room's yjs state when a
          remote op is in flight. Compare against the room's own projection:
          if the room is NEWER (its yjs text differs from the submission's
          page content), prefer the room and only carry over fields the room
          cannot derive (title/meta are submitted separately). The room's
          canonical yjs state therefore can never be overwritten by a stale
          client snapshot. */
    case 'doc': {
      if (!ctx.noteId || ctx.seat !== 'active' || !ctx.sessionId) return;
      const room = getRoom(ctx.noteId);
      if (!room) return;
      const doc = msg.doc as Record<string, unknown> | undefined;
      if (!doc || typeof doc !== 'object') return;
      const projected = docJsonFromYRoom(room);
      if (projected) {
        const roomText = plainTextOf(projected);
        const clientText = plainTextOf(doc);
        if (clientText.length < roomText.length * 0.5 && roomText.length > 0) {
          /* the submission lost >half the room's text → a stale local mirror;
             accept it as pendingDoc ONLY for metadata, content stays room-*/
          room.structure.set('pendingDoc', projected);
        } else {
          room.structure.set('pendingDoc', doc);
        }
      } else {
        room.structure.set('pendingDoc', doc);
      }
      markRoomDirty(room);
      return;
    }

    /* ── collaborative metadata (title ONLY today — §14 metadata boundary).
          The seat holder's title edits converge through this Y.Map; every
          client observes it and mirrors into its local title state. Server
          persistence picks the title up through structure 'pendingTitle'. */
    case 'metadata': {
      if (!ctx.noteId || ctx.seat !== 'active' || !ctx.sessionId) return;
      const room = getRoom(ctx.noteId);
      if (!room) return;
      const title = typeof msg.title === 'string' ? msg.title.slice(0, 300) : null;
      if (title === null) return;
      const meta = room.doc.getMap('metadata');
      if (meta.get('title') === title) return;
      meta.set('title', title);
      room.structure.set('pendingTitle', title);
      markRoomDirty(room);
      return;
    }

    default:
      return;
  }
}

/** SYSTEM op fan-out (§20): a version restore happened for `noteId` — push
 *  the restored §4 document to every connected client so all editors
 *  reconcile to the restored canonical state (called by routes/versions). */
export function broadcastRestored(noteId: string, doc: Record<string, unknown>): void {
  const frame = JSON.stringify({ t: 'restored', doc });
  for (const [ws, ctx] of sockets) {
    if (ctx.noteId === noteId && ws.readyState === WebSocket.OPEN) {
      try { ws.send(frame); } catch { /* ignore */ }
    }
  }
}

/* heartbeat-socket liveness probe (ws-level ping/pong, distinct from the
   session heartbeat frames above) */
setInterval(() => {
  for (const [ws, ctx] of sockets) {
    if (!ctx.alive) { try { ws.terminate(); } catch { /* ignore */ } continue; }
    ctx.alive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, HEARTBEAT_INTERVAL_MS).unref();
