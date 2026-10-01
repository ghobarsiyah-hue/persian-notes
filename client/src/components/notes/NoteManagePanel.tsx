import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Copy, Trash2, RotateCcw, ExternalLink, Check } from 'lucide-react';
import { SidePanel, Button, Badge, ErrorText } from '@/components/ui';
import { NoteThumb } from '@/components/notes/NoteThumb';
import { useApp } from '@/store/AppProvider';
import { notesApi, tagsApi } from '@/api/endpoints';
import { faDigits } from '@/utils/fa';
import type { Note, Subject } from '@/types';

/**
 * NoteManagePanel — the «شخصی‌سازی و مدیریت» surface for one note, opened
 * from the note card (بخش جزوه‌های من). Slides in from the LEFT (the same
 * SidePanel the editor uses), and shows:
 *   • a live first-page A4 thumbnail (NoteThumb)
 *   • metadata: title, subject, chapter, tags, favorite
 *   • management: open, clone, trash/restore, permanent delete (trash only)
 * All edits persist immediately via notesApi.update; the parent refetches
 * through onChanged() so the grid reflects every change.
 */
export function NoteManagePanel({ note, open, onClose, onChanged, mode = 'all' }: {
  note: Note | null;
  open: boolean;
  onClose: () => void;
  /** parent refetch after any mutation */
  onChanged?: () => void;
  mode?: 'all' | 'favorite' | 'trash';
}) {
  const { subjects, tags, reloadTags, toast } = useApp();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [chapter, setChapter] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState('');

  /* sync the form when a (new) note opens */
  useEffect(() => {
    if (!note) return;
    setTitle(note.title);
    setSubjectId(typeof note.subjectId === 'object' ? (note.subjectId?._id ?? '') : (note.subjectId ?? ''));
    setChapter(note.chapter ?? '');
    setFavorite(Boolean(note.favorite));
    setTagIds((note.tags as Array<{ _id: string }> | string[]).map((t) => (typeof t === 'string' ? t : t._id)));
    setError('');
  }, [note]);

  const flash = () => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  };

  const patch = async (data: Partial<Note>) => {
    if (!note) return;
    setSaving(true);
    setError('');
    try {
      await notesApi.update(note._id, data);
      flash();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message || 'ذخیره‌سازی ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  /* title/chapter commit on blur or Enter — no per-keystroke network */
  const commitText = () => {
    if (!note) return;
    const t = title.trim();
    if (!t) { setTitle(note.title); return; }
    if (t !== note.title) void patch({ title: t });
    if (chapter !== note.chapter) void patch({ chapter });
  };

  const addTag = async () => {
    const name = tagInput.trim();
    if (!name || !note) return;
    setTagInput('');
    try {
      const existing = tags.find((t) => t.name === name);
      const tag = existing ?? (await tagsApi.create(name)).tag;
      if (!existing) reloadTags?.();
      if (tagIds.includes(tag._id)) return;
      const next = [...tagIds, tag._id];
      setTagIds(next);
      await patch({ tags: next });
    } catch (e) {
      setError((e as Error).message || 'افزودن برچسب ناموفق بود.');
    }
  };

  const removeTag = async (id: string) => {
    if (!note) return;
    const next = tagIds.filter((t) => t !== id);
    setTagIds(next);
    await patch({ tags: next });
  };

  const clone = async () => {
    if (!note) return;
    try {
      const { note: copy } = await notesApi.clone(note._id);
      toast('روگرفت جزوه ساخته شد.', 'success');
      onChanged?.();
      onClose();
      navigate(`/editor/${copy._id}`);
    } catch (e) {
      toast('تکثیر ناموفق بود: ' + (e as Error).message, 'error');
    }
  };

  const words = note?.wordCount ?? 0;

  if (!note) return null;

  return (
    <SidePanel open={open} onClose={onClose} title="مدیریت جزوه">
      {note && (
        <div className="flex min-h-full flex-col gap-5">
          {/* ── preview + stats ── */}
          <section className="flex gap-4">
            <div className="shrink-0 rounded-xl bg-ink-50 p-2 dark:bg-ink-900">
              <NoteThumb note={note} width={96} />
              <div className="mt-1.5 text-center text-[10.5px] font-medium text-ink-400">صفحهٔ ۱</div>
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <h3 className="line-clamp-2 text-sm font-bold leading-6 text-ink-900 dark:text-ink-100">{note.title}</h3>
              <p className="text-[11.5px] text-ink-500 dark:text-ink-400">
                {words > 0 ? `${faDigits(words)} کلمه · ~${faDigits(Math.ceil(words / 300))} صفحه` : 'جزوهٔ خالی'}
              </p>
              <p className="text-[11px] text-ink-400">ساخته‌شده: {new Date(note.createdAt).toLocaleDateString('fa-IR')}</p>
              <button
                type="button"
                onClick={() => { onClose(); navigate(`/editor/${note._id}`); }}
                className="mt-1 flex h-8 items-center gap-1.5 rounded-lg border border-ink-200 px-3 text-[12px] font-semibold text-ink-700 transition-colors hover:border-[#0070f3] hover:text-[#0070f3] dark:border-ink-700 dark:text-ink-200"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                باز کردن در ویرایشگر
              </button>
            </div>
          </section>

          {/* ── personalization ── */}
          <section className="space-y-3 border-t border-ink-100 pt-4 dark:border-ink-800">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold text-ink-700 dark:text-ink-200">شخصی‌سازی</span>
              <span className={`flex items-center gap-1 text-[10.5px] transition-opacity ${savedFlash ? 'text-emerald-600 opacity-100 dark:text-emerald-400' : 'opacity-0'}`}>
                <Check className="h-3 w-3" /> ذخیره شد
              </span>
            </div>

            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-500 dark:text-ink-400">عنوان</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={commitText}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                dir="rtl"
                className="h-9 w-full rounded-lg border border-ink-200 bg-transparent px-3 text-[13px] outline-none focus:border-[#0070f3] dark:border-ink-700"
              />
            </label>

            <div className="grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-500 dark:text-ink-400">موضوع</span>
                <select
                  value={subjectId}
                  onChange={(e) => { setSubjectId(e.target.value); void patch({ subjectId: e.target.value || null }); }}
                  className="h-9 w-full rounded-lg border border-ink-200 bg-transparent px-2 text-[12.5px] outline-none focus:border-[#0070f3] dark:border-ink-700 dark:bg-ink-900"
                >
                  <option value="">بدون موضوع</option>
                  {subjects.map((s: Subject) => <option key={s._id} value={s._id}>{s.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-500 dark:text-ink-400">فصل</span>
                <input
                  value={chapter}
                  onChange={(e) => setChapter(e.target.value)}
                  onBlur={commitText}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  placeholder="مثلاً فصل ۳"
                  dir="rtl"
                  className="h-9 w-full rounded-lg border border-ink-200 bg-transparent px-3 text-[12.5px] outline-none placeholder:text-ink-400 focus:border-[#0070f3] dark:border-ink-700"
                />
              </label>
            </div>

            <div>
              <span className="mb-1 block text-[11px] text-ink-500 dark:text-ink-400">برچسب‌ها</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {tagIds.map((id) => {
                  const t = tags.find((x) => x._id === id);
                  return (
                    <Badge key={id} tone="neutral">
                      <span className="inline-flex items-center gap-1">
                        #{t?.name ?? '…'}
                        <button type="button" onClick={() => void removeTag(id)} className="text-ink-400 hover:text-red-500" aria-label={`حذف برچسب ${t?.name ?? ''}`}>✕</button>
                      </span>
                    </Badge>
                  );
                })}
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void addTag()}
                  placeholder="+ برچسب…"
                  className="h-7 w-24 rounded-md bg-transparent px-2 text-[11.5px] outline-none placeholder:text-ink-400 focus-visible:shadow-ring dark:bg-ink-900"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => { const v = !favorite; setFavorite(v); void patch({ favorite: v }); }}
              className={`flex h-9 w-full items-center gap-2 rounded-lg border px-3 text-[12.5px] font-medium transition-colors ${
                favorite
                  ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
                  : 'border-ink-200 text-ink-600 hover:border-amber-300 hover:text-amber-600 dark:border-ink-700 dark:text-ink-300'
              }`}
            >
              <Star className={`h-4 w-4 ${favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
              {favorite ? 'در علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}
            </button>
          </section>

          {/* ── management ── */}
          <section className={mode === 'trash' ? 'hidden' : 'space-y-1.5 border-t border-ink-100 pt-4 dark:border-ink-800'}>
            <span className="text-[12px] font-bold text-ink-700 dark:text-ink-200">مدیریت</span>
            <button
              type="button"
              onClick={clone}
              className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[12.5px] text-ink-600 transition-colors hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
            >
              <Copy className="h-4 w-4" /> تکثیر جزوه
            </button>
            <button
              type="button"
              onClick={async () => { await patch({ trashed: true }); toast('به سطل زباله منتقل شد.', 'info'); onChanged?.(); onClose(); }}
              className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[12.5px] text-ink-600 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-ink-300 dark:hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" /> انتقال به سطل زباله
            </button>
          </section>
          {mode === 'trash' && (
            <section className="space-y-1.5 border-t border-ink-100 pt-4 dark:border-ink-800">
              <span className="text-[12px] font-bold text-ink-700 dark:text-ink-200">بازیابی</span>
              <button
                type="button"
                onClick={async () => { await patch({ trashed: false }); onChanged?.(); onClose(); }}
                className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[12.5px] text-ink-600 transition-colors hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
              >
                <RotateCcw className="h-4 w-4" /> بازیابی از سطل زباله
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (window.confirm('حذف همیشگی؟ این عمل بازگشت‌پذیر نیست.')) {
                    await notesApi.remove(note._id);
                    onChanged?.();
                    onClose();
                  }
                }}
                className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[12.5px] text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4" /> حذف همیشگی
              </button>
            </section>
          )}

          {error && <ErrorText>{error}</ErrorText>}

          {/* docked footer (same pn-side-footer contract as the editor panels) */}
          <div className="pn-side-footer mt-auto flex shrink-0 items-center justify-between border-t border-ink-100 pt-3 dark:border-ink-800">
            <span className="text-[10.5px] text-ink-400">{saving ? 'در حال ذخیره…' : 'تغییرات بلافاصله ذخیره می‌شوند'}</span>
            <Button onClick={onClose}>اتمام</Button>
          </div>
        </div>
      )}
    </SidePanel>
  );
}
