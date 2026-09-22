import { Link } from 'react-router-dom';
import { CircleHelp, LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react';
import { useApp } from '@/store/AppProvider';
import { AvatarBadge } from './AccountBadge';
import { BotAvatar } from '@/components/BotAvatar';
import { formatDate as faDate } from '@/utils/fa';

/**
 * AccountPanel — the menu that opens from the editor's AccountChip.
 * Same visual language as the rest of the app's popovers: one quiet surface,
 * a calm identity header, hairline dividers, and menu rows with real focus
 * states. Everything reads from the auth store — no placeholder identities,
 * no decorative cards.
 */
export function AccountPanel({ onNavigate }: { onNavigate: () => void }) {
  const { user, logout, online, settings } = useApp();

  return (
    <div dir="rtl" className="w-64 select-none py-1.5">
      {/* identity header */}
      <div className="flex items-center gap-3 px-3.5 pb-3 pt-2">
        <div className="relative shrink-0">
          <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full">
            {user?.avatar
              ? <img src={user.avatar} alt="" className="h-full w-full object-cover" />
              : <BotAvatar name={user?.name} preset={settings?.avatarPreset} className="h-full w-full" />}
          </span>
          <AvatarBadge online={online} className="-bottom-0.5 -left-0.5 h-2.5 w-2.5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-ink-900 dark:text-ink-100">{user?.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-ink-500 dark:text-ink-400" dir="ltr">
            {user?.username ? `@${user.username}` : user?.email}
          </p>
        </div>
      </div>

      <div className="mx-2.5 h-px bg-black/[.06] dark:bg-white/[.07]" />

      {/* account facts — quiet, tabular */}
      <dl className="space-y-1.5 px-3.5 py-3 text-[11.5px] leading-5">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-500 dark:text-ink-400">وضعیت</dt>
          <dd className={`inline-flex items-center gap-1.5 font-medium ${online ? 'text-ink-700 dark:text-ink-200' : 'text-[#b3261e] dark:text-[#f2b8b5]'}`}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-[#0070f3]' : 'bg-[#ff5b4f]'}`} />
            {online ? 'متصل' : 'بدون اتصال'}
          </dd>
        </div>
        {user?.createdAt && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-500 dark:text-ink-400">عضویت از</dt>
            <dd className="font-medium text-ink-700 dark:text-ink-200">{faDate(user.createdAt)}</dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-500 dark:text-ink-400">دسترسی</dt>
          <dd className="inline-flex items-center gap-1 font-medium text-ink-700 dark:text-ink-200">
            <ShieldCheck className="h-3 w-3 opacity-60" aria-hidden="true" />
            امن
          </dd>
        </div>
      </dl>

      <div className="mx-2.5 h-px bg-black/[.06] dark:bg-white/[.07]" />

      {/* actions */}
      <nav className="px-1 pt-1" aria-label="اقدامات حساب">
        <MenuRow to="/settings?tab=account" icon={<UserRound className="h-3.5 w-3.5" aria-hidden="true" />} onClick={onNavigate}>
          پروفایل و حساب
        </MenuRow>
        <MenuRow to="/settings" icon={<Settings className="h-3.5 w-3.5" aria-hidden="true" />} onClick={onNavigate}>
          تنظیمات
        </MenuRow>
        <MenuRow to="/settings?tab=guide" icon={<CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />} onClick={onNavigate}>
          راهنما
        </MenuRow>
        <div className="mx-1.5 my-1 h-px bg-black/[.06] dark:bg-white/[.07]" />
        <button
          type="button"
          onClick={() => { onNavigate(); logout(); }}
          className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[12.5px] font-medium text-[#b3261e] transition-colors hover:bg-[#b3261e]/8 focus-visible:shadow-focus dark:text-[#f2b8b5] dark:hover:bg-[#f2b8b5]/10"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          خروج از حساب
        </button>
      </nav>
    </div>
  );
}

function MenuRow({ to, icon, children, onClick }: {
  to: string; icon: React.ReactNode; children: React.ReactNode; onClick: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex min-h-8 items-center gap-2 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-700 transition-colors hover:bg-ink-100 focus-visible:shadow-focus dark:text-ink-200 dark:hover:bg-ink-800"
    >
      <span className="text-ink-400 dark:text-ink-500">{icon}</span>
      {children}
    </Link>
  );
}
