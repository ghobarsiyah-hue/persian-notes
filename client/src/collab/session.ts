/* ═══════════════════════════════════════════════════════════════════════
   Collaboration client — transport + session orchestration.

   LAYERS (task §ARCHITECTURAL PRINCIPLE — concerns stay separate):
     1. CollabTransport  — WebSocket connect/reconnect/backoff + framing.
                           Knows NOTHING about TipTap or React.
     2. CollabSession    — one user's session for one note: yjs doc, page
                           fragments, seat lifecycle, presence state.

   The EDITOR (EditorPage/Page.tsx) never touches raw WebSocket messages —
   it talks to CollabSession through the adapter boundary (task §TRANSPORT).

   DOCUMENT MODEL (task §PAGE ARCHITECTURE — one TipTap instance per A4
   sheet is PRESERVED):
     - one Y.Doc per note, with Y.XmlFragment `page:<pageId>` per sheet
     - page identity = the STABLE DocPage.id (never an array index)
     - a Y.Map `structure` mirrors page order/kind/auto + float commits so
       late joiners rebuild the page list deterministically
   CONVERGENCE: yjs (CRDT) merges concurrent transactions from all editors;
   remote updates are applied as REMOTE ProseMirror transactions by
   y-prosemirror (marked isChangeOrigin — no echo loop, no document JSON
   replacement, task §CRITICAL: TRANSACTION-BASED SYNC).
   ═══════════════════════════════════════════════════════════════════════ */

import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';
import { getToken } from '@/api/client';

/* ── shared constants (mirrored from server/src/collab/constants.ts) ────── */
export const MAX_ACTIVE_EDITORS = 4;
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** reconnect backoff ceiling */
const RECONNECT_MAX_DELAY_MS = 10_000;
const RECONNECT_BASE_DELAY_MS = 600;

export type CollabConnState = 'connecting' | 'connected' | 'reconnecting' | 'offline';
export type CollabSeatState = 'active' | 'view' | 'acquiring';
export type CollabDenyReason = 'capacity' | 'forbidden';

export interface CollabEditorPresence {
  sessionId: string;
  userId: string;
  displayName: string;
  avatar: string | null;
  pageId: string | null;
}

export interface CollabSessionState {
  conn: CollabConnState;
  seat: CollabSeatState;
  /** null while unknown/disabled — personal notes are not collaborative */
  denyReason: CollabDenyReason | null;
  activeEditors: CollabEditorPresence[];
  maxEditors: number;
  revision: number;
}

export interface PageStructureEntry {
  id: string;
  kind: string;
  auto: boolean;
}

/* ── semantic structure model (§2 canonical collaborative structure) ──────
   pageOrder: Y.Array<string> — the ONLY ordering authority (pageNumber is
   derived UI info). pageMeta: Y.Map pageId → { kind, auto }. Every
   structural change is an ENTRY-level operation (create/delete/reorder/
   kind/auto), never a whole-array replace. */

/* ── protocol frames (server/src/collab/hub.ts) ─────────────────────────── */
type ServerFrame =
  | { t: 'joined'; noteId: string; sessionId: string; revision: number; canEdit: boolean; seat: 'active' | 'view'; maxEditors: number; state64: string; sv64: string }
  | { t: 'seats'; active: number; max: number; editors: CollabEditorPresence[] }
  | { t: 'seat.acquired'; sessionId: string }
  | { t: 'seat.transferred' }
  | { t: 'seat.released' }
  | { t: 'denied'; reason: CollabDenyReason }
  | { t: 'revoked' }
  | { t: 'sync.step2'; u64: string }
  | { t: 'update'; u64: string; from?: string }
  | { t: 'awareness'; u64: string }
  | { t: 'restored'; doc: Record<string, unknown> }
  | { t: 'server.ack'; n: number };

const b64decode = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64encode = (u: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
};

/* ═════════════════════════════════════════════════════════════════════════
   1. Transport — WebSocket with exponential backoff reconnect.
   ═════════════════════════════════════════════════════════════════════════ */
type TransportEvents = {
  onOpen: () => void;
  onClose: () => void;
  onFrame: (f: ServerFrame) => void;
  onConnState: (s: CollabConnState) => void;
};

