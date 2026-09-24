import mongoose, { Schema, model, Document, Types } from 'mongoose';

export type GroupSettings = Record<string, unknown>;

/** Security model for joining + content control — a typed slice of the
 *  settings bag with server-side defaults; the API layer validates every
 *  write. joinPolicy: 'invite' (only admins/owner add members, the default)
 *  or 'open' (any registered user may join themselves). contentPolicy:
 *  'members' (only members see group notes) or 'public' (anyone with the
 *  link can read — write access always stays membership-gated). */
export interface GroupSecuritySettings {
  joinPolicy: 'invite' | 'open';
  contentPolicy: 'members' | 'public';
}

export const DEFAULT_SECURITY_SETTINGS: GroupSecuritySettings = {
  joinPolicy: 'invite',
  contentPolicy: 'members',
};

/** read + normalize the security slice — unknown/stale values fall back to
 *  the safe defaults so a corrupted record can never widen access */
export function readSecuritySettings(g: IGroup): GroupSecuritySettings {
  const s = (g.settings ?? {}) as Record<string, unknown>;
  return {
    joinPolicy: s.joinPolicy === 'open' ? 'open' : 'invite',
    contentPolicy: s.contentPolicy === 'public' ? 'public' : 'members',
  };
}

export interface IGroup extends Document {
  name: string;
  /** canonical absolute URL of a small data-URL avatar (≤150 KB, image/*) —
   *  same validation convention as the User avatar; null = initials fallback */
  avatar: string | null;
  description: string;
  /** group accent color — the ONE theming hook consumed by the group UI
   *  (header ring, avatars, active tab). Hex string or null = system accent */
  accentColor: string | null;
  /** the ONE owner — always an existing User; derived server-side at creation,
   *  never accepted from the client body */
  ownerId: Types.ObjectId;
  /** small extensible bag for future group-level preferences; NOT a dumping
   *  ground — only fields with a concrete consumer may be written here.
   *  The security slice (joinPolicy/contentPolicy) is validated by the API
   *  and read through readSecuritySettings(). */
  settings: GroupSettings;
  createdAt: Date;
  updatedAt: Date;
}

const GroupSchema = new Schema<IGroup>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    avatar: { type: String, default: null },
    description: { type: String, default: '', maxlength: 500, trim: true },
    accentColor: { type: String, default: null },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    settings: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

/* access patterns: group by id (implicit _id), groups by owner (My Groups fast
 * path + owner cleanup), member listing by group */
GroupSchema.index({ ownerId: 1, updatedAt: -1 });

export const Group = model<IGroup>('Group', GroupSchema);
