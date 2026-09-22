import { Router } from 'express';
import { z } from 'zod';
import { Subject } from '../models/Subject.js';
import { Note } from '../models/Note.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler, ApiError } from '../middleware/error.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    const subjects = await Subject.find({ userId: req.user!.id }).sort({ order: 1, name: 1 });
    res.json({ subjects });
  })
);

router.post(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    const data = z
      .object({
        name: z.string().min(1, 'نام موضوع را وارد کنید').max(120),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'رنگ نامعتبر است').optional(),
        parentId: z.string().nullable().optional(),
        order: z.number().int().optional(),
      })
      .parse(req.body);
    const subject = await Subject.create({
      userId: req.user!.id,
      name: data.name,
      color: data.color,
      parentId: data.parentId ?? null,
      order: data.order ?? 0,
    });
    res.status(201).json({ subject });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req: AuthRequest, res) => {
    const data = z
      .object({
        name: z.string().min(1).max(120).optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        parentId: z.string().nullable().optional(),
        order: z.number().int().optional(),
      })
      .parse(req.body);
    const subject = await Subject.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      data,
      { new: true, runValidators: true }
    );
    if (!subject) throw new ApiError(404, 'موضوع یافت نشد.');
    res.json({ subject });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req: AuthRequest, res) => {
    const subject = await Subject.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
    if (!subject) throw new ApiError(404, 'موضوع یافت نشد.');
    // detach notes and re-parent children
    await Note.updateMany({ userId: req.user!.id, subjectId: subject._id }, { subjectId: null });
    await Subject.updateMany({ userId: req.user!.id, parentId: subject._id }, { parentId: null });
    res.json({ ok: true });
  })
);

export default router;
