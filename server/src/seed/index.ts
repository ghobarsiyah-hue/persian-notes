import { Template } from '../models/Template.js';
import { Note } from '../models/Note.js';
import { Subject } from '../models/Subject.js';
import { Tag } from '../models/Tag.js';
import { SEED_TEMPLATES, SEED_NOTES } from './data.js';
import type { TNode } from './builders.js';

export function collectText(node: TNode): string {
  let out = node.text ?? '';
  if (node.content) for (const child of node.content) out += ' ' + collectText(child);
  return out;
}

export function wordCountOf(node: TNode): number {
  return collectText(node).split(/\s+/).filter(Boolean).length;
}

/** idempotent — safe to call on every startup */
export async function ensureSeedTemplates(): Promise<void> {
  for (const t of SEED_TEMPLATES) {
    const existing = await Template.findOne({ key: t.key, isBuiltIn: true });
    if (!existing) {
      await Template.create({
        key: t.key,
        name: t.name,
        description: t.description,
        category: t.category,
        style: t.style,
        content: t.content,
        isBuiltIn: true,
      });
    }
  }
}

/** creates the realistic sample data; everything is flagged metadata.seed = true */
export async function seedSampleDataForUser(userId: string): Promise<{ created: number }> {
  const existing = await Note.countDocuments({ userId, 'metadata.seed': true });
  if (existing > 0) return { created: 0 };

  const subjectCache = new Map<string, string>();
  const tagCache = new Map<string, string>();
  let createdCount = 0;

  for (const seed of SEED_NOTES) {
    /* idempotency per note: a stable seedKey (or the title as fallback)
       lets us add new seed notes without touching existing ones */
    const seedKey = seed.seedKey ?? seed.title;
    const already = await Note.findOne({ userId, 'metadata.seedKey': seedKey });
    if (already) continue;

    let subjectId = subjectCache.get(seed.subjectName);
    if (!subjectId) {
      const s = await Subject.findOneAndUpdate(
        { userId, name: seed.subjectName },
        { $setOnInsert: { userId, name: seed.subjectName, color: '#1d4ed8' } },
        { upsert: true, new: true }
      );
      subjectId = String(s._id);
      subjectCache.set(seed.subjectName, subjectId);
    }

    const tagIds: string[] = [];
    for (const name of seed.tags) {
      let tagId = tagCache.get(name);
      if (!tagId) {
        const t = await Tag.findOneAndUpdate(
          { userId, name },
          { $setOnInsert: { userId, name, color: '#0ea5e9' } },
          { upsert: true, new: true }
        );
        tagId = String(t._id);
        tagCache.set(name, tagId);
      }
      tagIds.push(tagId);
    }

    await Note.create({
      userId,
      title: seed.title,
      subjectId,
      chapter: seed.chapter,
      section: seed.section,
      content: seed.content,
      html: '',
      plainText: collectText(seed.content),
      tags: tagIds,
      favorite: seed.tags.includes('مهم') || Boolean(seed.seedKey),
      wordCount: wordCountOf(seed.content),
      metadata: { seed: true, seedKey },
    });
    createdCount++;
  }
  return { created: createdCount };
}

/** removes only the seeded sample data (notes flagged metadata.seed), plus orphaned seed subjects/tags */
export async function removeSampleDataForUser(userId: string): Promise<{ removed: number }> {
  const res = await Note.deleteMany({ userId, 'metadata.seed': true });
  const { deletedCount } = res;

  // clean up subjects/tags that no longer have any notes
  const subjects = await Subject.find({ userId });
  for (const s of subjects) {
    if ((await Note.countDocuments({ subjectId: s._id })) === 0) await s.deleteOne();
  }
  const tags = await Tag.find({ userId });
  for (const t of tags) {
    if ((await Note.countDocuments({ tags: t._id })) === 0) await t.deleteOne();
  }
  return { removed: deletedCount ?? 0 };
}
