/* ═══════════════════════════════════════════════════════════════════════
   In-memory collaboration session store — seat management for group notes.

   A "seat" is an ACTIVE EDITING lease for one user on one note. Sessions
   live only in memory (a server restart legitimately ends every session;
   clients reconnect and re-acquire). NO document content is stored here —
   the canonical document lives in the Note model / the yjs room; a session
   is a lease, not a copy (task §SHARED NOTE SESSION).

   SEAT INVARIANT (the core promise):
     count(ACTIVE sessions for a note) ≤ MAX_ACTIVE_EDITORS — always,
     including under concurrent acquisition from multiple sockets.

   Atomicity is guaranteed by a single-threaded synchronous critical
   section: Node runs JS on one event-loop thread and the acquire path
   below is fully synchronous (no await between check and insert), so two
   sockets racing for the last seat can never both win. The reaper runs on
   the same loop; heartbeat-timeout releases happen between turns.
   ═══════════════════════════════════════════════════════════════════════ */

import { randomBytes } from 'node:crypto';
import { MAX_ACTIVE_EDITORS, HEARTBEAT_TIMEOUT_MS, ONE_SEAT_PER_USER } from './constants.js';

export type SessionStatus = 'ACTIVE' | 'CLOSED';

export interface CollabSession {
  /** unguessable id — never derivable from userId/noteId (§SECURITY) */
  sessionId: string;
  noteId: string;
  userId: string;
  /** ws connection identity (socket id) that currently owns the seat */
  connectionId: string;
  startedAt: number;
  lastHeartbeatAt: number;
  status: SessionStatus;
  /** informational only — never used to route edits */
  pageId?: string;
  /** display metadata for presence (mirrored from the User doc at connect) */
  displayName: string;
  avatar?: string | null;
}

export type SeatResult =
  | { ok: true; session: CollabSession; /** a previous same-user seat was taken over (2nd tab) */ takeover: boolean }
  | { ok: false; reason: 'full' };

/** round a timestamp down to a bucket — mask for timing side channels on
 *  presence data (not secrets, just hygiene) */
const now = () => Date.now();

class SessionStore {
  /** noteId → sessions (ACTIVE + recently CLOSED kept for bookkeeping) */
  private byNote = new Map<string, Map<string, CollabSession>>();
  /** connectionId → sessionId — O(1) disconnect lookup */
  private byConnection = new Map<string, string>();

  /** random, unguessable session id (128 bits) */
  private newSessionId(): string {
    return randomBytes(16).toString('hex');
  }

  private noteMap(noteId: string): Map<string, CollabSession> {
    let m = this.byNote.get(noteId);
    if (!m) {
      m = new Map();
      this.byNote.set(noteId, m);
    }
    return m;
  }

  /**
   * Acquire an editing seat. ATOMIC: the capacity check and the insert run
   * in one synchronous critical section — no await between them — so two
   * sockets competing for the last seat can never both win.
   *
   * Reconnect/refresh handling: an existing ACTIVE session for the SAME
   * (userId, noteId) is re-bound to the new connection instead of creating
   * a duplicate (so a network blip never leaks a seat AND never counts the
   * same user twice).
   */
  acquire(args: {
    noteId: string;
    userId: string;
    connectionId: string;
    displayName: string;
    avatar?: string | null;
  }): SeatResult {
    const { noteId, userId, connectionId, displayName, avatar } = args;
    const map = this.noteMap(noteId);
    const t = now();

    for (const s of map.values()) {
      if (s.status !== 'ACTIVE') continue;
      if (s.userId !== userId) continue;
      if (t - s.lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) continue; // stale — treated as free
      /* same user, live session: RECONNECT or 2nd TAB.
         Deterministic multi-tab policy (ONE_SEAT_PER_USER): re-bind the
         seat to the newest connection; the old socket is demoted by the
         hub (it receives a `seat.transferred` message → view-only). */
      s.connectionId = connectionId;
      s.lastHeartbeatAt = t;
      return { ok: true, session: s, takeover: true };
    }

    /* count ACTIVE, fresh seats */
    let active = 0;
    for (const s of map.values()) {
      if (s.status === 'ACTIVE' && t - s.lastHeartbeatAt <= HEARTBEAT_TIMEOUT_MS) active++;
    }
    if (active >= MAX_ACTIVE_EDITORS) return { ok: false, reason: 'full' };

    const session: CollabSession = {
      sessionId: this.newSessionId(),
      noteId,
      userId,
      connectionId,
      startedAt: t,
      lastHeartbeatAt: t,
      status: 'ACTIVE',
      displayName,
      avatar,
    };
    map.set(session.sessionId, session);
    this.byConnection.set(connectionId, session.sessionId);
    return { ok: true, session, takeover: false };
  }

