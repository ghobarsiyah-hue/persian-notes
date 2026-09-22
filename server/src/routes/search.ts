import { Router } from 'express';
import { Note } from '../models/Note.js';
import { Subject } from '../models/Subject.js';
import { Tag } from '../models/Tag.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();
router.use(requireAuth);

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** returns a snippet with match offsets so the client can highlight */
function buildSnippet(text: string, query: string, radius = 90): { text: string; matchStart: number; matchEnd: number } | null {
  const idx = text.indexOf(query);
  if (idx === -1) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  return {
    text: `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`,
    matchStart: idx - start,
    matchEnd: idx - start + query.length,
  };
}

router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    const q = String(req.query.q ?? '').trim();
    const { subjectId, tagId, favorite, days } = req.query;
    const query = String(req.query.q ?? '').trim();

    const filter: Record<string, unknown> = { userId: req.user!.id, trashed: false };
    if (subjectId) filter.subjectId = subjectId;
    if (tagId) filter.tags = tagId;
    if (favorite === 'true') filter.favorite = true;
    if (days) {
      const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
      filter.updatedAt = { $gte: since };
    }
    if (query) {
      const rx = new RegExp(escapeRegex(query), 'i');
      filter.$or = [{ title: rx }, { plainText: rx }, { chapter: rx }, { section: rx }];
    }

    const notes = await Note.find(filter)
      .sort({ updatedAt: -1 })
      .limit(100)
      .populate('tags')
      .populate('subjectId', 'name color parentId');

    // also match subject names / tag names so users find notes via their metadata
    let extraNoteIds: string[] = [];
    if (query) {
      const rx = new RegExp(escapeRegex(query), 'i');
      const [subjects, tags] = await Promise.all([
        Subject.find({ userId: req.user!.id, name: rx }).select('_id'),
        Tag.find({ userId: req.user!.id, name: rx }).select('_id'),
      ]);
      if (subjects.length || tags.length) {
        const metaFilter: Record<string, unknown> = {
          userId: req.user!.id,
          trashed: false,
          $or: [
            ...(subjects.length ? [{ subjectId: { $in: subjects.map((s) => s._id) } }] : []),
            ...(tags.length ? [{ tags: { $in: tags.map((t) => t._id) } }] : []),
          ],
        };
        const metaNotes = await Note.find(metaFilter).limit(50).select('_id');
        extraNoteIds = metaNotes
          .map((n) => String(n._id))
          .filter((id) => !notes.some((n) => String(n._id) === id));
      }
    }

    const results = notes.map((n) => {
      const plain = n.plainText || '';
      const q2 = q || query;
      const snippet = q2 ? buildSnippet(plain, q2) : null;
      const titleMatch = q2 ? new RegExp(escapeRegex(q2), 'i').test(n.title) : false;
      return {
        note: n,
        snippet,
        titleMatch,
        matchedIn: [titleMatch ? 'title' : null, snippet ? 'content' : null].filter(Boolean),
      };
    });

    let extraResults: Array<Record<string, unknown>> = [];
    if (extraNoteIds.length) {
      const extraNotes = await Note.find({ _id: { $in: extraNoteIds } })
        .populate('tags')
        .populate('subjectId', 'name color parentId');
      extraResults = extraNotes.map((n) => ({
        note: n,
        snippet: null,
        titleMatch: false,
        matchedIn: ['metadata'],
      }));
    }

    res.json({ results: [...results, ...extraResults], query: q });
  })
);

export default router;
