import mongoose from 'mongoose';
import { Group, type IGroup, readSecuritySettings } from '../../models/Group.js';
import { GroupMembership, type GroupRole } from '../../models/GroupMembership.js';
import { User } from '../../models/User.js';
import { Notification } from '../../models/Notification.js';
import { ApiError } from '../../middleware/error.js';
import { hasActiveMembership } from './permissions.js';

/* ═══════════════════════════════════════════════════════════════════════
   Group domain service — mutations live here (not inline in routes) so the
   future invitation/Club layers call the SAME functions instead of
   re-implementing the invariants (atomic owner creation, one membership
   row per user, owner protection, notification reuse).
   ═══════════════════════════════════════════════════════════════════════ */

/** shape returned to the client — NEVER the raw mongoose doc */
export interface PublicGroup {
  id: string;
  name: string;
  avatar: string | null;
  description: string;
  /** hex accent color or null = system accent (consumed by the group UI) */
  accentColor: string | null;
  ownerId: string;
  memberCount: number;
  /** security model — every client renders its join/edit UX from these */
  joinPolicy: 'invite' | 'open';
  contentPolicy: 'members' | 'public';
  myRole: GroupRole | null;
  myStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

function publicGroup(g: IGroup, memberCount: number, myRole: GroupRole | null, myStatus: string | null): PublicGroup {
  return {
    id: String(g._id),
    name: g.name,
    avatar: g.avatar ?? null,
    description: g.description ?? '',
    accentColor: g.accentColor ?? null,
    ownerId: String(g.ownerId),
    memberCount,
    ...readSecuritySettings(g),
    myRole,
    myStatus,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}

async function countActiveMembers(groupId: string): Promise<number> {
  return GroupMembership.countDocuments({ groupId, status: 'active' });
}

export interface CreateGroupInput {
  name: string;
  description?: string;
  avatar?: string | null;
  accentColor?: string | null;
}

/**
 * CREATE — atomic: Group + owner membership are written in one MongoDB
 * transaction when the deployment supports it (replica set / mongod ≥4.0
 * on localhost does NOT: standalone servers reject transactions with
 * IllegalOperation). Strategy is decided ONCE per process by probing a
 * real transaction; the invariant "a group can never exist without its
 * owner membership" holds in BOTH paths:
 *  - transaction → all-or-nothing by definition
 *  - fallback    → membership FIRST, group SECOND; a failure between the
 *                  two leaves a pending membership row pointing nowhere,
 *                  which deleteOrphanMemberships() sweeps — never an
 *                  ownerless group.
 */
let transactionsSupported: boolean | null = null;

async function supportsTransactions(): Promise<boolean> {
  if (transactionsSupported !== null) return transactionsSupported;
  const conn = mongoose.connection;
  try {
    /* replica-set deployments advertise topology transactions require */
    if (conn.readyState !== 1) throw new Error('not connected');
    const hello = await conn.db?.admin().command({ hello: 1 });
    const topologyOk = hello?.setName ? true : false;
    if (!topologyOk) throw new Error('standalone');
    const session = await conn.startSession();
    try {
      await session.withTransaction(async () => {
        /* a no-op write-agnostic probe: read on an ephemeral collection */
        await conn.db?.command({ ping: 1 }, { session });
      });
      transactionsSupported = true;
    } finally {
      await session.endSession();
    }
  } catch {
    transactionsSupported = false;
  }
  return transactionsSupported;
}

export async function createGroup(ownerUserId: string, input: CreateGroupInput): Promise<PublicGroup> {
  if (await supportsTransactions()) {
    const session = await mongoose.startSession();
    let created: PublicGroup | null = null;
    try {
      await session.withTransaction(async () => {
        const [group] = await Group.create(
          [
            {
              name: input.name,
              description: input.description ?? '',
              avatar: input.avatar ?? null,
              accentColor: input.accentColor ?? null,
              ownerId: new mongoose.Types.ObjectId(ownerUserId),
            },
          ],
          { session }
        );

        await GroupMembership.create(
          [
            {
              groupId: group._id,
              userId: new mongoose.Types.ObjectId(ownerUserId),
              role: 'owner',
              status: 'active',
              grantedBy: null,
              joinedAt: new Date(),
            },
          ],
          { session }
        );

        created = publicGroup(group, 1, 'owner', 'active');
      });
    } finally {
      await session.endSession();
    }
    if (!created) throw new ApiError(500, 'خطای داخلی سرور. لطفاً دوباره تلاش کنید.');
    return created;
  }

  /* fallback (no transactions): membership FIRST so the group record is
     never created without its owner membership; the unique (groupId,userId)
     index makes the upsert idempotent, and double-submission creates two
     DISTINCT groups (each with its own owner) rather than corrupting one. */
  const ownerObjectId = new mongoose.Types.ObjectId(ownerUserId);
  const [membership] = await GroupMembership.create(
    [
      {
        groupId: new mongoose.Types.ObjectId(), // re-assigned below to the group id
        userId: ownerObjectId,
        role: 'owner',
        status: 'active',
        grantedBy: null,
        joinedAt: new Date(),
      },
    ]
  );
  try {
    const [group] = await Group.create([
      {
        name: input.name,
        description: input.description ?? '',
        avatar: input.avatar ?? null,
        accentColor: input.accentColor ?? null,
        ownerId: ownerObjectId,
      },
    ]);
    membership.groupId = group._id;
    await membership.save();
    return publicGroup(group, 1, 'owner', 'active');
  } catch (err) {
    /* group creation failed → remove the provisional membership row so no
       orphan remains; the user's create attempt cleanly failed (§21) */
    await GroupMembership.deleteOne({ _id: membership._id }).catch(() => undefined);
    throw err;
  }
}

/** housekeeping: drop provisional membership rows whose group was never
 *  created (crash between the two fallback writes). Cheap, index-backed. */
export async function deleteOrphanMemberships(): Promise<number> {
  const memberships = await GroupMembership.find().select('_id groupId').lean<{ _id: mongoose.Types.ObjectId; groupId: mongoose.Types.ObjectId }[]>();
  if (memberships.length === 0) return 0;
  const groupIds = [...new Set(memberships.map((m) => String(m.groupId)))];
  const existing = new Set(
    (await Group.find({ _id: { $in: groupIds } }).select('_id').lean<{ _id: mongoose.Types.ObjectId }[]>()).map((g) => String(g._id))
  );
  const orphans = memberships.filter((m) => !existing.has(String(m.groupId)));
  if (orphans.length === 0) return 0;
  const res = await GroupMembership.deleteMany({ _id: { $in: orphans.map((m) => m._id) } });
  return res.deletedCount ?? 0;
}

/** LIST MY GROUPS — only groups where the caller holds an ACTIVE membership.
 *  Membership is the single source of truth; ownerId is NOT consulted for
 *  access (a transferred-away owner must not keep access). */
export async function listMyGroups(userId: string): Promise<PublicGroup[]> {
  const memberships = await GroupMembership.find({ userId, status: 'active' })
    .select('groupId role')
    .lean<{ groupId: mongoose.Types.ObjectId; role: GroupRole }[]>();
  if (memberships.length === 0) return [];

  const groups = await Group.find({ _id: { $in: memberships.map((m) => m.groupId) } })
    .sort({ updatedAt: -1 })
    .lean<IGroup[]>();

  const byId = new Map(memberships.map((m) => [String(m.groupId), m]));
  const counts = await GroupMembership.aggregate<{ _id: unknown; n: number }>([
    { $match: { groupId: { $in: memberships.map((m) => m.groupId) }, status: 'active' } },
    { $group: { _id: '$groupId', n: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.n]));

  return groups.map((g) => {
    const m = byId.get(String(g._id));
    return {
      id: String(g._id),
      name: g.name,
      avatar: g.avatar ?? null,
      description: g.description ?? '',
      accentColor: g.accentColor ?? null,
      ownerId: String(g.ownerId),
      memberCount: countMap.get(String(g._id)) ?? 0,
      ...readSecuritySettings(g as IGroup),
      myRole: (m?.role as GroupRole) ?? null,
      myStatus: m ? 'active' : null,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
    };
  });
}

/** GET ONE — requires ACTIVE membership (any role has group.view). */
export async function getGroupForUser(groupId: string, userId: string): Promise<PublicGroup> {
  const group = await Group.findById(groupId);
  if (!group) throw new ApiError(404, 'گروه یافت نشد.');

  const m = await GroupMembership.findOne({ groupId: group._id, userId, status: 'active' }).lean();
  if (!m) throw new ApiError(403, 'شما به این گروه دسترسی ندارید.');

  return publicGroup(group, await countActiveMembers(String(group._id)), m.role as GroupRole, 'active');
}

export interface UpdateGroupInput {
  name?: string;
  description?: string;
  avatar?: string | null;
  accentColor?: string | null;
  joinPolicy?: 'invite' | 'open';
  contentPolicy?: 'members' | 'public';
}

/** UPDATE — caller must already hold group.manageSettings (checked by the
 *  route via authorize()). Returns the fresh public shape WITH the caller's
 *  membership resolved: the previous behavior returned myRole/myStatus = null,
 *  which flipped the client's settings panel into read-only mode right after
 *  the first save — the owner could never edit the group again without a
 *  full page reload (item ۲). */
export async function updateGroup(groupId: string, actorId: string, patch: UpdateGroupInput): Promise<PublicGroup> {
  /* the security slice lives INSIDE the settings bag — projected out of the
     flat patch and merged so partial updates never drop the other slice */
  const { joinPolicy, contentPolicy, ...rest } = patch;
  const securityPatch: Record<string, unknown> = {};
  if (joinPolicy) securityPatch.joinPolicy = joinPolicy;
  if (contentPolicy) securityPatch.contentPolicy = contentPolicy;

  let group = await Group.findById(groupId);
  if (!group) throw new ApiError(404, 'گروه یافت نشد.');
  if (Object.keys(securityPatch).length > 0) {
    const current = readSecuritySettings(group);
    group.set('settings', { ...(group.settings ?? {}), ...current, ...securityPatch });
    group.markModified('settings');
  }
  if (Object.keys(rest).length > 0) group.set(rest as Record<string, unknown>);
  group = await group.save({ validateBeforeSave: true });
  /* resolve the CALLER's membership so the client keeps its edit rights */
  const m = await GroupMembership.findOne({ groupId: group._id, userId: actorId, status: 'active' }).lean();
  return publicGroup(group, await countActiveMembers(groupId), (m?.role as GroupRole) ?? null, m ? 'active' : null);
}

/** DELETE — owner-only (route enforces group.delete). Removes the group and
 *  every membership row; nothing else (notes are NOT touched — §18).
 *  Transactional when supported; otherwise group LAST so a crash can only
 *  orphan memberships (swept by deleteOrphanMemberships), never a group
 *  whose members were already deleted. */
export async function deleteGroup(groupId: string): Promise<void> {
  if (await supportsTransactions()) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await GroupMembership.deleteMany({ groupId }).session(session);
        await Group.findByIdAndDelete(groupId).session(session);
      });
    } finally {
      await session.endSession();
    }
    return;
  }
  await GroupMembership.deleteMany({ groupId });
  await Group.findByIdAndDelete(groupId);
}

