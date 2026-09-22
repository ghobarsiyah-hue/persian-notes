import { useState } from 'react';
import { subjectsApi } from '@/api/endpoints';
import { useApp } from '@/store/AppProvider';
import { NewSubjectModal } from '@/components/notes/NewSubjectModal';
import { EmptyState, Button } from '@/components/ui';

/** مدیریت موضوعات با ساختار درختی (موضوع ← فصل ← بخش) */
export function SubjectsPage() {
  const { subjects, reloadSubjects } = useApp();
  const [newSubject, setNewSubject] = useState(false);
  const roots = subjects.filter((s) => !s.parentId);

  const removeSubject = async (id: string, name: string) => {
    if (!window.confirm(`موضوع «${name}» حذف شود؟ جزوه‌ها حذف نمی‌شوند و بدون موضوع خواهند شد.`)) return;
    try {
      await subjectsApi.remove(id);
      await reloadSubjects();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-5 flex items-center gap-2">
        <h1 className="grow text-xl font-extrabold tracking-tight text-ink-900 dark:text-ink-100">موضوعات</h1>
        <Button onClick={() => setNewSubject(true)}>+ موضوع جدید</Button>
      </div>
      {roots.length === 0 && <EmptyState icon="◎" title="هنوز موضوعی ندارید" description="موضوعات (درس‌ها) را برای سازماندهی جزوه‌ها بسازید." />}
      <ul className="space-y-2">
        {roots.map((s) => (
          <li key={s._id} className="pn-glass-panel rounded-2xl p-4 shadow-card">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: s.color }} aria-hidden="true" />
              <span className="font-semibold text-ink-900 dark:text-ink-100">{s.name}</span>
              <div className="grow" />
              <button type="button" title="حذف" onClick={() => void removeSubject(s._id, s.name)} className="flex h-8 min-w-8 items-center justify-center rounded-lg text-xs text-ink-400 hover:bg-ink-100 hover:text-ship dark:hover:bg-ink-800">
                ✕
              </button>
            </div>
            {subjects.filter((c) => c.parentId === s._id).length > 0 && (
              <ul className="mt-2 space-y-1 border-r border-ink-100 pr-4 dark:border-ink-800">
                {subjects.filter((c) => c.parentId === s._id).map((c) => (
                  <li key={c._id} className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-400">
                    <span className="h-2 w-2 rounded-full" style={{ background: c.color }} aria-hidden="true" />
                    {c.name}
                    <button type="button" onClick={() => void removeSubject(c._id, c.name)} className="flex h-8 min-w-8 items-center justify-center rounded-lg text-xs text-ink-400 hover:text-ship">
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <NewSubjectModal open={newSubject} onClose={() => setNewSubject(false)} />
    </div>
  );
}

export default SubjectsPage;
