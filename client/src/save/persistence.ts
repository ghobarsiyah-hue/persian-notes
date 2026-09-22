/**
 * Centralized persistence layer for notes:
 *   1. saveStateMeta      — one authoritative label/color per SaveState
 *   2. pendingNoteStore   — the EXISTING `pn_pending_u-<uid>_<noteId>`
 *                           localStorage convention, upgraded to a typed
 *                           record that carries baseRevision (§5: reuse,
 *                           never a second offline storage system)
 *   3. AutosaveScheduler  — debounce/single-flight/flush scheduler with
 *                           revision-safe, out-of-order-save protection (§4)
 *
 * The scheduler lives OUTSIDE the editor hot path: producers call
 * `markDirty()` (one boolean + one state transition), and the only
 * serialization/network work happens inside the debounced flush.
 */

import type { SaveState } from '@/types';

/* ── 1. save-state metadata (single source for every indicator) ─────────── */

export const SAVE_STATE_META: Record<SaveState, { text: string; color: string; pulse: boolean }> = {
  idle: { text: 'ذخیره شد', color: '#999999', pulse: false },
  dirty: { text: 'تغییرات ذخیره‌نشده', color: '#f5a623', pulse: true },
  saving: { text: 'در حال ذخیره…', color: '#f5a623', pulse: true },
  saved: { text: 'ذخیره شد', color: '#74b2c7', pulse: false },
  offline: { text: 'آفلاین — ذخیره محلی', color: '#f5a623', pulse: true },
  pendingSync: { text: 'در انتظار همگام‌سازی', color: '#f5a623', pulse: true },
  failed: { text: 'خطا در ذخیره', color: '#ff5b4f', pulse: false },
};

/* ── 2. pending-note store (offline queue) ──────────────────────────────── */

import type { PendingNoteSave } from '@/types';

/** Offline-pending autosaves are namespaced by USER id: after a logout, user
 *  B must never be able to read (or even collide with) user A's queued
 *  document state (§7/§9 — AUTH-13). Reuses the EXISTING key format. */
export const pendingKey = (uid: string, id: string) => `pn_pending_u-${uid}_${id}`;