export class CollabTransport {
  private ws: WebSocket | null = null;
  private closedByUs = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private noteId: string, private events: TransportEvents) {}

  get state(): CollabConnState { return this.ws && this.ws.readyState === WebSocket.OPEN ? 'connected' : (this.closedByUs ? 'offline' : this.attempt > 0 ? 'reconnecting' : 'connecting'); }

  connect(): void {
    this.closedByUs = false;
    this.openSocket();
  }

  private openSocket(): void {
    if (this.ws) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getToken() ?? '';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}//${location.host}/api/collab?noteId=${encodeURIComponent(this.noteId)}&token=${encodeURIComponent(token)}`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.events.onConnState('connected');
      this.events.onOpen();
    };
    ws.onmessage = (ev) => {
      try { this.events.onFrame(JSON.parse(String(ev.data)) as ServerFrame); } catch { /* malformed frame */ }
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.closedByUs) { this.events.onConnState('offline'); return; }
      this.events.onConnState('reconnecting');
      this.events.onClose();
      this.scheduleReconnect();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closedByUs) return;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, this.attempt), RECONNECT_MAX_DELAY_MS);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(msg)); } catch { /* drop — CRDT resyncs */ }
    }
    /* offline: nothing to do — yjs update log replays the missing ops on
       resync (sync.step1/step2 diff), so no local edit is ever lost */
  }

  /** deliberate close (leaving the editor / new session) */
  close(): void {
    this.closedByUs = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } this.ws = null; }
    this.events.onConnState('offline');
  }
}

/* ═════════════════════════════════════════════════════════════════════════
   2. Session — yjs doc + page fragments + seat + presence.
   ═════════════════════════════════════════════════════════════════════════ */
type SessionEvents = {
  onState: (s: CollabSessionState) => void;
  /** a remote yjs update arrived (for latency QA probes) */
  onRemoteUpdate?: () => void;
  /** a SYSTEM restore landed — the editor integration must reconcile */
  onRestored?: (doc: Record<string, unknown>) => void;
};

export class CollabSession {
  readonly doc = new Y.Doc();
  readonly awareness: Awareness;
  private transport: CollabTransport | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sessionId = '';
  private destroyed = false;

  /** Set TRUE while applying OUR OWN outbound yjs ops (local transactions) —
   *  the doc observer uses it to distinguish LOCAL from REMOTE updates so
   *  remote frames are never echoed back (the forbidden loop, task §CRITICAL). */
  applyingLocal = false;

  state: CollabSessionState = {
    conn: 'connecting',
    seat: 'view',
    denyReason: null,
    activeEditors: [],
    maxEditors: MAX_ACTIVE_EDITORS,
    revision: 0,
  };

  constructor(private noteId: string, private events: SessionEvents) {
    this.awareness = new Awareness(this.doc);
  }

  /* ── page fragment registry ──────────────────────────────────────────── */
  fragmentFor(pageId: string): Y.XmlFragment {
    return this.doc.getXmlFragment(`page:${pageId}`);
  }

  /** page structure mirror (order/kind/auto) — written by EditorPage on
   *  structural changes, read by late joiners to rebuild the page list */
  get structure(): Y.Map<unknown> {
    return this.doc.getMap('structure');
  }

  /* ── SEMANTIC structure ops (§2) — entry-level, never array replace ───── */
  /** ordered pageIds — the ONLY ordering authority (pageNumber derived) */
  get pageOrder(): Y.Array<string> {
    return this.doc.getArray('pageOrder');
  }

  /** pageId → { kind, auto } */
  get pageMeta(): Y.Map<unknown> {
    return this.doc.getMap('pageMeta');
  }

  /** collaborative metadata (title) — see §14 metadata boundary */
  get metadata(): Y.Map<unknown> {
    return this.doc.getMap('metadata');
  }

  readPageOrder(): string[] {
    return this.pageOrder.toArray().filter((v): v is string => typeof v === 'string' && !!v);
  }

  readPageMeta(pageId: string): { kind: string; auto: boolean } {
    const m = this.pageMeta.get(pageId) as Record<string, unknown> | undefined;
    return { kind: typeof m?.kind === 'string' ? m.kind : 'framed', auto: m?.auto === true };
  }

