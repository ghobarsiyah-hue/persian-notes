import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { notesApi, subjectsApi } from '@/api/endpoints';
import { NoteCard } from '@/components/notes/NoteCard';
import { NewNoteModal } from '@/components/notes/NewNoteModal';
import { NewSubjectModal } from '@/components/notes/NewSubjectModal';
import { EmptyState, Button, Skeleton } from '@/components/ui';
import { faDigits } from '@/utils/fa';
import type { Note, Subject } from '@/types';

const HERO_ACTIONS: Array<{ icon: string; label: string; desc: string; action: 'note' | 'subject' | 'template' }> = [
  { icon: '+', label: 'جزوه جدید', desc: 'شروع از صفر', action: 'note' },
  { icon: '▦', label: 'از قالب', desc: 'ساختار از پیش آماده', action: 'template' },
  { icon: '◎', label: 'موضوع جدید', desc: 'افزودن درس یا موضوع', action: 'subject' },
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Note[]>([]);
  const [trashed, setTrashed] = useState<Note[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newNote, setNewNote] = useState(false);
  const [newSubject, setNewSubject] = useState(false);

  const load = async () => {
    try {
      const [all, trash, subs] = await Promise.all([notesApi.list(), notesApi.list({ trashed: true }), subjectsApi.list()]);
      setNotes(all.notes); setTrashed(trash.notes); setSubjects(subs.subjects);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const recent = useMemo(() => notes.slice(0, 6), [notes]);
  const favorites = useMemo(() => notes.filter((n) => n.favorite).slice(0, 4), [notes]);
  const continueEditing = recent[0];
  const totalWords = useMemo(() => notes.reduce((sum, n) => sum + (n.wordCount || 0), 0), [notes]);
  const totalMinutes = Math.round(totalWords / 200);

  const stats = [
    { value: faDigits(notes.length), label: 'جزوه' },
    { value: faDigits(subjects.length), label: 'موضوع' },
    { value: faDigits(totalWords), label: 'کلمه' },
    { value: `~${faDigits(totalMinutes)}`, label: 'دقیقه مطالعه' },
  ];

  return (
    <div className="mx-auto max-w-4xl p-6" style={{ animation: 'pn-fade-in 0.15s ease-out' }}>
      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-[13px] text-[#ff5b4f] dark:bg-red-950 dark:text-red-400" style={{ boxShadow: '0 0 0 1px rgba(239,68,68,0.2)' }}>{error}</p>}

      {loading ? (
        <div className="space-y-5" aria-busy="true">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-6 w-32" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Hero */}
          <section className="relative overflow-hidden rounded-xl bg-[#171717] p-6 text-white dark:bg-[#ededed] dark:text-[#171717]">
            <div className="relative">
              <h1 className="text-[28px] font-semibold tracking-[-0.04em] leading-tight" style={{ textWrap: 'balance' }}>
                به پرشین‌نوت خوش آمدید
              </h1>
              <p className="mt-2 max-w-lg text-[14px] leading-6 text-[#888] dark:text-[#666]" style={{ textWrap: 'balance' }}>
                Write study notes with educational blocks, LaTeX formulas, and AI assistance. Export to PDF, Word, or HTML with one click.
              </p>

              <div className="mt-5 grid grid-cols-3 gap-2 max-w-md">
                {HERO_ACTIONS.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={() => a.action === 'note' ? setNewNote(true) : a.action === 'subject' ? setNewSubject(true) : navigate('/templates')}
                    className="rounded-lg p-3 text-right transition-[background] duration-100 hover:bg-white/10 dark:hover:bg-black/10"
                    style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.1)' }}
                  >
                    <span className="block text-[18px]" aria-hidden="true">{a.icon}</span>
                    <span className="mt-1 block text-[13px] font-medium">{a.label}</span>
                    <span className="block text-[11px] text-[#888] dark:text-[#666]">{a.desc}</span>
                  </button>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap gap-6 border-t border-white/10 dark:border-black/10 pt-4">
                {stats.map((s) => (
                  <div key={s.label}>
                    <div className="text-[20px] font-semibold tracking-[-0.02em]">{s.value}</div>
                    <div className="text-[11px] text-[#888] dark:text-[#666]">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Continue editing */}
          {continueEditing && (
            <section>
              <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.05em] text-[#999]">ادامه ویرایش</h2>
              <Link
                to={`/editor/${continueEditing._id}`}
                className="pn-glass-panel group flex items-center justify-between rounded-xl p-4 transition-[transform,box-shadow] duration-150 hover:translate-y-[-1px]"
                style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)' }}
              >
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-[#171717] dark:text-white tracking-[-0.01em]">{continueEditing.title}</h3>
                  <p className="mt-1 truncate text-[12px] text-[#999]">{faDigits(continueEditing.wordCount)} words — {continueEditing.plainText?.slice(0, 100)}</p>
                </div>                  <span className="mr-4 shrink-0 rounded-lg bg-gray-100 px-3 py-2 text-[12px] font-medium text-[#666] dark:bg-[#222] dark:text-[#aaa] transition-[background] duration-100 group-hover:bg-gray-200 dark:group-hover:bg-[#333]">
                  ادامه →
                </span>
              </Link>
            </section>
          )}

          {/* Subjects */}
          {subjects.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[12px] font-semibold uppercase tracking-[0.05em] text-[#999]">موضوعات</h2>
                <Link to="/subjects" className="text-[12px] font-medium text-[#0070f3] hover:underline dark:text-[#3291ff]">مدیریت →</Link>
              </div>
              <div className="flex flex-wrap gap-2">
                {subjects.slice(0, 8).map((s) => (
                  <Link key={s._id} to={`/notes?subject=${s._id}`} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-[#666] dark:bg-[#1a1a1a] dark:text-[#aaa] transition-[box-shadow] duration-100 hover:translate-y-[-1px]" style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color || '#0070f3' }} aria-hidden="true" />
                    {s.name}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Recent notes */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.05em] text-[#999]">جزوه‌های اخیر</h2>
              <Link to="/notes" className="text-[12px] font-medium text-[#0070f3] hover:underline dark:text-[#3291ff]">مشاهده همه →</Link>
            </div>
            {recent.length === 0 ? (               <EmptyState icon="+" title="هنوز جزوه‌ای ندارید" description="اولین جزوه خود را بسازید یا از یک قالب شروع کنید." action={<Button onClick={() => setNewNote(true)} className="mt-2">Create first note</Button>} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {recent.map((n) => <NoteCard key={n._id} note={n} onTrash={async (x) => { await notesApi.update(x._id, { trashed: true }); void load(); }} />)}
              </div>
            )}
          </section>

          {favorites.length > 0 && (
            <section>
              <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.05em] text-[#999]">Favorites</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {favorites.map((n) => <NoteCard key={n._id} note={n} onTrash={async (x) => { await notesApi.update(x._id, { trashed: true }); void load(); }} />)}
              </div>
            </section>
          )}

          {trashed.length > 0 && (
            <section>
              <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.05em] text-[#999]">Recently deleted</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {trashed.slice(0, 3).map((n) => (
                  <NoteCard key={n._id} note={n} onRestore={async (x) => { await notesApi.update(x._id, { trashed: false }); void load(); }} onDelete={async (x) => { if (window.confirm('Permanently delete?')) { await notesApi.remove(x._id); void load(); } }} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <NewNoteModal open={newNote} onClose={() => setNewNote(false)} />
      <NewSubjectModal open={newSubject} onClose={() => setNewSubject(false)} onCreated={() => navigate('/subjects')} />
    </div>
  );
}
