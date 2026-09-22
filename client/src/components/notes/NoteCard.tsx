import { Link } from 'react-router-dom';
import { useApp } from '@/store/AppProvider';
import { relativeTime, faDigits } from '@/utils/fa';
import { Badge } from '@/components/ui';
import type { Note } from '@/types';

export function NoteCard({ note, onTrash, onRestore, onDelete }: {
  note: Note;
  onTrash?: (n: Note) => void;
  onRestore?: (n: Note) => void;
  onDelete?: (n: Note) => void;
}) {
  const { subjects, tags } = useApp();
  const subject = typeof note.subjectId === 'object' ? note.subjectId : subjects.find((s) => s._id === note.subjectId);
  const noteTags = (note.tags as Array<{ _id: string; name: string }> | string[])
    .map((t) => (typeof t === 'string' ? tags.find((x) => x._id === t)?.name : t.name))
    .filter(Boolean);

  return (
    <div className="pn-glass-panel group flex flex-col rounded-2xl p-4 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-card-accent-hover">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/editor/${note._id}`} className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink-900 group-hover:text-ink-600 dark:text-white dark:group-hover:text-ink-300">
            {note.favorite && <span className="text-amber-500" aria-hidden="true">★ </span>}
            {note.title}
          </h3>
          <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
            {subject?.name ?? 'بدون موضوع'}
            {note.chapter ? ` — ${note.chapter}` : ''}
          </p>
        </Link>
      </div>
      <p className="mt-2 line-clamp-2 min-h-8 text-xs leading-5 text-ink-500 dark:text-ink-400">
        {note.plainText?.slice(0, 140) || '—'}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
        {noteTags.slice(0, 4).map((name) => (
          <Badge key={name}>#{name}</Badge>
        ))}
        <div className="grow" />
        <span className="whitespace-nowrap text-ink-400 dark:text-ink-500">
          {faDigits(note.wordCount)} کلمه · ~{faDigits(Math.max(1, Math.ceil((note.wordCount || 0) / 300)))} صفحه
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-ink-100 pt-2 text-[11px] text-ink-400 dark:border-ink-800 dark:text-ink-500">
        <span>آخرین ویرایش: {relativeTime(note.updatedAt)}</span>
        {onTrash && !note.trashed && (
          <button type="button" onClick={() => onTrash(note)} className="flex h-7 min-w-7 items-center justify-center rounded-md text-ink-400 opacity-0 transition-all duration-100 hover:text-ship group-hover:opacity-100" title="انتقال به سطل زباله" aria-label="انتقال به سطل زباله">
            ✕
          </button>
        )}
        {onRestore && (
          <button type="button" onClick={() => onRestore(note)} className="min-h-7 rounded-md px-1.5 text-ink-600 hover:text-accent-700 dark:text-ink-300" title="بازیابی">
            بازیابی ↺
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={() => onDelete(note)} className="min-h-7 rounded-md px-1.5 text-ink-400 hover:text-ship" title="حذف همیشگی">
            حذف همیشگی ✕
          </button>
        )}
      </div>
    </div>
  );
}
