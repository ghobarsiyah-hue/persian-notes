import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { groupsApi } from '@/api/endpoints';
import { useApp } from '@/store/AppProvider';
import { Button, ButtonWithSpinner, EmptyState, Skeleton } from '@/components/ui';
import { faDigits, relativeTime } from '@/utils/fa';
import type { Group, GroupRole, Note } from '@/types';

/* UX-only mirror of the server's group.createNote — the server re-checks. */
const CAN_CREATE: readonly GroupRole[] = ['owner', 'admin', 'member'];

/**
 * جزوه‌های گروهی — the group's shared notes. Every active member sees the
 * list (server enforces group.view); each row opens the standard editor,
 * which uses the same save pipeline as personal notes (groupId is carried
 * by the note itself, no parallel state). Local page state only (§20).
 */
export function GroupNotesPanel({ group, canCreate }: { group: Group; canCreate: boolean }) {
  const { toast } = useApp();
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [busy, setBusy] = useState(false);

  const allowed = CAN_CREATE.includes(group.myRole as GroupRole) && canCreate;

  useEffect(() => {
    let alive = true;
    groupsApi
      .groupNotes(group.id)
      .then(({ notes: list }) => alive && setNotes(list))
      .catch((e) => toast('بارگذاری جزوه‌های گروه ناموفق بود: ' + (e as Error).message, 'error'));
    return () => {
      alive = false;
    };
  }, [group.id, toast]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { note } = await groupsApi.createGroupNote(group.id, {});
      toast('جزوه گروهی ساخته شد.', 'success');
      navigate(`/editor/${note._id}`);
    } catch (e) {
      toast('ساخت جزوه گروهی ناموفق بود: ' + (e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (notes === null) {
    return (
      <div aria-busy="true" className="space-y-2">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {allowed && (
        <div className="flex justify-end">
          <ButtonWithSpinner loading={busy} onClick={() => void create()} aria-busy={busy}>
            + جزوه گروهی جدید
          </ButtonWithSpinner>
        </div>
      )}

      {notes.length === 0 ? (
        <EmptyState
          icon="☰"
          title="هنوز جزوه‌ی گروهی ندارید"
          description={
            allowed
              ? 'اولین جزوه‌ی مشترک گروه را بسازید؛ همه‌ی اعضا آن را می‌بینند.'
              : 'مدیران گروه هنوز جزوه‌ی مشترکی نساخته‌اند.'
          }
          action={
            allowed && (
              <Button onClick={() => void create()} className="mt-2" disabled={busy} aria-busy={busy}>
                ساخت جزوه گروهی
              </Button>
            )
          }
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="فهرست جزوه‌های گروهی">
          {notes.map((n) => (
            <li key={n._id}>
              <button
                type="button"
                onClick={() => navigate(`/editor/${n._id}`)}
                className="pn-glass-panel w-full rounded-xl p-3 text-right shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-card-accent-hover focus-visible:shadow-focus"
              >
                <span className="block truncate text-sm font-semibold text-ink-900 dark:text-ink-100">
                  {n.title || 'بدون عنوان'}
                </span>
                <span className="mt-1 block text-[11px] text-ink-500 dark:text-ink-400">
                  {faDigits(n.wordCount ?? 0)} واژه · آخرین تغییر {relativeTime(n.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
