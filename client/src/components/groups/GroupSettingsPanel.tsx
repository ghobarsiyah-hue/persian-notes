import { useRef, useState, type FormEvent } from 'react';
import { groupsApi } from '@/api/endpoints';
import { useApp } from '@/store/AppProvider';
import { Field, Button, ButtonWithSpinner, ErrorText } from '@/components/ui';
import { GroupAvatar } from '@/components/groups/GroupAvatar';
import { loadAvatarFile } from '@/utils/imageFile';
import { CONTENT_POLICY_LABELS, JOIN_POLICY_LABELS, type Group } from '@/types';
import { ShieldCheck } from 'lucide-react';

/** رنگ اکسان گروه — پالت هماهنگ با هویت سیستم؛ null = اکسان سیستم */
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
  const [accent, setAccent] = useState<string | null>(group.accentColor ?? null);
  const [joinPolicy, setJoinPolicy] = useState<Group['joinPolicy']>(group.joinPolicy ?? 'invite');
  const [contentPolicy, setContentPolicy] = useState<Group['contentPolicy']>(group.contentPolicy ?? 'members');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty =
    name.trim() !== group.name ||
    description !== group.description ||
    avatar !== undefined ||
    accent !== (group.accentColor ?? null) ||
    joinPolicy !== (group.joinPolicy ?? 'invite') ||
    contentPolicy !== (group.contentPolicy ?? 'members');

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
        ...(accent !== (group.accentColor ?? null) ? { accentColor: accent } : {}),
        ...(joinPolicy !== (group.joinPolicy ?? 'invite') ? { joinPolicy } : {}),
        ...(contentPolicy !== (group.contentPolicy ?? 'members') ? { contentPolicy } : {}),
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
          <div>
            <dt className="text-[11px] text-ink-400">رنگ گروه</dt>
            <dd className="mt-0.5 flex items-center gap-2 font-semibold text-ink-900 dark:text-ink-100">
              <span
                aria-hidden="true"
                className="inline-block h-4 w-4 rounded-full border border-black/10 dark:border-white/20"
                style={{ background: group.accentColor ?? 'linear-gradient(135deg,#7c3aed 0%,#2563eb 100%)' }}
              />
              {group.accentColor ?? 'پیش‌فرض سیستم'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-400">سیستم عضویت</dt>
            <dd className="mt-0.5 font-semibold text-ink-900 dark:text-ink-100">{JOIN_POLICY_LABELS[group.joinPolicy ?? 'invite']}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-400">دسترسی محتوا</dt>
            <dd className="mt-0.5 font-semibold text-ink-900 dark:text-ink-100">{CONTENT_POLICY_LABELS[group.contentPolicy ?? 'members']}</dd>
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
        <span className="mb-1.5 block text-sm font-medium text-ink-700 dark:text-ink-300">رنگ گروه</span>
        <p className="mb-2 text-[11px] text-ink-400">در هدر و آواتارهای گروه اعمال می‌شود.</p>
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

      {/* ── تنظیمات امنیتی (item ۱۳/۱۵): join policy + content visibility —
          rendered as accessible radio groups; the server re-validates every
          value and falls back to the SAFE defaults on stale data ── */}
      <fieldset className="space-y-3 rounded-xl border border-black/5 p-3 dark:border-white/10">
        <legend className="flex items-center gap-1.5 px-1 text-[13px] font-semibold text-ink-800 dark:text-ink-200">
          <ShieldCheck aria-hidden="true" className="h-4 w-4" />
          امنیت و دسترسی
        </legend>

        <div role="radiogroup" aria-label="سیستم عضویت">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-700 dark:text-ink-300">سیستم عضویت</span>
          <div className="space-y-1">
            {([
              { v: 'invite', label: 'فقط با دعوت', desc: 'مدیران و مالک اعضا را اضافه می‌کنند — امن‌ترین حالت' },
              { v: 'open', label: 'پیوستن آزاد', desc: 'هر کاربر ثبت‌نام‌شده می‌تواند عضو شود' },
            ] as const).map((o) => (
              <label key={o.v} className="flex min-h-9 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-100/60 dark:hover:bg-ink-800/60">
                <input
                  type="radio"
                  name="groupJoinPolicy"
                  className="mt-1 accent-[#0070f3]"
                  checked={joinPolicy === o.v}
                  onChange={() => setJoinPolicy(o.v)}
                  disabled={busy}
                />
                <span className="leading-tight">
                  <span className="block text-[13px] text-ink-800 dark:text-ink-200">{o.label}</span>
                  <span className="block text-[11px] text-ink-400">{o.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div role="radiogroup" aria-label="دسترسی محتوا">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-700 dark:text-ink-300">دسترسی به جزوه‌ها</span>
          <div className="space-y-1">
            {([
              { v: 'members', label: 'فقط اعضا', desc: 'جزوه‌های گروه فقط برای اعضای فعال دیده می‌شود' },
              { v: 'public', label: 'عمومی', desc: 'هرکسی با لینک می‌تواند بخواند — نوشتن همچنان فقط اعضا' },
            ] as const).map((o) => (
              <label key={o.v} className="flex min-h-9 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-100/60 dark:hover:bg-ink-800/60">
                <input
                  type="radio"
                  name="groupContentPolicy"
                  className="mt-1 accent-[#0070f3]"
                  checked={contentPolicy === o.v}
                  onChange={() => setContentPolicy(o.v)}
                  disabled={busy}
                />
                <span className="leading-tight">
                  <span className="block text-[13px] text-ink-800 dark:text-ink-200">{o.label}</span>
                  <span className="block text-[11px] text-ink-400">{o.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </fieldset>

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
