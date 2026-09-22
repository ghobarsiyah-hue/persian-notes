import { Router } from 'express';
import { z } from 'zod';
import { Notification } from '../models/Notification.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler, ApiError } from '../middleware/error.js';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  type: z.string().max(100).default('system:info'),
  title: z.string().min(1).max(200),
  message: z.string().max(2000).optional(),
  severity: z.enum(['success', 'info', 'warning', 'error']).default('info'),
  /** ISO date; rows past it are pruned on read instead of shown */
  expiresAt: z.string().datetime().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/** list the current user's notifications — ALWAYS scoped server-side to the
 *  authenticated identity, never a client-supplied userId (§16) */
router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    /* housekeeping: expired rows of this user are swept on every read */
    await Notification.deleteMany({
      userId: req.user!.id,
      expiresAt: { $ne: null, $lt: new Date() },
    });
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const notifications = await Notification.find({ userId: req.user!.id })
      .sort({ createdAt: -1 })
      .limit(limit);
    const unread = await Notification.countDocuments({ userId: req.user!.id, read: false });
    res.json({ notifications, unread });
  })
);

/** create a notification for the CURRENT user (future group/club/share
 *  services can call the model directly for OTHER recipients — the REST
 *  surface stays user-scoped until those features exist) */
router.post(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    const data = createSchema.parse(req.body);
    const notification = await Notification.create({
      userId: req.user!.id,
      type: data.type,
      title: data.title,
      message: data.message ?? '',
      severity: data.severity,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      metadata: data.metadata ?? {},
    });
    res.status(201).json({ notification });
  })
);

/** mark all as read (must be declared before the parametric :id routes) */
router.post(
  '/read-all',
  asyncHandler(async (req: AuthRequest, res) => {
    await Notification.updateMany({ userId: req.user!.id, read: false }, { read: true });
    res.json({ ok: true });
  })
);

router.patch(
  '/:id/read',
  asyncHandler(async (req: AuthRequest, res) => {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { read: true },
      { new: true }
    );
    if (!notification) throw new ApiError(404, 'اعلان یافت نشد.');
    res.json({ notification });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req: AuthRequest, res) => {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId: req.user!.id,
    });
    if (!notification) throw new ApiError(404, 'اعلان یافت نشد.');
    res.json({ ok: true });
  })
);

export default router;
