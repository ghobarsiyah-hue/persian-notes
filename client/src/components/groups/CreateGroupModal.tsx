import { useRef, useState, type FormEvent } from 'react';
import { Modal, Field, Button, ButtonWithSpinner, ErrorText } from '@/components/ui';
import { GroupAvatar } from '@/components/groups/GroupAvatar';
import { groupsApi } from '@/api/endpoints';
import { useApp } from '@/store/AppProvider';
import { emitUserEvent } from '@/events/userEvents';
import { loadAvatarFile } from '@/utils/imageFile';
import type { Group } from '@/types';

/** همان پالت تنظیمات گروه — null = اکسان سیستم */
const ACCENT_CHOICES: Array<{ c: string | null; label: string }> = [
  { c: null, label: 'پیش‌فرض' },
  { c: '#7c3aed', label: 'بنفش' },
  { c: '#2563eb', label: 'آبی' },
  { c: '#0d9488', label: 'سبزآبی' },
  { c: '#16a34a', label: 'سبز' },
  { c: '#d97706', label: 'نارنجی' },
  { c: '#dc2626', label: 'قرمز' },
  { c: '#db2777', label: 'صورتی' },
];

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
  const [accent, setAccent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setName('');
    setDescription('');
    setAvatar(null);
    setAccent(null);
    setError(null);
  };

  const pickAvatar = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('فایل انتخاب‌شده تصویر نیست.');
      return;
    }
    /* no manual cap — loadAvatarFile auto-fits under the server budget */
    setBusy(true);
    loadAvatarFile(file)
      .then((url) => setAvatar(url))
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
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
        accentColor: accent,
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
          <span className="mb-1.5 block text-sm font-medium text-ink-700 dark:text-ink-300">رنگ گروه</span>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="رنگ گروه">
            {ACCENT_CHOICES.map(({ c, label }) => {
              const active = accent === c;
              return (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={label}
                  aria-label={label}
                  disabled={busy}
                  onClick={() => setAccent(c)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                    active
                      ? 'border-ink-900 ring-2 ring-ink-900/20 dark:border-white dark:ring-white/30'
                      : 'border-black/10 hover:border-black/25 dark:border-white/15 dark:hover:border-white/35'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="h-5 w-5 rounded-full"
                    style={{ background: c ?? 'linear-gradient(135deg,#7c3aed 0%,#2563eb 100%)' }}
                  />
                </button>
              );
            })}
          </div>
        </div>

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
