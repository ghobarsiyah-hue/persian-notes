/* ═══════════════════════════════════════════════════════════════════════
   Collaboration authorization — THIN glue over the EXISTING permission
   system. Role/membership logic lives ONLY in services/groups/permissions.ts
   and routes/notes.ts's resolveNoteAccess (§13 invariant 15 — never
   duplicate role logic here).

   For a group-owned note (groupId set):
     read  → active member (group.view)          [existing rule]
     edit  → note creator OR group.editAnyNote   [existing rule]
   Personal notes (groupId null) stay owner-only and are NOT collaborative —
   the adapter refuses them at the preflight, exactly like the REST layer.

   Every socket message that asserts authority re-checks membership LIVE
   (never a cached permission snapshot): if membership ends or edit rights
   are revoked mid-session, the next check fails and the seat is released.
   ═══════════════════════════════════════════════════════════════════════ */

import { Note } from '../models/Note.js';
import { GroupMembership } from '../models/GroupMembership.js';
import { roleHasPermission } from '../services/groups/permissions.js';
import { verifyToken } from '../middleware/auth.js';

export type CollabAccess =
  | { ok: true; canEdit: boolean; note: { _id: unknown; title: string; groupId: unknown; revision: number; content: unknown } }
  | { ok: false; reason: 'unauthorized' | 'not_found' | 'forbidden'; message: string };

/** resolve a note + the user's authority over it, using ONLY the existing
 *  ownership/permission rules (mirrors routes/notes.ts resolveNoteAccess —
 *  that helper is not exported, so the rules are re-used by name, not
 *  reimplemented with different semantics). */
export async function resolveCollabAccess(noteId: string, userId: string): Promise<CollabAccess> {
  const note = await Note.findById(noteId);
  if (!note) return { ok: false, reason: 'not_found', message: 'یادداشت یافت نشد.' };

  if (note.groupId) {
    const membership = await GroupMembership.findOne({ groupId: note.groupId, userId, status: 'active' });
    if (!membership) return { ok: false, reason: 'not_found', message: 'یادداشت یافت نشد.' };
    const canEdit = String(note.userId) === userId || roleHasPermission(membership.role, 'group.editAnyNote');
    return {
      ok: true,
      canEdit,
      note: { _id: note._id, title: note.title, groupId: note.groupId, revision: note.revision ?? 0, content: note.content },
    };
  }

  /* personal note — owner-only (existing rule), not collaborative */
  if (String(note.userId) !== userId) return { ok: false, reason: 'not_found', message: 'یادداشت یافت نشد.' };
  return {
    ok: true,
    canEdit: true,
    note: { _id: note._id, title: note.title, groupId: note.groupId, revision: note.revision ?? 0, content: note.content },
  };
}

/** extract + verify the JWT from a WS upgrade request (Bearer in the
 *  `token` query param or the `sec-websocket-protocol` fallback). The
 *  browser WebSocket API cannot set Authorization headers, so the token
 *  travels in the URL — same trust level as the REST layer since it is
 *  verified with the SAME pinned-algorithm verifier. */
export function tokenFromUpgradeRequest(url: URL, req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const q = url.searchParams.get('token');
  if (q) return q;
  const proto = req.headers['sec-websocket-protocol'];
  const first = Array.isArray(proto) ? proto[0] : proto;
  if (first) return first.split(',')[0].trim() || null;
  return null;
}

/** authenticate a WS handshake → userId, or null. tokenVersion is checked
 *  against the User row (logout/password change kills old sockets too). */
export async function authenticateUpgrade(url: URL, req: { headers: Record<string, string | string[] | undefined> }): Promise<{ userId: string } | null> {
  const token = tokenFromUpgradeRequest(url, req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const { User } = await import('../models/User.js');
  const user = await User.findById(payload.sub).select('tokenVersion name avatar username');
  if (!user || user.tokenVersion !== payload.ver) return null;
  return { userId: String(user._id) };
}
