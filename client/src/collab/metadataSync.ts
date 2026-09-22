/* ═══════════════════════════════════════════════════════════════════════
   metadataSync — collaborative metadata: TITLE only (§13/§14).

   METADATA BOUNDARY (decisions, documented per §14):
     COLLABORATIVE (this module):        title
     SERVER-ONLY (never mirrored here):  subjectId, chapter, section, tags,
                                         favorite, trashed, wordCount…
     LOCAL UI (never collaborative):     zoom, activePageId, panel tabs,
                                         add menus, focus mode

   Behavior:
     - OUT: the seat holder's title edits publish through the room
       (`publishTitle` → metadata frame + Y.Map 'metadata'). Debouncing is
       unnecessary: yjs set() on the same value is a no-op and the frame is
       one short string per keystroke PAUSE (input onChange coalesced by the
       equality check) — far below the presence budget.
     - IN: remote title changes are observed and mirrored into React state
       WITHOUT triggering autosave (the title travels through the room's own
       persistence: pendingTitle → persistRoom). This kills the per-keystroke
       version snapshot risk (§20): versions see title changes only at real
       persistence boundaries.
     - Reconnect: the Y.Map state rides the room sync (joined → state64 +
       sync.step2), so a reconnecting client re-observes the latest title —
       nothing is lost (§18/§19).
     - Permissions: publishTitle is a no-op without an ACTIVE seat; the
       server additionally rejects metadata frames from seat-less sockets.
   ═══════════════════════════════════════════════════════════════════════ */

import type { CollabSession } from './session';

/** OUT: publish a local title edit (silently ignored without a seat) */
export function publishTitle(session: CollabSession | null, title: string): void {
  if (!session) return;
  session.publishTitle(title);
}

/**
 * IN: observe remote title changes. Returns an unsubscribe fn.
 * `onRemoteTitle` receives ONLY non-local updates (our own metadata.set
 * transactions carry origin 'local' and are filtered here), so typing in
 * the title field never double-fires through the observer.
 */
export function observeTitle(session: CollabSession, onRemoteTitle: (title: string) => void): () => void {
  const handler = () => {
    const t = session.readTitle();
    if (t !== null) onRemoteTitle(t);
  };
  session.metadata.observe(handler);
  return () => { session.metadata.unobserve(handler); };
}
