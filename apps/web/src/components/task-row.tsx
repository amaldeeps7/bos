'use client';
import { TASK_STATUS, fmtT } from '@bos/shared';
import { useRouter } from 'next/navigation';
import { useAct, useApp } from '@/lib/app';
import { dueInfo } from '@/lib/domain';
import type { Project, Task } from '@/lib/types';
import { Avatar, Badge, Icon, TONES, badgeStyle } from './ui';

const checkStyle = (done: boolean) => ({ width: 20, height: 20, flex: 'none' as const, marginTop: 1, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: done ? '1px solid #0052ff' : '1.5px solid #cbd5e1', background: done ? '#0052ff' : '#fff', color: '#fff' });
const titleStyle = (done: boolean) => ({ margin: 0, cursor: 'pointer', fontSize: 15, fontWeight: 500, color: done ? '#94a3b8' : '#0f172a', textDecoration: done ? 'line-through' : 'none' });
const prioTone = (p: string) => (p === 'High' ? 'danger' : p === 'Medium' ? 'warning' : 'neutral');

export function useTaskActions() {
  const act = useAct(); const { setUi } = useApp();
  return {
    toggle: (t: Task) => act(`tasks/${t.id}`, { status: t.status === 'done' ? 'todo' : 'done' }, { method: 'PATCH', quiet: true }),
    open: (t: Task) => setUi({ taskId: t.id, meetId: null }),
    plan: (t: Task) => act(`tasks/${t.id}/plan`),
  };
}

/** The compact row used by Focus today (My Work). */
export function FocusRow({ t, p }: { t: Task; p?: Project }) {
  const { today } = useApp(); const router = useRouter(); const a = useTaskActions();
  const done = t.status === 'done'; const d = dueInfo(t, today);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
      <button onClick={() => a.toggle(t)} aria-label="Mark done" style={checkStyle(done)}>{done && <Icon name="check" size={13} />}</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p onClick={() => a.open(t)} style={titleStyle(done)}>{t.title}</p>
        <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}><button className="quiet" onClick={() => router.push(`/projects/${t.projectId}`)}>{p?.name}</button> · {p?.customer}</p>
      </div>
      {t.block && !done && <span title="Time blocked today" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: '#64748b', whiteSpace: 'nowrap', marginTop: 2 }}><Icon name="clock" size={13} />{fmtT(t.block.start)}</span>}
      {!t.block && !done && <button className="outline-blue" onClick={() => a.plan(t)} title="Block an hour for this today" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', fontSize: 12.5, fontWeight: 500, color: '#64748b', cursor: 'pointer', whiteSpace: 'nowrap' }}><Icon name="calendar-plus" size={13} />Plan</button>}
      <span style={d.style}>{d.label}</span>
    </div>
  );
}

/** The full row on the Tasks screen. */
export function TaskListRow({ t, p }: { t: Task; p?: Project }) {
  const { today, person } = useApp(); const router = useRouter(); const a = useTaskActions();
  const done = t.status === 'done'; const d = dueInfo(t, today); const st = TASK_STATUS[t.status];
  const who = person(t.assigneeId); const comments = t.events.filter(e => e.kind === 'comment').length;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: '1 1 280px', minWidth: 0 }}>
        <button onClick={() => a.toggle(t)} aria-label="Toggle done" style={checkStyle(done)}>{done && <Icon name="check" size={13} />}</button>
        <div style={{ minWidth: 0 }}>
          <p onClick={() => a.open(t)} style={titleStyle(done)}>{t.title}</p>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0 6px' }}>
            <span className="mono" style={{ fontSize: 12, color: '#94a3b8' }}>{t.key}</span><span>·</span>
            <button className="quiet" onClick={() => router.push(`/projects/${t.projectId}`)}>{p?.name}</button><span>·</span><span>{p?.customer}</span>
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', marginLeft: 32 }}>
        {['doing', 'review', 'blocked'].includes(t.status) && <Badge tone={st[1]}>{st[0]}</Badge>}
        <button className="quiet" onClick={() => a.open(t)} aria-label="Comments" style={{ display: 'flex', alignItems: 'center', gap: 4, width: 40, color: '#94a3b8' }}><Icon name="message-square" size={14} />{comments}</button>
        <span style={{ ...badgeStyle(prioTone(t.priority) as any), width: 70, justifyContent: 'center' }}>{t.priority}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: 130, fontSize: 14 }}><Avatar name={who.name} src={who.avatar} />{who.name}</span>
        <span style={d.style}>{d.label}</span>
      </div>
    </div>
  );
}

/** The row on a project's Open tasks card. */
export function ProjectTaskRow({ t }: { t: Task }) {
  const { today, person } = useApp(); const a = useTaskActions();
  const done = t.status === 'done'; const d = dueInfo(t, today); const st = TASK_STATUS[t.status];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
      <button onClick={() => a.toggle(t)} aria-label="Toggle done" style={checkStyle(done)}>{done && <Icon name="check" size={13} />}</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p onClick={() => a.open(t)} style={titleStyle(done)}>{t.title}</p>
        <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: '0 6px' }}>
          <span className="mono" style={{ fontSize: 12, color: '#94a3b8' }}>{t.key}</span><span>·</span><span>{person(t.assigneeId).name}</span>
          {['doing', 'review', 'blocked'].includes(t.status) && <><span>·</span><span style={{ color: TONES[st[1]][0], fontWeight: 500 }}>{st[0]}</span></>}
        </p>
      </div>
      <span style={d.style}>{d.label}</span>
    </div>
  );
}
