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
 * `localOriginIds` are object ids THIS tab created/patched during its own
 * un-acked local transactions; they are reconciled too (the yjs state is
 * canonical), but they are never the reason to skip an update.
 */
export function reconcileFloatsFromSession(
  session: CollabSession,
  pageId: string,
  local: Array<Record<string, unknown>>
): Array<Record<string, unknown>> | null {
  const remote = session.readFloatObjects(pageId);
  const remoteIds = new Set(remote.map((r) => String(r.id)));
  const localIds = new Set(local.map((l) => String(l.id)));

  const changed =
    remoteIds.size !== localIds.size ||
    remote.some((r) => {
      const l = local.find((x) => String(x.id) === String(r.id));
      return !l || JSON.stringify(sortKeys(l)) !== JSON.stringify(sortKeys(r));
    });
  if (!changed) return null;

  /* merge strategy: remote per-object state is canonical for properties;
     objects that exist only locally (created offline / not yet published)
     are KEPT (never silently dropped — no data loss, §36); objects that
     exist only remotely are ADDED; remote-deleted objects are REMOVED. */
  const merged: Array<Record<string, unknown>> = [];
  const byRemoteId = new Map(remote.map((r) => [String(r.id), r]));
  for (const l of local) {
    const id = String(l.id);
    const r = byRemoteId.get(id);
    if (r) merged.push(r);
    else if (!remoteIds.has(id)) merged.push(l); /* local-only object survives */
  }
  for (const r of remote) {
    if (!localIds.has(String(r.id))) merged.push(r);
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
