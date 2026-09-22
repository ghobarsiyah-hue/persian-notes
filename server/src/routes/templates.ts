import { Router } from 'express';
import { Template } from '../models/Template.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    // built-in templates are global; user templates are private
    const templates = await Template.find({
      $or: [{ isBuiltIn: true }, { userId: req.user!.id }],
    }).sort({ isBuiltIn: -1, name: 1 });
    res.json({ templates });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req: AuthRequest, res) => {
    const template = await Template.findById(req.params.id);
    if (!template || (template.userId && String(template.userId) !== req.user!.id)) {
      return res.status(404).json({ error: 'قالب یافت نشد.' });
    }
    res.json({ template });
  })
);

export default router;
