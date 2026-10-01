/* ═══════════════════════════════════════════════════════════════════════
   floatSync — SEMANTIC floating-object collaboration (§7–§10).

   COMMIT-ORIENTED (kept from the previous milestone — §10): pointermove
   stays LOCAL (rAF/live state in FloatingLayer); only meaningful state
   commits cross the network.

   OUT (local commits)  → semantic ops keyed by (pageId, objectId):
                            CREATE_FLOAT  = opUpsertFloat (full property set)
                            UPDATE_FLOAT  = opPatchFloat (PROPERTY-LEVEL —
                                            independent keys merge; the same
                                            key converges via yjs LWW-per-key)
                            DELETE_FLOAT  = opDeleteFloat
   IN  (remote commits) → diff the session's per-object state against the
                            local React floats and apply ONLY the changes
                            (add/update/remove) — never a whole-array
                            replace, so concurrent local drags are not
                            clobbered by remote traffic.

   Identity: FloatingElement.id (stable string) + pageId. NEVER the array
   index. Floating TEXT rides the same property map (`text` key) — it is
   collaborative state, not DOM-only (§9).

   Conflict policy (§8): per-property last-writer-wins INSIDE yjs (the
   only deterministic option for a plain number/string), whole-object
   merge across DIFFERENT properties — A's x change and B's width change
   both survive; concurrent writes to x converge to one value on all
   clients (yjs guarantees).
   ═══════════════════════════════════════════════════════════════════════ */

import * as Y from 'yjs';
import type { CollabSession } from './session';

/* ═════════════════════════════════════════════════════════════════════
   §23 DRAG POLICY — deterministic local-interaction-wins rule.

   While THIS tab is actively dragging/resizing/rotating an object, remote
   commits for THAT object must not fight the pointer. The gesture is
   registered here (protectedFloatRef, set/cleared by EditorPage around the
   FloatingLayer's live geometry channel); the float reconcile SKIPS
   property application for protected objects entirely — the local visual
   state wins temporarily, the final pointerup commits, and the canonical
   yjs state converges from that commit. A remote change to a DIFFERENT
   object on the same page still lands normally.

   The protection is per-object and gesture-scoped: it can never produce a
   permanent divergence, because the object is republished at pointerup
   (the normal commit path) and the NEXT remote op reconciles freely.
   ═════════════════════════════════════════════════════════════════════ */
export interface ProtectedFloat {
  pageId: string;
  objectId: string;
}

/** module-level ref holder — EditorPage assigns one stable ref here so the
 *  reconcile path (and tests) can read/write the protected gesture without
 *  re-rendering anything (a ref, not React state — §25 hot-path rule). */
export const protectedFloatRef: { current: ProtectedFloat | null } = { current: null };

export function setProtectedFloat(pageId: string | null, objectId: string | null): void {
  protectedFloatRef.current = pageId && objectId ? { pageId, objectId } : null;
}

export function getProtectedFloat(): ProtectedFloat | null {
  return protectedFloatRef.current;
}

/** OUT: CREATE_FLOAT — after the element exists in local state */
export function floatUpsert(session: CollabSession, pageId: string, obj: Record<string, unknown>): void {
  session.opUpsertFloat(pageId, obj);
}

/** OUT: UPDATE_FLOAT — property-level patch (only listed keys travel) */
export function floatPatch(session: CollabSession, pageId: string, objectId: string, patch: Record<string, unknown>): void {
  session.opPatchFloat(pageId, objectId, patch);
}

/** OUT: DELETE_FLOAT */
export function floatDelete(session: CollabSession, pageId: string, objectId: string): void {
  session.opDeleteFloat(pageId, objectId);
}

/** extract the property-level patch between two float objects (only keys
 *  whose value actually changed — keeps update frames minimal) */
