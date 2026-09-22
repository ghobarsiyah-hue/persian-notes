import { useRef, useState, type FormEvent } from 'react';
import { Modal, Field, Button, ButtonWithSpinner, ErrorText } from '@/components/ui';
import { GroupAvatar } from '@/components/groups/GroupAvatar';
import { groupsApi } from '@/api/endpoints';
import { useApp } from '@/store/AppProvider';
import { emitUserEvent } from '@/events/userEvents';
import type { Group } from '@/types';

const MAX_AVATAR_BYTES = 150 * 1024;

/**
 * Create Group — one calm flow that matches the site's identity: the SAME
 * modal shell as every other dialog, quiet inputs with the standard
 * shadow-ring, a live avatar preview, and a clear hierarchy
 * (نام ← توضیح ← تصویر). Client validation is UX only; the server
 * re-validates. Every control is labelled and focus-visible.
 */
export function CreateGroupModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (group: Group) => void;
}) {
  const { toast } = useApp();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setName('');
    setDescription('');
    setAvatar(null);
    setError(null);
  };

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

  const create = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('نام گروه باید حداقل ۲ حرف باشد.');
      return;
    }
    if (busy) return; // duplicate-submission guard
    setBusy(true);
    setError(null);
    try {
      const { group } = await groupsApi.create({
        name: trimmed,
        description: description.trim() || undefined,
        avatar,
      });
      toast(`گروه «${group.name}» ساخته شد. شما مالک آن هستید.`, 'success');
      emitUserEvent('group.created', { targetType: 'group', targetId: group.id, metadata: { name: group.name } });
      reset();
      onClose();
      onCreated?.(group);
    } catch (e) {
      /* server confirmed failure — nothing was created; stay in the form
         with the error so the user can retry without duplicates */
      setError((e as Error).message);
      toast('ساخت گروه ناموفق بود: ' + (e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} title="گروه جدید">
      <form onSubmit={(e) => void create(e)} className="space-y-5" noValidate>
        {/* identity row — avatar preview beside the name, one quiet block */}
        <div className="flex items-start gap-4">
          <div className="shrink-0 pt-1">
            <GroupAvatar name={name || 'گ'} avatar={avatar} className="h-14 w-14" rounded="rounded-2xl" />
          </div>
          <div className="min-w-0 grow space-y-4">
            <Field label="نام گروه" error={error || undefined}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثلاً: گروه فیزیولوژی"
                autoComplete="off"
                aria-required="true"
                aria-invalid={!!error}
                disabled={busy}
                className="w-full min-h-10 rounded-lg bg-transparent px-3 text-sm shadow-ring transition-shadow focus-visible:shadow-focus dark:bg-ink-900 dark:text-ink-100"
              />
            </Field>
          </div>
        </div>

        <Field label="توضیحات (اختیاری)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="این گروه چه کاری انجام می‌دهد؟"
            rows={3}
            aria-label="توضیحات گروه"
            disabled={busy}
            className="w-full resize-none rounded-lg bg-transparent px-3 py-2 text-sm leading-6 shadow-ring transition-shadow focus-visible:shadow-focus dark:bg-ink-900 dark:text-ink-100"
          />
        </Field>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink-700 dark:text-ink-300">تصویر گروه (اختیاری)</span>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              aria-label="انتخاب فایل تصویر گروه"
              onChange={(e) => pickAvatar(e.target.files?.[0])}
            />
            <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              انتخاب تصویر
            </Button>
            {avatar && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAvatar(null)} disabled={busy}>
                حذف
              </Button>
            )}
            <span className="text-[11px] text-ink-400">PNG یا JPG · حداکثر ۱۵۰KB</span>
          </div>
        </div>

        {error && <ErrorText>{error}</ErrorText>}

        <div className="flex items-center justify-end gap-2 border-t border-black/5 pt-4 dark:border-white/5">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            انصراف
          </Button>
          <ButtonWithSpinner type="submit" loading={busy} aria-busy={busy}>
            ساخت گروه
          </ButtonWithSpinner>
        </div>
      </form>
    </Modal>
  );
}
