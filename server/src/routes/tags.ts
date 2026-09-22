import { Router } from 'express';
import { z } from 'zod';
import { Tag } from '../models/Tag.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler, ApiError } from '../middleware/error.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    const tags = await Tag.find({ userId: req.user!.id }).sort({ name: 1 });
    res.json({ tags });
  })
);

router.post(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    const data = z
      .object({
        name: z
          .string()
          .min(1, 'نام برچسب را وارد کنید')
          .max(60)
          .transform((v) => v.replace(/^#/, '').trim()),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      })
      .parse(req.body);
    const tag = await Tag.findOneAndUpdate(
      { userId: req.user!.id, name: data.name },
      { $setOnInsert: { userId: req.user!.id, name: data.name, color: data.color ?? '#0ea5e9' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ tag });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req: AuthRequest, res) => {
    const data = z
      .object({
        name: z.string().min(1).max(60).optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      })
      .parse(req.body);
    const tag = await Tag.findOneAndUpdate({ _id: req.params.id, userId: req.user!.id }, data, {
      new: true,
    });
    if (!tag) throw new ApiError(404, 'برچسب یافت نشد.');
    res.json({ tag });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req: AuthRequest, res) => {
    const tag = await Tag.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
    if (!tag) throw new ApiError(404, 'برچسب یافت نشد.');
    res.json({ ok: true });
  })
);

export default router;
