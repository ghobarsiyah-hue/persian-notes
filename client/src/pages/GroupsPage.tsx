import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { groupsApi } from '@/api/endpoints';
import { useApp } from '@/store/AppProvider';
import { CreateGroupModal } from '@/components/groups/CreateGroupModal';
import { GroupAvatar } from '@/components/groups/GroupAvatar';
import { Button, EmptyState, Skeleton, PageTitle } from '@/components/ui';
import { GROUP_ROLE_LABELS, type Group } from '@/types';
import { faDigits, relativeTime } from '@/utils/fa';

/**
 * My Groups — groups where the CURRENT user holds an ACTIVE membership
 * (server-filtered; the client only renders). Local page state keeps group
 * data OUT of the global store so editor pages never rerender for it (§20).
 */
export function GroupsPage() {
  const { user, toast } = useApp();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { groups: list } = await groupsApi.list();
      setGroups(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl p-6" style={{ animation: 'pn-fade-in 0.15s ease-out' }}>
      <PageTitle
        title="گروه‌های من"
        description="گروه‌هایی که در آن‌ها عضو هستید."
        actions={<Button onClick={() => setCreating(true)}>+ گروه جدید</Button>}
      />

      {loading ? (
        <div aria-busy="true" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      ) : error ? (
        <div className="mt-6" role="alert">
          <p className="mb-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-600 dark:bg-red-950 dark:text-red-400">
            بارگذاری گروه‌ها ناموفق بود: {error}
          </p>
          <Button variant="secondary" onClick={() => void load()}>تلاش دوباره</Button>
        </div>
      ) : groups.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon="◙"
            title="هنوز گروهی ندارید"
            description="با ساخت یک گروه، هم‌کلاسی‌ها و همکاران‌تان را دور هم جمع کنید."
            action={<Button onClick={() => setCreating(true)} className="mt-2">ساخت گروه</Button>}
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <Link
              key={g.id}
              to={`/groups/${g.id}`}
              className="pn-glass-panel group flex flex-col rounded-2xl p-4 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-card-accent-hover"
            >
              <div className="flex items-center gap-3">
                <GroupAvatar name={g.name} avatar={g.avatar} className="h-11 w-11" />
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-ink-900 dark:text-white">{g.name}</h3>
                  <p className="text-[11px] text-ink-500 dark:text-ink-400">
                    {g.myRole && GROUP_ROLE_LABELS[g.myRole]} · {faDigits(g.memberCount)} عضو
                  </p>
                </div>
              </div>
              {g.description && (
                <p className="mt-2 line-clamp-2 min-h-8 text-xs leading-5 text-ink-500 dark:text-ink-400">{g.description}</p>
              )}
              <div className="mt-2 border-t border-ink-100 pt-2 text-[11px] text-ink-400 dark:border-ink-800 dark:text-ink-500">
                آخرین فعالیت: {relativeTime(g.updatedAt)}
                {user && g.ownerId === user.id && <span className="mr-2 text-accent-700 dark:text-accent-300">مالک</span>}
              </div>
            </Link>
          ))}
        </div>
      )}

      <CreateGroupModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(g) => {
          toast('گروه جدید آماده است.', 'success');
          navigate(`/groups/${g.id}`);
        }}
      />
    </div>
  );
}

export default GroupsPage;
