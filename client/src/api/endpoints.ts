import { api } from './client';
import type {
  AppSettings,
  AIActionId,
  AIResult,
  AIStatus,
  Group,
  GroupMember,
  Note,
  SearchHit,
  Subject,
  Tag,
  Template,
  User,
  VersionSummary,
  GroupRole,
} from '@/types';
// ---------- auth ----------
export const authApi = {
  /* silent401: a rejected LOGIN is 'wrong credentials', not a dead session —
     the server's Persian message must reach the form, no global cascade */
  login: (email: string, password: string) =>
    api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { email, password }, silent401: true }),
  register: (name: string, email: string, password: string, username?: string) =>
    api<{ token: string; user: User }>('/auth/register', { method: 'POST', body: { name, email, password, ...(username ? { username } : {}) }, silent401: true }),
  me: () => api<{ user: User }>('/auth/me'),
  /* returns a FRESH token too when the password changed — this session
     survives, every other device's token is dead (server-side version bump) */
  updateMe: (data: { name?: string; avatar?: string | null; username?: string | null; currentPassword?: string; password?: string }) =>
    api<{ user: User; token?: string }>('/auth/me', { method: 'PUT', body: data }),
  /* server-side session invalidation (bumps tokenVersion — every earlier
     token dies even if a copy was stolen) */
  logout: () => api<{ ok: boolean }>('/auth/logout', { method: 'POST', silent401: true }),
};

// ---------- notes ----------
export const notesApi = {
  list: (params: { trashed?: boolean; subjectId?: string; favorite?: boolean; tagId?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.trashed) q.set('trashed', 'true');
    if (params.subjectId) q.set('subjectId', params.subjectId);
    if (params.favorite) q.set('favorite', 'true');
    if (params.tagId) q.set('tagId', params.tagId);
    return api<{ notes: Note[] }>(`/notes?${q.toString()}`);
  },
  get: (id: string) => api<{ note: Note }>(`/notes/${id}`),
  create: (data: Partial<Note>) => api<{ note: Note }>('/notes', { method: 'POST', body: data }),
  update: (id: string, data: Partial<Note> & { versionReason?: string; baseRevision?: number }) =>
    api<{ note: Note }>(`/notes/${id}`, { method: 'PATCH', body: data }),
  remove: (id: string) => api<{ ok: boolean }>(`/notes/${id}`, { method: 'DELETE' }),
  /** clone a note (often a template) as a new editable note */
  clone: (id: string) => api<{ note: Note }>(`/notes/${id}/clone`, { method: 'POST' }),
};

// ---------- collaboration (real-time layer preflight) ----------
export const collabApi = {
  /** ONE advisory call when a note opens: may this user connect, can they
   *  edit, and how many editing seats are taken right now. The WS hub
   *  re-verifies everything server-side on every frame. */
  preflight: (noteId: string) =>
    api<{ collaborative: boolean; canEdit: boolean; maxEditors: number; activeEditors: number; editors: Array<{ userId: string; displayName: string; avatar: string | null; pageId: string | null }> }>(
      '/collab/preflight', { method: 'POST', body: { noteId } }
    ),
};

// ---------- subjects ----------
export const subjectsApi = {
  list: () => api<{ subjects: Subject[] }>('/subjects'),
  create: (data: { name: string; color?: string; parentId?: string | null }) =>
    api<{ subject: Subject }>('/subjects', { method: 'POST', body: data }),
  update: (id: string, data: Partial<Subject>) =>
    api<{ subject: Subject }>(`/subjects/${id}`, { method: 'PATCH', body: data }),
  remove: (id: string) => api<{ ok: boolean }>(`/subjects/${id}`, { method: 'DELETE' }),
};

// ---------- tags ----------
export const tagsApi = {
  list: () => api<{ tags: Tag[] }>('/tags'),
  create: (name: string, color?: string) =>
    api<{ tag: Tag }>('/tags', { method: 'POST', body: { name, color } }),
  remove: (id: string) => api<{ ok: boolean }>(`/tags/${id}`, { method: 'DELETE' }),
};

// ---------- templates ----------
export const templatesApi = {
  list: () => api<{ templates: Template[] }>('/templates'),
  get: (id: string) => api<{ template: Template }>(`/templates/${id}`),
};

