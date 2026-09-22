import { useState, useMemo } from 'react';
import { useApp } from '@/store/AppProvider';
import { NewNoteModal } from '@/components/notes/NewNoteModal';

const CATEGORY_ICONS: Record<string, string> = {
  'دانشگاهی': '◆', 'پزشکی': '✚', 'دبیرستان / دانشگاه': '▦', 'علوم پایه': '⊗', 'مرور': '↻',
};

const TEMPLATE_COLORS: Record<string, { from: string; to: string; icon: string }> = {
  university: { from: '#171717', to: '#444', icon: '◆' },
  medical: { from: '#ff5b4f', to: '#ff8c7a', icon: '✚' },
  biology: { from: '#0070f3', to: '#3291ff', icon: '◎' },
  physiology: { from: '#0070f3', to: '#7928ca', icon: '♥' },
  anatomy: { from: '#7928ca', to: '#a855f7', icon: '◁' },
  biochemistry: { from: '#f5a623', to: '#f5c563', icon: '⊗' },
  'exam-summary': { from: '#ff5b4f', to: '#f5a623', icon: '★' },
  'quick-review': { from: '#0070f3', to: '#0070f3', icon: '⚡' },
  flashcards: { from: '#7928ca', to: '#de1d8d', icon: '◧' },
};

function TemplatePreview({ template }: { template: { key?: string; name: string; description: string; category: string } }) {
  const colors = TEMPLATE_COLORS[template.key ?? ''] ?? { from: '#999', to: '#ccc', icon: '▬' };
  return (
    <div className="relative h-28 overflow-hidden rounded-t-xl bg-[#fafafa] dark:bg-[#0a0a0a] p-3">
      <div className="absolute top-0 right-0 left-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${colors.from}, ${colors.to})` }} />
      <div className="mt-2 space-y-1.5">
        <div className="h-2 rounded bg-gray-200 dark:bg-[#222]" style={{ width: '65%' }} />
        <div className="h-1.5 rounded bg-gray-100 dark:bg-[#1a1a1a]" style={{ width: '50%' }} />
        <div className="mt-2 flex gap-2">
          <div className="h-10 flex-1 rounded-md bg-white dark:bg-[#111] p-1.5" style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.04)' }}>
            <div className="h-1 rounded bg-gray-100 dark:bg-[#222]" style={{ width: '45%' }} />
            <div className="mt-1 h-1 rounded bg-gray-100 dark:bg-[#222]" style={{ width: '75%' }} />
          </div>
          <div className="h-10 flex-1 rounded-md bg-white dark:bg-[#111] p-1.5" style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.04)' }}>
            <div className="h-1 rounded bg-gray-100 dark:bg-[#222]" style={{ width: '40%' }} />
            <div className="mt-1 h-1 rounded bg-gray-100 dark:bg-[#222]" style={{ width: '65%' }} />
          </div>
        </div>
      </div>
      <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-white/80 backdrop-blur px-2 py-0.5 text-[10px] font-medium text-[#666] dark:bg-[#171717]/80 dark:text-[#888]" style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.04)' }}>
        <span>{colors.icon}</span>
        {template.category}
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const { templates } = useApp();
  const [newNote, setNewNote] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  const categories = useMemo(() => {
    const cats = new Set(templates.map((t) => t.category));
    return ['all', ...Array.from(cats)];
  }, [templates]);

  const filtered = useMemo(() => {
    if (filter === 'all') return templates;
    return templates.filter((t) => t.category === filter);
  }, [templates, filter]);

  return (
    <div className="mx-auto max-w-4xl p-6" style={{ animation: 'pn-fade-in 0.15s ease-out' }}>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-[#171717] dark:text-white">Templates</h1>
        <p className="mt-1 text-[13px] text-[#999]">Start with a pre-built structure and customize it to your needs</p>
      </div>

      {/* Category tabs */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setFilter(cat)}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-[background,color] duration-100 ${
              filter === cat
                ? 'bg-[#171717] text-white dark:bg-white dark:text-[#171717]'
                : 'bg-gray-100 text-[#666] hover:bg-gray-200 dark:bg-[#222] dark:text-[#888] dark:hover:bg-[#333]'
            }`}
          >
            {cat === 'all' ? 'همه' : `${CATEGORY_ICONS[cat] ?? '▦'} ${cat}`}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((t) => (
          <button
            key={t._id}
            type="button"
            onClick={() => { setSelectedTemplate(t._id); setNewNote(true); }}                className="pn-glass-panel group rounded-xl text-right transition-[transform,box-shadow] duration-150 hover:translate-y-[-2px]"
            style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)' }}
          >
            <TemplatePreview template={t} />
            <div className="p-4">
              <h3 className="text-[14px] font-semibold text-[#171717] dark:text-white tracking-[-0.01em] group-hover:text-[#0070f3] dark:group-hover:text-[#3291ff] transition-[color] duration-100">{t.name}</h3>
              <p className="mt-1 min-h-8 text-[12px] leading-5 text-[#999]">{t.description}</p>
              <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[#ccc] dark:text-[#555]">
                {t.style.fontSize && <span className="rounded bg-gray-50 px-1.5 py-0.5 dark:bg-[#1a1a1a]">{t.style.fontSize}pt</span>}
                {t.style.lineHeight && <span className="rounded bg-gray-50 px-1.5 py-0.5 dark:bg-[#1a1a1a]">lh {t.style.lineHeight}</span>}
                <span className="rounded bg-[#0070f3]/5 px-1.5 py-0.5 text-[#0070f3] dark:bg-[#0070f3]/10 dark:text-[#3291ff]">{t.category}</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="py-16 text-center">
          <div className="mb-3 text-[32px]">○</div>
          <p className="text-[13px] text-[#999]">قالبی در این دسته‌بندی یافت نشد.</p>
        </div>
      )}

      <div className="mt-8 rounded-xl bg-[#fafafa] p-4 dark:bg-[#111]" style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.06)' }}>
        <h3 className="text-[13px] font-semibold text-[#171717] dark:text-white">◉ نکته</h3>
        <p className="mt-1 text-[12px] text-[#999] leading-5">
          هر قالب شامل بلوک‌های آموزشی، فرمول‌ها و جدول‌های از پیش تنظیم‌شده است. پس از ساخت جزوه از قالب، می‌توانید هر بخش را ویرایش یا حذف کنید. از <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-[#222] rounded text-[10px] font-medium">/</kbd> برای درج بلوک‌های جدید استفاده کنید.
        </p>
      </div>

      <NewNoteModal open={newNote} onClose={() => { setNewNote(false); setSelectedTemplate(null); }} initialTemplateId={selectedTemplate ?? undefined} />
    </div>
  );
}
