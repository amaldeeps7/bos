'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fmtMonYear } from '@bos/shared';
import { useAct, useApp, useQ } from '@/lib/app';
import type { Profile } from '@/lib/types';
import { Back, Badge, Btn, Card, CardHead, Icon, Switch } from '@/components/ui';
import { useOpenNewMeeting } from '@/components/dialogs';
import { Face, PersonLink, ProfileDialog, STATUS_TONE } from '@/components/team';
import { MfaCard } from '@/components/mfa';

const tzShort = (tz: string) => { try { return new Intl.DateTimeFormat('en-IN', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || ''; } catch { return ''; } };
const PREFS = [['remind', 'Meeting reminders', '10 minutes before, with the join link'], ['mention', 'Comments and mentions', 'When someone comments on your tasks'], ['digest', 'Daily digest', 'Your day at 8:30 am: meetings, due tasks, approvals']] as const;

export default function PersonPage() {
  const { id } = useParams<{ id: string }>(); const router = useRouter(); const act = useAct();
  const { me, can, has, setUi } = useApp();
  const q = useQ<Profile>(`team/${id}`); const p = q.data;
  const newMeeting = useOpenNewMeeting();
  const [editing, setEditing] = useState(false);
  if (q.isError) return <><Back label="Team" onClick={() => router.push('/team')} /><p style={{ color: '#64748b' }}>That person isn’t in the team directory.</p></>;
  if (!p) return <p style={{ color: '#64748b' }}>Loading…</p>;

  const canAssign = can('tasks') && has('task.create');
  const tz = tzShort(me.org.tz);
  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/login'; };
  const field = (label: string, value: React.ReactNode) => (
    <div><p style={{ margin: 0, fontSize: 12.5, color: '#64748b' }}>{label}</p><div style={{ margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div></div>
  );
  const empty = <span style={{ color: '#64748b' }}>—</span>;

  return (
    <>
      <Back label="Team" onClick={() => router.push('/team')} />
      <Card style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '16px 20px' }}>
          <span style={{ width: 64, height: 64, flex: 'none', borderRadius: 999, background: '#eef4ff', color: '#0052ff', fontSize: 22, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{p.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>{p.name}</h1>
              <Badge tone={STATUS_TONE[p.status]}>{p.statusText}</Badge>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 15, color: '#475569' }}>{[p.title, p.dept].filter(Boolean).join(' · ')}</p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {p.canEdit && <Btn icon="pencil" onClick={() => setEditing(true)}>{p.isMe ? 'Edit profile' : 'Edit'}</Btn>}
            {!p.isMe && <Btn icon="calendar-plus" onClick={() => newMeeting('', p.id)}>Schedule meeting</Btn>}
            {canAssign && <Btn kind="pri" icon="plus" onClick={() => setUi({ newTask: { projectId: p.projects[0]?.id || '', assigneeId: p.id } })}>{p.isMe ? 'New task' : 'Assign task'}</Btn>}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', gap: '14px 24px', paddingTop: 16, borderTop: '1px solid #f1f5f9', fontSize: 14 }}>
          {field('Email', <a href={`mailto:${p.email}`} style={{ color: 'inherit', textDecoration: 'none' }}>{p.email}</a>)}
          {field('Phone', p.phone ? <a href={`tel:${p.phone.replace(/\s/g, '')}`} style={{ color: 'inherit', textDecoration: 'none' }}>{p.phone}</a> : empty)}
          {field('Working hours', p.hours ? `${p.hours}${tz && !/[A-Z]{2,}$/.test(p.hours) ? ' ' + tz : ''}` : empty)}
          {field('Location', [p.location, p.joined && `joined ${fmtMonYear(p.joined)}`].filter(Boolean).join(' · ') || empty)}
          {field('Reports to', p.manager ? <PersonLink id={p.manager.id} style={{ marginTop: 2 }}>{p.manager.name}</PersonLink> : empty)}
          {p.reports.length > 0 && field('Direct reports', <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>{p.reports.map(r => <PersonLink key={r.id} id={r.id}>{r.name}</PersonLink>)}</div>)}
        </div>
      </Card>

      {p.projects.length > 0 && (
        <Card>
          <CardHead title="Projects" />
          {p.projects.map(pr => (
            <button key={pr.id} onClick={() => router.push(`/projects/${pr.id}`)} className="row-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px' }}>
              <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{pr.name}</span><span style={{ display: 'block', fontSize: 13, color: '#64748b' }}>{pr.customer}</span></span>
              <span style={{ fontSize: 13, color: '#64748b', whiteSpace: 'nowrap' }}>{pr.open ? `${pr.open} open` : ''}</span>
            </button>
          ))}
        </Card>
      )}

      {p.isMe && p.prefs && (
        <Card>
          <CardHead title="Your settings" sub="Only you see this section." />
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px', padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ width: 40, height: 40, flex: 'none', borderRadius: 10, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0052ff' }}><Icon name="calendar" size={18} /></span>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Calendar</p>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>{p.calendar ? `Connected · meeting invites arrive at ${p.email} as calendar events (Google Calendar, Outlook, Apple)` : 'Not connected. Meetings won’t be sent to your calendar.'}</p>
            </div>
            <Btn onClick={() => act('me/prefs', { calendar: !p.calendar }, { method: 'PATCH' })}>{p.calendar ? 'Disconnect' : 'Connect'}</Btn>
          </div>
          {PREFS.map(([k, label, sub]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{label}</p><p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>{sub}</p></div>
              <Switch on={p.prefs![k]} label={label} onClick={() => act('me/prefs', { [k]: !p.prefs![k] }, { method: 'PATCH', quiet: true })} />
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px' }}>
            <p style={{ margin: 0, fontSize: 14, color: '#64748b' }}>Signed in as {me.user.email}</p>
            <Btn icon="log-out" onClick={logout}>Sign out</Btn>
          </div>
        </Card>
      )}

      {p.isMe && <MfaCard />}

      {editing && <ProfileDialog p={p} onClose={() => setEditing(false)} />}
    </>
  );
}
