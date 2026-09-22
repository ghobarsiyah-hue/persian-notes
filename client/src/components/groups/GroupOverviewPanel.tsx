import { Card } from '@/components/ui';
import { GroupAvatar } from '@/components/groups/GroupAvatar';
import { GROUP_ROLE_LABELS, type Group, type GroupMember } from '@/types';
import { faDigits, formatDate } from '@/utils/fa';

/** Overview — real data only; no fake placeholders for chat/collab (§12). */
export function GroupOverviewPanel({ group, members }: { group: Group; members: GroupMember[] }) {
  const active = members.filter((m) => m.status === 'active');
  const owner = active.find((m) => m.role === 'owner');
  const admins = active.filter((m) => m.role === 'admin');

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div className="flex items-center gap-4">
          <GroupAvatar name={group.name} avatar={group.avatar} className="h-14 w-14" rounded="rounded-2xl" />
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-ink-900 dark:text-ink-100">{group.name}</h2>
            {group.description ? (
              <p className="mt-1 text-sm leading-6 text-ink-600 dark:text-ink-300">{group.description}</p>
            ) : (
              <p className="mt-1 text-xs text-ink-400">توضیحی ثبت نشده است.</p>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 border-t border-black/5 pt-3 text-sm dark:border-white/5 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] text-ink-400">تعداد اعضا</dt>
            <dd className="mt-0.5 font-semibold text-ink-900 dark:text-ink-100">{faDigits(group.memberCount)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-400">نقش شما</dt>
            <dd className="mt-0.5 font-semibold text-ink-900 dark:text-ink-100">
              {group.myRole ? GROUP_ROLE_LABELS[group.myRole] : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-400">تاریخ ساخت</dt>
            <dd className="mt-0.5 font-semibold text-ink-900 dark:text-ink-100">{formatDate(group.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-400">مالک گروه</dt>
            <dd className="mt-0.5 font-semibold text-ink-900 dark:text-ink-100">{owner?.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-400">مدیران</dt>
            <dd className="mt-0.5 font-semibold text-ink-900 dark:text-ink-100">
              {admins.length > 0 ? admins.map((a) => a.name).join('، ') : '—'}
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
