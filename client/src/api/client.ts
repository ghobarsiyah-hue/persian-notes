/**
 * Thin fetch wrapper for the REST API.
 * - attaches the JWT token
 * - maps HTTP errors to Persian messages
 * - fires `pn:offline` / `pn:online` events so the UI can react to network loss
 */

const TOKEN_KEY = 'pn_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiRequestError extends Error {
  status: number;
  offline: boolean;
  /** server JSON body (e.g. a 409 carries `code:'revision_conflict'` + the
   *  server's current `revision` so the client can reconcile + retry) */
  payload?: Record<string, unknown>;
  constructor(message: string, status = 0, offline = false, payload?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.offline = offline;
    this.payload = payload;
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal; silent401?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    window.dispatchEvent(new CustomEvent('pn:offline'));
    throw new ApiRequestError('اتصال به سرور برقرار نشد. تغییرات به‌صورت محلی ذخیره می‌شود.', 0, true);
  }

  window.dispatchEvent(new CustomEvent('pn:online'));

  if (res.status === 401 && !options.silent401) {
    onUnauthorized?.();
    throw new ApiRequestError('نشست شما منقضی شده است. دوباره وارد شوید.', 401);
  }

  if (!res.ok) {
    let message = `خطای سرور (کد ${res.status})`;
    let data: Record<string, unknown> | undefined;
    try {
      data = await res.json();
      if (typeof data?.error === 'string') message = data.error;
    } catch {
      /* ignore */
    }
    throw new ApiRequestError(message, res.status, false, data);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
