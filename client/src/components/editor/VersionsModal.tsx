import { useEffect, useState } from 'react';
import { Modal, Spinner } from '@/components/ui';
import { versionsApi } from '@/api/endpoints';
import { formatDate, faDigits } from '@/utils/fa';
import type { Note, VersionSummary } from '@/types';

interface Props {
  open: boolean;
  note: Note | null;
  onClose: () => void;
  onRestored: (note: Note) => void;
  onError: (message: string) => void;
}

/** version history: view snapshots and restore them (never destroys data) */
export function VersionsModal({ open, note, onClose, onRestored, onError }: Props) {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ id: string; html: string; title: string } | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (open && note) {
      setLoading(true);
      setPreview(null);
      versionsApi
        .list(note._id)
        .then((r) => setVersions(r.versions))
        .catch((e) => onError((e as Error).message))
        .finally(() => setLoading(false));
    }
  }, [open, note, onError]);

  const showVersion = async (id: string) => {
    try {
      const { version } = await versionsApi.get(id);
      setPreview({ id, html: version.html, title: version.title });
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const restore = async (id: string) => {
    if (!window.confirm('نسخه فعلی به‌صورت خودکار پشتیبان‌گیری می‌شود و سپس این نسخه بازیابی خواهد شد. مطمئن هستید؟')) return;
    setRestoring(true);
    try {
      const { note: restored } = await versionsApi.restore(id);
      onRestored(restored);
      onClose();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="تاریخچه نسخه‌ها" wide>
      {loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-ink-500">
          <Spinner /> در حال بارگذاری نسخه‌ها…
        </div>
      )}
      {!loading && versions.length === 0 && <p className="py-10 text-center text-sm text-ink-500">هنوز نسخه‌ای ثبت نشده است. نسخه‌ها به‌صورت خودکار هنگام ویرایش و قبل از عملیات هوشمند ذخیره می‌شوند.</p>}
      {!loading && versions.length > 0 && (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          <ul className="max-h-96 space-y-1 overflow-y-auto">
            {versions.map((v) => (
              <li key={v._id}>
                <button
                  type="button"
                  onClick={() => showVersion(v._id)}
                  className={`w-full rounded-lg border px-3 py-2 text-right text-xs ${
                    preview?.id === v._id ? 'border-ink-800 bg-ink-100 dark:border-ink-200 dark:bg-ink-800' : 'border-ink-200 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800'
                  }`}
                >
                  <div className="font-semibold">{formatDate(v.createdAt)}</div>
                  <div className="text-ink-500 dark:text-ink-400">{v.reason} — {faDigits(v.wordCount)} کلمه</div>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex min-h-64 flex-col">
            {preview ? (
              <>
                <div className="grow overflow-y-auto rounded-lg border border-ink-200 p-4 dark:border-ink-700" dangerouslySetInnerHTML={{ __html: preview.html }} />
                <button
                  type="button"
                  disabled={restoring}
                  onClick={() => restore(preview.id)}
                  className="mt-3 self-start rounded-lg bg-ink-800 px-4 py-2 text-sm font-medium text-white hover:bg-ink-700 disabled:opacity-60 dark:bg-ink-200 dark:text-ink-900"
                >
                  {restoring ? 'در حال بازیابی…' : 'بازیابی این نسخه'}
                </button>
              </>
            ) : (
              <p className="m-auto text-sm text-ink-500">یک نسخه را برای مشاهده انتخاب کنید.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
