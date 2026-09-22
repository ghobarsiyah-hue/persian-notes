import { Router } from 'express';
import { z } from 'zod';
import { getAIProvider, AIUnavailableError, AI_ACTION_LABELS, type AIAction } from '../services/ai/index.js';
import { Note } from '../models/Note.js';
import { Subject } from '../models/Subject.js';
import { Settings } from '../models/Settings.js';
import { maybeCreateVersion } from './notes.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler, ApiError } from '../middleware/error.js';

const router = Router();
router.use(requireAuth);

const ACTIONS = Object.keys(AI_ACTION_LABELS) as AIAction[];

router.get(
  '/status',
  asyncHandler(async (_req: AuthRequest, res) => {
    const provider = getAIProvider();
    res.json({
      provider: provider.name,
      actions: ACTIONS.map((a) => ({
        id: a,
        label: AI_ACTION_LABELS[a],
        available: provider.isActionAvailable(a),
      })),
    });
  })
);

const runSchema = z.object({
  action: z.enum(ACTIONS as [AIAction, ...AIAction[]]),
  text: z.string().min(1, 'متنی برای پردازش انتخاب نشده است').max(20000),
  scope: z.enum(['selection', 'paragraph', 'section', 'document']).default('selection'),
  instruction: z.string().max(500).optional(),
  noteId: z.string().optional(),
});

router.post(
  '/run',
  asyncHandler(async (req: AuthRequest, res) => {
    const data = runSchema.parse(req.body);
    const provider = getAIProvider();

    if (!provider.isActionAvailable(data.action)) {
      throw new AIUnavailableError(
        provider.name === 'openai-compatible'
          ? 'سرویس هوش مصنوعی پیکربندی نشده است (OPENAI_API_KEY در .env تنظیم نشده).'
          : 'این عملیات با موتور داخلی انجام نمی‌شود. یک سرویس هوش مصنوعی در .env پیکربندی کنید.'
      );
    }

    // context awareness: resolve note + subject path if provided
    let noteContext: { title?: string; subject?: string; chapter?: string; sectionTitle?: string } = {};
    let noteDoc = null;
    if (data.noteId) {
      noteDoc = await Note.findOne({ _id: data.noteId, userId: req.user!.id });
      if (noteDoc) {
        noteContext = {
          title: noteDoc.title,
          chapter: noteDoc.chapter || undefined,
          sectionTitle: data.scope === 'section' || data.scope === 'document' ? noteDoc.section || undefined : undefined,
        };
        if (noteDoc.subjectId) {
          const subject = await Subject.findById(noteDoc.subjectId);
          if (subject) noteContext.subject = subject.name;
        }
      }
    }

    // safety net: snapshot the note before AI transformation
    if (noteDoc) {
      const settings = await Settings.findOne({ userId: req.user!.id });
      if (settings?.ai.autoVersionBeforeAI !== false) {
        await maybeCreateVersion(
          String(noteDoc._id),
          req.user!.id,
          noteDoc.title,
          noteDoc.content as object,
          noteDoc.html,
          noteDoc.wordCount,
          `پشتیبان خودکار قبل از «${AI_ACTION_LABELS[data.action]}»`,
          true
        );
      }
    }

    try {
      const result = await provider.run({ ...data, note: noteContext });
      res.json(result);
    } catch (err) {
      if (err instanceof AIUnavailableError) throw new ApiError(503, err.message);
      throw err;
    }
  })
);

export default router;
