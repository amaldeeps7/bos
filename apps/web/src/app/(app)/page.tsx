'use client';
import { useRouter } from 'next/navigation';
import { DAYS, MILESTONE_STATUS, diffDays, dayNum, fmtD, fmtMon, fmtT, hLabel, hm, healthTone, inr } from '@bos/shared';
import { useAct, useApp, useQ } from '@/lib/app';
import { barColor, isNow, projStats } from '@/lib/domain';
import type { Approval, Meeting, Project, Task } from '@/lib/types';
import { Badge, Btn, Card, CardHead, Icon, badgeStyle } from '@/components/ui';
import { FocusRow } from '@/components/task-row';
import { useOpenNewMeeting } from '@/components/dialogs';
import { openLink } from '@/components/overlays';

export default function MyWork() {
  const { me, today, now, can, setUi, first, toast } = useApp(); const router = useRouter(); const act = useAct();
  const tasks = useQ<Task[]>(can('tasks') ? 'tasks' : null).data || [];
  const projects = useQ<Project[]>(can('projects') ? 'projects' : null).data || [];
  const approvals = useQ<Approval[]>(can('approvals') ? 'approvals' : null).data || [];
  const meetings = useQ<Meeting[]>('meetings').data || [];
  const newMeeting = useOpenNewMeeting();
  const pmap = new Map(projects.map(p => [p.id, p]));
  const off = (t: Task) => diffDays(t.due, today);
  const mineOpen = tasks.filter(t => t.assigneeId === me.user.id && t.status !== 'done');
  const dueToday = mineOpen.filter(t => off(t) === 0).length, overdue = mineOpen.filter(t => off(t) < 0).length, upcoming = mineOpen.filter(t => off(t) > 0 && off(t) <= 7).length;
  const doneWeek = tasks.filter(t => t.assigneeId === me.user.id && t.status === 'done' && off(t) >= -7).length;
  const waiting = approvals.filter(a => a.status === 'waiting');
  const todays = meetings.filter(m => diffDays(m.date, today) === 0);
  const focus = tasks.filter(t => t.assigneeId === me.user.id && off(t) <= 0 && t.status !== 'done').sort((a, b) => off(a) - off(b));
  const hour = Math.floor(now); const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateTxt = `${DAYS[new Date(today + 'T00:00:00Z').getUTCDay()]}, ${new Date(today + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`;
  const sub = `${dateTxt} · ${todays.length} meeting${todays.length === 1 ? '' : 's'} · ${dueToday} due today${overdue ? `, ${overdue} overdue` : ''}${waiting.length && can('approvals') ? ` · ${waiting.length} waiting on your approval` : ''}`;
  const fig = (label: string, value: number, alarm?: boolean) => (
    <button key={label} onClick={() => router.push('/tasks')} className="hov" style={{ textAlign: 'left', border: 0, background: 'transparent', padding: '18px 20px', cursor: 'pointer', borderRight: '1px solid #f1f5f9' }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#64748b' }}>{label}</p>
      <p className="num" style={{ margin: '6px 0 0', fontSize: 30, lineHeight: 1, fontWeight: 600, letterSpacing: '-0.02em', color: alarm && value > 0 ? '#be123c' : '#0f172a' }}>{value}</p>
    </button>
  );
  const upcomingMs = projects.flatMap(p => p.milestones.filter(m => { const o = diffDays(m.due, today); return o >= 0 && o <= 21 && !['PAID', 'INVOICED'].includes(m.status); }).map(m => ({ p, m }))).sort((a, b) => a.m.due.localeCompare(b.m.due));

  return <>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px 24px' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>{greet}, {first}</h1>
        <p style={{ margin: '4px 0 0', fontSize: 15, color: '#64748b' }}>{sub}</p>
      </div>
      {can('tasks') && <Btn icon="plus" onClick={() => setUi({ newTask: { projectId: '' } })}>New task</Btn>}
    </div>

    {can('tasks') && <Card style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
      {fig('Due today', dueToday)}{fig('Overdue', overdue, true)}{fig('Next 7 days', upcoming)}{fig('Done this week', doneWeek)}
    </Card>}

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,440px),1fr))', gap: 20, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
        {can('tasks') && <Card>
          <CardHead title="Focus today" sub="Your tasks that are overdue or due today." right={<button className="link" onClick={() => router.push('/tasks')}>All tasks</button>} />
          {focus.map(t => <FocusRow key={t.id} t={t} p={pmap.get(t.projectId)} />)}
          {!focus.length && <p style={{ margin: 0, padding: '24px 20px', fontSize: 14, color: '#64748b' }}>Nothing overdue or due today.</p>}
        </Card>}
        {can('approvals') && <Card>
          <CardHead title="Waiting on you" sub={waiting.length ? `${waiting.length} decision${waiting.length > 1 ? 's' : ''} routed to you.` : 'Decisions routed to you.'} right={<button className="link" onClick={() => router.push('/approvals')}>Open approvals</button>} />
          {waiting.slice(0, 3).map(a => (
            <div key={a.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{a.title}</p>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>{a.kind} · from {a.by}</p>
              </div>
              {a.amount != null && <span className="num" style={{ fontSize: 14, fontWeight: 500 }}>{inr(a.amount)}</span>}
              <Btn size="xs" onClick={() => act(`approvals/${a.id}/decide`, { approve: true })} style={{ boxShadow: 'none' }}>Approve</Btn>
            </div>
          ))}
          {!waiting.length && <p style={{ margin: 0, padding: '24px 20px', fontSize: 14, color: '#64748b' }}>You're clear. Nothing needs a decision.</p>}
        </Card>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
        <DaySchedule meetings={todays} tasks={tasks} onNew={() => newMeeting()} onToast={toast} />
        {can('projects') && <Card>
          <CardHead title="Milestones in the next 3 weeks" />
          {upcomingMs.map(({ p, m }) => { const [label, tone, solid] = MILESTONE_STATUS[m.status];
            return (
              <button key={m.id} onClick={() => router.push(`/projects/${p.id}`)} className="row-btn" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px' }}>
                <div style={{ width: 44, flex: 'none', textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' }}>{fmtMon(m.due)}</p>
                  <p className="num" style={{ margin: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.1 }}>{dayNum(m.due)}</p>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{m.name}</p><p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>{p.name} · {p.customer}</p></div>
                <Badge tone={tone} solid={solid} dot={!solid}>{label}</Badge>
              </button>
            ); })}
          {!upcomingMs.length && <p style={{ margin: 0, padding: '20px', fontSize: 14, color: '#64748b' }}>No milestones due in the next three weeks.</p>}
        </Card>}
      </div>
    </div>

    {can('projects') && <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.011em' }}>My projects</h2>
        <button className="link" onClick={() => router.push('/projects')}>All projects</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,260px),1fr))', gap: 16 }}>
        {projects.filter(p => p.ownerId === me.user.id || tasks.some(t => t.projectId === p.id && t.assigneeId === me.user.id)).map(p => <ProjectCard key={p.id} p={p} />)}
      </div>
    </div>}
  </>;
}

function ProjectCard({ p }: { p: Project }) {
  const router = useRouter(); const st = projStats(p);
  return (
    <button onClick={() => router.push(`/projects/${p.id}`)} className="lift" style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 18px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 1px 2px rgba(15,23,42,.04)', cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', width: '100%' }}>
        <div style={{ minWidth: 0 }}><p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{p.name}</p><p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>{p.customer}</p></div>
        <span style={badgeStyle(healthTone(p.health))}><span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor' }} />{p.health}</span>
      </div>
      <div style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#64748b', marginBottom: 6 }}><span>{st.pct}% complete</span><span>Ends {fmtD(p.endDate)}</span></div>
        <div style={{ height: 6, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}><div style={{ display: 'block', height: '100%', width: st.pct + '%', borderRadius: 999, background: barColor(p.health) }} /></div>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: '#64748b', width: '100%' }}>Next: <span style={{ color: '#0f172a', fontWeight: 500 }}>{st.next ? `${st.next.name} · ${fmtD(st.next.due)}` : 'Wrapping up'}</span></p>
    </button>
  );
}

