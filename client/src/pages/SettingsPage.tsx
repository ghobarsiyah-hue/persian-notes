import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CircleHelp, LogOut } from 'lucide-react';
import { useApp } from '@/store/AppProvider';
import { Spinner, Button, Input } from '@/components/ui';
import { EduBlocksModal } from '@/components/editor/EduBlocksModal';
import { BotAvatar, BOT_PROFILES } from '@/components/BotAvatar';
import { faDigits, formatDate, relativeTime } from '@/utils/fa';
import type { NotificationPosition, NotificationPrefs } from '@/types';
import { WIKI_ARTICLES, findArticle } from '@/wiki/articles';

/* ═══════════════════════════════════════════════════════════════════════
   تنظیمات — one calm page, six real sections. Everything here writes to
   its source of truth: profile/security → PUT /auth/me (AppProvider.updateMe),
   اعلان‌ها/ظاهر → the per-user settings doc (saveSettings). No local-only
   state, no capabilities the backend lacks.
   ═══════════════════════════════════════════════════════════════════════ */

const TABS = [
  { id: 'account', label: 'حساب کاربری', help: 'account' },
  { id: 'security', label: 'امنیت', help: 'security' },
  { id: 'notifications', label: 'اعلان‌ها', help: 'notifications' },
  { id: 'appearance', label: 'ظاهر و تجربه', help: 'appearance' },
  { id: 'privacy', label: 'حریم خصوصی و داده', help: 'privacy' },
  { id: 'guide', label: 'راهنما', help: undefined },
] as const;

type TabId = (typeof TABS)[number]['id'];

function HelpLink({ to }: { to: string }) {
  /* opens the matching article inside the guide tab — help lives in settings */
  return (
    <Link
      to={`/settings?tab=guide&topic=${to}`}
      title="راهنما"
      aria-label="راهنمای این بخش"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-400 transition hover:bg-gray-100 hover:text-ink-700 dark:text-ink-500 dark:hover:bg-[#222] dark:hover:text-ink-200"
    >
      <CircleHelp size={14} aria-hidden="true" />
    </Link>
  );
}

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-4">
      <div className="flex items-center gap-2 border-b border-black/5 pb-2 dark:border-white/5">
        <h2 className="text-[15px] font-bold text-ink-900 dark:text-ink-100">{title}</h2>
        {help && <HelpLink to={help} />}
      </div>
      {children}
    </section>
  );
}

