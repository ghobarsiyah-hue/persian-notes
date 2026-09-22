import mongoose, { Schema, model, Document, Types } from 'mongoose';

export type GroupSettings = Record<string, unknown>;

export interface IGroup extends Document {
  name: string;
  /** canonical absolute URL of a small data-URL avatar (≤150 KB, image/*) —
   *  same validation convention as the User avatar; null = initials fallback */
  avatar: string | null;
  description: string;
  /** the ONE owner — always an existing User; derived server-side at creation,
   *  never accepted from the client body */
  ownerId: Types.ObjectId;
  /** small extensible bag for future group-level preferences; NOT a dumping
   *  ground — only fields with a concrete consumer may be written here */
  settings: GroupSettings;
  createdAt: Date;
  updatedAt: Date;
}

const GroupSchema = new Schema<IGroup>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    avatar: { type: String, default: null },
    description: { type: String, default: '', maxlength: 500, trim: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    settings: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

/* access patterns: group by id (implicit _id), groups by owner (My Groups fast
 * path + owner cleanup), member listing by group */
GroupSchema.index({ ownerId: 1, updatedAt: -1 });

export const Group = model<IGroup>('Group', GroupSchema);
