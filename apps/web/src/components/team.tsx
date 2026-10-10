'use client';
import { CSSProperties, ReactNode, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useApp, useQ } from '@/lib/app';
import type { Profile, TeamMember } from '@/lib/types';
import { Btn, Dialog } from './ui';

export const STATUS_COLOR: Record<TeamMember['status'], string> = { available: '#047857', meeting: '#0052ff', leave: '#b45309' };
export const STATUS_TONE = { available: 'success', meeting: 'primary', leave: 'warning' } as const;
const initials = (n: string) => n.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();

/** Round initials with the availability dot, as on the org chart and directory. */
export function Face({ name, src, status, size = 36, accent }: { name: string; src?: string | null; status?: TeamMember['status']; size?: number; accent?: boolean }) {
  return (
    <span style={{ position: 'relative', width: size, height: size, flex: 'none', borderRadius: 999, background: accent ? '#eef4ff' : '#f1f5f9', color: accent ? '#0052ff' : size <= 30 ? '#64748b' : '#475569',
      fontSize: size >= 40 ? 14 : size <= 30 ? 11 : 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {src ? <img src={src} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: 999, objectFit: 'cover' }} /> : initials(name)}
      {status && <span aria-hidden="true" style={{ position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRadius: 999, background: STATUS_COLOR[status], border: '2px solid #fff' }} />}
    </span>
  );
}

/** A colleague's name that opens their profile. */
export function PersonLink({ id, children, style }: { id: string; children: ReactNode; style?: CSSProperties }) {
  const router = useRouter();
  return <button onClick={e => { e.stopPropagation(); router.push(`/team/${id}`); }} className="person-link" style={{ border: 0, background: 'none', padding: 0, fontSize: 14, color: '#0052ff', cursor: 'pointer', textAlign: 'left', ...style }}>{children}</button>;
}

/** Edit a profile. You change your own contact details and leave; admins (user.manage) also set title, team, manager and joining date. */
export function ProfileDialog({ p, onClose }: { p: Profile; onClose: () => void }) {
  const qc = useQueryClient(); const { toast } = useApp();
  const team = useQ<TeamMember[]>(p.canManage ? 'team' : null).data || [];
  const [f, setF] = useState({ name: p.name, title: p.title, dept: p.dept, managerId: p.manager?.id || '', joined: p.joined, phone: p.phone, location: p.location, hours: p.hours, leaveUntil: p.leaveUntil });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  const depts = [...new Set(team.map(t => t.dept).filter(Boolean))].sort();
  const submit = async () => {
    setBusy(true); setErr('');
    const body: Record<string, string> = { phone: f.phone, location: f.location, hours: f.hours, leaveUntil: f.leaveUntil };
    if (p.canManage) Object.assign(body, { title: f.title, dept: f.dept, managerId: f.managerId, joined: f.joined });
    try {
      // Your own name is yours to change; an admin changes others' in Settings → Users.
      if (p.isMe && f.name.trim() !== p.name) await api('me/profile', { method: 'PATCH', body: { name: f.name } });
      const r = await api<{ message: string }>(`team/${p.id}`, { method: 'PATCH', body }); await qc.invalidateQueries(); toast(r.message); onClose();
    }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Something went wrong.'); setBusy(false); }
  };
  const grid = { padding: '18px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 } as const;
  return (
    <Dialog width={560} title={p.isMe ? 'Edit your profile' : `Edit ${p.name}`} sub={p.canManage ? undefined : 'Your title, team and manager are set by an admin.'} onClose={onClose}
      footer={<><Btn onClick={onClose} style={{ boxShadow: 'none' }}>Cancel</Btn><Btn kind="pri" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
      <div style={grid}>
        {p.isMe && <label className="label" style={{ gridColumn: '1/-1' }}>Your name<input className="input" value={f.name} onChange={set('name')} /></label>}
        {p.canManage && <>
          <label className="label">Job title<input className="input" autoFocus value={f.title} onChange={set('title')} /></label>
          <label className="label">Team<input className="input" list="team-depts" value={f.dept} onChange={set('dept')} placeholder="e.g. Delivery" /><datalist id="team-depts">{depts.map(x => <option key={x} value={x} />)}</datalist></label>
          <label className="label">Reports to<select className="select" value={f.managerId} onChange={set('managerId')}>
            <option value="">No one (top of the chart)</option>
            {team.filter(t => t.id !== p.id).map(t => <option key={t.id} value={t.id}>{t.name}{t.title ? ` — ${t.title}` : ''}</option>)}
          </select></label>
          <label className="label">Joined<input className="input" type="date" value={f.joined} onChange={set('joined')} /></label>
        </>}
        <label className="label">Phone<input className="input" type="tel" autoFocus={!p.canManage} value={f.phone} onChange={set('phone')} placeholder="+91 98000 00000" /></label>
        <label className="label">Location<input className="input" value={f.location} onChange={set('location')} placeholder="e.g. Mumbai" /></label>
        <label className="label">Working hours<input className="input" value={f.hours} onChange={set('hours')} placeholder="9:30 am – 6:30 pm" /></label>
        <label className="label">On leave until<input className="input" type="date" value={f.leaveUntil} onChange={set('leaveUntil')} />
          <span className="hint">{f.leaveUntil ? <button type="button" className="link" style={{ padding: 0, fontSize: 13 }} onClick={() => setF({ ...f, leaveUntil: '' })}>Clear — back at work</button> : 'Leave blank when at work.'}</span>
        </label>
        {err && <p style={{ gridColumn: '1/-1', margin: 0, fontSize: 14, color: '#be123c' }}>{err}</p>}
      </div>
    </Dialog>
  );
}
