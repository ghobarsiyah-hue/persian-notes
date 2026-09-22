/* ═══════════════════════════════════════════════════════════════════════
   Server-side group event log — reuses the client's UserEvent naming so a
   future activity feed consumes one vocabulary. Deliberately minimal:
   ring buffer + subscription, NO database writes, NO analytics (§16).
   ═══════════════════════════════════════════════════════════════════════ */

export interface GroupEvent {
  eventType: string;
  actorId: string;
  groupId: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

type Listener = (event: GroupEvent) => void;

const listeners = new Set<Listener>();
const recent: GroupEvent[] = [];
const MAX_RECENT = 100;

/** emit a group event — never throws into the caller (mirrors the client
 *  userEvents.ts contract) */
export function emitGroupEvent(
  eventType: 'group.created' | 'group.updated' | 'group.deleted' | 'group.member.roleChanged' | 'group.member.removed',
  actorId: string,
  groupId: string,
  metadata: Record<string, unknown> = {}
): void {
  const event: GroupEvent = {
    eventType,
    actorId,
    groupId,
    timestamp: new Date().toISOString(),
    metadata,
  };
  recent.push(event);
  if (recent.length > MAX_RECENT) recent.shift();
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('[groupEvents] listener failed for', eventType, err);
    }
  }
}

export function onGroupEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function recentGroupEvents(limit = 50): GroupEvent[] {
  return recent.slice(-limit);
}
