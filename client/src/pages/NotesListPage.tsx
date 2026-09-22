import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { notesApi, subjectsApi } from '@/api/endpoints';
import { useApp } from '@/store/AppProvider';
import { NoteCard } from '@/components/notes/NoteCard';
import { NewSubjectModal } from '@/components/notes/NewSubjectModal';
import { EmptyState, Button, Select, Skeleton } from '@/components/ui';
import type { Note } from '@/types';

/** generic filtered list page: همه / علاقه‌مندی / سطل زباله */
export function NotesListPage({ mode }: { mode: 'all' | 'favorite' | 'trash' }) {
  const { subjects, toast } = useApp();
  const [searchParams] = useSearchParams();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [subjectFilter, setSubjectFilter] = useState(searchParams.get('subject') ?? '');
  const [query, setQuery] = useState('');
  const [newSubject, setNewSubject] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { trashed: mode === 'trash' };
      if (mode === 'favorite') params.favorite = true;
      if (subjectFilter) params.subjectId = subjectFilter;
      const { notes: list } = await notesApi.list(params);
      setNotes(list);
    } catch (e) {
      toast('بارگذاری جزوه‌ها ناموفق بود: ' + (e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, subjectFilter]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return notes;
    return notes.filter((n) => n.title.includes(q) || n.plainText?.includes(q));
  }, [notes, query]);

  const title = mode === 'trash' ? 'سطل زباله' : mode === 'favorite' ? 'علاقه‌مندی‌ها' : 'جزوه‌های من';

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h1 className="grow text-xl font-extrabold tracking-tight text-ink-900 dark:text-ink-100">{title}</h1>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="فیلتر سریع…"
          aria-label="فیلتر سریع"
          className="w-48 min-h-9 rounded-lg bg-transparent px-3 text-sm shadow-ring placeholder:text-ink-400 focus-visible:shadow-focus dark:bg-ink-900 dark:text-ink-100"
        />
        {mode !== 'trash' && (
          <Select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)} className="w-auto">
            <option value="">همه موضوعات</option>
            {subjects.map((s) => (
              <option key={s._id} value={s._id}>{s.name}</option>
            ))}
          </Select>
        )}
        {mode !== 'trash' && (
          <Button variant="secondary" onClick={() => setNewSubject(true)}>+ موضوع</Button>
        )}
      </div>

      {loading ? (
        <div aria-busy="true" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={mode === 'trash' ? '✕' : '▬'} title="موردی یافت نشد" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((n) => (
            <NoteCard
              key={n._id}
              note={n}
              onTrash={mode === 'trash' ? undefined : async (x) => { await notesApi.update(x._id, { trashed: true }); void load(); }}
              onRestore={mode === 'trash' ? async (x) => { await notesApi.update(x._id, { trashed: false }); void load(); } : undefined}
              onDelete={
                mode === 'trash'
                  ? async (x) => {
                      if (window.confirm('حذف همیشگی؟ این عمل بازگشت‌پذیر نیست.')) {
                        await notesApi.remove(x._id);
                        void load();
                      }
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}

      <NewSubjectModal open={newSubject} onClose={() => setNewSubject(false)} />
    </div>
  );
}

export default NotesListPage;
