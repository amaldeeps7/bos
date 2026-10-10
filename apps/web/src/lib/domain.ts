import type { CSSProperties } from 'react';
import { DAYS, diffDays, fmtD, addDays } from '@bos/shared';
import type { Meeting, Project, Task } from './types';

export const MOD_OF_SCREEN: Record<string, string | null> = {
  mywork: null, tasks: 'tasks', meetings: null, approvals: 'approvals', pipeline: 'crm', projects: 'projects', project: 'projects',
  settings: null, team: null, person: null, catalog: 'sales', credits: 'billing', customers: 'crm', customer: 'crm', quotes: 'sales', quote: 'sales',
  invoices: 'billing', invoice: 'billing', payments: 'payments', assets: 'assets', reports: 'reports', qeditor: 'sales', ieditor: 'billing',
};
export const SCREENS: Record<string, { title: string; group: string }> = {
  mywork: { title: 'My Work', group: 'Home' }, tasks: { title: 'Tasks', group: 'Work' }, meetings: { title: 'Meetings', group: 'Work' },
  approvals: { title: 'Approvals', group: 'Work' }, team: { title: 'Team', group: 'Work' }, person: { title: 'Profile', group: 'Work · Team' }, pipeline: { title: 'Pipeline', group: 'Sales' }, projects: { title: 'Projects', group: 'Delivery' },
  project: { title: 'Project', group: 'Delivery' }, settings: { title: 'Settings', group: 'Organisation' }, catalog: { title: 'Catalogue', group: 'Sales' },
  credits: { title: 'Credit notes', group: 'Finance' }, customers: { title: 'Customers', group: 'Sales' }, customer: { title: 'Customer', group: 'Sales · Customers' },
  quotes: { title: 'Quotations', group: 'Sales' }, quote: { title: 'Quotation', group: 'Sales · Quotations' }, invoices: { title: 'Invoices', group: 'Finance' },
  invoice: { title: 'Invoice', group: 'Finance · Invoices' }, payments: { title: 'Payments', group: 'Finance' }, assets: { title: 'Assets', group: 'Delivery' },
  reports: { title: 'Reports', group: 'Insights' }, qeditor: { title: 'Quotation', group: 'Sales · Quotations' }, ieditor: { title: 'Invoice', group: 'Finance · Invoices' },
};

/** Works out which screen a URL shows, and the record id when it has one. */
export function screenOf(path: string): { screen: string; id?: string } {
  const p = path.split('?')[0].split('/').filter(Boolean);
  if (!p.length) return { screen: 'mywork' };
  const [a, b, c] = p;
  const detail: Record<string, string> = { team: 'person', projects: 'project', customers: 'customer', quotes: 'quote', invoices: 'invoice' };
  if (a === 'quotes' && (b === 'new' || c === 'edit')) return { screen: 'qeditor', id: b === 'new' ? undefined : b };
  if (a === 'invoices' && (b === 'new' || c === 'edit')) return { screen: 'ieditor', id: b === 'new' ? undefined : b };
  if (b && detail[a]) return { screen: detail[a], id: b };
  if (a === 'credit-notes') return { screen: 'credits' };
  return { screen: a in SCREENS ? a : 'mywork' };
}

export function dueInfo(t: Task, today: string): { label: string; style: CSSProperties } {
  const o = diffDays(t.due, today); let label: string, color = '#64748b';
  if (t.status === 'done') label = 'Done';
  else if (o < 0) { label = `${-o}d overdue`; color = '#be123c'; }
  else if (o === 0) { label = 'Today'; color = '#b45309'; }
  else if (o === 1) label = 'Tomorrow';
  else if (o < 7) label = DAYS[new Date(t.due + 'T00:00:00Z').getUTCDay()].slice(0, 3);
  else label = fmtD(t.due);
  return { label, style: { fontSize: 13, fontWeight: 500, color, whiteSpace: 'nowrap', width: 84, textAlign: 'right', flex: 'none' } };
}

export function projStats(p: Project) {
  const inv = p.milestones.filter(m => m.status === 'INVOICED' || m.status === 'PAID').reduce((a, m) => a + m.value, 0);
  const paid = p.milestones.filter(m => m.status === 'PAID').reduce((a, m) => a + m.value, 0);
  const done = p.milestones.reduce((a, m) => a + (['COMPLETED', 'INVOICED', 'PAID'].includes(m.status) ? m.value : m.status === 'IN_PROGRESS' ? m.value * 0.5 : 0), 0);
  const pct = Math.round(done / (p.contract || 1) * 100);
  const next = p.milestones.find(m => m.status === 'IN_PROGRESS' || m.status === 'PENDING');
  return { inv, paid, pct, next };
}

export const meetDay = (m: Meeting, today: string) => diffDays(m.date, today);
export const isPast = (m: Meeting, today: string, now: number) => { const d = meetDay(m, today); return d < 0 || (d === 0 && m.start + m.dur <= now); };
export const isNow = (m: Meeting, today: string, now: number) => meetDay(m, today) === 0 && m.start <= now && now < m.start + m.dur;
export const provider = (u: string) => (/meet\.google\./i.test(u) ? 'Google Meet' : /zoom\.us/i.test(u) ? 'Zoom' : /teams\.(microsoft|live)\./i.test(u) ? 'Microsoft Teams' : '');
export const dayOpts = (today: string, n = 14) => Array.from({ length: n }, (_, i) => addDays(today, i));

/** First free half-hour slot today (between meetings and focus blocks) that fits `dur` hours. */
export function findSlot(dur: number, now: number, busy: { start: number; dur: number }[]): number | null {
  for (let h = Math.max(9, Math.ceil(now * 2) / 2); h + dur <= 19; h += 0.5) if (!busy.some(b => h < b.start + b.dur && b.start < h + dur)) return h;
  return null;
}

export const barColor = (h: string) => (h === 'At risk' ? '#be123c' : h === 'On hold' ? '#b45309' : 'linear-gradient(135deg,#0052ff,#4d7cff)');
