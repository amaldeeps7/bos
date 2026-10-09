'use client';
import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TASK_STATUS, dayLabel, fmtD, fmtT, hm, stampLabel } from '@bos/shared';
import { useAct, useApp, useQ } from '@/lib/app';
import { dueInfo, isNow, isPast, provider } from '@/lib/domain';
import type { Meeting, Project, Task } from '@/lib/types';
import { Avatar, Badge, Icon, TONES } from './ui';

function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 65, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,.32)' }} />
      <div style={{ position: 'relative', width: 580, maxWidth: '100%', height: '100%', background: '#fff', boxShadow: '-16px 0 48px -12px rgba(15,23,42,.3)', display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  );
}
const CloseX = ({ onClick }: { onClick: () => void }) => <button onClick={onClick} aria-label="Close" className="ghost-icon" style={{ width: 32, height: 32, flex: 'none' }}><Icon name="x" size={18} /></button>;

/** A text field that edits locally and saves when it loses focus. */
function useDraft(value: string, save: (v: string) => void) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return { value: v, onChange: (e: { target: { value: string } }) => setV(e.target.value), onBlur: () => { if (v !== value) save(v); } };
}

export function TaskPanel() {
  const { ui, setUi } = useApp();
  const tasks = useQ<Task[]>('tasks').data;
  const t = tasks?.find(x => x.id === ui.taskId);
  if (!ui.taskId || !t) return null;
  return <TaskPanelInner key={t.id} t={t} />;
}

