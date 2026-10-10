'use client';
import { useState } from 'react';
import { DAYS, TASK_STATUS, addDays } from '@bos/shared';
import { useAct, useApp } from '@/lib/app';
import { dueInfo } from '@/lib/domain';
import type { Project, Task } from '@/lib/types';
import { Avatar, Icon, TONES, badgeStyle } from './ui';
import { useTaskActions } from './task-row';

const COLS = Object.keys(TASK_STATUS) as (keyof typeof TASK_STATUS)[];
const prioTone = (p: string) => (p === 'High' ? 'danger' : p === 'Medium' ? 'warning' : 'neutral');

/** Columns by status. Drag a card to another column (or use "Move to") to change its status. */
export function TaskBoard({ tasks, projects }: { tasks: Task[]; projects: Map<string, Project> }) {
  const act = useAct(); const a = useTaskActions(); const { today, person } = useApp();
  const [over, setOver] = useState<string | null>(null);
  const move = (t: Task, status: string) => { if (t.status !== status) void act(`tasks/${t.id}`, { status }, { method: 'PATCH', quiet: true }); };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS.length}, minmax(240px, 1fr))`, gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
      {COLS.map(col => {
        const rows = tasks.filter(t => t.status === col); const [label, tone] = TASK_STATUS[col];
        return (
          <section key={col} aria-label={label} onDragOver={e => { e.preventDefault(); setOver(col); }} onDragLeave={() => setOver(o => (o === col ? null : o))}
            onDrop={e => { e.preventDefault(); setOver(null); const t = tasks.find(x => x.id === e.dataTransfer.getData('text/task')); if (t) move(t, col); }}
            style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8, borderRadius: 12, background: over === col ? '#eff4ff' : '#f1f5f9', outline: over === col ? '2px dashed #0052ff' : 'none', minHeight: 160 }}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px' }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: TONES[tone][0] }} /><b style={{ fontSize: 13, fontWeight: 600 }}>{label}</b><span style={{ fontSize: 13, color: '#94a3b8' }}>{rows.length}</span>
            </header>
            {rows.map(t => {
              const p = projects.get(t.projectId); const d = dueInfo(t, today); const who = person(t.assigneeId);
              return (
                <article key={t.id} draggable onDragStart={e => { e.dataTransfer.setData('text/task', t.id); e.dataTransfer.effectAllowed = 'move'; }}
                  style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6, cursor: 'grab' }}>
                  <button onClick={() => a.open(t)} style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', fontSize: 14, fontWeight: 500, color: t.status === 'done' ? '#94a3b8' : '#0f172a', cursor: 'pointer', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</button>
                  <span style={{ fontSize: 12.5, color: '#64748b' }}><span className="mono" style={{ color: '#94a3b8' }}>{t.key}</span> · {p?.name}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Avatar name={who.name} src={who.avatar} size={22} />
                    <span style={{ ...badgeStyle(prioTone(t.priority) as any), fontSize: 12 }}>{t.priority}</span>
                    {t.status !== 'done' && <span style={{ ...d.style, fontSize: 12.5 }}>{d.label}</span>}
                    <select aria-label={`Move ${t.key} to`} value={t.status} onChange={e => move(t, e.target.value)} style={{ marginLeft: 'auto', height: 26, border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, color: '#64748b', background: '#fff' }}>
                      {COLS.map(c => <option key={c} value={c}>{TASK_STATUS[c][0]}</option>)}
                    </select>
                  </span>
                </article>
              );
            })}
            {!rows.length && <p style={{ margin: 0, padding: '12px 6px', fontSize: 13, color: '#94a3b8' }}>Drop tasks here</p>}
          </section>
        );
      })}
    </div>
  );
}

/** A month of due dates. Click a task to open it; "+n more" shows that day's list. */
export function TaskCalendar({ tasks, month, onMonth, onDay }: { tasks: Task[]; month: string; onMonth: (m: string) => void; onDay: (iso: string) => void }) {
  const a = useTaskActions(); const { today } = useApp();
  const first = month + '-01'; const startDow = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday first
  const gridStart = addDays(first, -startDow);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const shift = (n: number) => { const [y, m] = month.split('-').map(Number); onMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)); };
  const byDay = new Map<string, Task[]>(); for (const t of tasks) byDay.set(t.due, [...(byDay.get(t.due) || []), t]);
  const title = new Date(first + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="ghost-icon" onClick={() => shift(-1)} aria-label="Previous month" style={{ width: 32, height: 32 }}><Icon name="chevron-left" size={16} /></button>
        <b style={{ fontSize: 15, minWidth: 150, textAlign: 'center' }}>{title}</b>
        <button className="ghost-icon" onClick={() => shift(1)} aria-label="Next month" style={{ width: 32, height: 32 }}><Icon name="chevron-right" size={16} /></button>
        {month !== today.slice(0, 7) && <button className="link" onClick={() => onMonth(today.slice(0, 7))} style={{ fontSize: 14 }}>Today</button>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div role="grid" aria-label={title} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(110px, 1fr))', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', background: '#e2e8f0', gap: 1, minWidth: 770 }}>
          {[1, 2, 3, 4, 5, 6, 0].map(i => <div key={i} style={{ background: '#f8fafc', padding: '6px 8px', fontSize: 12, fontWeight: 600, color: '#64748b' }}>{DAYS[i].slice(0, 3)}</div>)}
          {days.map(d => {
            const list = byDay.get(d) || []; const other = d.slice(0, 7) !== month; const isToday = d === today;
            return (
              <div key={d} role="gridcell" style={{ background: other ? '#fafafa' : '#fff', minHeight: 96, padding: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? '#fff' : other ? '#cbd5e1' : '#64748b', background: isToday ? '#0052ff' : 'none', borderRadius: 999, minWidth: 20, textAlign: 'center', padding: '1px 5px' }}>{+d.slice(8)}</span>
                {list.slice(0, 3).map(t => {
                  const tone = TONES[TASK_STATUS[t.status]?.[1] || 'neutral'];
                  return <button key={t.id} onClick={() => a.open(t)} title={`${t.key} ${t.title}`} style={{ border: 0, borderLeft: `3px solid ${tone[0]}`, background: tone[1], borderRadius: 4, padding: '2px 6px', fontSize: 12, textAlign: 'left', color: t.status === 'done' ? '#94a3b8' : '#0f172a', textDecoration: t.status === 'done' ? 'line-through' : 'none', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</button>;
                })}
                {list.length > 3 && <button className="link" onClick={() => onDay(d)} style={{ fontSize: 12, alignSelf: 'flex-start' }}>+{list.length - 3} more</button>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