export const pendingNoteStore = {
  /** read the queued payload for a note, if any (typed; tolerant of the
   *  legacy un-typed shape written by older builds) */
  get(uid: string, noteId: string): PendingNoteSave | null {
    try {
      const raw = localStorage.getItem(pendingKey(uid, noteId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PendingNoteSave> & { payload?: Record<string, unknown> };
      if (!parsed) return null;
      /* legacy rows stored the payload at top level — wrap it */
      if (!parsed.payload && typeof parsed === 'object') {
        const { noteId: _n, baseRevision: _b, updatedAt: _u, payload: _p, ...rest } = parsed as Record<string, unknown>;
        return { noteId, baseRevision: 0, updatedAt: String(_u ?? new Date(0).toISOString()), payload: rest };
      }
      return { noteId, baseRevision: parsed.baseRevision ?? 0, updatedAt: parsed.updatedAt ?? new Date(0).toISOString(), payload: parsed.payload ?? {} };
    } catch {
      return null;
    }
  },

  /** queue the pending edit for a note (keeps the NEWEST payload — §3) */
  set(uid: string, noteId: string, value: Omit<PendingNoteSave, 'noteId'>): void {
    try {
      localStorage.setItem(pendingKey(uid, noteId), JSON.stringify({ noteId, ...value }));
    } catch {
      /* quota/private-mode failures must never break the editor */
    }
  },

  clear(uid: string, noteId: string): void {
    try {
      localStorage.removeItem(pendingKey(uid, noteId));
    } catch {
      /* ignore */
    }
  },
};

/* ── 3. AutosaveScheduler ───────────────────────────────────────────────── */

export interface AutosaveDeps {
  /** build the payload for the CURRENT document state (called only inside
   *  the flush — never on the typing hot path) */
  buildPayload: () => Record<string, unknown>;
  /** persist one payload; resolves with the server's revision, or throws.
   *  `baseRevision` lets the API guard against out-of-order saves. */
  send: (payload: Record<string, unknown>, baseRevision: number) => Promise<number | null>;
  /** transition the save-state machine (coalesced — see below) */
  setState: (state: SaveState) => void;
  /** authenticated user id (pending-store namespace), '' when unknown */
  userId: () => string;
  /** note id being saved (stable for this scheduler instance) */
  noteId: string;
  /** offline probe used to classify a send failure */
  isOfflineError: (err: unknown) => boolean;
  /** transient UI feedback (toast) — used ONLY for real failures */
  onError?: (message: string) => void;
  /** debounce window (ms) */
  debounceMs?: number;
}

/**
 * One scheduler per persisted document. Guarantees:
 *  - rapid `markDirty()` calls coalesce into ONE flush after `debounceMs`
 *  - never two concurrent `send`s for the same note (single-flight)
 *  - a newer `markDirty` during an in-flight send re-arms the debounce and
 *    the newest state wins — an older response can never overwrite it
 *    (revision-safe: sends carry baseRevision, conflicts surface as `failed`)
 *  - offline failures park the payload in pendingNoteStore (state → offline)
 *  - `flush()` is idempotent while a send is in flight
 */
export class AutosaveScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private dirtyAgain = false;
  /** revision the client believes the server is at (from the last response
   *  or the note's load payload); sent as baseRevision with every save */
  private baseRevision = 0;
  private destroyed = false;

  constructor(private deps: AutosaveDeps) {}

  /** seed from the note as loaded from the server (or after a conflict) */
  setBaseRevision(rev: number): void {
    if (rev > this.baseRevision) this.baseRevision = rev;
  }

  getBaseRevision(): number {
    return this.baseRevision;
  }

  /** mark the document dirty and (re)arm the debounce — the ONLY thing the
   *  editor hot path does for persistence */
  markDirty(immediate = false): void {
    if (this.destroyed) return;
    this.dirtyAgain = true;
    this.deps.setState('dirty');
    if (immediate) {
      void this.flush();
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.deps.debounceMs ?? 1500);
  }

  /** flush now (Ctrl+S, reconnect, beforeunload). Safe to call repeatedly. */
  async flush(): Promise<'saved' | 'queued' | 'failed' | 'skipped'> {
    if (this.destroyed) return 'skipped';
    if (this.inFlight) {
      /* already saving — the armed debounce (or a later markDirty) will pick
         up the newer state; do NOT double-send */
      return 'skipped';
    }
    if (!this.dirtyAgain && this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirtyAgain) return 'skipped';

    this.inFlight = true;
    this.dirtyAgain = false;
    this.deps.setState('saving');
    const uid = this.deps.userId();
    try {
      const payload = this.deps.buildPayload();
      const rev = await this.deps.send(payload, this.baseRevision);
      if (typeof rev === 'number') this.baseRevision = Math.max(this.baseRevision, rev);
      this.dirtyAgain = false;
      this.inFlight = false;
      /* edits that arrived mid-send already re-armed the timer via markDirty */
      if (!this.timer && !this.dirtyAgain) this.deps.setState('saved');
      return 'saved';
    } catch (err) {
      this.inFlight = false;
      /* revision conflict already handled INSIDE send (server revision
         re-seeded + a fresh markDirty armed) — this is a quiet retry, not
         a failure: no error toast, no 'failed' state (§16). The retry's
         payload is rebuilt from the canonical collaborative state. */
      if ((err as { handledConflict?: boolean })?.handledConflict) {
        this.deps.setState('dirty');
        return 'queued';
      }
      if (this.deps.isOfflineError(err)) {
        /* park the newest payload for the reconnect sync */
        try {
          const queued = this.deps.buildPayload();
          pendingNoteStore.set(uid, this.deps.noteId, {
            baseRevision: this.baseRevision,
            updatedAt: new Date().toISOString(),
            payload: queued,
          });
        } catch {
          /* payload build failure must not crash the editor */
        }
        this.deps.setState('offline');
        return 'queued';
      }
      this.deps.setState('failed');
      this.deps.onError?.((err as Error)?.message ?? 'خطای ناشناخته');
      return 'failed';
    }
  }

  /** called when the server reports a stale base (409) — re-seed and retry */
  handleConflict(serverRevision: number): void {
    this.setBaseRevision(serverRevision);
    this.markDirty();
  }

  /** clear the queued offline payload (after a successful sync) */
  clearPending(): void {
    pendingNoteStore.clear(this.deps.userId(), this.deps.noteId);
  }

  hasPending(): boolean {
    return pendingNoteStore.get(this.deps.userId(), this.deps.noteId) !== null;
  }

  /** called when pending edits from a PREVIOUS offline session exist and the
   *  connection is back — transitions to pendingSync and flushes */
  async syncPending(): Promise<void> {
    if (!this.hasPending()) return;
    this.deps.setState('pendingSync');
    await this.flush();
    if (!this.hasPending()) this.clearPending();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
