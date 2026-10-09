'use client';
import { useState } from 'react';
import { DAYS, dayLabel, diffDays, fmtD, fmtT, hm } from '@bos/shared';
import { useAct, useApp, useQ } from '@/lib/app';
import { isNow, isPast } from '@/lib/domain';
import type { Meeting, Project } from '@/lib/types';
import { Avatar, Badge, Btn, Card, Icon, PageHead, Tabs } from '@/components/ui';
import { useOpenNewMeeting } from '@/components/dialogs';
import { openLink } from '@/components/overlays';

type Tab = 'upcoming' | 'past' | 'follow';
const LOC_ICON: Record<string, string> = { 'Google Meet': 'icon-video', Zoom: 'icon-video', 'Microsoft Teams': 'icon-video', 'Customer site': 'icon-map-pin' };

export default function Meetings() {
  const { today, now, setUi, person, toast } = useApp(); const act = useAct();
  const meetings = useQ<Meeting[]>('meetings').data || [];
  const projects = useQ<Project[]>('projects').data || [];
  const newMeeting = useOpenNewMeeting();
  const [tab, setTab] = useState<Tab>('upcoming');
  const past = (m: Meeting) => isPast(m, today, now);
  const defs: Record<Tab, (m: Meeting) => boolean> = { upcoming: m => !past(m), past, follow: m => past(m) && m.actions.some(a => !a.taskId) };
  const ord = (m: Meeting) => m.date + String(m.start).padStart(5, '0');
  const list = meetings.filter(defs[tab]).sort((a, b) => (tab === 'upcoming' ? ord(a).localeCompare(ord(b)) : ord(b).localeCompare(ord(a))));
  const days = [...new Set(list.map(m => m.date))];
  const wd = (d: string) => DAYS[new Date(d + 'T00:00:00Z').getUTCDay()];
  const cancel = async (m: Meeting) => { if (!confirm(`Cancel “${m.title}”? Attendees will be notified.`)) return; const r = await act(`meetings/${m.id}`, undefined, { method: 'DELETE', quiet: true }); if (r) toast(`“${m.title}” cancelled. Attendees notified.`); };
  const edit = (m: Meeting) => setUi({ meetDialog: { id: m.id, title: m.title, p: m.projectId || '', date: m.date, start: String(m.start), dur: String(m.dur), who: [...m.attendees], loc: m.loc, link: m.link } });
  return <>
    <PageHead title="Meetings" sub={`${meetings.filter(m => !past(m)).length} upcoming · ${meetings.filter(defs.follow).length} need follow-up`} right={<Btn kind="pri" icon="plus" onClick={() => newMeeting()}>New meeting</Btn>} />
    <Tabs tabs={([['upcoming', 'Upcoming'], ['past', 'Past'], ['follow', 'Needs follow-up']] as [Tab, string][]).map(([id, label]) => ({ id, label, count: meetings.filter(defs[id]).length }))} value={tab} onChange={setTab} />
    <Card style={{ overflow: 'hidden' }}>
      {days.map(d => {
        const rows = list.filter(m => m.date === d); const off = diffDays(d, today);
        return (
          <div key={d}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', borderTop: '1px solid #e2e8f0', marginTop: -1 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: off === 0 ? '#0052ff' : '#0f172a' }}>{Math.abs(off) <= 1 ? `${dayLabel(d, today)} · ${wd(d).slice(0, 3)} ${fmtD(d)}` : `${wd(d)}, ${fmtD(d)}`}</span>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>{rows.length} meeting{rows.length > 1 ? 's' : ''}</span>
            </div>
            {rows.map(m => {
              const pr = projects.find(p => p.id === m.projectId); const ps = past(m); const live = isNow(m, today, now); const open = m.actions.filter(a => !a.taskId).length;
              const tag: [string, any] | null = live ? ['In progress', 'success'] : ps ? (open ? [`${open} action item${open > 1 ? 's' : ''} open`, 'warning'] : m.notes ? ['Notes', 'neutral'] : ['No notes', 'neutral']) : null;
              return (
                <div key={m.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flex: '1 1 320px', minWidth: 0 }}>
                    <div style={{ width: 72, flex: 'none' }}>
                      <p className="num" style={{ margin: 0, fontSize: 14, fontWeight: 600, color: ps ? '#94a3b8' : '#0f172a' }}>{fmtT(m.start)}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 12.5, color: '#94a3b8' }}>{hm(m.dur)}</p>
                    </div>
                    <button onClick={() => setUi({ meetId: m.id, taskId: null })} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'pointer' }}>
                      <p style={{ margin: 0, fontSize: 15, fontWeight: 500, color: ps ? '#475569' : '#0f172a' }}>{m.title}</p>
                      <p style={{ margin: '3px 0 0', fontSize: 13, color: '#64748b', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0 6px' }}><span>{pr ? `${pr.name} · ${pr.customer}` : 'Internal'}</span><span>·</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name={LOC_ICON[m.loc] || 'icon-building'} size={13} />{m.loc}</span></p>
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginLeft: 88 }}>
                    <div style={{ display: 'flex', paddingLeft: 6 }}>
                      {m.attendees.slice(0, 4).map(w => <Avatar key={w} name={person(w).name} size={26} style={{ marginLeft: -6, border: '2px solid #fff', fontSize: 10 }} />)}
                      {m.attendees.length > 4 && <span style={{ width: 26, height: 26, marginLeft: -6, border: '2px solid #fff', borderRadius: 999, background: '#e2e8f0', color: '#475569', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+{m.attendees.length - 4}</span>}
                    </div>
                    {tag && <Badge tone={tag[1]}>{tag[0]}</Badge>}
                    {!ps && m.link && <button onClick={() => { toast(`Opening ${m.loc}…`); openLink(m); }} className="btn btn-pri" style={{ height: 32, padding: '0 12px', fontSize: 13, gap: 6, boxShadow: 'none' }}><Icon name="video" size={14} />Join</button>}
                    {!ps && <>
                      <button onClick={() => edit(m)} title="Edit or reschedule" aria-label="Edit or reschedule" className="outline-blue" style={{ width: 32, height: 32, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="calendar-clock" size={15} /></button>
                      <button onClick={() => cancel(m)} title="Cancel meeting" aria-label="Cancel meeting" className="outline-red" style={{ width: 32, height: 32, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={15} /></button>
                    </>}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      {!list.length && <p style={{ margin: 0, padding: '28px 20px', fontSize: 14, color: '#64748b' }}>Nothing here.</p>}
    </Card>
  </>;
}
