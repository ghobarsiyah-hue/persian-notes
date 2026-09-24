import { Router } from 'express';
import { z } from 'zod';
import { Settings } from '../models/Settings.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();
router.use(requireAuth);

async function getOrCreate(userId: string) {
  let s = await Settings.findOne({ userId });
  if (!s) s = await Settings.create({ userId });
  return s;
}

router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    res.json({ settings: await getOrCreate(req.user!.id) });
  })
);

const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  editor: z
    .object({
      fontSize: z.number().min(12).max(28).optional(),
      lineHeight: z.number().min(1.2).max(3).optional(),
      fontFamily: z.string().max(80).optional(),
      /** کادرهای آموزشی customization — shape owned by the client, but
          validated coarsely so garbage can never reach the DB */
      eduBlocks: z
        .union([
          z.string().max(20),
          z
            .object({
              base: z.enum(['minimal', 'tinted', 'strong']).optional(),
              borderColor: z.string().max(40).optional(),
              borderWidth: z.number().min(0).max(6).optional(),
              borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
              radius: z.number().min(0).max(40).optional(),
              padding: z.number().min(0).max(40).optional(),
              shadow: z.enum(['none', 'soft', 'raised']).optional(),
              accentBar: z.enum(['none', 'start', 'end']).optional(),
              titleBar: z.enum(['none', 'soft', 'full']).optional(),
              titleWeight: z.number().min(300).max(900).optional(),
              titleSize: z.number().min(50).max(200).optional(),
              iconsVisible: z.boolean().optional(),
              tint: z.enum(['none', 'soft', 'strong']).optional(),
              fillColors: z.record(z.string().max(40)).optional(),
              titleColors: z.record(z.string().max(40)).optional(),
              accentColors: z.record(z.string().max(40)).optional(),
              hideIcons: z.record(z.boolean()).optional(),
            })
            .passthrough(),
        ])
        .optional(),
    })
    .optional(),
  export: z
    .object({
      margin: z.number().min(5).max(60).optional(),
      fontSize: z.number().min(8).max(24).optional(),
      lineHeight: z.number().min(1.2).max(3).optional(),
      showPageNumbers: z.boolean().optional(),
      showHeader: z.boolean().optional(),
      showFooter: z.boolean().optional(),
      headerText: z.string().max(200).optional(),
      footerText: z.string().max(200).optional(),
      showCover: z.boolean().optional(),
    })
    .optional(),
  ai: z.object({ autoVersionBeforeAI: z.boolean().optional() }).optional(),
  notifications: z
    .object({
      position: z.enum(['top-right', 'top-left', 'bottom-right', 'bottom-left']).optional(),
      prefs: z
        .object({
          collabJoined: z.boolean().optional(),
          collabEdited: z.boolean().optional(),
          collabLeft: z.boolean().optional(),
          docMajorChange: z.boolean().optional(),
          docShare: z.boolean().optional(),
          docAccessChange: z.boolean().optional(),
          systemSave: z.boolean().optional(),
          systemError: z.boolean().optional(),
          systemWarning: z.boolean().optional(),
          systemUpdate: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  border: z
    .object({
      enabled: z.boolean().optional(),
      style: z.enum(['classic', 'double', 'ornate', 'minimal', 'none']).optional(),
      primaryColor: z.string().max(40).optional(),
      secondaryColor: z.string().max(40).optional(),
      fillColor: z.string().max(40).optional(),
      thickness: z.number().min(0.5).max(3).optional(),
      cornerDecoration: z.boolean().optional(),
      showHeader: z.boolean().optional(),
      showFooter: z.boolean().optional(),
      showPageNumbers: z.boolean().optional(),
      sideLabel: z.string().max(120).optional(),
    })
    .optional(),
  /** fallback-avatar preset — 'auto' (name-hash) or one of the bot profile
   *  ids the client offers (validated as a loose token, new ids stay
   *  backward-compatible without a server deploy) */
  avatarPreset: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
});

router.put(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    const data = settingsSchema.parse(req.body);
    const s = await getOrCreate(req.user!.id);
    if (data.theme) s.theme = data.theme;
    if (data.editor) Object.assign(s.editor, data.editor);
    /* Mixed sub-doc: mark modified so Mongoose actually persists the change */
    if (data.editor?.eduBlocks !== undefined) s.markModified('editor.eduBlocks');
    if (data.export) Object.assign(s.export, data.export);
    if (data.ai) Object.assign(s.ai, data.ai);
    /* Border settings (template colors etc.) — validated above but previously
       never applied, so picker changes were silently dropped for every template */
    if (data.border) Object.assign(s.border, data.border);
    if (data.notifications) {
      if (data.notifications.position) s.notifications.position = data.notifications.position;
      if (data.notifications.prefs) Object.assign(s.notifications.prefs, data.notifications.prefs);
    }
    if (data.avatarPreset) s.avatarPreset = data.avatarPreset;
    await s.save();
    res.json({ settings: s });
  })
);

export default router;