/* a quiet, accessible switch — real thumb that slides between the two ends
   (the previous variant used h-4.5, which Tailwind v3 does not generate, so
   the track collapsed and the thumb translate fought the RTL helpers) */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center justify-between gap-4">
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 focus-visible:shadow-focus ${
          checked ? 'bg-accent-600' : 'bg-gray-300 dark:bg-[#333]'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-[inset-inline-start] duration-150 ${
            checked ? 'start-[18px]' : 'start-[2px]'
          }`}
        />
      </button>
    </label>
  );
}

export default function SettingsPage() {
  const { settings, saveSettings, user, toast, updateMe, logout, online } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'account') as TabId;
  const [busy, setBusy] = useState<string | null>(null);
  const [eduOpen, setEduOpen] = useState(false);

  /* account section state */
  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null); // local preview until save
  const fileRef = useRef<HTMLInputElement>(null);

  /* security section state */
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState<string | null>(null);

  if (!settings) return <p className="py-16 text-center text-ink-500 dark:text-ink-400">در حال بارگذاری…</p>;
  const shownAvatar = avatarPreview ?? user?.avatar ?? null;

  const pickAvatar = (file: File | undefined) => {
    setPwError(null);
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast('قالب تصویر باید PNG یا JPG باشد.', 'error');
      return;
    }
    if (file.size > 150 * 1024) {
      toast('حجم تصویر باید کمتر از ۱۵۰ کیلوبایت باشد.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(String(reader.result));
    reader.readAsDataURL(file);
  };

  const saveAvatar = async () => {
    setBusy('avatar');
    try {
      await updateMe({ avatar: avatarPreview });
      setAvatarPreview(null);
      toast('تصویر پروفایل ذخیره شد.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const removeAvatar = async () => {
    setBusy('avatar');
    try {
      await updateMe({ avatar: null });
      setAvatarPreview(null);
      toast('تصویر پروفایل حذف شد.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return;
    setBusy('name');
    try {
      const uname = username.trim().toLowerCase();
      /* unchanged or cleared → only send when it actually differs */
      const usernamePatch = uname === (user?.username ?? '') ? {} : { username: uname || null };
      await updateMe({ name: name.trim(), ...usernamePatch });
      toast('اطلاعات حساب به‌روزرسانی شد.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (pw.next.length < 8) { setPwError('رمز جدید باید حداقل ۸ کاراکتر باشد.'); return; }
    if (pw.next !== pw.confirm) { setPwError('تکرار رمز با رمز جدید یکسان نیست.'); return; }
    setBusy('password');
    try {
      await updateMe({ currentPassword: pw.current, password: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      toast('رمز عبور تغییر کرد. نشست‌های دیگر باطل شدند.', 'success');
    } catch (err) {
      setPwError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setPref = (key: keyof NotificationPrefs, value: boolean) => {
    void saveSettings({ notifications: { ...settings.notifications, prefs: { ...settings.notifications.prefs, [key]: value } } });
  };
  const setPosition = (position: NotificationPosition) => {
    void saveSettings({ notifications: { ...settings.notifications, position } });
  };

  const prefGroups: { title: string; items: [keyof NotificationPrefs, string][] }[] = [
    {
      title: 'رویدادهای همکاری',
      items: [
        ['collabJoined', 'شخصی وارد سند شد'],
        ['collabEdited', 'شخصی سند را ویرایش کرد'],
        ['collabLeft', 'شخصی از سند خارج شد'],
      ],
    },
    {
      title: 'رویدادهای سند',
      items: [
        ['docMajorChange', 'تغییرات مهم سند'],
        ['docShare', 'اشتراک‌گذاری سند'],
        ['docAccessChange', 'تغییر دسترسی'],
      ],
    },
    {
      title: 'سیستم',
      items: [
        ['systemSave', 'ذخیره موفق'],
        ['systemError', 'خطا'],
        ['systemWarning', 'هشدار'],
        ['systemUpdate', 'به‌روزرسانی مهم'],
      ],
    },
  ];

  const positions: { id: NotificationPosition; label: string; cls: string }[] = [
    { id: 'top-right', label: 'بالا راست', cls: 'top-1 right-1' },
    { id: 'top-left', label: 'بالا چپ', cls: 'top-1 left-1' },
    { id: 'bottom-right', label: 'پایین راست', cls: 'bottom-1 right-1' },
    { id: 'bottom-left', label: 'پایین چپ', cls: 'bottom-1 left-1' },
  ];

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-xl font-extrabold tracking-tight text-ink-900 dark:text-ink-100">تنظیمات</h1>

      <div className="mt-5 flex flex-col gap-8 md:flex-row">
        {/* section nav — horizontal chips on mobile, quiet rail on desktop */}
        <nav aria-label="بخش‌های تنظیمات" className="shrink-0">
          <ul className="flex gap-1.5 overflow-x-auto pb-1 md:w-52 md:flex-col md:overflow-visible">
            {TABS.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setParams(t.id === 'account' ? {} : { tab: t.id }, { replace: true })}
                  aria-current={tab === t.id ? 'page' : undefined}
                  className={`w-full whitespace-nowrap rounded-lg px-3 py-2 text-right text-sm font-medium transition ${
                    tab === t.id
                      ? 'bg-gray-100 text-[#171717] dark:bg-[#222] dark:text-white'
                      : 'text-[#888] hover:bg-gray-50 hover:text-[#666] dark:text-[#666] dark:hover:bg-[#1a1a1a] dark:hover:text-[#aaa]'
                  }`}
                >
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 space-y-9">
          {tab === 'account' && (
            <Section title="حساب کاربری" help="account">
              {/* avatar */}
              <div className="flex items-center gap-4">
                <span className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full" aria-hidden="true">
                  {shownAvatar ? <img src={shownAvatar} alt="" className="h-full w-full object-cover" /> : <BotAvatar name={user?.name} preset={settings.avatarPreset} className="h-full w-full" />}
                </span>
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy === 'avatar'}>
                      {shownAvatar ? 'تغییر تصویر…' : 'انتخاب تصویر…'}
                    </Button>
                    {shownAvatar && (
                      <Button variant="ghost" onClick={() => (avatarPreview ? setAvatarPreview(null) : removeAvatar())} disabled={busy === 'avatar'}>
                        حذف تصویر
                      </Button>
                    )}
                    {avatarPreview && (
                      <Button onClick={saveAvatar} disabled={busy === 'avatar'}>
                        {busy === 'avatar' ? <Spinner /> : null} ذخیره تصویر
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-ink-500 dark:text-ink-400">PNG یا JPG، حداکثر ۱۵۰ کیلوبایت</p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => pickAvatar(e.target.files?.[0])}
                    aria-label="انتخاب تصویر پروفایل"
                  />
                </div>
              </div>

              {/* name + آیدی + email */}
              <form onSubmit={saveName} className="flex flex-wrap items-end gap-3">
                <div className="w-56">
                  <Input label="نام نمایشی" value={name} onChange={(e) => setName(e.target.value)} disabled={busy === 'name'} maxLength={80} required />
                </div>
                <div className="w-56">
                  <Input
                    label="آیدی کاربر"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={busy === 'name'}
                    maxLength={24}
                    dir="ltr"
                    placeholder="sara_87"
                    autoComplete="username"
                  />
                </div>
                <Button type="submit" disabled={busy === 'name' || name.trim().length < 2 || (name === user?.name && username.trim().toLowerCase() === (user?.username ?? ''))}>
                  {busy === 'name' ? <Spinner /> : null} ذخیره
                </Button>
              </form>
              <p className="text-xs text-ink-500 dark:text-ink-400">آیدی فقط حروف لاتین، رقم، خط تیره و زیرخط (۳ تا ۲۴ کاراکتر) — یکتا در کل برنامه.</p>
              <div>
                <p className="text-xs text-ink-500 dark:text-ink-400">ایمیل (شناسه ورود — قابل تغییر نیست)</p>
                <p className="mt-1 text-sm text-ink-900 dark:text-ink-100" dir="ltr">{user?.email}</p>
                {user?.username && (
                  <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400" dir="ltr">@{user.username}</p>
                )}
              </div>

              {/* status */}
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.06)' }}>
                  <dt className="text-ink-500 dark:text-ink-400">وضعیت حساب</dt>
                  <dd>
                    <span className={`inline-flex items-center gap-1.5 ${online ? 'text-accent-700 dark:text-accent-300' : 'text-red-600 dark:text-red-400'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-accent-600' : 'bg-red-500'}`} aria-hidden="true" />
                      {online ? 'فعال' : 'آفلاین'}
                    </span>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.06)' }}>
                  <dt className="text-ink-500 dark:text-ink-400">ساخت حساب</dt>
                  <dd>{user?.createdAt ? formatDate(user.createdAt) : '—'}</dd>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 sm:col-span-2" style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.06)' }}>
                  <dt className="text-ink-500 dark:text-ink-400">آخرین ورود</dt>
                  <dd>{user?.lastLoginAt ? relativeTime(user.lastLoginAt) : '—'}</dd>
                </div>
              </dl>
            </Section>
          )}

          {tab === 'security' && (
            <Section title="امنیت" help="security">
              <form onSubmit={changePassword} className="max-w-sm space-y-3">
                <Input type="password" dir="ltr" label="رمز فعلی" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required disabled={busy === 'password'} />
                <Input type="password" dir="ltr" label="رمز جدید (حداقل ۸ کاراکتر)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" required disabled={busy === 'password'} />
                <Input type="password" dir="ltr" label="تکرار رمز جدید" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" required disabled={busy === 'password'} />
                {pwError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{pwError}</p>}
                <Button type="submit" disabled={busy === 'password' || !pw.current || !pw.next}>
                  {busy === 'password' ? <Spinner /> : null} تغییر رمز عبور
                </Button>
              </form>
              <p className="max-w-md text-xs leading-6 text-ink-500 dark:text-ink-400">
                با تغییر رمز، نشست‌های فعال روی دستگاه‌های دیگر باطل می‌شوند؛ این دستگاه باقی می‌ماند. خروج از حساب نیز نشست را سمت سرور باطل می‌کند.
              </p>
              <Button variant="secondary" onClick={logout} className="gap-2">
                <LogOut size={14} aria-hidden="true" /> خروج از حساب
              </Button>
            </Section>
          )}

          {tab === 'notifications' && (
            <Section title="اعلان‌ها" help="notifications">
              {/* position — accessible radio group with a mini page preview */}
              <fieldset>
                <legend className="text-sm font-medium text-ink-900 dark:text-ink-100">محل نمایش اعلان‌ها</legend>
                <div className="mt-3 flex flex-wrap items-center gap-5">
                  <div
                    className="relative h-28 w-20 shrink-0 rounded-lg border border-black/10 bg-white dark:border-white/10 dark:bg-[#171717]"
                    role="img"
                    aria-label={`محل فعلی: ${positions.find((p) => p.id === settings.notifications.position)?.label}`}
                  >
                    {positions.map((p) => (
                      <span
                        key={p.id}
                        aria-hidden="true"
                        className={`absolute h-2.5 w-2.5 rounded-full transition ${
                          settings.notifications.position === p.id
                            ? 'bg-accent-600 ring-2 ring-accent-600/30'
                            : 'bg-gray-300 dark:bg-[#333]'
                        } ${p.cls}`}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {positions.map((p) => (
                      <label key={p.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-gray-700 transition hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-[#1a1a1a]">
                        <input
                          type="radio"
                          name="notification-position"
                          value={p.id}
                          checked={settings.notifications.position === p.id}
                          onChange={() => setPosition(p.id)}
                          className="accent-[#0f766e]"
                        />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              </fieldset>

              {/* prefs — only kinds the system can really emit; collab prefs
                  are stored now and activate when collaboration ships */}
              <div className="space-y-5">
                {prefGroups.map((g) => (
                  <div key={g.title}>
                    <p className="mb-1.5 text-xs font-medium text-ink-500 dark:text-ink-400">{g.title}</p>
                    <div className="max-w-sm divide-y divide-black/5 dark:divide-white/5">
                      {g.items.map(([key, label]) => (
                        <Switch key={key} label={label} checked={settings.notifications.prefs[key]} onChange={(v) => setPref(key, v)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="max-w-md text-xs leading-6 text-ink-500 dark:text-ink-400">
                رویدادهای همکاری زمانی فعال می‌شوند که ویرایش مشترک به برنامه اضافه شود؛ انتخاب‌های شما ذخیره می‌شود.
              </p>
            </Section>
          )}

          {tab === 'appearance' && (
            <Section title="ظاهر و تجربه" help="appearance">
              {/* fallback avatar — pick one of the bot profiles; only applies
                  while no custom picture is uploaded */}
              <fieldset>
                <legend className="text-sm font-medium text-ink-900 dark:text-ink-100">آواتار پیش‌فرض</legend>
                <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                  تا وقتی تصویر پروفایل نداشته باشید، این آواتار نمایش داده می‌شود.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2.5">
                  {BOT_PROFILES.map((p) => {
                    const active = settings.avatarPreset === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => void saveSettings({ avatarPreset: p.id })}
                        aria-pressed={active}
                        title={p.label}
                        className={`flex h-12 w-12 items-center justify-center rounded-full transition focus-visible:shadow-focus ${
                          active ? 'ring-2 ring-accent-600 ring-offset-2 ring-offset-white dark:ring-offset-[#111]' : 'hover:scale-105'
                        }`}
                      >
                        {/* the auto chip previews the name-hash pick that
                            «پیش‌فرض» actually resolves to */}
                        <BotAvatar
                          name={user?.name}
                          preset={p.id === 'auto' ? 'auto' : p.id}
                          className="h-full w-full"
                        />
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="max-w-sm space-y-3 border-t border-black/5 pt-5 dark:border-white/5">
                <Input
                  label="اندازه قلم ویرایشگر"
                  type="number"
                  min={12}
                  max={28}
                  value={settings.editor.fontSize}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v >= 12 && v <= 28) void saveSettings({ editor: { ...settings.editor, fontSize: v } });
                  }}
                />
                <Input
                  label="فاصله خطوط"
                  type="number"
                  step="0.1"
                  min={1.2}
                  max={3}
                  value={settings.editor.lineHeight}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v >= 1.2 && v <= 3) void saveSettings({ editor: { ...settings.editor, lineHeight: v } });
                  }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/5 pt-4 dark:border-white/5">
                <div>
                  <h3 className="text-sm font-medium text-ink-900 dark:text-ink-100">کادرهای آموزشی</h3>
                  <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
                    استایل، رنگ و گوشه‌های کادرها — در ویرایشگر، چاپ و PDF اعمال می‌شود.
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setEduOpen(true)}>شخصی‌سازی…</Button>
              </div>
            </Section>
          )}

          {tab === 'privacy' && (
            <Section title="حریم خصوصی و داده" help="privacy">
              <div className="max-w-md space-y-2.5 text-sm leading-7 text-gray-700 dark:text-gray-300">
                <p>هر جزوه متعلق به حسابی است که آن را ساخته است. دسترسی در سرور و در هر درخواست بررسی می‌شود؛ شناسه جزوه به‌تنهایی برای دیدن یا تغییر آن کافی نیست.</p>
                <p>جزوه‌های سطل زباله تا خالی‌کردن آن قابل بازیابی‌اند.</p>
                <p>می‌توانید هر جزوه را به PDF یا Word ببرید؛ خروجی روی دستگاه خودتان ساخته می‌شود.</p>
                <p>رمز عبور شما به‌صورت رمزنگاری‌شده ذخیره می‌شود و هرگز در پاسخ‌ها یا گزارش‌ها ظاهر نمی‌شود.</p>
              </div>
            </Section>
          )}

          {tab === 'guide' && (
            <Section title="راهنما">
              {(() => {
                const helpId = params.get('topic');
                const article = helpId ? findArticle(helpId) : undefined;
                if (article) {
                  return (
                    <article className="max-w-2xl">
                      <p className="text-xs text-ink-500 dark:text-ink-400">{article.section}</p>
                      <h3 className="mt-1 text-[15px] font-bold text-ink-900 dark:text-ink-100">{article.title}</h3>
                      <div className="mt-3 space-y-2.5">
                        {article.body.map((p, i) => (
                          <p key={i} className="text-sm leading-7 text-gray-700 dark:text-gray-300">{p}</p>
                        ))}
                      </div>
                      <Link
                        to="/settings?tab=guide"
                        replace
                        className="mt-4 inline-block text-xs font-medium text-accent-700 hover:text-accent-800 dark:text-accent-300"
                      >
                        بازگشت به فهرست راهنما
                      </Link>
                    </article>
                  );
                }
                return (
                  <nav className="max-w-2xl divide-y divide-black/5 dark:divide-white/5" aria-label="فهرست مقاله‌های راهنما">
                    {WIKI_ARTICLES.map((a) => (
                      <Link
                        key={a.id}
                        to={`/settings?tab=guide&topic=${a.id}`}
                        replace
                        className="group flex items-baseline justify-between gap-3 py-2.5"
                      >
                        <span className="text-sm font-medium text-ink-900 transition group-hover:text-accent-700 dark:text-ink-100 dark:group-hover:text-accent-300">{a.title}</span>
                        <span className="shrink-0 text-xs text-ink-500 dark:text-ink-400">{a.section}</span>
                      </Link>
                    ))}
                  </nav>
                );
              })()}
            </Section>
          )}
        </div>
      </div>

      <EduBlocksModal open={eduOpen} onClose={() => setEduOpen(false)} />
    </div>
  );
}