  /** CREATE_PAGE — insert an id after `afterId` (or at the end) + meta */
  opCreatePage(pageId: string, kind: string, auto: boolean, afterId?: string): void {
    this.doc.transact(() => {
      const order = this.pageOrder;
      const idx = afterId ? order.toArray().indexOf(afterId) : -1;
      if (idx >= 0) order.insert(idx + 1, [pageId]);
      else order.push([pageId]);
      this.pageMeta.set(pageId, { kind, auto });
    }, 'local');
  }

  /** DELETE_PAGE — remove order entry + meta + fragments + float state.
   *  Entry-level: other pages are untouched (§4). Idempotent: deleting an
   *  unknown id is a no-op (a concurrent deleter already won). */
  opDeletePage(pageId: string): void {
    this.doc.transact(() => {
      const order = this.pageOrder;
      const idx = order.toArray().indexOf(pageId);
      if (idx >= 0) order.delete(idx, 1);
      this.pageMeta.delete(pageId);
      const frag = this.doc.getXmlFragment(`page:${pageId}`);
      frag.delete(0, frag.length);
      this.doc.getMap(`floatObj:${pageId}`).clear();
      this.doc.getMap(`floats:${pageId}`).set('list', []);
    }, 'local');
  }

  /** MOVE_PAGE — reorder by id: pull the entry out, place it immediately
   *  BEFORE `beforeId` (null = append at the end). Concurrent reorders
   *  converge through yjs list semantics (§5). */
  opMovePage(pageId: string, beforeId: string | null): void {
    this.doc.transact(() => {
      const order = this.pageOrder;
      const ids = order.toArray();
      const from = ids.indexOf(pageId);
      if (from < 0) return;
      order.delete(from, 1);
      ids.splice(from, 1);
      const targetIdx = beforeId ? ids.indexOf(beforeId) : -1;
      if (targetIdx < 0) order.push([pageId]);
      else order.insert(targetIdx, [pageId]);
    }, 'local');
  }

  /** UPDATE_PAGE_KIND / UPDATE_PAGE_AUTO_STATE — per-page attributes */
  opUpdatePageMeta(pageId: string, patch: { kind?: string; auto?: boolean }): void {
    this.doc.transact(() => {
      const cur = this.readPageMeta(pageId);
      this.pageMeta.set(pageId, { ...cur, ...patch });
    }, 'local');
  }

  /** semantic structure snapshot (order + meta) — used by receive paths and
   *  legacy `pages` mirror upkeep */
  readStructure(): PageStructureEntry[] {
    return this.readPageOrder().map((id) => ({ id, ...this.readPageMeta(id) }));
  }

  /** keep the legacy `structure.pages` mirror coherent for server-side
   *  projection fallback (writeStructure compatibility) */
  writeStructure(entries: PageStructureEntry[]): void {
    this.doc.transact(() => {
      this.structure.set('pages', entries);
    }, 'local');
  }

  /* ── floats: per-OBJECT semantic state (§7/§8) ──────────────────────── */
  /** objectId → Y.Map of properties for one page (COMMIT-oriented) */
  floatObjectsFor(pageId: string): Y.Map<unknown> {
    return this.doc.getMap(`floatObj:${pageId}`);
  }

