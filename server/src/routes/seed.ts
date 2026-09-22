import { Router } from 'express';
import { ensureSeedTemplates, seedSampleDataForUser, removeSampleDataForUser } from '../seed/index.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();

// built-in templates are global — need no auth beyond existence
router.get(
  '/templates/ensure',
  asyncHandler(async (_req, res) => {
    await ensureSeedTemplates();
    res.json({ ok: true });
  })
);

// sample data is per-user and can be added/removed from Settings
router.use(requireAuth);

router.post(
  '/sample-data',
  asyncHandler(async (req: AuthRequest, res) => {
    const result = await seedSampleDataForUser(req.user!.id);
    res.json({ ok: true, ...result });
  })
);

router.delete(
  '/sample-data',
  asyncHandler(async (req: AuthRequest, res) => {
    const result = await removeSampleDataForUser(req.user!.id);
    res.json({ ok: true, ...result });
  })
);

export default router;
