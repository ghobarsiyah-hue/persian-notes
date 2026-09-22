import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { groupsApi } from '@/api/endpoints';
import { useApp } from '@/store/AppProvider';
import { GroupAvatar } from '@/components/groups/GroupAvatar';
import { GroupOverviewPanel } from '@/components/groups/GroupOverviewPanel';
import { GroupMembersPanel } from '@/components/groups/GroupMembersPanel';
import { GroupSettingsPanel } from '@/components/groups/GroupSettingsPanel';
import { GroupNotesPanel } from '@/components/groups/GroupNotesPanel';
import { Button, Skeleton } from '@/components/ui';
import { faDigits } from '@/utils/fa';
import type { Group, GroupMember, GroupRole } from '@/types';

/* Client-side permission mirror — UX ONLY. Every action here is re-checked
 * server-side; hiding a button is cosmetic, never a security boundary. */
const CAN: Record<string, readonly GroupRole[]> = {
  manageSettings: ['owner', 'admin'],
  manageMembers: ['owner', 'admin'],
  manageRoles: ['owner', 'admin'],
  deleteGroup: ['owner'],
};

function can(roles: readonly GroupRole[] | undefined, role: GroupRole | null | undefined): boolean {
  if (!role) return false;
  return roles?.includes(role) ?? false;
}

const TABS = [
  { id: 'overview', label: 'نمای کلی' },
  { id: 'notes', label: 'جزوه‌های گروهی' },
  { id: 'members', label: 'اعضا' },
  { id: 'settings', label: 'تنظیمات' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * Group space — Overview / Members / Settings. Group data lives in LOCAL
 * page state (fetched once here and passed down), so switching groups or
 * editing group fields never touches the global store and can never cause
 * editor rerenders (§19/§20).
 */
export function GroupDetailPage() {
  const { groupId = '' } = useParams();
  const { user, toast } = useApp();
  const navigate = useNavigate();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('overview');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ group: g }, { members: m }] = await Promise.all([groupsApi.get(groupId), groupsApi.members(groupId)]);
      setGroup(g);
      setMembers(m);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-6" aria-busy="true">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="mx-auto max-w-4xl p-6" role="alert">
        <p className="mb-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-600 dark:bg-red-950 dark:text-red-400">
          {error ?? 'گروه یافت نشد.'}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void load()}>تلاش دوباره</Button>
          <Link to="/groups"><Button variant="ghost">بازگشت به گروه‌ها</Button></Link>
        </div>
      </div>
    );
  }

  const isAdminUp = can(CAN.manageMembers, group.myRole);

  return (
    <div className="mx-auto max-w-4xl p-6" style={{ animation: 'pn-fade-in 0.15s ease-out' }}>
      {/* Group header */}
      <div className="flex flex-wrap items-center gap-4">
        <GroupAvatar name={group.name} avatar={group.avatar} className="h-16 w-16" rounded="rounded-2xl" />
        <div className="min-w-0 grow">
          <h1 className="truncate text-xl font-extrabold tracking-tight text-ink-900 dark:text-ink-100">{group.name}</h1>
          <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
            {faDigits(group.memberCount)} عضو
            {group.myRole && ` · نقش شما: ${roleLabel(group.myRole)}`}
          </p>
        </div>
        {can(CAN.deleteGroup, group.myRole) && (
          <Button
            variant="danger"
            size="sm"
            aria-label={`حذف گروه ${group.name}`}
            onClick={async () => {
              if (!window.confirm(`گروه «${group.name}» برای همیشه حذف شود؟ این عمل بازگشت‌پذیر نیست.`)) return;
              try {
                await groupsApi.remove(group.id);
                toast('گروه حذف شد.', 'success');
                navigate('/groups');
              } catch (e) {
                toast('حذف گروه ناموفق بود: ' + (e as Error).message, 'error');
              }
            }}
          >
            حذف گروه
          </Button>
        )}
      </div>

      {/* Tabs — ARIA tabs pattern: roving tabindex + arrow keys */}
      <div className="mt-5 flex gap-1 border-b border-black/5 pb-px dark:border-white/5" role="tablist" aria-label="بخش‌های گروه">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`group-tab-${t.id}`}
            aria-controls={`group-panel-${t.id}`}
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const dir = e.key === 'ArrowLeft' ? 1 : -1; // RTL: Left = next
              const next = TABS[(i + dir + TABS.length) % TABS.length];
              setTab(next.id);
              document.getElementById(`group-tab-${next.id}`)?.focus();
            }}
            className={`rounded-t-lg px-4 py-2 text-[13px] font-medium transition-[background,color] duration-100 focus-visible:shadow-focus ${
              tab === t.id
                ? 'bg-gray-100 text-ink-900 dark:bg-[#222] dark:text-white'
                : 'text-ink-500 hover:bg-gray-50 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-[#1a1a1a] dark:hover:text-ink-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        id={`group-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`group-tab-${tab}`}
        tabIndex={-1}
        className="mt-5"
      >
        {tab === 'overview' && <GroupOverviewPanel group={group} members={members} />}
        {tab === 'notes' && <GroupNotesPanel group={group} canCreate={true} />}
        {tab === 'members' && (
          <GroupMembersPanel
            group={group}
            members={members}
            canManage={isAdminUp}
            canManageRoles={can(CAN.manageRoles, group.myRole)}
            currentUserId={user?.id ?? null}
            onChanged={async () => {
              /* re-sync from the SERVER result — the UI never invents state */
              try {
                const [{ group: g }, { members: m }] = await Promise.all([groupsApi.get(groupId), groupsApi.members(groupId)]);
                setGroup(g);
                setMembers(m);
              } catch (e) {
                toast('همگام‌سازی اعضا ناموفق بود: ' + (e as Error).message, 'error');
              }
            }}
          />
        )}
        {tab === 'settings' && (
          <GroupSettingsPanel
            group={group}
            canEdit={can(CAN.manageSettings, group.myRole)}
            onSaved={(g) => setGroup(g)}
          />
        )}
      </div>
    </div>
  );
}

function roleLabel(role: GroupRole): string {
  return role === 'owner' ? 'مالک' : role === 'admin' ? 'مدیر' : 'عضو';
}

export default GroupDetailPage;