export function floatDiff(prev: Record<string, unknown> | undefined, next: Record<string, unknown>): Record<string, unknown> | null {
  if (!prev) return next;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    if (JSON.stringify(prev[k]) !== JSON.stringify(v)) patch[k] = v;
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * IN: reconcile ONE page's local floats from the session's per-object state.
 * Returns a NEW array when something changed, or the SAME reference when
 * nothing did (identity-stable → no React churn, §25).
 *
 * §23 DRAG POLICY: the object currently under a LOCAL gesture (drag/resize/
 * rotate — see getProtectedFloat) keeps its LOCAL geometry; remote traffic
 * for it is skipped entirely for the duration of the gesture. The pointerup
 * commit republishes the final geometry, so the canonical state converges
 * and the skip can never become a permanent divergence.
 */
export function reconcileFloatsFromSession(
  session: CollabSession,
  pageId: string,
  local: Array<Record<string, unknown>>
): Array<Record<string, unknown>> | null {
  const remote = session.readFloatObjects(pageId);
  const protectedId = getProtectedFloat();
  const draggingId = protectedId && protectedId.pageId === pageId ? protectedId.objectId : null;

  /* the local object under an active gesture: shielded from remote below */
  const draggingLocal = draggingId
    ? local.find((l) => String(l.id) === draggingId)
    : undefined;

  const effectiveRemote = draggingId
    ? remote.filter((r) => String(r.id) !== draggingId)
    : remote;
  const effectiveLocal = draggingId
    ? local.filter((l) => String(l.id) !== draggingId)
    : local;

  const remoteIds = new Set(effectiveRemote.map((r) => String(r.id)));
  const localIds = new Set(effectiveLocal.map((l) => String(l.id)));

  const changed =
    remoteIds.size !== localIds.size ||
    effectiveRemote.some((r) => {
      const l = effectiveLocal.find((x) => String(x.id) === String(r.id));
      return !l || JSON.stringify(sortKeys(l)) !== JSON.stringify(sortKeys(r));
    });
  if (!changed) return null;

  /* merge strategy: remote per-object state is canonical for properties;
     objects that exist only remotely are ADDED; remote-deleted objects are
     REMOVED. Objects that exist only locally are KEPT — UNLESS the id is
     tombstoned (§24): a tombstoned local-only copy is the STALE MIRROR of
     an object that was deleted (locally or concurrently remotely), and
     keeping it would resurrect the deleted object into autosave/exports.
     Deletion wins deterministically; a deliberate re-create goes through
     opUpsertFloat, which clears the tombstone. */
  const merged: Array<Record<string, unknown>> = [];
  const byRemoteId = new Map(effectiveRemote.map((r) => [String(r.id), r]));
  for (const l of effectiveLocal) {
    const id = String(l.id);
    const r = byRemoteId.get(id);
    if (r) merged.push(r);
    else if (!remoteIds.has(id) && !session.isFloatTombstoned(pageId, id)) merged.push(l); /* local-only object survives */
  }
  for (const r of effectiveRemote) {
    if (!localIds.has(String(r.id))) merged.push(r);
  }
  /* re-insert the protected object at its ORIGINAL local position so the
     React array order (z-order painting) is not disturbed mid-gesture */
  if (draggingLocal) {
    const origIdx = local.findIndex((l) => String(l.id) === draggingId);
    const insertAt = Math.min(Math.max(0, origIdx), merged.length);
    merged.splice(insertAt, 0, draggingLocal);
  }
  return merged;
}

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

/** observe remote float/structure changes for ONE page (used by EditorPage's
 *  receive effect — origin-filtered to skip our own local commits) */
export function observeFloatChanges(
  session: CollabSession,
  pageIds: () => string[],
  onChange: (pageId: string) => void
): () => void {
  const handler = (_u: Uint8Array, origin: unknown) => {
    if (origin === 'local') return; /* our own commit — no echo */
    for (const pid of pageIds()) onChange(pid);
  };
  session.doc.on('update', handler);
  return () => { session.doc.off('update', handler); };
}

/** Y import guard (keeps tree-shaking honest — Y.Map instance checks above) */
export type { Y };
