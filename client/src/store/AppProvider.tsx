import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getToken, setToken, setUnauthorizedHandler, api } from '@/api/client';
import { authApi, subjectsApi, tagsApi, templatesApi, settingsApi } from '@/api/endpoints';
import type { AppSettings, Subject, Tag, Template, User } from '@/types';
import { DEFAULT_BORDER_SETTINGS, type EduBlocksSettings } from '@/types';
import { resolveEduBlocks, DEFAULT_EDU_BLOCKS } from '@/utils/eduBlocks';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info' | 'warning';
  message: string;
  /** a stable identity for dedupe — repeated identical toasts (e.g. a
   *  failing autosave firing on every debounce tick) collapse into one */
  dedupeKey?: string;
}

interface AppState {
  user: User | null;
  authReady: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, username?: string) => Promise<void>;
  logout: () => void;
  subjects: Subject[];
  tags: Tag[];
  templates: Template[];
  settings: AppSettings | null;
  reloadSubjects: () => Promise<void>;
  reloadTags: () => Promise<void>;
  reloadTemplates: () => Promise<void>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  saveEduBlocks: (edu: EduBlocksSettings) => Promise<void>;
  toasts: Toast[];
  toast: (message: string, kind?: Toast['kind'], dedupeKey?: string) => void;
  dismissToast: (id: number) => void;
  updateMe: (patch: { name?: string; avatar?: string | null; username?: string | null; currentPassword?: string; password?: string }) => Promise<User>;
  online: boolean;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  editor: { fontSize: 16, lineHeight: 2, fontFamily: 'Sahel' },
  export: {
    margin: 20,
    fontSize: 13,
    lineHeight: 1.9,
    showPageNumbers: true,
    showHeader: true,
    showFooter: true,
    headerText: '',
    footerText: '',
    showCover: false,
  },
  ai: { autoVersionBeforeAI: true },
  border: DEFAULT_BORDER_SETTINGS,
  notifications: {
    position: 'bottom-left',
    prefs: {
      collabJoined: true,
      collabEdited: false,
      collabLeft: false,
      docMajorChange: true,
      docShare: true,
      docAccessChange: true,
      systemSave: false,
      systemError: true,
      systemWarning: true,
      systemUpdate: true,
    },
  },
  avatarPreset: 'auto',
};

let toastSeq = 1;
let lastToastKey = '';
let lastToastAt = 0;

/** Normalize the loaded settings: merge defaults AND migrate the legacy
 *  'minimal' | 'tinted' eduBlocks string to the full customization object. */
