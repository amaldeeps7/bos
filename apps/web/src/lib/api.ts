// Thin client for the Business OS API. Requests go through Next's /api rewrite so the session cookie is first-party.
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch('/api/' + path.replace(/^\//, ''), {
    method: init.method || (init.body !== undefined ? 'POST' : 'GET'),
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'include',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('. ') : data?.message || res.statusText;
    if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) location.href = data?.code === 'mfa_required' ? '/login?reason=2fa' : '/login';
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

/** Signs out this device (the session ends on the server too) and goes to the sign-in page. */
export async function signOut() {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch { /* signed out locally anyway */ }
  location.href = '/login';
}
