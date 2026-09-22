/* ═══════════════════════════════════════════════════════════════════════
   Collaboration policy — the ONE source for every session/seat constant.

   The 4-editor limit is a SESSION limit (how many users may ACTIVELY edit
   one note at the same instant). It is deliberately NOT a group-member
   limit and NOT a read/view limit: any number of authorized members may
   open the note; only ACTIVE editing seats are capped.
   ═══════════════════════════════════════════════════════════════════════ */

/** Maximum simultaneous ACTIVE editors per note. The server enforces this
 *  atomically (see sessionStore.ts) — never trust any client-side count. */
export const MAX_ACTIVE_EDITORS = 4;

/** How often an editor client must heartbeat to keep its seat alive. */
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** A seat whose last heartbeat is older than this is stale and released. */
export const HEARTBEAT_TIMEOUT_MS = 45_000;
/** Sweep interval for the stale-seat reaper. */
export const SEAT_REAPER_INTERVAL_MS = 10_000;

/** Same-user multi-tab policy: one user holds AT MOST one ACTIVE seat per
 *  note. A second tab sends `takeover` and re-uses the seat; the old socket
 *  is demoted to view-only. Duplicate tabs therefore never consume two of
 *  the four seats, and a dead tab can never monopolize a seat. */
export const ONE_SEAT_PER_USER = true;

/** Persist the shared document back to the Note model at most this often
 *  (per room) — the existing autosave/REST pipeline remains the canonical
 *  persistence path and its baseRevision/409 contract is untouched. */
export const ROOM_PERSIST_INTERVAL_MS = 5_000;

/** Close codes / reasons sent to clients (Mirrored on the client adapter). */
export const COLLAB_CLOSE = {
  UNAUTHORIZED: 4001,
  FORBIDDEN: 4003,
  NOT_FOUND: 4004,
  /** note deleted while the session was open */
  NOTE_DELETED: 4006,
  /** server shutdown / restart */
  SERVER_SHUTDOWN: 4011,
} as const;
