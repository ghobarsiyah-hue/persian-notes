import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler, ApiError } from '../middleware/error.js';
import {
  authorize,
  canManageTarget,
  getMembership,
  roleHasPermission,
} from '../services/groups/permissions.js';
import {
  createGroup,
  listMyGroups,
  getGroupForUser,
  updateGroup,
  deleteGroup,
  listMembers,
  setMemberRole,
  removeMember,
} from '../services/groups/groupService.js';
import type { GroupRole } from '../models/GroupMembership.js';
import { Note } from '../models/Note.js';
import { emitGroupEvent } from '../services/groups/groupEvents.js';

const router = Router();
router.use(requireAuth);

/* ── validation (§8) — zod, matching the existing app conventions ──────── */
const AVATAR_SCHEMA = z
  .string()
  .regex(/^data:image\/(png|jpeg|webp);base64,/, 'قالب تصویر پشتیبانی نمی‌شود')
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 150 * 1024, 'حجم تصویر باید کمتر از ۱۵۰ کیلوبایت باشد');

/* hex accent color (#rgb/#rrggbb) — null resets to the system accent */
const ACCENT_SCHEMA = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'رنگ باید به فرمت HEX باشد')
  .nullable()
  .optional();

const createSchema = z.object({
  name: z.string().trim().min(2, 'نام گروه باید حداقل ۲ حرف باشد').max(80),
  description: z.string().max(500).optional(),
  avatar: AVATAR_SCHEMA.nullable().optional(),
  accentColor: ACCENT_SCHEMA,
});

/* security model (تنظیمات امنیتی) — whitelist enums; the service projects
   them into the settings bag; defaults stay 'invite'/'members' (safe) */
const joinPolicySchema = z.enum(['invite', 'open']).optional();
const contentPolicySchema = z.enum(['members', 'public']).optional();

const updateSchema = z
  .object({
    name: z.string().trim().min(2, 'نام گروه باید حداقل ۲ حرف باشد').max(80).optional(),
    description: z.string().max(500).optional(),
    avatar: AVATAR_SCHEMA.nullable().optional(),
    accentColor: ACCENT_SCHEMA,
    joinPolicy: joinPolicySchema,
    contentPolicy: contentPolicySchema,
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'داده‌ای برای بروزرسانی ارسال نشده است.' });

const roleSchema = z.object({
  role: z.enum(['admin', 'member']), // 'owner' is NOT settable — owner protection
});

const ID = z
  .string()
  .refine((v) => mongoose.Types.ObjectId.isValid(v), 'شناسه وارد شده نامعتبر است.');

function requireId(value: string | undefined): string {
  const parsed = ID.safeParse(value ?? '');
  if (!parsed.success) throw new ApiError(400, 'شناسه وارد شده نامعتبر است.');
  return parsed.data;
}

/* ── POST /groups — create (§3: atomic group + owner membership) ──────── */
router.post(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    const data = createSchema.parse(req.body);
    const group = await createGroup(req.user!.id, data);
    emitGroupEvent('group.created', req.user!.id, group.id, { name: group.name });
    res.status(201).json({ group });
  })
);

/* ── GET /groups — My Groups (active memberships only) ────────────────── */
router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    const groups = await listMyGroups(req.user!.id);
    res.json({ groups });
  })
);

/* ── GET /groups/:groupId — requires active membership + group.view ───── */
router.get(
  '/:groupId',
  asyncHandler(async (req: AuthRequest, res) => {
    const groupId = requireId(req.params.groupId);
    const group = await getGroupForUser(groupId, req.user!.id);
    res.json({ group });
  })
);

/* ── PATCH /groups/:groupId — group.manageSettings ────────────────────── */
router.patch(
  '/:groupId',
  asyncHandler(async (req: AuthRequest, res) => {
    const groupId = requireId(req.params.groupId);
    const data = updateSchema.parse(req.body);
    await authorize(groupId, req.user!.id, 'group.manageSettings');
    const group = await updateGroup(groupId, req.user!.id, data);
    emitGroupEvent('group.updated', req.user!.id, groupId, { fields: Object.keys(data) });
    res.json({ group });
  })
);

/* ── DELETE /groups/:groupId — group.delete (owner-only) ──────────────── */
router.delete(
  '/:groupId',
  asyncHandler(async (req: AuthRequest, res) => {
    const groupId = requireId(req.params.groupId);
    await authorize(groupId, req.user!.id, 'group.delete');
    await deleteGroup(groupId);
    emitGroupEvent('group.deleted', req.user!.id, groupId, {});
    res.json({ ok: true });
  })
);

