import mongoose, { Schema, model, Document, Types } from 'mongoose';

/** Role and STATUS are orthogonal axes (§ "keep membership status separate
 *  from role"): an invited user is 'pending', not a 'pending' role. */
export type GroupRole = 'owner' | 'admin' | 'member';
export type GroupMembershipStatus = 'active' | 'pending' | 'suspended' | 'removed';

export interface IGroupMembership extends Document {
  groupId: Types.ObjectId;
  userId: Types.ObjectId;
  role: GroupRole;
  status: GroupMembershipStatus;
  /** who granted the current role (owner/admin) — audit trail for role
   *  changes; null for creator-owner memberships */
  grantedBy: Types.ObjectId | null;
  joinedAt: Date | null;
  leftAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const GroupMembershipSchema = new Schema<IGroupMembership>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: {
      type: String,
      enum: ['owner', 'admin', 'member'],
      default: 'member',
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'pending', 'suspended', 'removed'],
      default: 'active',
      required: true,
    },
    grantedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    joinedAt: { type: Date, default: null },
    leftAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/* THE data-integrity constraint: at most ONE membership row per (group,user).
 * "one active membership per group per user" is enforced by upserting this
 * single row through status transitions — a user can never hold two active
 * memberships of the same group because they cannot hold two rows at all. */
GroupMembershipSchema.index({ groupId: 1, userId: 1 }, { unique: true });
/* hot access patterns: all members of a group; all groups of a user */
GroupMembershipSchema.index({ groupId: 1, status: 1 });
GroupMembershipSchema.index({ userId: 1, status: 1 });

export const GroupMembership = model<IGroupMembership>('GroupMembership', GroupMembershipSchema);
