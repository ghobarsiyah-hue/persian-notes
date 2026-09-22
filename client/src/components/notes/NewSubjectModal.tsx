import { useState } from 'react';
import { Modal, Select, ButtonWithSpinner, Field } from '@/components/ui';
import { subjectsApi } from '@/api/endpoints';
import { useApp } from '@/store/AppProvider';
import type { Subject } from '@/types';

export function NewSubjectModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: () => void }) {
  const { reloadSubjects, subjects, toast } = useApp();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [color, setColor] = useState('#0a72ef');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) {
      setError('نام موضوع را وارد کنید.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await subjectsApi.create({ name: name.trim(), color, parentId: parentId || null });
      await reloadSubjects();
      toast('موضوع ساخته شد.', 'success');
      setName('');
      setParentId('');
      onClose();
      onCreated?.();
    } catch (e) {
      toast('ساخت موضوع ناموفق بود: ' + (e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="موضوع جدید">
      <div className="space-y-4">
        <Field label="نام موضوع" error={error || undefined}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ color }}
            placeholder="مثلاً: فیزیولوژی"
            autoComplete="off"
            className="w-full min-h-10 rounded-lg bg-transparent px-3 text-sm shadow-ring focus-visible:shadow-focus dark:bg-ink-900 dark:text-ink-100"
            onKeyDown={(e) => e.key === 'Enter' && !busy && void create()}
          />
        </Field>
        <Select value={parentId} onChange={(e) => setParentId(e.target.value)} label="زیرمجموعه (اختیاری — برای فصل/بخش)">
          <option value="">— موضوع اصلی —</option>
          {subjects.filter((s: Subject) => !s.parentId).map((s: Subject) => (
            <option key={s._id} value={s._id}>{s.name}</option>
          ))}
        </Select>
        <Field label="رنگ">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-16 cursor-pointer rounded-lg shadow-ring" />
        </Field>
        <div className="flex justify-end">
          <ButtonWithSpinner loading={busy} onClick={() => void create()}>ساخت موضوع</ButtonWithSpinner>
        </div>
      </div>
    </Modal>
  );
}