  /** CREATE_FLOAT / full object sync on insert — one entry-level write */
  opUpsertFloat(pageId: string, obj: Record<string, unknown>): void {
    const oid = String(obj.id ?? '');
    if (!oid) return;
    const objMap = this.floatObjectsFor(pageId);
    this.doc.transact(() => {
      let props = objMap.get(oid) as Y.Map<unknown> | undefined;
      if (!(props instanceof Y.Map)) props = objMap.set(oid, new Y.Map<unknown>()) as Y.Map<unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined) continue;
        if (props.get(k) !== v) props.set(k, v);
      }
    }, 'local');
  }

  /** UPDATE_FLOAT — property-level patch: only the given keys are written,
   *  so A changing x never reverts B's concurrent width change (§8). */
  opPatchFloat(pageId: string, objectId: string, patch: Record<string, unknown>): void {
    const objMap = this.floatObjectsFor(pageId);
    const props = objMap.get(objectId) as Y.Map<unknown> | undefined;
    if (!(props instanceof Y.Map)) return; // object gone (deleted remotely)
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (props.get(k) !== v) props.set(k, v);
      }
    }, 'local');
  }

  /** DELETE_FLOAT — removes the object entry only */
  opDeleteFloat(pageId: string, objectId: string): void {
    const objMap = this.floatObjectsFor(pageId);
    this.doc.transact(() => {
      objMap.delete(objectId);
    }, 'local');
  }

  /** read one page's floats as plain objects (merged per-property) */
  readFloatObjects(pageId: string): Array<Record<string, unknown>> {
    const objMap = this.floatObjectsFor(pageId);
    const out: Array<Record<string, unknown>> = [];
    objMap.forEach((raw, oid) => {
      if (!(raw instanceof Y.Map)) return;
      const props: Record<string, unknown> = { id: oid };
      raw.forEach((v, k) => { props[k] = v; });
      out.push(props);
    });
    out.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
    return out;
  }

  /** legacy mirror — the §4 persistence projection still reads 'floats:<pid>'
   *  'list'; keep it coherent whenever per-object state changes locally */
  commitFloats(pageId: string, elements: Array<Record<string, unknown>>): void {
    const map = this.doc.getMap(`floats:${pageId}`);
    this.doc.transact(() => {
      map.set('list', elements);
    }, 'local');
  }

  readFloats(pageId: string): Array<Record<string, unknown>> | null {
    const map = this.doc.getMap(`floats:${pageId}`);
    const list = map.get('list');
    return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : null;
  }

  /* ── collaborative metadata (title — §13) ────────────────────────────── */
  /** publish a title edit (seat holders only — server enforces) */
  publishTitle(title: string): void {
    if (this.state.seat !== 'active') return;
    if (this.metadata.get('title') === title) return;
    this.metadata.set('title', title);
    this.transport?.send({ t: 'metadata', title });
  }

  readTitle(): string | null {
    const t = this.metadata.get('title');
    return typeof t === 'string' ? t : null;
  }

  /* ── lifecycle ───────────────────────────────────────────────────────── */
  start(): void {
    if (this.destroyed) return;
    this.transport = new CollabTransport(this.noteId, {
      onOpen: () => {
        /* join AFTER open; the server answers `joined` with room state */
        this.transport!.send({ t: 'join', noteId: this.noteId });
      },
      onClose: () => { /* reconnect is owned by the transport */ },
      onFrame: (f) => this.handleFrame(f),
      onConnState: (conn) => this.setState({ conn }),
    });
    this.transport.connect();
    /* session heartbeat — keep the seat alive while this tab lives. The
       CURRENT page id rides along as throttled presence metadata (one frame
       per heartbeat, not per focus change — §11). */
    let lastPresencePage: string | null = null;
    this.heartbeatTimer = setInterval(() => {
      this.transport?.send({ t: 'heartbeat', pageId: lastPresencePage ?? undefined });
    }, HEARTBEAT_INTERVAL_MS);
    /* awareness liveness (y-protocols expects periodic local state refresh);
       page changes update awareness locally AND re-publish immediately —
       the 15s heartbeat above only refreshes liveness + the same value */
    this.setAwarenessPage = (pageId: string | null) => {
      lastPresencePage = pageId;
      try {
        this.awareness.setLocalState({ pageId });
        this.transport?.send({ t: 'awareness', u64: b64encode(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) });
      } catch { /* awareness is best-effort metadata */ }
    };
    this.awareness.setLocalState({ pageId: null });
  }

  destroy(): void {
    this.destroyed = true;
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    try { this.awareness.destroy(); } catch { /* ignore */ }
    try { this.transport?.close(); } catch { /* ignore */ }
    this.transport = null;
  }

  /* ── seat operations ─────────────────────────────────────────────────── */
  /** request an editing seat (called when the user starts editing while
   *  view-only, or when a seat frees up — no page reload involved) */
  requestSeat(): void {
    if (this.state.seat === 'active' || this.state.denyReason === 'forbidden') return;
    this.setState({ seat: 'acquiring' });
    this.transport?.send({ t: 'acquire' });
  }

  releaseSeat(): void {
    if (this.state.seat !== 'active') return;
    this.transport?.send({ t: 'leave' });
    this.setState({ seat: 'view' });
  }

  /* ── yjs update plumbing ─────────────────────────────────────────────── */
  /** send LOCAL document ops to the room (called by EditorPage after its
   *  own transactions commit into this.doc). The yjs update log alone is
   *  enough — no full-document JSON ever travels for typing (§CRITICAL). */
  broadcastLocalUpdate(update: Uint8Array): void {
    this.transport?.send({ t: 'update', u64: b64encode(update) });
  }

  /** full state vector diff exchange (called on reconnect / late join) */
  requestSync(): void {
    this.transport?.send({ t: 'sync.step1', s64: b64encode(Y.encodeStateVector(this.doc)) });
  }

  /** submit the merged §4 document for persistence — produced by the
   *  EXISTING autosave payload builder; the transport forwards it, the
   *  server stores it through the room's persistence path. */
  submitDocForPersistence(doc: Record<string, unknown>): void {
    if (this.state.seat !== 'active') return;
    this.transport?.send({ t: 'doc', doc });
  }

  /** local awareness state (informational page presence only) — assigned
   *  by start() so the same value also rides the session heartbeat */
  setAwarenessPage: (pageId: string | null) => void = () => {};

  /** SYSTEM restore hook — assigned by the editor integration */
  onRestoredDoc: ((doc: Record<string, unknown>) => void) | null = null;

  /* ── frame handling ──────────────────────────────────────────────────── */
  private handleFrame(f: ServerFrame): void {
    switch (f.t) {
      case 'joined': {
        this.sessionId = f.sessionId;
        /* apply the room's current state BEFORE flipping seat state so the
           editor renders the converged document immediately */
        if (f.state64) Y.applyUpdate(this.doc, b64decode(f.state64), 'server');
        this.setState({
          seat: f.seat === 'active' ? 'active' : 'view',
          denyReason: null,
          revision: f.revision,
          maxEditors: f.maxEditors || MAX_ACTIVE_EDITORS,
        });
        if (!f.canEdit) this.setState({ denyReason: 'forbidden' });
        this.requestSync();
        return;
      }
      case 'seats': {
        this.setState({
          activeEditors: f.editors ?? [],
          maxEditors: f.max || MAX_ACTIVE_EDITORS,
          /* server is authoritative about capacity: a 'full' denial may be
             cleared the moment a seat frees up */
          ...(this.state.denyReason === 'capacity' && (f.editors?.length ?? 0) < (f.max || MAX_ACTIVE_EDITORS)
            ? { denyReason: null } : {}),
        });
        if (this.state.denyReason === 'capacity' && this.state.seat === 'view') {
          /* seat may have opened — try to upgrade WITHOUT a page reload */
          this.requestSeat();
        }
        return;
      }
      case 'seat.acquired': {
        this.sessionId = f.sessionId;
        this.setState({ seat: 'active', denyReason: null });
        return;
      }
      case 'seat.transferred':
      case 'seat.released': {
        /* this tab lost its seat (2nd tab took over, stale heartbeat, …) —
           degrade to VIEW-ONLY instantly, never mid-edit ghost-writing */
        this.setState({ seat: 'view' });
        return;
      }
      case 'denied': {
        this.setState({ seat: 'view', denyReason: f.reason });
        return;
      }
      case 'revoked': {
        /* permission/membership revoked mid-session — server already
           released the seat; become view-only (or disconnected next join) */
        this.setState({ seat: 'view', denyReason: 'forbidden' });
        return;
      }
      case 'restored': {
        /* SYSTEM op (§20): a version restore landed in the room — the yjs
           ops inside the frame already reconcile pages/fragments/floats via
           the doc observer; this hook lets the editor integration guard
           local UI state (active page) and inform the user. */
        this.onRestoredDoc?.(f.doc);
        this.events.onRestored?.(f.doc);
        return;
      }
      case 'sync.step2': {
        if (f.u64) Y.applyUpdate(this.doc, b64decode(f.u64), 'server');
        return;
      }
      case 'update': {
        if (f.u64) {
          Y.applyUpdate(this.doc, b64decode(f.u64), 'server');
          this.events.onRemoteUpdate?.();
        }
        return;
      }
      case 'awareness': {
        try { applyAwarenessUpdate(this.awareness, b64decode(f.u64), 'server'); } catch { /* metadata only */ }
        return;
      }
      default:
        return;
    }
  }

  private setState(patch: Partial<CollabSessionState>): void {
    this.state = { ...this.state, ...patch };
    this.events.onState(this.state);
  }

  get currentSessionId(): string { return this.sessionId; }
}

/* re-exports used by the editor integration */
export { b64encode, b64decode };
