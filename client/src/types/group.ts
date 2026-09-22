/* ── Groups (foundation milestone) ─────────────────────────────────────
   Mirrors the server's PublicGroup shape. Roles and STATUS are separate
   axes; role is for UI display only — the server is the authority. */

export type GroupRole = 'owner' | 'admin' | 'member';
export type GroupMembershipStatus = 'active' | 'pending' | 'suspended' | 'removed';

export interface Group {
  id: string;
  name: string;
  avatar: string | null;
  description: string;
  ownerId: string;
  memberCount: number;
  /** the CALLER's role in this group (null when not a member) */
  myRole: GroupRole | null;
  myStatus: GroupMembershipStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  membershipId: string;
  userId: string;
  name: string;
  avatar: string | null;
  role: GroupRole;
  status: GroupMembershipStatus;
  joinedAt: string | null;
  createdAt: string;
}

export const GROUP_ROLE_LABELS: Record<GroupRole, string> = {
  owner: 'مالک',
  admin: 'مدیر',
  member: 'عضو',
};

export const GROUP_ROLE_LABELS_PLURAL: Record<GroupRole, string> = {
  owner: 'مالک',
  admin: 'مدیر',
  member: 'عضو',
};