function normalizeSettings(raw: Partial<AppSettings> | null | undefined): AppSettings {
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...(raw ?? {}),
    editor: { ...DEFAULT_SETTINGS.editor, ...(raw?.editor ?? {}) },
    export: { ...DEFAULT_SETTINGS.export, ...(raw?.export ?? {}) },
    ai: { ...DEFAULT_SETTINGS.ai, ...(raw?.ai ?? {}) },
    border: { ...DEFAULT_BORDER_SETTINGS, ...(raw?.border ?? {}) },
    notifications: {
      position: raw?.notifications?.position ?? DEFAULT_SETTINGS.notifications.position,
      prefs: { ...DEFAULT_SETTINGS.notifications.prefs, ...(raw?.notifications?.prefs ?? {}) },
    },
    avatarPreset: raw?.avatarPreset ?? 'auto',
  };
  const edu = resolveEduBlocks(merged.editor.eduBlocks);
  merged.editor.eduBlocks = edu ?? { ...DEFAULT_EDU_BLOCKS };
  return merged;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [online, setOnline] = useState(true);

  const toast = useCallback((message: string, kind: Toast['kind'] = 'info', dedupeKey?: string) => {
    /* duplicate suppression: identical content within 1.5 s collapses into
       one toast instead of stacking a storm (existing toast keeps its own
       timer — no restart trickery) */
    const key = dedupeKey ?? `${kind}|${message}`;
    const now = Date.now();
    if (key === lastToastKey && now - lastToastAt < 1500) return;
    lastToastKey = key;
    lastToastAt = now;
    const id = toastSeq++;
    setToasts((t) => {
      const next = [...t, { id, kind, message, dedupeKey: key }];
      /* max 4 visible — older toasts drop off instead of covering the page */
      return next.slice(-4);
    });
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const loadUserData = useCallback(async () => {
    const [s, t, tp, st] = await Promise.all([
      subjectsApi.list(),
      tagsApi.list(),
      templatesApi.list(),
      settingsApi.get(),
    ]);
    setSubjects(s.subjects);
    setTags(t.tags);
    setTemplates(tp.templates);
    setSettings(normalizeSettings(st.settings));
  }, []);

  useEffect(() => {
    (async () => {
      if (getToken()) {
        try {
          const { user: me } = await authApi.me();
          setUser(me);
          await loadUserData();
        } catch {
          setToken(null);
        }
      }
      setAuthReady(true);
    })();
  }, [loadUserData]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
      /* a dead session must also drop the previous user's private data —
         the RequireAuth redirect re-mounts these stores for the next login */
      setSubjects([]);
      setTags([]);
      setTemplates([]);
      setSettings(null);
    });
  }, []);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('pn:online', up);
    window.addEventListener('pn:offline', down);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('pn:online', up);
      window.removeEventListener('pn:offline', down);
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { token, user: u } = await authApi.login(email, password);
      setToken(token);
      setUser(u);
      await loadUserData();
      toast('خوش آمدید!', 'success');
    },
    [loadUserData, toast]
  );

  const register = useCallback(
    async (name: string, email: string, password: string, username?: string) => {
      const { token, user: u } = await authApi.register(name, email, password, username);
      setToken(token);
      setUser(u);
      await loadUserData();
      toast('حساب شما ساخته شد. خوش آمدید!', 'success');
    },
    [loadUserData, toast]
  );

  const logout = useCallback(() => {
    /* invalidate the session SERVER-side first (tokenVersion bump kills the
       token even if a copy was stolen) — then clear ALL private client state
       so nothing of this user leaks into the next login (§7) */
    void authApi.logout().catch(() => { /* offline/already-dead: still clear */ });
    setToken(null);
    setUser(null);
    setSubjects([]);
    setTags([]);
    setTemplates([]);
    setSettings(null);
    setToasts([]); // the next user must not see this session's notifications
  }, []);

  /* profile / security changes flow through ONE channel: the server is the
     source of truth, the returned user replaces the store, and a fresh token
     (issued on password change) keeps THIS session alive while older ones die */
  const updateMe = useCallback(async (patch: { name?: string; avatar?: string | null; currentPassword?: string; password?: string }) => {
    const res = await authApi.updateMe(patch);
    if ('token' in res && res.token) setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const reloadSubjects = useCallback(async () => setSubjects((await subjectsApi.list()).subjects), []);
  const reloadTags = useCallback(async () => setTags((await tagsApi.list()).tags), []);
  const reloadTemplates = useCallback(async () => setTemplates((await templatesApi.list()).templates), []);

  const saveSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        ...patch,
        editor: { ...prev.editor, ...(patch.editor ?? {}) },
        export: { ...prev.export, ...(patch.export ?? {}) },
        ai: { ...prev.ai, ...(patch.ai ?? {}) },
        border: { ...prev.border, ...(patch.border ?? {}) },
      };
    });
    await api('/settings', { method: 'PUT', body: patch });
  }, []);

  /** Replace the eduBlocks customization object wholesale (deep object —
   *  the shallow merge in saveSettings would keep stale family keys). */
  const saveEduBlocks = useCallback(async (edu: EduBlocksSettings) => {
    await saveSettings({ editor: { eduBlocks: edu } } as Partial<AppSettings>);
  }, [saveSettings]);

  const value = useMemo<AppState>(
    () => ({
      user,
      authReady,
      login,
      register,
      logout,
      updateMe,
      subjects,
      tags,
      templates,
      settings,
      reloadSubjects,
      reloadTags,
      reloadTemplates,
      saveSettings,
      saveEduBlocks,
      toasts,
      toast,
      dismissToast,
      online,
    }),
    [
      user, authReady, login, register, logout, updateMe, subjects, tags, templates, settings,
      reloadSubjects, reloadTags, reloadTemplates, saveSettings, saveEduBlocks, toasts, toast, dismissToast, online,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
