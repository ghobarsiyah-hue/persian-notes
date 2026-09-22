import { useState } from 'react';
import { groupsApi } from '@/api/endpoints';
import { useApp } from '@/store/AppProvider';
import { emitUserEvent } from '@/events/userEvents';
import { Select, Button, Badge } from '@/components/ui';
import { BotAvatar } from '@/components/BotAvatar';
import { GROUP_ROLE_LABELS, type Group, type GroupMember, type GroupRole } from '@/types';
import { faDigits, relativeTime } from '@/utils/fa';

const STATUS_BADGES: Record<GroupMember['status'], { label: string; tone: 'neutral' | 'ship' | 'develop' | 'preview' } | null> = {
  active: null,
  pending: { label: 'در انتظار', tone: 'develop' },
  suspended: { label: 'معلق', tone: 'preview' },
  removed: { label: 'حذف‌شده', tone: 'ship' },
};

const SELECTABLE_ROLES: GroupRole[] = ['admin', 'member'];

/**
 * Members — identity comes from the existing User/Profile data (name +
 * avatar via the server; email is never exposed). Management controls are
 * rendered ONLY for owner/admin (UX), and every mutation is verified and
 * applied by the server: the UI updates from the server's response or not
 * at all — a failed role change leaves the old role visible (§21/§22).
 */
export function GroupMembersPanel({
  group,
  members,
  canManage,
  canManageRoles,
  currentUserId,
  onChanged,
}: {
  group: Group;
  members: GroupMember[];
  canManage: boolean;
  canManageRoles: boolean;
  currentUserId: string | null;
  onChanged: () => Promise<void>;
}) {
  const { toast } = useApp();
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const setRole = async (m: GroupMember, role: GroupRole) => {
    if (role === m.role) return;
    setBusyUserId(m.userId);
    try {
      await groupsApi.setMemberRole(group.id, m.userId, role);
      toast(`نقش «${m.name}» به ${GROUP_ROLE_LABELS[role]} تغییر یافت.`, 'success');
      await onChanged(); // UI re-renders from confirmed server data
    } catch (e) {
      toast('تغییر نقش ناموفق بود: ' + (e as Error).message, 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const remove = async (m: GroupMember) => {
    if (!window.confirm(`«${m.name}» از گروه حذف شود؟`)) return;
    setBusyUserId(m.userId);
    try {
      await groupsApi.removeMember(group.id, m.userId);
      toast(`«${m.name}» از گروه حذف شد.`, 'success');
      await onChanged();
    } catch (e) {
      toast('حذف عضو ناموفق بود: ' + (e as Error).message, 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const leave = async (m: GroupMember) => {
    if (!window.confirm('از این گروه خارج می‌شوید؟')) return;
    setBusyUserId(m.userId);
    try {
      await groupsApi.removeMember(group.id, m.userId);
      toast('از گروه خارج شدید.', 'success');
      emitUserEvent('group.member.left', { targetType: 'group', targetId: group.id });
      await onChanged();
    } catch (e) {
      toast('خروج از گروه ناموفق بود: ' + (e as Error).message, 'error');
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div className="space-y-2">
      {members.map((m) => {
        const isSelf = m.userId === currentUserId;
        const isOwner = m.role === 'owner';
        const statusBadge = STATUS_BADGES[m.status];
        /* owner is never manageable (server enforces this too); admins are
           manageable by the owner only; self-management = leave */
        const manageable = canManage && !isOwner && !isSelf && m.status === 'active';
        const canTouchThisTarget =
          m.role !== 'admin' || group.myRole === 'owner'; /* admin↔admin blocked */

        return (
          <div
            key={m.membershipId}
            className="pn-glass-panel flex flex-wrap items-center gap-3 rounded-2xl p-3 shadow-card"
          >
            {m.avatar ? (
              <img src={m.avatar} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
            ) : (
              <BotAvatar name={m.name} className="h-10 w-10 text-[11px] font-bold" />
            )}
            <div className="min-w-0 grow">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold text-ink-900 dark:text-ink-100">
                  {m.name}
                  {isSelf && <span className="mr-1 text-[11px] font-normal text-ink-400">(شما)</span>}
                </span>
                <Badge tone={isOwner ? 'ship' : 'neutral'}>{GROUP_ROLE_LABELS[m.role]}</Badge>
                {statusBadge && <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>}
              </div>
              <p className="mt-0.5 text-[11px] text-ink-400">
                {m.joinedAt ? `عضو از ${relativeTime(m.joinedAt)}` : 'هنوز عضو نشده'}
              </p>
            </div>

            {manageable && canManageRoles && canTouchThisTarget && (
              <Select
                aria-label={`نقش ${m.name}`}
                value={m.role}
                disabled={busyUserId === m.userId}
                onChange={(e) => void setRole(m, e.target.value as GroupRole)}
                className="w-auto min-w-28"
              >
                {SELECTABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{GROUP_ROLE_LABELS[r]}</option>
                ))}
              </Select>
            )}

            {manageable && (
              <Button
                variant="danger"
                size="sm"
                disabled={busyUserId === m.userId}
                aria-label={`حذف عضو ${m.name} از گروه`}
                onClick={() => void remove(m)}
              >
                حذف
              </Button>
            )}

            {isSelf && !isOwner && m.status === 'active' && (
              <Button variant="ghost" size="sm" disabled={busyUserId === m.userId} aria-label={`خروج ${m.name} از گروه`} onClick={() => void leave(m)}>
                خروج از گروه
              </Button>
            )}

            {isOwner && <span className="text-[11px] text-ink-400">مالک گروه</span>}
          </div>
        );
      })}
    </div>
  );
}
