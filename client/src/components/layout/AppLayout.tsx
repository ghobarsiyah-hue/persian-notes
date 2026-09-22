import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FileText, PenLine, FolderOpen, Users,
  Store, Trash2, Settings, LogOut, PanelRightClose, PanelRightOpen,
} from 'lucide-react';
import { useApp } from '@/store/AppProvider';
import { BrandLogo } from '@/components/brand/BrandLogo';

/* icon sizing/weight shared by every nav row so the rail reads as one
   system, not a pile of glyphs (16px, 1.8 stroke = the editor's iconography) */
const ICON_CLS = 'h-4 w-4 shrink-0';

const NAV = [
  { to: '/', label: 'داشبورد', icon: <LayoutDashboard className={ICON_CLS} />, end: true },
  { to: '/notes', label: 'جزوه‌های من', icon: <FileText className={ICON_CLS} /> },
  { to: '/editor/new', label: 'جزوه‌نویسی', icon: <PenLine className={ICON_CLS} />, accent: true },
  { to: '/subjects', label: 'موضوعات', icon: <FolderOpen className={ICON_CLS} /> },
  { to: '/groups', label: 'گروه‌های من', icon: <Users className={ICON_CLS} /> },
  /* علاقه‌مندی‌ها / ویرایش‌های اخیر live on the dashboard — the rail stays
     focused on destinations, not filtered views */
];

const NAV_SECONDARY = [
  /* آیتم ۱۶: «قالب‌ها» → «فروشگاه» با آیکون مغازه */
  { to: '/templates', label: 'فروشگاه', icon: <Store className={ICON_CLS} /> },
  /* راهنما merged into تنظیمات (guide tab) — one destination, not two */
  { to: '/trash', label: 'سطل زباله', icon: <Trash2 className={ICON_CLS} /> },
  { to: '/settings', label: 'تنظیمات', icon: <Settings className={ICON_CLS} /> },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { logout, online, tags } = useApp();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="pn-app-bg flex h-screen overflow-hidden text-[#171717] dark:text-[#ededed]" dir="rtl">
      {/* Sidebar */}
      <aside
        className={`pn-glass-panel flex shrink-0 flex-col border-l border-black/5 transition-[width] duration-200 dark:border-white/5 ${
          collapsed ? 'w-[52px]' : 'w-60'
        }`}
        style={{
          boxShadow: '1px 0 0 0 rgba(0,0,0,0.06)',
        }}
      >
        {/* Logo + collapse toggle */}
        <div className={`flex items-center gap-1.5 pt-5 pb-4 ${collapsed ? 'flex-col px-1' : 'px-4'}`}>
          <BrandLogo
            size={collapsed ? 28 : 32}
            className="shrink-0 transition-[width,height] duration-200"
          />
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="text-sm font-semibold tracking-[-0.02em] text-[#171717] dark:text-white">
                پرشین‌نوت
              </h1>
              <p className="text-[10px] text-[#666] dark:text-[#888]">
                دفترچه جزوه فارسی
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'باز کردن منو' : 'جمع کردن منو'}
            aria-label={collapsed ? 'باز کردن منو' : 'جمع کردن منو'}
            aria-expanded={!collapsed}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#999] transition-[background,color] duration-100 hover:bg-gray-100 hover:text-[#171717] dark:text-[#666] dark:hover:bg-[#1a1a1a] dark:hover:text-white ${collapsed ? '' : 'mr-auto'}`}
          >
            {collapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </button>
        </div>

        {/* Primary nav */}
        <nav className="grow space-y-0.5 px-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) =>
                `relative flex min-h-9 items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium transition-[background] duration-100 ${
                  isActive
                    ? 'bg-gray-100 text-[#171717] dark:bg-[#222] dark:text-white'
                    : 'text-[#666] hover:bg-gray-50 hover:text-[#171717] dark:text-[#888] dark:hover:bg-[#1a1a1a] dark:hover:text-white'
                } ${collapsed ? 'justify-center px-2' : ''}`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-1.5 right-0 w-[3px] rounded-full bg-[#0070f3]"
                    />
                  )}
                  {/* the icon stays mounted in both states so collapsing keeps
                      a usable icon-only rail */}
                  <span className={`shrink-0 ${isActive ? 'text-[#171717] dark:text-white' : 'text-[#999] dark:text-[#555]'}`} aria-hidden="true">
                    {item.icon}
                  </span>
                  {!collapsed && <span className={`min-w-0 grow truncate ${'accent' in item && item.accent ? 'font-semibold text-accent-700 dark:text-accent-300' : ''}`}>{item.label}</span>}
                </>
              )}
            </NavLink>
          ))}

          {/* Divider */}
          <div className="mx-3 my-3" style={{ height: 1, background: 'rgba(0,0,0,0.06)' }} />

          {/* Secondary nav */}
          {NAV_SECONDARY.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.label}
              className={({ isActive }) =>
                `relative flex min-h-8 items-center gap-2.5 rounded-lg px-3 text-[12px] font-medium transition-[background] duration-100 ${
                  isActive
                    ? 'bg-gray-100 text-[#171717] dark:bg-[#222] dark:text-white'
                    : 'text-[#888] hover:bg-gray-50 hover:text-[#666] dark:text-[#666] dark:hover:bg-[#1a1a1a] dark:hover:text-[#aaa]'
                } ${collapsed ? 'justify-center px-2' : ''}`
              }
            >
              <span className={`shrink-0 text-[#aaa] dark:text-[#4a4a4a]`} aria-hidden="true">{item.icon}</span>
              {!collapsed && <span className="min-w-0 grow truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Exit — the identity chip lives beside the editor's فایل menu;
            the rail keeps only a red-tinted logout */}
        <div className="px-3 pb-4">
          <button
            type="button"
            onClick={() => { logout(); navigate('/login'); }}
            title="خروج از حساب"
            aria-label="خروج از حساب"
            className={`flex min-h-8 w-full items-center gap-1.5 rounded-lg text-[12px] font-medium text-[#b3261e] hover:bg-[#b3261e]/8 dark:text-[#f2b8b5] dark:hover:bg-[#f2b8b5]/10 transition-[background,color] duration-100 ${collapsed ? 'justify-center px-2' : 'justify-center px-3'}`}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            {!collapsed && 'خروج از حساب'}
          </button>
        </div>
      </aside>

      {/* Main column — the global search header was removed (dead weight);
          search remains available from the editor toolbar (Ctrl+F) and the
          dedicated search page. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-y-auto" style={{ animation: 'pn-fade-in 0.15s ease-out' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