/* ── GET /groups/:groupId/members — group.view ────────────────────────── */
router.get(
  '/:groupId/members',
  asyncHandler(async (req: AuthRequest, res) => {
    const groupId = requireId(req.params.groupId);
    await authorize(groupId, req.user!.id, 'group.view');
    const members = await listMembers(groupId);
    res.json({ members });
  })
);

/* ── PATCH /groups/:groupId/members/:userId — group.manageRoles ───────── */
router.patch(
  '/:groupId/members/:userId',
  asyncHandler(async (req: AuthRequest, res) => {
    const groupId = requireId(req.params.groupId);
    const userId = requireId(req.params.userId);
    const { role } = roleSchema.parse(req.body);

    const actor = await authorize(groupId, req.user!.id, 'group.manageRoles');
    const target = await getMembership(groupId, userId);
    if (!target) throw new ApiError(404, 'عضو یافت نشد.');

    /* owner protection + admin hierarchy, decided in ONE place */
    if (!canManageTarget(actor.role, target.role as GroupRole, userId, req.user!.id)) {
      throw new ApiError(403, 'شما اجازه تغییر نقش این عضو را ندارید.');
    }
    if (!roleHasPermission(actor.role, 'group.manageRoles')) {
      throw new ApiError(403, 'شما اجازه تغییر نقش این عضو را ندارید.');
    }

    const member = await setMemberRole(groupId, userId, role as GroupRole, req.user!.id);
    emitGroupEvent('group.member.roleChanged', req.user!.id, groupId, { userId, role });
    res.json({ member });
  })
);

/* ── DELETE /groups/:groupId/members/:userId — group.manageMembers ────── */
router.delete(
  '/:groupId/members/:userId',
  asyncHandler(async (req: AuthRequest, res) => {
    const groupId = requireId(req.params.groupId);
    const userId = requireId(req.params.userId);

    const actor = await authorize(groupId, req.user!.id, 'group.manageMembers');
    const target = await getMembership(groupId, userId);
    if (!target) throw new ApiError(404, 'عضو یافت نشد.');

    if (!canManageTarget(actor.role, target.role as GroupRole, userId, req.user!.id)) {
      throw new ApiError(403, 'شما اجازه حذف این عضو را ندارید.');
    }

    const selfRemoval = userId === req.user!.id;
    const result = await removeMember(groupId, userId, req.user!.id, !selfRemoval);
    if (!selfRemoval) {
      emitGroupEvent('group.member.removed', req.user!.id, groupId, { userId });
    }
    res.json({ ok: true, member: result });
  })
);

/* ═══════════════════════════════════════════════════════════════════════
   Group notes (جزوه گروهی) — a Note with groupId. Same Note domain as
   personal notes; group membership is the access boundary (checked HERE,
   once per request — never by the client).
   ═══════════════════════════════════════════════════════════════════════ */

/** list group notes — every ACTIVE member can read (group.view) */
router.get(
  '/:groupId/notes',
  asyncHandler(async (req: AuthRequest, res) => {
    const groupId = requireId(req.params.groupId);
    await authorize(groupId, req.user!.id, 'group.view');
    const notes = await Note.find({ groupId, trashed: false })
      .sort({ updatedAt: -1 })
      .populate('tags')
      .populate('subjectId', 'name color parentId')
      .limit(500);
    res.json({ notes });
  })
);

/** create a group note — members+ (group.createNote). userId is the CREATOR
 *  (personal subjects/tags still reference their owner's own sets). */
router.post(
  '/:groupId/notes',
  asyncHandler(async (req: AuthRequest, res) => {
    const groupId = requireId(req.params.groupId);
    await authorize(groupId, req.user!.id, 'group.createNote');
    const data = z
      .object({
        title: z.string().max(300).optional(),
        chapter: z.string().max(200).optional(),
        section: z.string().max(200).optional(),
        content: z.record(z.unknown()).optional(),
        html: z.string().optional(),
        plainText: z.string().optional(),
      })
      .parse(req.body);

    const note = await Note.create({
      userId: req.user!.id,
      groupId,
      title: data.title || 'جزوه گروهی بدون عنوان',
      chapter: data.chapter ?? '',
      section: data.section ?? '',
      content: data.content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
      html: data.html ?? '',
      plainText: data.plainText ?? '',
    });
    res.status(201).json({ note });
  })
);

export default router;
