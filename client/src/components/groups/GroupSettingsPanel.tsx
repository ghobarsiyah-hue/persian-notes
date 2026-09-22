import { useRef, useState, type FormEvent } from 'react';
import { groupsApi } from '@/api/endpoints';
import { useApp } from '@/store/AppProvider';
import { Field, Button, ButtonWithSpinner, ErrorText } from '@/components/ui';
import { GroupAvatar } from '@/components/groups/GroupAvatar';
import type { Group } from '@/types';

const MAX_AVATAR_BYTES = 150 * 1024;

/**
 * Settings — read-only summary for members (no misleading controls), real
 * form for owner/admin (server re-checks group.manageSettings on every
 * PATCH). The panel renders the SERVER's returned group after save, never
 * a local guess (§22).
 */
export function GroupSettingsPanel({
  group,
  canEdit,
  onSaved,
}: {
  group: Group;
  canEdit: boolean;
  onSaved: (g: Group) => void;
}) {
  const { toast } = useApp();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [avatar, setAvatar] = useState<string | null | undefined>(undefined); // undefined = unchanged
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = name.trim() !== group.name || description !== group.description || avatar !== undefined;

  const pickAvatar = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('قالب تصویر باید PNG یا JPG باشد.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError('حجم تصویر باید کمتر از ۱۵۰ کیلوبایت باشد.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAvatar(String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit || busy) return;
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('نام گروه باید حداقل ۲ حرف باشد.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { group: updated } = await groupsApi.update(group.id, {
        ...(trimmed !== group.name ? { name: trimmed } : {}),
        ...(description !== group.description ? { description } : {}),
        ...(avatar !== undefined ? { avatar } : {}),
      });
      onSaved(updated); // confirmed server state
      setAvatar(undefined);
      toast('تنظیمات گروه ذخیره شد.', 'success');
    } catch (err) {
      /* keep the previous values visible — no false success */
      setError((err as Error).message);
      toast('ذخیره تنظیمات ناموفق بود: ' + (err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!canEdit) {
    return (
      <div className="pn-glass-panel space-y-3 rounded-2xl p-4 shadow-card">
        <h3 className="text-[15px] font-bold text-ink-900 dark:text-ink-100">تنظیمات گروه</h3>
        <p className="text-sm text-ink-500 dark:text-ink-400">
          فقط مالک و مدیران گروه می‌توانند تنظیمات را تغییر دهند.
        </p>
        <dl className="grid grid-cols-1 gap-3 border-t border-black/5 pt-3 text-sm dark:border-white/5">
          <div>
            <dt className="text-[11px] text-ink-400">نام گروه</dt>
            <dd className="mt-0.5 font-semibold text-ink-900 dark:text-ink-100">{group.name}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-400">توضیحات</dt>
            <dd className="mt-0.5 font-semibold text-ink-900 dark:text-ink-100">{group.description || '—'}</dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="pn-glass-panel space-y-4 rounded-2xl p-4 shadow-card">
      <h3 className="text-[15px] font-bold text-ink-900 dark:text-ink-100">تنظیمات گروه</h3>

      <Field label="نام گروه" error={error || undefined}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          disabled={busy}
          className="w-full min-h-10 rounded-lg bg-transparent px-3 text-sm shadow-ring focus-visible:shadow-focus dark:bg-ink-900 dark:text-ink-100"
        />
      </Field>

      <Field label="توضیحات">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          disabled={busy}
          className="w-full rounded-lg bg-transparent px-3 py-2 text-sm shadow-ring focus-visible:shadow-focus dark:bg-ink-900 dark:text-ink-100"
        />
      </Field>

      <div>
        <span className="mb-1.5 block text-sm font-medium text-ink-700 dark:text-ink-300">تصویر گروه</span>
        <div className="flex items-center gap-3">
          <GroupAvatar name={name || group.name} avatar={avatar !== undefined ? avatar : group.avatar} className="h-12 w-12" />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => pickAvatar(e.target.files?.[0])}
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            تغییر تصویر
          </Button>
          {(avatar !== undefined ? avatar : group.avatar) && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setAvatar(null)} disabled={busy}>
              حذف تصویر
            </Button>
          )}
        </div>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      <div className="flex justify-end">
        <ButtonWithSpinner type="submit" loading={busy} disabled={!dirty}>
          ذخیره تغییرات
        </ButtonWithSpinner>
      </div>
    </form>
  );
}