// ---------- versions ----------
export const versionsApi = {
  list: (noteId: string) => api<{ versions: VersionSummary[] }>(`/versions/note/${noteId}`),
  get: (id: string) =>
    api<{ version: { _id: string; content: Record<string, unknown>; html: string; title: string; createdAt: string } }>(
      `/versions/${id}`
    ),
  restore: (id: string) => api<{ note: Note }>(`/versions/${id}/restore`, { method: 'POST' }),
};

// ---------- AI ----------
export const aiApi = {
  status: () => api<AIStatus>('/ai/status'),
  run: (data: {
    action: AIActionId;
    text: string;
    scope: 'selection' | 'paragraph' | 'section' | 'document';
    instruction?: string;
    noteId?: string;
  }) => api<AIResult>('/ai/run', { method: 'POST', body: data }),
};

// ---------- search ----------
export const searchApi = {
  run: (params: { q?: string; subjectId?: string; tagId?: string; favorite?: boolean; days?: number }) => {
    const q = new URLSearchParams();
    if (params.q) q.set('q', params.q);
    if (params.subjectId) q.set('subjectId', params.subjectId);
    if (params.tagId) q.set('tagId', params.tagId);
    if (params.favorite) q.set('favorite', 'true');
    if (params.days) q.set('days', String(params.days));
    return api<{ results: SearchHit[]; query: string }>(`/search?${q.toString()}`);
  },
};

// ---------- settings ----------
export const settingsApi = {
  get: () => api<{ settings: AppSettings }>('/settings'),
  update: (data: Partial<AppSettings>) => api<{ settings: AppSettings }>('/settings', { method: 'PUT', body: data }),
};

// ---------- export ----------
export const exportApi = {
  docx: (data: {
    title: string;
    html: string;
    subject?: string;
    chapter?: string;
    headerText?: string;
    footerText?: string;
    /** document font — the editor's fontFamily setting */
    bodyFontFamily?: string;
    /** document font size in px — the editor's own setting */
    fontSizePx?: number;
    /** document line-height — the editor's own setting */
    lineHeight?: number;
    /** edu-block customization CSS, prebuilt client-side (unscoped) */
    eduCss?: string;
    /** ornamental page frame as VML — embedded in the Word page header so
     *  it repeats on every page (like the editor sheet and the PDF) */
    headerHtml?: string;
    /** footer HTML carrying a real PAGE field for the page number */
    footerHtml?: string;
  }) => apiBlob('/export/docx', data),
  html: (data: { title: string; html: string; subject?: string; chapter?: string }) => apiBlob('/export/html', data),
};

async function apiBlob(path: string, body: unknown): Promise<Blob> {
  const token = localStorage.getItem('pn_token');
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('تولید فایل خروجی ناموفق بود.');
  return res.blob();
}

// ---------- groups ----------
export const groupsApi = {
  list: () => api<{ groups: Group[] }>('/groups'),
  get: (groupId: string) => api<{ group: Group }>(`/groups/${groupId}`),
  create: (data: { name: string; description?: string; avatar?: string | null; accentColor?: string | null }) =>
    api<{ group: Group }>('/groups', { method: 'POST', body: data }),
  update: (groupId: string, data: { name?: string; description?: string; avatar?: string | null; accentColor?: string | null; joinPolicy?: 'invite' | 'open'; contentPolicy?: 'members' | 'public' }) =>
    api<{ group: Group }>(`/groups/${groupId}`, { method: 'PATCH', body: data }),
  remove: (groupId: string) => api<{ ok: boolean }>(`/groups/${groupId}`, { method: 'DELETE' }),
  members: (groupId: string) => api<{ members: GroupMember[] }>(`/groups/${groupId}/members`),
  setMemberRole: (groupId: string, userId: string, role: GroupRole) =>
    api<{ member: GroupMember }>(`/groups/${groupId}/members/${userId}`, { method: 'PATCH', body: { role } }),
  removeMember: (groupId: string, userId: string) =>
    api<{ ok: boolean }>(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
  /* group notes (جزوه گروهی) — create is member+, list is member+ */
  groupNotes: (groupId: string) => api<{ notes: Note[] }>(`/groups/${groupId}/notes`),
  createGroupNote: (groupId: string, data: { title?: string; content?: Record<string, unknown> }) =>
    api<{ note: Note }>(`/groups/${groupId}/notes`, { method: 'POST', body: data }),
};

// ---------- seed ----------
export const seedApi = {
  addSampleData: () => api<{ ok: boolean; created: number }>('/seed/sample-data', { method: 'POST' }),
  removeSampleData: () => api<{ ok: boolean; removed: number }>('/seed/sample-data', { method: 'DELETE' }),
};