/* ── members ──────────────────────────────────────────────────────────── */

/** minimum identity fields a member list may expose — no email/credentials */
const MEMBER_USER_FIELDS = 'name avatar createdAt';

export async function listMembers(groupId: string): Promise<
  Array<{
    membershipId: string;
    userId: string;
    name: string;
    avatar: string | null;
    role: GroupRole;
    status: string;
    joinedAt: string | null;
    createdAt: string;
  }>
> {
  const rows = await GroupMembership.find({ groupId })
    .sort({ createdAt: 1 })
    .lean<{ _id: mongoose.Types.ObjectId; userId: mongoose.Types.ObjectId; role: GroupRole; status: string; joinedAt: Date | null; createdAt: Date }[]>();
  const userIds = rows.map((r) => r.userId);
  const users = await User.find({ _id: { $in: userIds } })
    .select(MEMBER_USER_FIELDS)
    .lean<{ _id: mongoose.Types.ObjectId; name: string; avatar?: string | null }[]>();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  return rows.map((r) => {
    const u = userMap.get(String(r.userId));
    return {
      membershipId: String(r._id),
      userId: String(r.userId),
      name: u?.name ?? 'کاربر حذف‌شده',
      avatar: u?.avatar ?? null,
      role: r.role,
      status: r.status,
      joinedAt: r.joinedAt ? r.joinedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

/** best-effort targeted notification to a group member through the EXISTING
 *  Notification infrastructure — never throws into the caller */
async function notifyMember(
  userId: string,
  type: string,
  title: string,
  message: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await Notification.create({ userId, type, title, message, severity: 'info', metadata });
  } catch {
    /* notification failure must not break the mutation */
  }
}

async function groupName(groupId: string): Promise<string> {
  const g = await Group.findById(groupId).select('name').lean();
  return g?.name ?? 'گروه';
}

/** ADD MEMBER (direct activation) — reserved for server-side/future
 *  invitation acceptance. Keeps the one-row invariant via upsert. */
export async function activateMembership(
  groupId: string,
  userId: string,
  role: GroupRole = 'member',
  grantedBy?: string
): Promise<void> {
  await GroupMembership.updateOne(
    { groupId, userId },
    {
      $set: { role, status: 'active', grantedBy: grantedBy ? new mongoose.Types.ObjectId(grantedBy) : null },
      $setOnInsert: { joinedAt: new Date() },
    },
    { upsert: true }
  );
}

/** future invitation flow: Invitation accepted → call this */
export async function upsertPendingMembership(groupId: string, userId: string): Promise<void> {
  await GroupMembership.updateOne(
    { groupId, userId },
    { $setOnInsert: { role: 'member', status: 'pending', joinedAt: null, grantedBy: null } },
    { upsert: true }
  );
}

export interface SetMemberRoleResult {
  membershipId: string;
  userId: string;
  role: GroupRole;
  status: string;
}

/** ROLE CHANGE — the route has already verified canManageTarget(); this
 *  enforces the data-level invariants and notifies the affected member. */
export async function setMemberRole(
  groupId: string,
  targetUserId: string,
  newRole: GroupRole,
  actorId: string
): Promise<SetMemberRoleResult> {
  const m = await GroupMembership.findOne({ groupId, userId: targetUserId });
  if (!m) throw new ApiError(404, 'عضو یافت نشد.');
  if (m.status === 'removed') throw new ApiError(400, 'کاربر دیگر عضو این گروه نیست.');

  /* role flips must NEVER bypass owner protection: the owner row is only
     writable by the owner-transfer path (not implemented yet) */
  if (m.role === 'owner') throw new ApiError(403, 'نقش مالک قابل تغییر نیست.');

  m.role = newRole;
  m.grantedBy = new mongoose.Types.ObjectId(actorId);
  await m.save();

  void notifyMember(
    targetUserId,
    'group:role_changed',
    'نقش شما در گروه تغییر کرد',
    `نقش شما در گروه «${await groupName(groupId)}» به ${roleLabel(newRole)} تغییر یافت.`,
    { groupId, role: newRole }
  );

  return { membershipId: String(m._id), userId: targetUserId, role: m.role, status: m.status };
}

export function roleLabel(role: GroupRole): string {
  return role === 'owner' ? 'مالک' : role === 'admin' ? 'مدیر' : 'عضو';
}

export interface RemoveMemberResult {
  membershipId: string;
  userId: string;
  status: string;
}

/** REMOVAL — status transition (row is kept: membership history + future
 *  re-invite). The owner can never be removed here. */
export async function removeMember(
  groupId: string,
  targetUserId: string,
  actorId: string,
  notify = true
): Promise<RemoveMemberResult> {
  const m = await GroupMembership.findOne({ groupId, userId: targetUserId });
  if (!m) throw new ApiError(404, 'عضو یافت نشد.');
  if (m.role === 'owner') throw new ApiError(403, 'مالک گروه قابل حذف نیست.');

  m.status = 'removed';
  m.leftAt = new Date();
  await m.save();

  if (notify) {
    void notifyMember(
      targetUserId,
      'group:member_removed',
      'از گروه حذف شدید',
      `شما از گروه «${await groupName(groupId)}» حذف شدید.`,
      { groupId }
    );
  }
  return { membershipId: String(m._id), userId: targetUserId, status: m.status };
}

export { countActiveMembers, hasActiveMembership };
