import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from '@/store/AppProvider';
import { AppLayout } from '@/components/layout/AppLayout';
import { Toaster } from '@/components/ui';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import NotesListPage from '@/pages/NotesListPage';
import SubjectsPageDefault from '@/pages/SubjectsPage';
import TemplatesPage from '@/pages/TemplatesPage';
import SettingsPage from '@/pages/SettingsPage';
import SearchPage from '@/pages/SearchPage';
import EditorPage from '@/pages/EditorPage';
import GroupsPage from '@/pages/GroupsPage';
import GroupDetailPage from '@/pages/GroupDetailPage';
import { HelpPage } from '@/pages/HelpPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, authReady } = useApp();
  if (!authReady) return <p className="py-16 text-center text-ink-500">در حال بارگذاری…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <AppLayout>{children}</AppLayout>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<LoginPage initialMode="register" />} />
      {/* Wiki/Help — no private data behind it, so no auth gate */}
      <Route path="/help" element={<HelpPage />} />
      <Route path="/help/:articleId" element={<HelpPage />} />
      <Route path="/" element={<RequireAuth><DashboardPage /></RequireAuth>} />
      <Route path="/notes" element={<RequireAuth><NotesListPage mode="all" /></RequireAuth>} />
      <Route path="/favorites" element={<RequireAuth><NotesListPage mode="favorite" /></RequireAuth>} />
      <Route path="/trash" element={<RequireAuth><NotesListPage mode="trash" /></RequireAuth>} />
      <Route path="/recent" element={<RequireAuth><NotesListPage mode="all" /></RequireAuth>} />
      <Route path="/subjects" element={<RequireAuth><SubjectsPageDefault /></RequireAuth>} />
      <Route path="/templates" element={<RequireAuth><TemplatesPage /></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
      <Route path="/search" element={<RequireAuth><SearchPage /></RequireAuth>} />
      <Route path="/editor/:id" element={<RequireAuth><EditorPage /></RequireAuth>} />
      <Route path="/groups" element={<RequireAuth><GroupsPage /></RequireAuth>} />
      <Route path="/groups/:groupId" element={<RequireAuth><GroupDetailPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <AppRoutes />
        <Toaster />
      </BrowserRouter>
    </AppProvider>
  );
}
