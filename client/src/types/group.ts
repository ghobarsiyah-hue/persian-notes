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
  /** hex accent color or null = system accent — the group's theming hook */
  accentColor: string | null;
  ownerId: string;
  memberCount: number;
  /** security model (mirrors the server) */
  joinPolicy: 'invite' | 'open';
  contentPolicy: 'members' | 'public';
  /** the CALLER's role in this group (null when not a member) */
  myRole: GroupRole | null;
  myStatus: GroupMembershipStatus | null;
  createdAt: string;
  updatedAt: string;
}

export const JOIN_POLICY_LABELS: Record<Group['joinPolicy'], string> = {
  invite: 'فقط با دعوت مدیر',
  open: 'پیوستن آزاد',
};

export const CONTENT_POLICY_LABELS: Record<Group['contentPolicy'], string> = {
  members: 'فقط اعضا',
  public: 'عمومی (خواندن با لینک)',
};

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
