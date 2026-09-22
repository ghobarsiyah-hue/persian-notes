import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Note, type INote } from '../models/Note.js';
import { GroupMembership } from '../models/GroupMembership.js';
import { roleHasPermission } from '../services/groups/permissions.js';
import { Subject } from '../models/Subject.js';
import { Tag } from '../models/Tag.js';
import type { Types as MongoTypes } from 'mongoose';

type ObjectId = MongoTypes.ObjectId;
import { Version, MAX_VERSIONS_PER_NOTE } from '../models/Version.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler, ApiError } from '../middleware/error.js';

const router = Router();
router.use(requireAuth);

/* ── cross-reference ownership (§6 IDOR hardening) ───────────────────────
   A note references subjects/tags — accepting arbitrary ids would let a
   client attach OTHER users' subjects/tags to their own notes (and read
   their titles through populate). Both helpers enforce that every referenced
   id belongs to the caller, failing safely. */
async function ownedSubjectId(userId: string, subjectId: string | null | undefined): Promise<ObjectId | null> {
  if (!subjectId) return null;
  if (!mongoose.Types.ObjectId.isValid(subjectId)) throw new ApiError(400, 'شناسه وارد شده نامعتبر است.');
  const subject = await Subject.findOne({ _id: subjectId, userId }).select('_id');
  if (!subject) throw new ApiError(400, 'موضوع انتخاب‌شده معتبر نیست.');
  return new mongoose.Types.ObjectId(subjectId);
}

/* ── group-note access (جزوه گروهی) ────────────────────────────────────
   A note whose groupId is set belongs to the GROUP, not to a single user:
   read  → any ACTIVE member (group.view)
   edit  → the note's creator, or owner/admin of the group (group.editAnyNote)
   Personal notes (groupId null) keep the exact old rule: owner-only. */
async function resolveNoteAccess(
  id: string,
  userId: string,
  mode: 'read' | 'edit'
): Promise<mongoose.HydratedDocument<INote>> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(400, 'شناسه وارد شده نامعتبر است.');
  const note = await Note.findById(id);
  if (!note) throw new ApiError(404, 'یادداشت یافت نشد.');
  if (note.groupId) {
    const permission = mode === 'read' ? 'group.view' : 'group.editAnyNote';
    const membership = await GroupMembership.findOne({ groupId: note.groupId, userId, status: 'active' });
    if (!membership) throw new ApiError(404, 'یادداشت یافت نشد.');
    const isEditor = String(note.userId) === userId || roleHasPermission(membership.role, permission);
    if (mode === 'edit' && !isEditor) throw new ApiError(403, 'شما اجازه ویرایش این جزوه گروهی را ندارید.');
    return note;
  }
  if (String(note.userId) !== userId) throw new ApiError(404, 'یادداشت یافت نشد.');
  return note;
}

async function ownedTagIds(userId: string, tags: string[] | undefined): Promise<ObjectId[]> {
  if (!tags || tags.length === 0) return [];
  for (const t of tags) {
    if (!mongoose.Types.ObjectId.isValid(t)) throw new ApiError(400, 'شناسه وارد شده نامعتبر است.');
  }
  const owned = await Tag.find({ _id: { $in: tags }, userId }).select('_id');
  return owned.map((t) => t._id as ObjectId);
}

const updateSchema = z.object({
  title: z.string().max(300).optional(),
  subjectId: z.string().nullable().optional(),
  chapter: z.string().max(200).optional(),
  section: z.string().max(200).optional(),
  content: z.record(z.unknown()).optional(),
  html: z.string().optional(),
  plainText: z.string().optional(),
  tags: z.array(z.string()).optional(),
  favorite: z.boolean().optional(),
  trashed: z.boolean().optional(),
  wordCount: z.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).optional(),
  versionReason: z.string().max(200).optional(),
  /** revision the client based its edit on (undefined = legacy client, skip
   *  the check so old builds keep saving) — a mismatch returns 409 CONFLICT
   *  with the server's current revision so the caller can re-read and retry */
  baseRevision: z.number().int().min(0).optional(),
});

export class RevisionConflictError extends Error {}

/** guard a PATCH with the note's monotonic revision: the pending write must
 *  be based on the revision the client has seen. Legacy clients that do not
 *  send baseRevision pass untouched (backward compatible §18). */
function assertBaseRevision(note: { revision?: number }, baseRevision: number | undefined) {
  if (baseRevision === undefined) return;
  if ((note.revision ?? 0) !== baseRevision) {
    /* the response CARRIES the server's current revision (error.meta) so a
       collaborating client can reconcile against the canonical collaborative
       state and retry — never blind-retry the same stale JSON (§16) */
    throw new ApiError(409, 'این یادداشت در جای دیگری تغییر کرده است.', {
      code: 'revision_conflict',
      revision: note.revision ?? 0,
    });
  }
}

const VERSION_INTERVAL_MS = 10 * 60 * 1000;

export async function maybeCreateVersion(
  noteId: string,
  userId: string,
  title: string,
  content: object,
  html: string,
  wordCount: number,
  reason: string,
  force = false
) {
  const last = await Version.findOne({ noteId }).sort({ createdAt: -1 });
  const changed = !last || JSON.stringify(last.content) !== JSON.stringify(content) || last.title !== title;
  if (!changed) return;
  if (!force && last && Date.now() - last.createdAt.getTime() < VERSION_INTERVAL_MS) return;
  await Version.create({ noteId, userId, title, content, html, wordCount, reason });
  const extra = await Version.find({ noteId }).sort({ createdAt: -1 }).skip(MAX_VERSIONS_PER_NOTE);
  if (extra.length) {
    await Version.deleteMany({ _id: { $in: extra.map((v) => v._id) } });
  }
}

