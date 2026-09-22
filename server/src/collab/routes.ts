import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { resolveCollabAccess } from './auth.js';
import { sessionStore } from './sessionStore.js';
import { MAX_ACTIVE_EDITORS, HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from './constants.js';

/* ═══════════════════════════════════════════════════════════════════════
   REST preflight for the collaboration layer.

   The editor calls this ONCE when a group note opens (never on the typing
   hot path): it answers "may this user connect, and can they edit?" and
   reports the current seat occupancy so the UI can show «ویرایشگران ۳/۴»
   before the socket is even opened. The WS handshake REPEATS every
   authority check — this endpoint is an advisory/UX shortcut, not the
   gate (the gate is server-side, in the hub, on every frame).
   ═══════════════════════════════════════════════════════════════════════ */

const router = Router();
router.use(requireAuth);

const preflightSchema = z.object({ noteId: z.string().min(1) });

router.post(
  '/preflight',
  asyncHandler(async (req: AuthRequest, res) => {
    const { noteId } = preflightSchema.parse(req.body);
    const access = await resolveCollabAccess(noteId, req.user!.id);
    if (!access.ok) {
      /* uniform 404/403 with the SAME messages as the note routes */
      if (access.reason === 'not_found') return res.status(404).json({ error: access.message });
      return res.status(403).json({ error: access.message });
    }
    const editors = sessionStore.presence(noteId);
    return res.json({
      collaborative: Boolean(access.note.groupId),
      canEdit: access.canEdit,
      maxEditors: MAX_ACTIVE_EDITORS,
      activeEditors: editors.length,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
      editors: editors.map((e) => ({ userId: e.userId, displayName: e.displayName, avatar: e.avatar ?? null, pageId: e.pageId ?? null })),
    });
  })
);

export default router;