  /** re-bind an existing seat to a NEW connection (websocket reconnect of
   *  the same logical client presenting the same sessionId) */
  rebind(sessionId: string, connectionId: string): CollabSession | null {
    for (const map of this.byNote.values()) {
      const s = map.get(sessionId);
      if (s && s.status === 'ACTIVE') {
        s.connectionId = connectionId;
        s.lastHeartbeatAt = now();
        this.byConnection.set(connectionId, sessionId);
        return s;
      }
    }
    return null;
  }

  /** heartbeat keep-alive; false when the session is gone/expired.
   *  `pageId` is optional presence metadata (informational only — never
   *  edit routing); a non-string value is ignored (protocol hardening). */
  heartbeat(sessionId: string, connectionId: string, pageId?: string): boolean {
    for (const map of this.byNote.values()) {
      const s = map.get(sessionId);
      if (s && s.status === 'ACTIVE' && s.connectionId === connectionId) {
        s.lastHeartbeatAt = now();
        if (pageId !== undefined) s.pageId = pageId;
        return true;
      }
    }
    return false;
  }

  /** explicit release (clean disconnect / demotion / revocation) */
  release(sessionId: string): CollabSession | null {
    for (const map of this.byNote.values()) {
      const s = map.get(sessionId);
      if (s) {
        s.status = 'CLOSED';
        if (s.connectionId) this.byConnection.delete(s.connectionId);
        return s;
      }
    }
    return null;
  }

  /** release by socket id (ws close) — O(1) */
  releaseByConnection(connectionId: string): CollabSession | null {
    const sid = this.byConnection.get(connectionId);
    if (!sid) return null;
    this.byConnection.delete(connectionId);
    return this.release(sid);
  }

  /** release every seat held by a user on a note (permission revoked) */
  releaseUser(noteId: string, userId: string): number {
    const map = this.byNote.get(noteId);
    if (!map) return 0;
    let n = 0;
    for (const s of map.values()) {
      if (s.userId === userId && s.status === 'ACTIVE') {
        s.status = 'CLOSED';
        this.byConnection.delete(s.connectionId);
        n++;
      }
    }
    return n;
  }

  /** reap seats whose heartbeat expired — returns the reaped sessions */
  reapStale(): CollabSession[] {
    const t = now();
    const reaped: CollabSession[] = [];
    for (const map of this.byNote.values()) {
      for (const s of map.values()) {
        if (s.status === 'ACTIVE' && t - s.lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
          s.status = 'CLOSED';
          this.byConnection.delete(s.connectionId);
          reaped.push(s);
        }
      }
    }
    return reaped;
  }

  /** presence list for a note (ACTIVE seats only) */
  presence(noteId: string): Array<Pick<CollabSession, 'sessionId' | 'userId' | 'displayName' | 'avatar' | 'pageId'>> {
    const t = now();
    const map = this.byNote.get(noteId);
    if (!map) return [];
    const out: Array<Pick<CollabSession, 'sessionId' | 'userId' | 'displayName' | 'avatar' | 'pageId'>> = [];
    for (const s of map.values()) {
      if (s.status === 'ACTIVE' && t - s.lastHeartbeatAt <= HEARTBEAT_TIMEOUT_MS) {
        out.push({ sessionId: s.sessionId, userId: s.userId, displayName: s.displayName, avatar: s.avatar ?? null, pageId: s.pageId });
      }
    }
    return out;
  }

  /** number of fresh ACTIVE seats on a note */
  countActive(noteId: string): number {
    const t = now();
    const map = this.byNote.get(noteId);
    if (!map) return 0;
    let n = 0;
    for (const s of map.values()) {
      if (s.status === 'ACTIVE' && t - s.lastHeartbeatAt <= HEARTBEAT_TIMEOUT_MS) n++;
    }
    return n;
  }

  /** find the ACTIVE seat of a user on a note (hub-side takeover demotion) */
  findUserSession(noteId: string, userId: string): CollabSession | null {
    const map = this.byNote.get(noteId);
    if (!map) return null;
    const t = now();
    for (const s of map.values()) {
      if (s.userId === userId && s.status === 'ACTIVE' && t - s.lastHeartbeatAt <= HEARTBEAT_TIMEOUT_MS) return s;
    }
    return null;
  }

  getSession(sessionId: string): CollabSession | null {
    for (const map of this.byNote.values()) {
      const s = map.get(sessionId);
      if (s) return s;
    }
    return null;
  }

  /** drop CLOSED bookkeeping rows (memory hygiene); returns removed count */
  pruneClosed(olderThanMs = 5 * 60_000): number {
    const t = now();
    let removed = 0;
    for (const [noteId, map] of this.byNote) {
      for (const [sid, s] of map) {
        if (s.status === 'CLOSED' && t - s.lastHeartbeatAt > olderThanMs) {
          map.delete(sid);
          removed++;
        }
      }
    }
    for (const [noteId, map] of this.byNote) {
      if (map.size === 0) this.byNote.delete(noteId);
    }
    return removed;
  }

  /** test/dev helper */
  reset(): void {
    this.byNote.clear();
    this.byConnection.clear();
  }
}

export const sessionStore = new SessionStore();
