'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { ini, MOD_PERM, AREA_MODULE, nowHours, todayISO } from '@bos/shared';
import { api, ApiError } from './api';
import type { Me, Person, Role } from './types';

/** UI state shared across screens: overlays, dialogs, assistant, toast, role preview. */
export interface Ui {
  taskId: string | null; meetId: string | null;
  meetDialog: MeetDraft | null; newTask: { projectId: string } | null; customer: string | null; search: boolean;
  pay: string | null; credit: string | null; aiOpen: boolean | null; notifOpen: boolean; viewAs: string | null;
}
export interface MeetDraft { id?: string; title: string; p: string; date: string; start: string; dur: string; who: string[]; guests: string[]; loc: string; link: string }

interface Ctx {
  me: Me; people: Map<string, Person>; person: (id?: string | null) => Person;
  today: string; now: number; width: number; isMobile: boolean; wide: boolean;
  ui: Ui; setUi: (patch: Partial<Ui> | ((u: Ui) => Partial<Ui>)) => void;
  toast: (msg: string) => void; toastMsg: string;
  has: (perm: string) => boolean; can: (mod: string | null) => boolean; ownHas: (perm: string) => boolean;
  previewRoles: Role[]; first: string;
}
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(AppCtx); if (!c) throw new Error('useApp outside provider'); return c; };

const unknown: Person = { id: '', name: 'Unknown', title: '', role: '', email: '', status: '' };

function useWidth() {
  const [w, setW] = useState(1400);
  useEffect(() => { const on = () => setW(window.innerWidth); on(); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  return w;
}

export function useQ<T>(path: string | null, enabled = true) {
  return useQuery<T>({ queryKey: [path], queryFn: () => api<T>(path!), enabled: !!path && enabled, staleTime: 15_000 });
}

/** Runs a mutation, shows the server's message as a toast and refreshes every query. */
export function useAct() {
  const qc = useQueryClient(); const { toast } = useApp();
  return useCallback(async <T = any,>(path: string, body: unknown = {}, opts: { method?: string; quiet?: boolean; msg?: string } = {}): Promise<T | null> => {
    try {
      const r = await api<T>(path, { method: opts.method || 'POST', body });
      const m = opts.msg ?? (r as any)?.message;
      if (m && !opts.quiet) toast(m);
      await qc.invalidateQueries();
      return r;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
      return null;
    }
  }, [qc, toast]);
}

function Inner({ children }: { children: ReactNode }) {
  const meQ = useQ<Me>('auth/me');
  const peopleQ = useQ<Person[]>('people');
  const me = meQ.data;
  const admin = !!me && ['settings.manage', 'role.manage'].some(p => me.user.perms.includes(p));
  const rolesQ = useQ<{ roles: Role[] }>(admin ? 'settings' : null);
  const width = useWidth();
  const [ui, setUiState] = useState<Ui>({ taskId: null, meetId: null, meetDialog: null, newTask: null, customer: null, search: false, pay: null, credit: null, aiOpen: null, notifOpen: false, viewAs: null });
  const setUi = useCallback((p: Partial<Ui> | ((u: Ui) => Partial<Ui>)) => setUiState(u => ({ ...u, ...(typeof p === 'function' ? p(u) : p) })), []);
  const [toastMsg, setToast] = useState(''); const tt = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = useCallback((m: string) => { clearTimeout(tt.current); setToast(m); tt.current = setTimeout(() => setToast(''), 2800); }, []);
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 60_000); return () => clearInterval(t); }, []);

  const value = useMemo<Ctx | null>(() => {
    if (!me) return null;
    const tz = me.org.tz;
    const people = new Map((peopleQ.data || []).map(p => [p.id, p]));
    const previewRoles = (rolesQ.data?.roles || []).filter(r => !r.builtIn);
    const viewRole = ui.viewAs ? previewRoles.find(r => r.name === ui.viewAs) : null;
    const perms = new Set(viewRole ? viewRole.perms : me.user.perms);
    const modOn = (m: string | null | undefined) => !m || me.user.modules[m] !== false;
    const has = (p: string) => perms.has(p) && modOn(AREA_MODULE[p.split('.')[0]]);
    const ownHas = (p: string) => me.user.perms.includes(p) && modOn(AREA_MODULE[p.split('.')[0]]);
    return {
      me, people, person: (id?: string | null) => (id && people.get(id)) || unknown,
      today: todayISO(tz), now: nowHours(tz), width, isMobile: width < 760, wide: width >= 1200,
      ui, setUi, toast, toastMsg, has, ownHas, can: (m: string | null) => !m || (modOn(m) && has(MOD_PERM[m])), previewRoles, first: me.user.name.split(' ')[0],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, peopleQ.data, rolesQ.data, ui, width, toastMsg, tick, setUi, toast]);

  if (meQ.isError) return null;
  if (!value) return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 14 }}>Loading…</div>;
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: true } } }));
  return <QueryClientProvider client={qc}><Inner>{children}</Inner></QueryClientProvider>;
}

export const nameOf = (p: Person, meId: string) => (p.id === meId ? 'You' : p.name);
export { ini };