function TaskPanelInner({ t }: { t: Task }) {
  const { setUi, today, me, person, has, people, toast } = useApp(); const act = useAct(); const router = useRouter();
  const p = useQ<Project[]>('projects').data?.find(x => x.id === t.projectId);
  const [draft, setDraft] = useState('');
  const close = () => setUi({ taskId: null });
  const patch = (b: object) => act(`tasks/${t.id}`, b, { method: 'PATCH', quiet: true });
  const title = useDraft(t.title, v => patch({ title: v }));
  const desc = useDraft(t.desc, v => patch({ desc: v }));
  const d = dueInfo(t, today);
  const send = async () => { const text = draft.trim(); if (!text) return; setDraft(''); await act(`tasks/${t.id}/comments`, { text }, { quiet: true }); };
  const pill = (on: boolean, tone: keyof typeof TONES) => { const [c, bg, b] = TONES[tone]; return { display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 11px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: on ? 600 : 500, whiteSpace: 'nowrap' as const, border: '1px solid ' + (on ? b : '#e2e8f0'), background: on ? bg : '#fff', color: on ? c : '#64748b' }; };
  const n = t.events.filter(e => e.kind === 'comment').length;
  const assignable = [...people.values()].filter(x => x.status === 'Active');
  const copy = async () => { try { await navigator.clipboard.writeText(`${location.origin}/tasks?task=${t.id}`); } catch { /* blocked */ } toast('Link to ' + t.key + ' copied.'); };

  return (
    <Drawer onClose={close}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '1px solid #e2e8f0' }}>
        <span className="mono" style={{ fontSize: 13, color: '#64748b' }}>{t.key}</span>
        <span style={{ color: '#cbd5e1' }}>/</span>
        <button className="quiet ellipsis" onClick={() => { close(); router.push(`/projects/${t.projectId}`); }} style={{ minWidth: 0 }}>{p?.name} · {p?.customer}</button>
        <span style={{ flex: 1 }} />
        <button onClick={copy} aria-label="Copy link" className="ghost-icon" style={{ width: 32, height: 32, flex: 'none' }}><Icon name="link" size={16} /></button>
        <CloseX onClick={close} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <textarea {...title} rows={2} aria-label="Title" className="title-edit" style={{ border: '1px solid transparent', borderRadius: 8, margin: '-6px -8px', padding: '6px 8px', fontFamily: 'inherit', fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.3, color: '#0f172a', resize: 'none', outlineColor: '#0052ff', background: 'transparent' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(TASK_STATUS).map(([k, [label, tone]]) => <button key={k} onClick={() => k !== t.status && patch({ status: k })} style={pill(t.status === k, tone)}><span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor' }} />{label}</button>)}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr)', gap: '10px 16px', alignItems: 'center', fontSize: 14 }}>
          <span style={{ color: '#64748b' }}>Assignee</span>
          <select value={t.assigneeId} disabled={!has('task.assign')} onChange={e => patch({ assigneeId: e.target.value })} style={{ height: 36, maxWidth: 240, border: '1px solid #e2e8f0', borderRadius: 8, padding: '0 8px', fontSize: 14, background: '#fff' }}>
            {assignable.map(o => <option key={o.id} value={o.id}>{o.id === me.user.id ? `Me (${o.name.split(' ')[0]})` : o.name}</option>)}
          </select>
          <span style={{ color: '#64748b' }}>Priority</span>
          <select value={t.priority} onChange={e => patch({ priority: e.target.value })} style={{ height: 36, maxWidth: 240, border: '1px solid #e2e8f0', borderRadius: 8, padding: '0 8px', fontSize: 14, background: '#fff' }}>
            <option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option>
          </select>
          <span style={{ color: '#64748b' }}>Due</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: d.style.color }}>{t.status === 'done' || d.label === fmtD(t.due) ? fmtD(t.due) : d.label + ' · ' + fmtD(t.due)}</span>
            <input type="date" value={t.due} onChange={e => e.target.value && patch({ due: e.target.value })} aria-label="Change due date" style={{ height: 30, border: '1px solid #e2e8f0', borderRadius: 8, padding: '0 6px', fontSize: 13, color: '#64748b', background: '#fff' }} />
          </span>
          <span style={{ color: '#64748b' }}>Reported by</span>
          <span>{person(t.reporterId).name}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Description</h3>
          <textarea {...desc} rows={5} placeholder="Add context, acceptance criteria or links…" style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6, color: '#0f172a', resize: 'vertical', outlineColor: '#0052ff', minHeight: 96 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Activity <span style={{ color: '#94a3b8', fontWeight: 500 }}>{n || ''}</span></h3>
          {t.events.map(e => {
            const who = person(e.userId); const nm = e.userId === me.user.id ? 'You' : who.name; const at = stampLabel(e.at, new Date(), me.org.tz);
            return e.kind === 'sys' ? (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#64748b', paddingLeft: 6 }}>
                <span style={{ width: 20, display: 'flex', justifyContent: 'center', flex: 'none' }}><span style={{ width: 7, height: 7, borderRadius: 999, background: '#cbd5e1' }} /></span>
                <span><span style={{ color: '#0f172a', fontWeight: 500 }}>{nm}</span> {e.text} · {at}</span>
              </div>
            ) : (
              <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <Avatar name={who.name} size={32} style={{ background: '#eef4ff', color: '#0052ff' }} />
                <div style={{ flex: 1, minWidth: 0, border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px' }}>
                  <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}><span style={{ color: '#0f172a', fontWeight: 600 }}>{nm}</span> · {at}</p>
                  <p style={{ margin: '4px 0 0', fontSize: 14, lineHeight: 1.55, color: '#0f172a', whiteSpace: 'pre-wrap', textWrap: 'pretty' as any }}>{e.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {has('task.comment') && (
        <div style={{ flex: 'none', borderTop: '1px solid #e2e8f0', padding: '12px 20px 16px', display: 'flex', gap: 10, alignItems: 'flex-end', background: '#f8fafc' }}>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} rows={2} placeholder="Write a comment… (⌘↵ to send)" style={{ flex: 1, minWidth: 0, border: '1px solid #cbd5e1', borderRadius: 8, padding: '9px 12px', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5, resize: 'none', outlineColor: '#0052ff', background: '#fff' }} />
          <button onClick={send} className="btn btn-pri" style={{ flex: 'none' }}>Comment</button>
        </div>
      )}
    </Drawer>
  );
}

export const openLink = (m: { link: string }) => { try { window.open(m.link, '_blank', 'noopener'); } catch { /* popup blocked */ } };

export function MeetingPanel() {
  const { ui } = useApp();
  const m = useQ<Meeting[]>('meetings').data?.find(x => x.id === ui.meetId);
  if (!ui.meetId || !m) return null;
  return <MeetingPanelInner key={m.id} m={m} />;
}

function MeetingPanelInner({ m }: { m: Meeting }) {
  const { setUi, today, now, person, me, has, people, toast } = useApp(); const act = useAct(); const router = useRouter();
  const pr = useQ<Project[]>('projects').data?.find(x => x.id === m.projectId);
  const [ma, setMa] = useState({ text: '', a: me.user.id });
  const close = () => setUi({ meetId: null });
  const patch = (b: object) => act(`meetings/${m.id}`, b, { method: 'PATCH', quiet: true });
  const agenda = useDraft(m.agenda, v => patch({ agenda: v }));
  const notes = useDraft(m.notes, v => patch({ notes: v }));
  const link = useDraft(m.link, v => patch({ link: v.trim() }));
  const past = isPast(m, today, now); const live = isNow(m, today, now);
  const tasks = useQ<Task[]>('tasks').data || [];
  const add = async () => { const text = ma.text.trim(); if (!text) return; await act(`meetings/${m.id}/actions`, { text, assigneeId: ma.a }, { quiet: true }); setMa({ ...ma, text: '' }); };
  const draftLoc = provider(link.value) || m.loc;
  const join = () => { toast(`Opening ${draftLoc}…`); openLink({ link: link.value || m.link }); };

  return (
    <Drawer onClose={close}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '1px solid #e2e8f0' }}>
        <Icon name="calendar" size={16} style={{ color: '#64748b' }} />
        <span style={{ fontSize: 13, color: '#64748b' }}>Meeting</span>
        <Badge tone={live ? 'success' : past ? 'neutral' : 'primary'}>{live ? 'In progress' : past ? 'Ended' : 'Upcoming'}</Badge>
        <span style={{ flex: 1 }} />
        {!past && <button className="outline-blue" onClick={() => setUi({ meetId: null, meetDialog: { id: m.id, title: m.title, p: m.projectId || '', date: m.date, start: String(m.start), dur: String(m.dur), who: [...m.attendees], loc: m.loc, link: m.link } })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', color: '#0f172a', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}><Icon name="calendar-clock" size={14} />Reschedule</button>}
        <CloseX onClick={close} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px 28px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.3, textWrap: 'pretty' as any }}>{m.title}</h2>
          <p style={{ margin: 0, fontSize: 14, color: '#475569' }}>{dayLabel(m.date, today)} · {fmtT(m.start)} – {fmtT(m.start + m.dur)} ({hm(m.dur)})</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '100px minmax(0,1fr)', gap: '12px 16px', alignItems: 'center', fontSize: 14 }}>
          <span style={{ color: '#64748b' }}>Where</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}><span>{draftLoc}</span>{!!(link.value || m.link) && <button onClick={join} className="btn btn-pri" style={{ height: 30, padding: '0 12px', fontSize: 13, gap: 6 }}><Icon name="video" size={14} />Join call</button>}</div>
          <span style={{ color: '#64748b' }}>Call link</span>
          <input {...link} placeholder="Paste a Google Meet or Zoom link" className="mono" style={{ height: 36, minWidth: 0, border: '1px solid #e2e8f0', borderRadius: 8, padding: '0 10px', fontSize: 13, color: '#0f172a', outlineColor: '#0052ff' }} />
          <span style={{ color: '#64748b' }}>Project</span>
          <div>{pr ? <button onClick={() => { close(); router.push(`/projects/${pr.id}`); }} style={{ border: 0, background: 'none', padding: 0, fontSize: 14, color: '#0052ff', cursor: 'pointer', textAlign: 'left' }}>{pr.name} · {pr.customer}</button> : <span style={{ color: '#64748b' }}>Internal — no project</span>}</div>
          <span style={{ color: '#64748b', alignSelf: 'start', paddingTop: 4 }}>Attendees</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {m.attendees.map(w => { const p = person(w); return <span key={w} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px 0 4px', border: '1px solid #e2e8f0', borderRadius: 999, fontSize: 13 }}><Avatar name={p.name} size={22} style={{ fontSize: 10 }} />{w === me.user.id ? 'You' : p.name}</span>; })}
            {m.ext && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', border: '1px solid rgba(0,82,255,.18)', background: '#eef4ff', color: '#0052ff', borderRadius: 999, fontSize: 13 }}><Icon name="building" size={13} />{m.ext}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Agenda</h3>
          <textarea {...agenda} rows={4} placeholder="What should this meeting decide?" style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6, color: '#0f172a', resize: 'vertical', outlineColor: '#0052ff' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Notes</h3>
          <textarea {...notes} rows={5} placeholder="Capture decisions as you go…" style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6, color: '#0f172a', resize: 'vertical', outlineColor: '#0052ff' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Action items</h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>Turn each one into a task so it doesn't live only in the notes.</p>
          </div>
          {m.actions.map(a => {
            const t = a.taskId ? tasks.find(x => x.id === a.taskId) : null; const who = person(a.assigneeId);
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10 }}>
                <Avatar name={who.name} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 500, textWrap: 'pretty' as any }}>{a.text}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12.5, color: '#64748b' }}>{who.name}</p>
                </div>
                {a.taskId && <button onClick={() => setUi({ taskId: a.taskId, meetId: null })} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 10px', flex: 'none', border: '1px solid rgba(4,120,87,.18)', borderRadius: 999, background: '#ecfdf5', color: '#047857', fontSize: 12, cursor: 'pointer' }}><Icon name="check" size={12} />{t?.key || 'Task'}</button>}
                {!a.taskId && pr && has('task.create') && <button className="outline-blue" onClick={() => act(`meetings/${m.id}/actions/${a.id}/task`, {}, { msg: '' }).then(r => r && toast(`${r.key} created for ${who.name}.`))} style={{ height: 30, padding: '0 10px', flex: 'none', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>Create task</button>}
                {!a.taskId && !pr && <span style={{ fontSize: 12.5, color: '#94a3b8', whiteSpace: 'nowrap' }}>No project linked</span>}
              </div>
            );
          })}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input value={ma.text} onChange={e => setMa({ ...ma, text: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="Add an action item…" style={{ flex: '1 1 220px', minWidth: 0, height: 38, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 12px', fontSize: 14, outlineColor: '#0052ff' }} />
            <select value={ma.a} onChange={e => setMa({ ...ma, a: e.target.value })} style={{ height: 38, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 8px', fontSize: 14, background: '#fff' }}>
              {[...people.values()].filter(p => p.status === 'Active').map(p => <option key={p.id} value={p.id}>{p.id === me.user.id ? 'Me' : p.name}</option>)}
            </select>
            <button onClick={add} className="btn btn-sec" style={{ height: 38, boxShadow: 'none' }}>Add</button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
