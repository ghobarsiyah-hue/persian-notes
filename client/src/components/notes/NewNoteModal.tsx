import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Select, ButtonWithSpinner } from '@/components/ui';
import { notesApi, templatesApi } from '@/api/endpoints';
import { useApp } from '@/store/AppProvider';
import type { Note } from '@/types';

/** quick-create flow: title → subject → (optional) template → editor */
export function NewNoteModal({ open, onClose, initialTemplateId }: { open: boolean; onClose: () => void; initialTemplateId?: string }) {
  const { subjects, reloadTags, templates } = useApp();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && initialTemplateId) {
      setTemplateId(initialTemplateId);
    }
  }, [open, initialTemplateId]);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setSubjectId('');
      setTemplateId('');
      setError(null);
    }
  }, [open]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      let content: Record<string, unknown> | undefined;
      let html: string | undefined;
      if (templateId) {
        const { template } = await templatesApi.get(templateId);
        content = template.content;
      }
      const { note } = await notesApi.create({
        title: title.trim() || 'جزوه بدون عنوان',
        subjectId: subjectId || null,
        content,
        html,
        metadata: { templateId: templateId || null },
      } as Partial<Note>);
      await reloadTags().catch(() => undefined);
      onClose();
      navigate(`/editor/${note._id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Find template description to show preview hint
  const selectedTpl = templates.find((t) => t._id === templateId);

  return (
    <Modal open={open} onClose={onClose} title="+ جزوه جدید">
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-700 dark:text-ink-300">عنوان جزوه</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثلاً: فیزیولوژی — سیکل قلبی"
            autoComplete="off"
            className="w-full min-h-10 rounded-xl bg-ink-50 px-3.5 text-sm shadow-ring focus-visible:shadow-focus dark:bg-ink-800 dark:text-ink-100 border border-ink-100 dark:border-ink-700 transition-all"
            onKeyDown={(e) => e.key === 'Enter' && !busy && void create()}
          />
        </label>

        <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} label="موضوع">
          <option value="">بدون موضوع</option>
          {subjects.map((s) => (
            <option key={s._id} value={s._id}>{s.name}</option>
          ))}
        </Select>

        <div>
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} label="شروع از قالب (اختیاری)">
            <option value="">صفحه خالی</option>
            {templates.map((t) => (
              <option key={t._id} value={t._id}>{t.name} — {t.category}</option>
            ))}
          </Select>
          {selectedTpl && (
            <div className="mt-2 rounded-lg bg-accent-50 p-2.5 text-xs text-accent-700 dark:bg-accent-900/20 dark:text-accent-300 border border-accent-100 dark:border-accent-900/30">
              <span className="font-semibold">{selectedTpl.name}:</span> {selectedTpl.description}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2.5 border-t border-ink-100 pt-4 dark:border-ink-800">
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 rounded-xl bg-ink-50 px-4 text-sm font-medium shadow-ring hover:bg-ink-100 dark:bg-ink-800 dark:hover:bg-ink-700 transition-colors"
          >
            انصراف
          </button>
          <ButtonWithSpinner loading={busy} onClick={() => void create()}>
            ساخت جزوه
          </ButtonWithSpinner>
        </div>
      </div>
    </Modal>
  );
}