/** Today's timeline, 9 am – 7 pm: meetings, focus blocks and a line at the current time. */
function DaySchedule({ meetings, tasks, onNew, onToast }: { meetings: Meeting[]; tasks: Task[]; onNew: () => void; onToast: (m: string) => void }) {
  const { now, today, setUi } = useApp();
  const PX = 56, H0 = 9, H1 = 19;
  type Item = { kind: 'ext' | 'int' | 'blk'; start: number; dur: number; title: string; meta: string; open: () => void; lane: number };
  const items: Item[] = [
    ...meetings.map(m => ({ kind: (m.ext ? 'ext' : 'int') as Item['kind'], start: m.start, dur: m.dur, title: m.title, meta: `${fmtT(m.start)} – ${fmtT(m.start + m.dur)} · ${m.loc}`, open: () => setUi({ meetId: m.id, taskId: null }), lane: 0 })),
    ...tasks.filter(t => t.block && t.status !== 'done').map(t => ({ kind: 'blk' as const, start: t.block!.start, dur: t.block!.dur, title: t.title, meta: `Focus time · ${fmtT(t.block!.start)} – ${fmtT(t.block!.start + t.block!.dur)}`, open: () => setUi({ taskId: t.id, meetId: null }), lane: 0 })),
  ].sort((a, b) => a.start - b.start);
  const ends: number[] = [];
  items.forEach(it => { let l = ends.findIndex(e => e <= it.start + 1e-6); if (l < 0) { l = ends.length; ends.push(0); } ends[l] = it.start + it.dur; it.lane = l; });
  const PAL = { ext: ['#eef4ff', '1px solid rgba(0,82,255,.22)', '#0f172a', '#0052ff'], int: ['#f1f5f9', '1px solid #e2e8f0', '#0f172a', '#64748b'], blk: ['#fff', '1px dashed #94a3b8', '#334155', '#64748b'] };
  const cur = meetings.find(m => isNow(m, today, now));
  const nx = cur || meetings.filter(m => m.start > now).sort((a, b) => a.start - b.start)[0];
  const busy = items.reduce((a, it) => a + Math.max(0, Math.min(H1, it.start + it.dur) - Math.max(now, it.start)), 0);
  const nowTop = (Math.min(Math.max(now, H0), H1) - H0) * PX;
  return (
    <Card>
      <CardHead title="Today's schedule" sub={`${meetings.length} meeting${meetings.length === 1 ? '' : 's'} · ${hm(Math.max(0, H1 - Math.max(now, H0) - busy))} free for the rest of the day`}
        right={<button className="link" onClick={onNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="plus" size={15} />New meeting</button>} />
      {nx && (
        <div style={{ margin: '14px 16px 0', padding: '12px 14px', borderRadius: 10, background: '#eef4ff', border: '1px solid rgba(0,82,255,.18)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 36, height: 36, flex: 'none', borderRadius: 8, background: '#fff', color: '#0052ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="video" size={18} /></span>
          <button onClick={() => setUi({ meetId: nx.id })} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'pointer' }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: '#0052ff' }}>{cur ? 'Happening now' : 'Up next · in ' + hm(nx.start - now)}</p>
            <p className="ellipsis" style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{nx.title}</p>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#475569' }}>{fmtT(nx.start)} – {fmtT(nx.start + nx.dur)} · {nx.loc}</p>
          </button>
          {nx.link && <button onClick={() => { onToast(`Opening ${nx.loc}…`); openLink(nx); }} className="btn btn-pri" style={{ height: 34, padding: '0 14px', fontSize: 13, flex: 'none', boxShadow: 'none' }}>Join</button>}
        </div>
      )}
      <div style={{ position: 'relative', height: 560, margin: '22px 16px 16px' }}>
        {Array.from({ length: H1 - H0 + 1 }, (_, i) => (
          <div key={i} style={{ position: 'absolute', left: 48, right: 0, top: i * PX, height: 0, borderTop: '1px solid #f1f5f9' }}>
            <span className="num" style={{ position: 'absolute', top: -8, left: -48, width: 40, textAlign: 'right', fontSize: 11.5, color: '#94a3b8', lineHeight: '16px', whiteSpace: 'nowrap' }}>{hLabel(H0 + i)}</span>
          </div>
        ))}
        {items.map((it, i) => {
          const n = 1 + Math.max(...items.filter(x => x.start < it.start + it.dur && it.start < x.start + x.dur).map(x => x.lane));
          const short = it.dur < 0.75; const past = it.start + it.dur <= now; const [bg, bd, c1, c2] = PAL[it.kind];
          return (
            <button key={i} onClick={it.open} style={{ position: 'absolute', top: (it.start - H0) * PX + 1, height: Math.max(it.dur * PX - 3, 20), left: `calc(48px + (100% - 48px) * ${it.lane / n})`, width: `calc((100% - 48px) / ${n} - 4px)`, boxSizing: 'border-box', textAlign: 'left', border: bd, borderRadius: 6, background: bg, padding: short ? '0 8px' : it.dur < 1 ? '2px 8px' : '5px 8px', cursor: 'pointer', display: 'flex', flexDirection: short ? 'row' : 'column', alignItems: short ? 'center' : 'stretch', justifyContent: short ? 'space-between' : 'flex-start', gap: short ? 8 : 1, overflow: 'hidden', opacity: past ? 0.55 : 1, zIndex: 1 }}>
              <span style={{ fontSize: 13, lineHeight: '17px', fontWeight: 600, color: c1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: short ? '0 1 auto' : 'none' }}>{it.title}</span>
              <span style={{ fontSize: 12, lineHeight: '16px', color: c2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 'none', maxWidth: short ? '45%' : '100%' }}>{short ? fmtT(it.start) : it.meta}</span>
            </button>
          );
        })}
        {now >= H0 && now <= H1 && <div style={{ position: 'absolute', left: 48, right: 0, top: nowTop - 1, height: 0, borderTop: '2px solid #be123c', zIndex: 3, pointerEvents: 'none' }}><span style={{ position: 'absolute', left: -4, top: -5, width: 8, height: 8, borderRadius: 999, background: '#be123c' }} /></div>}
      </div>
    </Card>
  );
}
