import { Router } from 'express';
import { Version } from '../models/Version.js';
import { Note } from '../models/Note.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler, ApiError } from '../middleware/error.js';
import { maybeCreateVersion } from './notes.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/note/:noteId',
  asyncHandler(async (req: AuthRequest, res) => {
    const note = await Note.findOne({ _id: req.params.noteId, userId: req.user!.id }).select('_id');
    if (!note) throw new ApiError(404, 'یادداشت یافت نشد.');
    const versions = await Version.find({ noteId: req.params.noteId })
      .sort({ createdAt: -1 })
      .select('title reason wordCount createdAt');
    res.json({ versions });
  })
);

router.get(
  '/:versionId',
  asyncHandler(async (req: AuthRequest, res) => {
    const version = await Version.findById(req.params.versionId);
    if (!version) throw new ApiError(404, 'نسخه یافت نشد.');
    const note = await Note.findOne({ _id: version.noteId, userId: req.user!.id }).select('_id');
    if (!note) throw new ApiError(403, 'دسترسی به این نسخه مجاز نیست.');
    res.json({ version });
  })
);

/** restore a version: snapshots current state first, then writes the old
 *  content back. COLLABORATION (§20): when the note has a LIVE room, the
 *  restored document is ALSO applied INTO the room's yjs doc as a SYSTEM
 *  operation — otherwise connected clients would keep editing the pre-
 *  restore state and the next room flush would silently overwrite this
 *  restore. All connected clients receive `restored` and reconcile. */
router.post(
  '/:versionId/restore',
  asyncHandler(async (req: AuthRequest, res) => {
    const version = await Version.findById(req.params.versionId);
    if (!version) throw new ApiError(404, 'نسخه یافت نشد.');
    const note = await Note.findOne({ _id: version.noteId, userId: req.user!.id });
    if (!note) throw new ApiError(403, 'دسترسی مجاز نیست.');

    await maybeCreateVersion(
      String(note._id),
      req.user!.id,
      note.title,
      note.content as object,
      note.html,
      note.wordCount,
      'پشتیبان قبل از بازیابی نسخه',
      true
    );

    note.title = version.title;
    note.content = version.content as never;
    note.html = version.html;
    note.wordCount = version.wordCount;
    note.revision = (note.revision ?? 0) + 1;
    await note.save();

    /* live collaboration room → system restore inside the room */
    try {
      const { getRoom, applySystemRestore } = await import('../collab/rooms.js');
      const room = getRoom(String(note._id));
      if (room) {
        applySystemRestore(room, note.content as unknown as Record<string, unknown>);
        /* fan the restored doc to every connected client */
        const { broadcastRestored } = await import('../collab/hub.js');
        broadcastRestored(String(note._id), note.content as unknown as Record<string, unknown>);
      }
    } catch { /* room infra not booted (tests) — restore still worked */ }

    res.json({ note: await note.populate([{ path: 'tags' }, { path: 'subjectId', select: 'name color parentId' }]) });
  })
);

export default router;