router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    const filter: Record<string, unknown> = { userId: req.user!.id };
    const { subjectId, trashed, favorite, tagId } = req.query;
    filter.trashed = trashed === 'true';
    if (subjectId) filter.subjectId = subjectId;
    if (favorite === 'true') filter.favorite = true;
    if (tagId) filter.tags = tagId;
    const notes = await Note.find(filter)
      .sort({ updatedAt: -1 })
      .populate('tags')
      .populate('subjectId', 'name color parentId')
      .limit(500);
    res.json({ notes });
  })
);

router.post(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    const data = z
      .object({
        title: z.string().max(300).optional(),
        subjectId: z.string().nullable().optional(),
        chapter: z.string().max(200).optional(),
        section: z.string().max(200).optional(),
        content: z.record(z.unknown()).optional(),
        html: z.string().optional(),
        plainText: z.string().optional(),
        tags: z.array(z.string()).optional(),
        templateId: z.string().nullable().optional(),
      })
      .parse(req.body);

    const subjectId = await ownedSubjectId(req.user!.id, data.subjectId);
    const tagIds = await ownedTagIds(req.user!.id, data.tags);
    const note = await Note.create({
      userId: req.user!.id,
      title: data.title || 'جزوه بدون عنوان',
      subjectId,
      chapter: data.chapter ?? '',
      section: data.section ?? '',
      content: data.content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
      html: data.html ?? '',
      plainText: data.plainText ?? '',
      tags: tagIds,
      metadata: { templateId: data.templateId ?? null },
    });
    await maybeCreateVersion(
      String(note._id),
      req.user!.id,
      note.title,
      note.content as object,
      note.html,
      note.wordCount,
      'نسخه اولیه'
    );
    res.status(201).json({
      note: await note.populate([
        { path: 'tags' },
        { path: 'subjectId', select: 'name color parentId' },
      ]),
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req: AuthRequest, res) => {
    const note = await resolveNoteAccess(req.params.id, req.user!.id, 'read');
    res.json({ note: await note.populate([{ path: 'tags' }, { path: 'subjectId', select: 'name color parentId' }]) });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req: AuthRequest, res) => {
    const data = updateSchema.parse(req.body);
    const note = await resolveNoteAccess(req.params.id, req.user!.id, 'edit');
    assertBaseRevision(note, data.baseRevision);

    const contentChanged =
      data.content !== undefined && JSON.stringify(note.content) !== JSON.stringify(data.content);

    if (data.title !== undefined) note.title = data.title;
    if (data.subjectId !== undefined)
      note.subjectId = await ownedSubjectId(req.user!.id, data.subjectId);
    if (data.chapter !== undefined) note.chapter = data.chapter;
    if (data.section !== undefined) note.section = data.section;
    if (data.content !== undefined) note.content = data.content as never;
    if (data.html !== undefined) note.html = data.html;
    if (data.plainText !== undefined) note.plainText = data.plainText;
    if (data.tags !== undefined)
      note.tags = (await ownedTagIds(req.user!.id, data.tags)) as never;
    if (data.favorite !== undefined && !note.groupId) note.favorite = data.favorite;
    if (data.wordCount !== undefined) note.wordCount = data.wordCount;
    if (data.metadata !== undefined) note.metadata = { ...note.metadata, ...data.metadata };
    if (data.trashed !== undefined) {
      note.trashed = data.trashed;
      note.trashedAt = data.trashed ? new Date() : null;
    }

    note.revision = (note.revision ?? 0) + 1;
    await note.save();

    if (contentChanged) {
      await maybeCreateVersion(
        String(note._id),
        req.user!.id,
        note.title,
        note.content as object,
        note.html,
        note.wordCount,
        data.versionReason ?? 'ذخیره خودکار'
      );
    }

    res.json({
      note: await note.populate([
        { path: 'tags' },
        { path: 'subjectId', select: 'name color parentId' },
      ]),
    });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req: AuthRequest, res) => {
    // permanent delete (from trash)
    const note = await resolveNoteAccess(req.params.id, req.user!.id, 'edit');
    if (!note) throw new ApiError(404, 'یادداشت یافت نشد.');
    await Version.deleteMany({ noteId: note._id });
    res.json({ ok: true });
  })
);

/** clone an existing note (often a template) as a new blank editable note */
router.post(
  '/:id/clone',
  asyncHandler(async (req: AuthRequest, res) => {
    const source = await Note.findOne({ _id: req.params.id, userId: req.user!.id });
    if (!source) throw new ApiError(404, 'یادداشت برای کلون کردن یافت نشد.');
    const note = await Note.create({
      userId: req.user!.id,
      title: `${source.title} (کلون)`,
      subjectId: source.subjectId,
      chapter: source.chapter,
      section: source.section,
      content: JSON.parse(JSON.stringify(source.content)) as never,
      html: source.html,
      plainText: source.plainText,
      tags: source.tags.map((t) => t), // Mongoose ObjectIds stay valid
      favorite: false,
      metadata: { templateId: source.metadata?.templateId ?? null },
    });
    await maybeCreateVersion(
      String(note._id),
      req.user!.id,
      note.title,
      note.content as object,
      note.html,
      note.wordCount,
      'کلون از یادداشت موجود'
    );
    res.status(201).json({
      note: await note.populate([
        { path: 'tags' },
        { path: 'subjectId', select: 'name color parentId' },
      ]),
    });
  })
);

export default router;
