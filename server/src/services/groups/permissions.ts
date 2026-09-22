import { GroupMembership, type GroupRole } from '../../models/GroupMembership.js';
import { ApiError } from '../../middleware/error.js';

/* ═══════════════════════════════════════════════════════════════════════
   Centralized Group permission layer.
   The ONLY place role→permission mapping lives. Routes never branch on
   `role === 'admin'` themselves — they ask for a permission and this file
   decides which roles hold it. Backend is the authoritative source; the
   frontend's role display is UX only.
   ═══════════════════════════════════════════════════════════════════════ */

export const GROUP_PERMISSIONS = [
  'group.view',
  'group.update',
  'group.delete',
  'group.manageMembers',
  'group.manageRoles',
  'group.manageSettings',
  'group.inviteMembers',
  'group.createNote',
  'group.editAnyNote',
] as const;

export type GroupPermission = (typeof GROUP_PERMISSIONS)[number];

/** role → permissions. Single source of truth:
 *  - owner  : everything (deletion is owner-only)
 *  - admin  : operational management — members/roles/invite/settings/view,
 *             but NOT deletion and never owner-level actions
 *  - member : view + invite-slot for the future invitation system */
export const ROLE_PERMISSIONS: Record<GroupRole, readonly GroupPermission[]> = {
  owner: GROUP_PERMISSIONS,
  admin: [
    'group.view',
    'group.update',
    'group.manageMembers',
    'group.manageRoles',
    'group.manageSettings',
    'group.inviteMembers',
    'group.createNote',
    'group.editAnyNote',
  ],
  member: ['group.view', 'group.inviteMembers', 'group.createNote'],
};

export function roleHasPermission(role: GroupRole, permission: GroupPermission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export interface ResolvedMembership {
  membershipId: string;
  groupId: string;
  userId: string;
  role: GroupRole;
  status: string;
}

/** load the caller's membership row (any status) — routes use this when the
 *  STATUS itself matters (e.g. reactivating a removed member, listing) */
export async function getMembership(groupId: string, userId: string): Promise<ResolvedMembership | null> {
  const m = await GroupMembership.findOne({ groupId, userId }).lean();
  if (!m) return null;
  return {
    membershipId: String(m._id),
    groupId: String(m.groupId),
    userId: String(m.userId),
    role: m.role,
    status: m.status,
  };
}

/** hasActiveMembership — the future collaboration/share layer asks exactly
 *  this question: "is this user an ACTIVE member of this group?" */
export async function hasActiveMembership(groupId: string, userId: string): Promise<boolean> {
  const m = await GroupMembership.findOne({ groupId, userId, status: 'active' }).select('_id').lean();
  return m !== null;
}

/**
 * The single authorization gate for every group API:
 *   authenticated user → group exists → membership lookup → status ACTIVE
 *   → role → permission → allow / deny.
 * Denials are uniform 403s: no signal about WHICH check failed.
 */
export async function authorize(
  groupId: string,
  userId: string,
  permission: GroupPermission
): Promise<ResolvedMembership> {
  const membership = await getMembership(groupId, userId);
  if (!membership || membership.status !== 'active') {
    throw new ApiError(403, 'شما به این گروه دسترسی ندارید.');
  }
  if (!roleHasPermission(membership.role, permission)) {
    throw new ApiError(403, 'شما به این گروه دسترسی ندارید.');
  }
  return membership;
}

/** Permission over a TARGET user (member management). Encapsulates the owner
 *  protection rules so every route gets them identically:
 *  - nobody (not even admin) manages the owner through this path
 *  - admins may not act on other admins — owner-only
 *  - a user always implicitly "manages" themselves (leave/self-demotion) */
export function canManageTarget(actorRole: GroupRole, targetRole: GroupRole, targetUserId: string, actorUserId: string): boolean {
  if (targetRole === 'owner') return false;
  if (targetUserId === actorUserId) return true;
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return targetRole === 'member';
  return false;
}
