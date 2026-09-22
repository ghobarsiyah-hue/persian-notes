/**
 * User Notification service — the ONE notification system.
 *
 * Two layers, deliberately separate (§7/§8):
 *   1. transient Toasts   — the EXISTING AppProvider toast pipeline,
 *                           initialized once via `initNotifier`. Nothing
 *                           new is rendered for these.
 *   2. persistent rows    — the server-backed inbox (Notification model +
 *                           /api/notifications), for events worth keeping:
 *                           restore events, future share/mention/invite.
 *                           Autosave success NEVER becomes a persistent
 *                           notification — it is a save-state transition.
 *
 * The service NEVER throws into its caller: a failed notification must not
 * break a save (§19). Mirrors every notification it emits onto the user
 * event bus so future activity feeds can consume them without a rewrite.
 */

import type { AppNotification, NotificationSeverity } from '@/types';
import { api } from '@/api/client';
import { emitUserEvent } from '@/events/userEvents';

interface ToastSink {
  (message: string, kind?: 'success' | 'error' | 'info' | 'warning', dedupeKey?: string): void;
}

export interface Notifier {
  /** transient toast (auto-dismisses; deduped by the provider) */
  toast: (message: string, severity?: NotificationSeverity, dedupeKey?: string) => void;
  /** persist an inbox row for the current user (best-effort) */
  notify: (input: { type: string; title: string; message?: string; severity?: NotificationSeverity; metadata?: Record<string, unknown>; expiresInMs?: number }) => Promise<AppNotification | null>;
  /** refresh the inbox from the server */
  list: () => Promise<{ notifications: AppNotification[]; unread: number }>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

interface NotifierState {
  toasts: ToastSink | null;
  user: () => string | null;
  /** cache of the last inbox fetch — consumers (future inbox UI) can read
   *  without refetching; kept minimal by design */
  cache: { notifications: AppNotification[]; unread: number; at: number } | null;
}

const state: NotifierState = { toasts: null, user: () => null, cache: null };

/** wire the service to the EXISTING toast pipeline + authenticated user —
 *  called once from AppProvider (not per render, not per keystroke) */
export function initNotifier(toasts: ToastSink, getUser: () => string | null): void {
  state.toasts = toasts;
  state.user = getUser;
}

function shutdownNotifier(): void {
  state.toasts = null;
  state.user = () => null;
  state.cache = null;
}

const SEVERITY_TO_TOAST: Record<NotificationSeverity, 'success' | 'error' | 'info' | 'warning'> = {
  success: 'success',
  info: 'info',
  warning: 'warning',
  error: 'error',
};

/** transient toast + optional persistence in one call.
 *  `persist: false` (default) = pure toast, no server round-trip. */
export async function notifyUser(
  input: {
    type: string;
    title: string;
    message?: string;
    severity?: NotificationSeverity;
    persist?: boolean;
    metadata?: Record<string, unknown>;
    expiresInMs?: number;
  }
): Promise<AppNotification | null> {
  const severity = input.severity ?? 'info';
  try {
    state.toasts?.(input.title, SEVERITY_TO_TOAST[severity], `ntf|${input.type}|${input.title}`);
  } catch {
    /* toast sink failures are non-fatal */
  }
  emitUserEvent(input.type as never, {
    targetType: 'system',
    metadata: { severity, title: input.title, ...(input.metadata ?? {}) },
  });
  if (!input.persist) return null;
  try {
    const res = await api<{ notification: AppNotification }>('/notifications', {
      method: 'POST',
      body: {
        type: input.type,
        title: input.title,
        message: input.message ?? '',
        severity,
        ...(input.metadata ? { metadata: input.metadata } : {}),
        ...(input.expiresInMs ? { expiresAt: new Date(Date.now() + input.expiresInMs).toISOString() } : {}),
      },
    });
    return res.notification;
  } catch {
    /* a failed notification must never break the save/editor (§19) */
    return null;
  }
}

/** inbox API — typed wrappers over /api/notifications (user-scoped
 *  server-side; the client never passes a userId) */
export const notifier: Notifier = {
  toast: (message, severity = 'info', dedupeKey) => {
    try {
      state.toasts?.(message, SEVERITY_TO_TOAST[severity], dedupeKey);
    } catch {
      /* non-fatal */
    }
  },
  notify: (input) => notifyUser({ ...input, persist: true }),
  list: async () => {
    const res = await api<{ notifications: AppNotification[]; unread: number }>('/notifications');
    state.cache = { ...res, at: Date.now() };
    return res;
  },
  markRead: async (id) => {
    await api(`/notifications/${id}/read`, { method: 'PATCH' });
  },
  markAllRead: async () => {
    await api('/notifications/read-all', { method: 'POST' });
  },
  remove: async (id) => {
    await api(`/notifications/${id}`, { method: 'DELETE' });
  },
};

/** exported for logout — the next user must not inherit sinks/cache */
export { shutdownNotifier };
