import { useAuth, getToken } from '../stores/auth';
import { getActiveAgency } from '../stores/agency';
import type { ApiErrorBody, AuthResponse } from '../types/api';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: { formErrors: string[]; fieldErrors: Record<string, string[]> }) {
    super(message);
  }
  /** Premier message d'erreur d'un champ (validation Zod). */
  field(name: string) { return this.details?.fieldErrors?.[name]?.[0]; }
}
export const errMsg = (e: unknown, fallback = 'Une erreur est survenue') => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : fallback);

type Query = Record<string, string | number | boolean | undefined | null>;
interface Opts { body?: unknown; form?: FormData; query?: Query; signal?: AbortSignal; headers?: Record<string, string>; noAuth?: boolean }

export const qs = (q?: Query) => {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ───────────── Refresh « single-flight » ─────────────
// Le refresh token tourne à chaque appel : rejouer le même cookie révoque toute la session (REFRESH_REUSED).
// Une seule promesse partagée dans l'onglet + un verrou Web Locks entre onglets.
let inflight: Promise<boolean> | null = null;
async function doRefresh(): Promise<boolean> {
  const run = async () => {
    const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!res.ok) return false;
    const data = (await res.json()) as AuthResponse;
    useAuth.getState().setSession(data.accessToken, data.user);
    return true;
  };
  try {
    return navigator.locks ? await navigator.locks.request('teledesk-refresh', run) : await run();
  } catch { return false; }
}
export function refreshSession(): Promise<boolean> {
  inflight ??= doRefresh().finally(() => { inflight = null; });
  return inflight;
}

async function parse(res: Response) {
  const text = await res.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

export async function api<T = unknown>(method: string, path: string, opts: Opts = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const token = getToken();
  if (token && !opts.noAuth) { headers.authorization = `Bearer ${token}`; const ag = getActiveAgency(); if (ag) headers['x-agency-id'] = ag; }
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const res = await fetch(`/api${path}${qs(opts.query)}`, { method, headers, body, signal: opts.signal, credentials: path.startsWith('/auth') ? 'include' : 'same-origin' });
  const data = (await parse(res)) as T & Partial<ApiErrorBody>;
  if (res.ok) return data as T;
  const err = data.error;
  if (res.status === 401 && err?.code === 'UNAUTHORIZED' && !retried && !opts.noAuth && !path.startsWith('/auth/login')) {
    if (await refreshSession()) return api<T>(method, path, opts, true);
    useAuth.getState().clear();
  }
  throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? `Erreur ${res.status}`, err?.details);
}
export const get = <T>(path: string, query?: Query, signal?: AbortSignal) => api<T>('GET', path, { query, signal });
export const post = <T>(path: string, body?: unknown, headers?: Record<string, string>) => api<T>('POST', path, { body, headers });
export const patch = <T>(path: string, body?: unknown) => api<T>('PATCH', path, { body });
export const del = <T>(path: string, body?: unknown) => api<T>('DELETE', path, { body });

/** Upload multipart avec progression (fetch ne sait pas la mesurer → XMLHttpRequest). */
export function upload<T>(path: string, form: FormData, onProgress?: (pct: number) => void, retried = false): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    const token = getToken();
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    const ag = getActiveAgency(); if (ag) xhr.setRequestHeader('x-agency-id', ag);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'Connexion impossible'));
    xhr.onload = async () => {
      let data: any = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* corps vide */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data as T);
      if (xhr.status === 401 && !retried && (await refreshSession())) return upload<T>(path, form, onProgress, true).then(resolve, reject);
      reject(new ApiError(xhr.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? `Erreur ${xhr.status}`, data?.error?.details));
    };
    xhr.send(form);
  });
}
