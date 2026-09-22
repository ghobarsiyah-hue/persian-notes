import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { searchApi } from '@/api/endpoints';
import { useApp } from '@/store/AppProvider';
import { useDebounce } from '@/hooks/useDebounce';
import { EmptyState, Select, Badge } from '@/components/ui';
import { faDigits, relativeTime } from '@/utils/fa';
import type { SearchHit } from '@/types';

function Highlighted({ text, start, end }: { text: string; start: number; end: number }) {
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded bg-amber-200 px-0.5 dark:bg-amber-600/60">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

export default function SearchPage() {
  const { subjects, tags } = useApp();
  const [params, setParams] = useSearchParams();
  const initialQ = params.get('q') ?? '';
  const [input, setInput] = useState(initialQ);
  const [subjectId, setSubjectId] = useState('');
  const [tagId, setTagId] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [days, setDays] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const q = useDebounce(input, 400);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const { results } = await searchApi.run({
          q,
          subjectId: subjectId || undefined,
          tagId: tagId || undefined,
          favorite: favorite || undefined,
          days: days ? Number(days) : undefined,
        });
        setHits(results);
        setSearched(true);
        setParams(q ? { q } : {}, { replace: true });
      } finally {
        setLoading(false);
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, subjectId, tagId, favorite, days]);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-xl font-extrabold tracking-tight text-ink-900 dark:text-ink-100">جستجوی سراسری</h1>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="جستجو در عنوان‌ها، متن، موضوعات و برچسب‌ها…"
          aria-label="عبارت جستجو"
          className="min-w-64 grow min-h-10 rounded-lg bg-transparent px-3 text-sm shadow-ring placeholder:text-ink-400 focus-visible:shadow-focus dark:bg-ink-900 dark:text-ink-100"
        />
        <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="w-auto">
          <option value="">همه موضوعات</option>
          {subjects.map((s) => (
            <option key={s._id} value={s._id}>{s.name}</option>
          ))}
        </Select>
        <Select value={tagId} onChange={(e) => setTagId(e.target.value)} className="w-auto">
          <option value="">همه برچسب‌ها</option>
          {tags.map((t) => (
            <option key={t._id} value={t._id}>#{t.name}</option>
          ))}
        </Select>
        <Select value={days} onChange={(e) => setDays(e.target.value)} className="w-auto">
          <option value="">هر زمانی</option>
          <option value="1">۲۴ ساعت اخیر</option>
          <option value="7">هفته اخیر</option>
          <option value="30">ماه اخیر</option>
        </Select>
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} className="h-4 w-4 accent-develop" />
          فقط علاقه‌مندی
        </label>
      </div>

      {loading && <p role="status" className="py-10 text-center text-ink-500 dark:text-ink-400">در حال جستجو…</p>}

      {!loading && searched && hits.length === 0 && <EmptyState icon="⊕" title="نتیجه‌ای یافت نشد" description="عبارت یا فیلترهای دیگری را امتحان کنید." />}

      <div className="space-y-3">
        {hits.map((hit) => {
          const { note, snippet } = hit;
          const subject = typeof note.subjectId === 'object' ? note.subjectId : null;
          return (
            <a
              key={note._id}
              href={`/editor/${note._id}`}
              className="pn-glass-panel block rounded-2xl p-4 shadow-card transition-shadow duration-150 hover:shadow-card-hover"
            >
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-ink-900 dark:text-ink-100">{note.title}</h3>
                {subject && <Badge>{subject.name}</Badge>}
                <div className="grow" />
                <span className="text-[11px] text-ink-400 dark:text-ink-500">{relativeTime(note.updatedAt)}</span>
              </div>
              {snippet && (
                <p className="mt-1.5 text-xs leading-6 text-ink-600 dark:text-ink-300">
                  <Highlighted text={snippet.text} start={snippet.matchStart} end={snippet.matchEnd} />
                </p>
              )}
              {!snippet && <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">{note.plainText?.slice(0, 160)}</p>}
              <div className="mt-2 text-[11px] text-ink-400 dark:text-ink-500">
                {faDigits(note.wordCount)} کلمه
                {hit.matchedIn.includes('metadata') && ' — یافت‌شده از طریق موضوع/برچسب'}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
