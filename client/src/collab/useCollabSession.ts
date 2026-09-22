/* ═══════════════════════════════════════════════════════════════════════
   useCollabSession — the React seam between EditorPage and the collab layer.

   Rules honored here (task contracts):
   - noteIdRef invariant: the session is keyed by the LIVE note id (the
     hook receives a getter, never a captured route param).
   - Personal notes never open a transport (collaborative === false at the
     preflight; also a cheap local check: note.groupId == null).
   - SaveState stays the ONLY persistence indicator; collab status is a
     separate concern surfaced separately in the UI.
   - No page reloads: view-only → active seat transitions live here.
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collabApi } from '@/api/endpoints';
import { CollabSession, type CollabSessionState } from './session';

export interface CollabPreflight {
  collaborative: boolean;
  canEdit: boolean;
  maxEditors: number;
  activeEditors: number;
}

export interface CollabUiState {
  /** null = collaboration not active for this note (personal note / preflight pending) */
  session: CollabSession | null;
  state: CollabSessionState | null;
  preflight: CollabPreflight | null;
}

export function useCollabSession(getNoteId: () => string, enabled: boolean): CollabUiState & {
  /** explicit retry when a seat was denied for capacity (seat may free up) */
  requestSeat: () => void;
  refreshPreflight: () => void;
} {
  const [session, setSession] = useState<CollabSession | null>(null);
  const [state, setState] = useState<CollabSessionState | null>(null);
  const [preflight, setPreflight] = useState<CollabPreflight | null>(null);
  const [preflightTick, setPreflightTick] = useState(0);
  const sessionRef = useRef<CollabSession | null>(null);

  /* ── preflight (ONE REST call when the note opens — never per keystroke) ── */
  useEffect(() => {
    if (!enabled) { setPreflight(null); return; }
    let cancelled = false;
    const noteId = getNoteId();
    if (!noteId || noteId === 'new') return;
    void (async () => {
      try {
        const r = await collabApi.preflight(noteId);
        if (!cancelled) setPreflight(r);
      } catch {
        /* collab preflight is advisory — editor keeps working without it */
        if (!cancelled) setPreflight({ collaborative: false, canEdit: true, maxEditors: 4, activeEditors: 0 });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, preflightTick]);

  /* ── session lifecycle ───────────────────────────────────────────────── */
  useEffect(() => {
    if (!enabled || !preflight?.collaborative) return;
    const noteId = getNoteId();
    if (!noteId || noteId === 'new') return;

    const s = new CollabSession(noteId, {
      onState: (st) => setState({ ...st }),
      // remote update → latency probes may hook here
      onRemoteUpdate: undefined,
    });
    sessionRef.current = s;
    setSession(s);
    setState({ ...s.state });
    s.start();

    return () => {
      s.destroy();
      sessionRef.current = null;
      setSession(null);
      setState(null);
    };
    // getNoteId is stable (ref getter); preflight gates the start exactly once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, preflight?.collaborative]);

  const requestSeat = useCallback(() => {
    sessionRef.current?.requestSeat();
  }, []);

  const refreshPreflight = useCallback(() => { setPreflightTick((t) => t + 1); }, []);

  return useMemo(() => ({ session, state, preflight, requestSeat, refreshPreflight }), [session, state, preflight, requestSeat, refreshPreflight]);
}
