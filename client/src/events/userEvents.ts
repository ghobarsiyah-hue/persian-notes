/**
 * UserEvent — lightweight pub/sub abstraction for user-level events.
 *
 * A typed, dependency-free emitter: producers (autosave, editor, future
 * collaboration/group systems) emit; any number of consumers subscribe.
 * Deliberately NOT a database layer — when groups/clubs later need a
 * server-side activity feed they can mirror these events to an API from a
 * single subscriber without touching the emitters.
 *
 * Event types shipped today: note.* and highlight.*. Future names
 * (group.*, club.*, note.shared, user.mentioned, collab.*) are documented
 * in the union's extension guide below but NOT emitted anywhere yet —
 * no speculative UI or data is built for them (§9).
 */

export type UserEventType =
  /* ── shipped today ─────────────────────────────────────────────── */
  | 'note.created'
  | 'note.updated'
  | 'note.saved'
  | 'note.restored'
  | 'highlight.created'
  | 'highlight.removed'
  /* ── groups foundation (emitted from group pages only) ────────── */
  | 'group.created'
  | 'group.member.joined'
  | 'group.member.left'
  /* ── reserved for future layers (do NOT emit yet) ─────────────── */
  | 'club.created'
  | 'note.shared'
  | 'note.commented'
  | 'user.mentioned'
  | 'collab.session.joined'
  | 'collab.session.left';

export interface UserEvent {
  /** who did it — the authenticated user id; anonymous/unknown = null */
  actorId: string | null;
  targetType: 'note' | 'highlight' | 'user' | 'group' | 'club' | 'system';
  targetId: string | null;
  eventType: UserEventType;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

type Listener = (event: UserEvent) => void;

const listeners = new Set<Listener>();

/** emit a user event — cheap, synchronous, never throws into the caller
 *  (a broken listener must not break the editor — §19) */
export function emitUserEvent(
  eventType: UserEventType,
  detail: { actorId?: string | null; targetType?: UserEvent['targetType']; targetId?: string | null; metadata?: Record<string, unknown> } = {}
): void {
  const event: UserEvent = {
    actorId: detail.actorId ?? null,
    targetType: detail.targetType ?? 'system',
    targetId: detail.targetId ?? null,
    eventType,
    timestamp: Date.now(),
    metadata: detail.metadata,
  };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('[userEvents] listener failed for', eventType, err);
    }
  }
}

/** subscribe; returns the unsubscribe function */
export function onUserEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** test/dev helper: drop every listener */
export function clearUserEventListeners(): void {
  listeners.clear();
}
