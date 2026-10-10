'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { MILESTONE_STATUS, dayLabel, dayNum, fmtD, fmtMon, fmtT, inr } from '@bos/shared';
import { useAct, useApp, useQ } from '@/lib/app';
import { isPast, projStats } from '@/lib/domain';
import type { Meeting, Project, Quote, Task } from '@/lib/types';
import { Avatar, Back, Badge, Btn, Card, CardHead, Icon, Metric, Metrics, PageHead } from '@/components/ui';
import { ProjectTaskRow } from '@/components/task-row';
import { useOpenNewMeeting } from '@/components/dialogs';
import { askAssistant } from '@/components/assistant';
import { MilestoneDialog, ProjectDialog } from '@/components/forms';
import type { Milestone } from '@/lib/types';

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>(); const router = useRouter(); const act = useAct();
  const { me, today, now, can, has, setUi, person, people } = useApp();
  const p = useQ<Project[]>('projects').data?.find(x => x.id === id);
  const tasks = useQ<Task[]>(can('tasks') ? 'tasks' : null).data || [];
  const meetings = useQ<Meeting[]>('meetings').data || [];
  const quotes = useQ<Quote[]>(can('sales') ? 'quotes' : null).data || [];
  const newMeeting = useOpenNewMeeting();
  const [editing, setEditing] = useState(false); const [ms, setMs] = useState<Milestone | 'new' | null>(null);
  if (!p) return <p style={{ color: '#64748b' }}>Loading…</p>;
  const st = projStats(p);
  const pTasks = tasks.filter(t => t.projectId === p.id && t.status !== 'done').sort((a, b) => a.due.localeCompare(b.due));
  const ready = p.milestones.filter(m => m.status === 'COMPLETED');
  const memberIds = [p.ownerId, ...new Set(tasks.filter(t => t.projectId === p.id).map(t => t.assigneeId).filter(a => a !== p.ownerId))];
  const activity = [...p.milestones].reverse().filter(m => ['COMPLETED', 'INVOICED', 'PAID'].includes(m.status)).map(m => ({
    icon: m.status === 'PAID' ? 'icon-wallet' : m.status === 'INVOICED' ? 'icon-file-text' : 'icon-circle-check',
    text: m.status === 'PAID' ? `Payment received for ${m.name}` : m.status === 'INVOICED' ? `Invoice raised for ${m.name}` : `${m.name} marked complete`,
    when: m.changedAt ? dayLabel(m.changedAt.slice(0, 10), today) : fmtD(m.due < today ? m.due : today),
  }));
  activity.push({ icon: 'icon-folder-plus', text: p.quoteId ? `Project created from quotation ${quotes.find(q => q.id === p.quoteId)?.no || ''}`.trim() : 'Project created', when: fmtD(p.createdAt.slice(0, 10)) });
  const pm = meetings.filter(m => m.projectId === p.id).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const summarise = () => { setUi({ aiOpen: true }); setTimeout(() => askAssistant('summary', 'Summarise this project'), 50); };
  void people;

  return <>
    <Back label="Projects" onClick={() => router.push('/projects')} />
    <PageHead title={p.name} badge={<Badge tone={p.status === 'ON_HOLD' ? 'warning' : 'success'} dot>{p.status === 'ON_HOLD' ? 'On hold' : 'Active'}</Badge>}
      sub={<>For {p.customer}, reference <span className="mono" style={{ fontSize: 14 }}>{p.code}</span> · {p.bu}</>}
      right={<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{has('project.update') && <Btn icon="pencil" onClick={() => setEditing(true)}>Edit</Btn>}{can('ai') && <Btn icon="sparkles" onClick={summarise}>Summarise</Btn>}</div>} />
    {editing && <ProjectDialog project={p} onClose={() => setEditing(false)} />}
    {ms && <MilestoneDialog project={p} milestone={ms === 'new' ? undefined : ms} onClose={() => setMs(null)} />}
    <Metrics>
      <Metric label="Contract value" value={inr(p.contract)} /><Metric label="Invoiced" value={inr(st.inv)} /><Metric label="Collected" value={inr(st.paid)} /><Metric label="Left to bill" value={inr(p.contract - st.inv)} />
    </Metrics>
    {ready.length > 0 && (
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '12px 16px', borderRadius: 12, background: '#eef4ff', border: '1px solid rgba(0,82,255,.15)' }}>
        <Icon name="receipt" size={18} style={{ color: '#0052ff' }} />
        <p style={{ margin: 0, flex: '1 1 240px', fontSize: 14 }}><strong style={{ fontWeight: 600 }}>{ready.map(m => m.name).join(', ')} is complete — {inr(ready.reduce((a, m) => a + m.value, 0))} ready to bill.</strong> Raise its invoice to start the approval.</p>
      </div>
    )}
    <Card>
      <CardHead title="Milestones" sub="Complete a milestone to make it billable, then raise its invoice." right={has('project.update') && <Btn size="sm" icon="plus" onClick={() => setMs('new')} style={{ boxShadow: 'none' }}>Add milestone</Btn>} />
      {p.milestones.map((m, i) => { const [label, tone, solid] = MILESTONE_STATUS[m.status];
        return (
          <div key={m.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 20px', padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
            <span className="num" style={{ width: 20, color: '#94a3b8', fontSize: 14 }}>{i + 1}</span>
            <div style={{ flex: '1 1 200px', minWidth: 0 }}><p style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>{m.name}</p><p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>{m.pct}% of contract · due {fmtD(m.due)}</p></div>
            <Badge tone={tone} solid={solid} dot={!solid}>{label}</Badge>
            <span className="num" style={{ width: 110, textAlign: 'right', fontSize: 15, fontWeight: 500 }}>{inr(m.value)}</span>
            <div style={{ width: 190, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              {has('project.update') && <button onClick={() => setMs(m)} title="Edit milestone" aria-label={`Edit ${m.name}`} className="outline-blue" style={{ width: 34, height: 34, flex: 'none', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="pencil" size={14} /></button>}
              {(m.status === 'IN_PROGRESS' || m.status === 'PENDING') && has('project.update') && <Btn size="sm" icon="circle-check" onClick={() => act(`projects/${p.id}/milestones/${m.id}/complete`)} style={{ boxShadow: 'none' }}>Complete</Btn>}
              {m.status === 'COMPLETED' && has('invoice.create') && <Btn size="sm" kind="pri" icon="file-text" onClick={async () => { const r = await act(`projects/${p.id}/milestones/${m.id}/bill`); if (r?.invoiceId) router.push(`/invoices/${r.invoiceId}`); }}>Raise invoice</Btn>}
            </div>
          </div>
        ); })}
    </Card>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,400px),1fr))', gap: 20, alignItems: 'start' }}>
      {can('tasks') && <Card>
        <CardHead title="Open tasks" count={pTasks.length} sub={!has('task.read_all') && p.ownerId !== me.user.id ? 'Your tasks on this project. The project owner sees them all.' : undefined} right={has('task.create') && <Btn size="sm" icon="plus" onClick={() => setUi({ newTask: { projectId: p.id } })} style={{ boxShadow: 'none' }}>Add task</Btn>} />
        {pTasks.map(t => <ProjectTaskRow key={t.id} t={t} />)}
        {!pTasks.length && <p style={{ margin: 0, padding: 20, fontSize: 14, color: '#64748b' }}>No open tasks.</p>}
      </Card>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Card>
          <CardHead title="Meetings" right={<Btn size="sm" icon="calendar-plus" onClick={() => newMeeting(p.id)} style={{ boxShadow: 'none' }}>Schedule</Btn>} />
          {pm.map(m => { const ps = isPast(m, today, now);
            return (
              <button key={m.id} onClick={() => setUi({ meetId: m.id })} className="row-btn" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px' }}>
                <div style={{ width: 40, flex: 'none', textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' }}>{fmtMon(m.date)}</p>
                  <p className="num" style={{ margin: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.1 }}>{dayNum(m.date)}</p>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{m.title}</p><p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>{dayLabel(m.date, today)} · {fmtT(m.start)} · {m.loc}</p></div>
                <Badge tone={ps ? 'neutral' : 'primary'}>{ps ? (m.notes ? 'Notes' : 'Ended') : m.date === today ? 'Today' : 'Upcoming'}</Badge>
              </button>
            ); })}
          {!pm.length && <p style={{ margin: 0, padding: 20, fontSize: 14, color: '#64748b' }}>No meetings for this project yet.</p>}
        </Card>
        {can('tasks') && <Card>
          <CardHead title="People" sub="Open tasks across all projects." />
          {memberIds.map(uid => { const u = person(uid); const n = tasks.filter(t => t.assigneeId === uid && t.status !== 'done').length;
            return (
              <div key={uid} onClick={() => router.push(`/team/${uid}`)} className="hov-row" role="link" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', cursor: 'pointer' }}>
                <Avatar name={u.name} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{u.name}</p><p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{uid === p.ownerId ? 'Project owner' : u.title}</p></div>
                <div style={{ width: 96 }}>
                  <div style={{ height: 6, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}><div style={{ height: '100%', width: Math.min(100, n / 7 * 100) + '%', borderRadius: 999, background: n >= 6 ? '#be123c' : n >= 4 ? '#b45309' : '#047857' }} /></div>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b', textAlign: 'right' }}>{n} open</p>
                </div>
              </div>
            ); })}
        </Card>}
        <Card>
          <CardHead title="Activity" />
          <div style={{ padding: '8px 20px 12px' }}>
            {activity.map((ev, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 0' }}>
                <Icon name={ev.icon} size={16} style={{ color: '#94a3b8', marginTop: 2 }} />
                <div><p style={{ margin: 0, fontSize: 14 }}>{ev.text}</p><p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>{ev.when}</p></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  </>;
}
