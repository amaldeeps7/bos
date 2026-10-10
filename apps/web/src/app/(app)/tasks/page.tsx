'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { TASK_STATUS, diffDays } from '@bos/shared';
import { useApp, useQ } from '@/lib/app';
import { api, ApiError } from '@/lib/api';
import type { Project, Task } from '@/lib/types';
import { Btn, Card, PageHead, Tabs } from '@/components/ui';
import { TaskListRow } from '@/components/task-row';
import { TaskBoard, TaskCalendar } from '@/components/task-views';
import { ExportBtn } from '@/components/export-btn';
import { BulkBar, Choice, DateRange, EmptyFiltered, FilterBar, MultiFilter, SearchBox, Toggle, ViewSwitch, bulkCtl, inRange, listOf, rangeOf, useSelection, useUrlState } from '@/components/filters';

type Tab = 'mine' | 'byme' | 'all';
type View = 'list' | 'board' | 'calendar';
type Group = 'due' | 'status' | 'project' | 'assignee' | 'priority';
const PRIO_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
const DEFAULTS = { tab: 'mine', q: '', status: '', prio: '', project: '', assignee: '', period: '', from: '', to: '', done: '', view: 'list', group: 'due', sort: 'due', month: '' };

export default function Tasks() {
  const { me, today, setUi, has, person, toast, people: everyone } = useApp(); const params = useSearchParams(); const qc = useQueryClient();
  const tasks = useQ<Task[]>('tasks').data || [];
  const projects = useQ<Project[]>('projects').data || [];
  const pmap = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);
  const [f, set] = useUrlState(DEFAULTS);
  const tab = (f.tab === 'all' && !has('task.read_all') ? 'mine' : f.tab) as Tab; const view = f.view as View;
  useEffect(() => { const t = params.get('task'); if (t) setUi({ taskId: t }); }, [params, setUi]);

  // Completed tasks older than 30 days aren't loaded up front; "Load older" pages them in.
  const [older, setOlder] = useState<Task[]>([]); const [moreOlder, setMoreOlder] = useState(true); const [loadingOlder, setLoadingOlder] = useState(false);
  const loadOlder = async () => {
    setLoadingOlder(true);
    try { const r = await api<{ rows: Task[]; more: boolean }>(`tasks/history?${older.length ? `before=${older.at(-1)!.id}&` : ''}q=${encodeURIComponent(f.q)}`); setOlder(o => [...o, ...r.rows]); setMoreOlder(r.more); }
    finally { setLoadingOlder(false); }
  };
  useEffect(() => { setOlder([]); setMoreOlder(true); }, [f.q]);

  const byTab: Record<Tab, (t: Task) => boolean> = { mine: t => t.assigneeId === me.user.id, byme: t => t.reporterId === me.user.id && t.assigneeId !== me.user.id, all: () => true };
  const tabs = ([['mine', 'Assigned to me'], ['byme', 'I assigned'], ...(has('task.read_all') ? [['all', 'Everyone']] : [])] as [Tab, string][]).map(([id, label]) => ({ id, label, count: tasks.filter(t => byTab[id](t) && t.status !== 'done').length }));
  const status = listOf(f.status), prio = listOf(f.prio), proj = listOf(f.project), who = listOf(f.assignee);
  const range = rangeOf(f.period, f.from, f.to, today, me.org.fyStart);
  const showDone = f.done === '1' || status.includes('done');
  const q = f.q.trim().toLowerCase();
  const all = [...tasks, ...older.filter(o => !tasks.some(t => t.id === o.id))];
  const inTab = all.filter(byTab[tab]);
  const list = inTab.filter(t =>
    (showDone || t.status !== 'done') && (!status.length || status.includes(t.status)) && (!prio.length || prio.includes(t.priority)) &&
    (!proj.length || proj.includes(t.projectId)) && (!who.length || who.includes(t.assigneeId)) && inRange(t.due, range) &&
    (!q || `${t.key} ${t.title} ${pmap.get(t.projectId)?.name || ''} ${pmap.get(t.projectId)?.customer || ''}`.toLowerCase().includes(q)));
  const active = !!(f.q || f.status || f.prio || f.project || f.assignee || f.period || f.done);
  const clear = () => set({ q: '', status: '', prio: '', project: '', assignee: '', period: '', from: '', to: '', done: '' });

  // Sorting within groups, then grouping.
  const cmp = (a: Task, b: Task) => {
    const k = f.sort.replace(/^-/, ''); const dir = f.sort.startsWith('-') ? -1 : 1;
    const v = k === 'priority' ? (PRIO_RANK[a.priority] ?? 9) - (PRIO_RANK[b.priority] ?? 9) : k === 'title' ? a.title.localeCompare(b.title) : k === 'key' ? a.key.localeCompare(b.key, 'en', { numeric: true }) : a.due.localeCompare(b.due);
    return (v || a.due.localeCompare(b.due)) * dir;
  };
  const o = (t: Task) => diffDays(t.due, today);
  const groupsOf = (g: Group): { label: string; c: string; rows: Task[] }[] => {
    if (g === 'due') return ([['Overdue', (t: Task) => t.status !== 'done' && o(t) < 0, '#be123c'], ['Today', (t: Task) => t.status !== 'done' && o(t) === 0, '#b45309'], ['This week', (t: Task) => t.status !== 'done' && o(t) > 0 && o(t) <= 7, '#0f172a'], ['Later', (t: Task) => t.status !== 'done' && o(t) > 7, '#0f172a'], ['Done', (t: Task) => t.status === 'done', '#64748b']] as [string, (t: Task) => boolean, string][])
      .map(([label, fn, c]) => ({ label, c, rows: list.filter(fn).sort(cmp) }));
    const key = (t: Task) => (g === 'status' ? t.status : g === 'project' ? t.projectId : g === 'assignee' ? t.assigneeId : t.priority);
    const name = (k: string) => (g === 'status' ? TASK_STATUS[k]?.[0] || k : g === 'project' ? pmap.get(k)?.name || 'No project' : g === 'assignee' ? person(k).name : k);
    const order = g === 'status' ? Object.keys(TASK_STATUS) : g === 'priority' ? ['High', 'Medium', 'Low'] : [...new Set(list.map(key))].sort((a, b) => name(a).localeCompare(name(b)));
    return order.map(k => ({ label: name(k), c: '#0f172a', rows: list.filter(t => key(t) === k).sort(cmp) }));
  };
  const groups = groupsOf(f.group as Group).filter(g => g.rows.length);

  // Several at once.
  const sel = useSelection(list.map(t => t.id));
  const bulk = async (body: object, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    try { const r = await api<{ message: string }>('tasks/bulk', { body: { ids: [...sel.sel], ...body } }); toast(r.message); sel.clear(); await qc.invalidateQueries(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not update the tasks.'); }
  };
  const people = [...new Set(inTab.map(t => t.assigneeId))].map(id => ({ value: id, label: person(id).name })).sort((a, b) => a.label.localeCompare(b.label));
  const projOpts = [...new Set(inTab.map(t => t.projectId))].map(id => ({ value: id, label: pmap.get(id)?.name || 'Project' })).sort((a, b) => a.label.localeCompare(b.label));
  const activePeople = [...everyone.values()].filter(p => p.status === 'Active');

  return <>
    <PageHead title="Tasks" sub="Work you own, and work you've handed out." right={<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <ExportBtn name="tasks" rows={() => list.map(t => ({ Key: t.key, Title: t.title, Project: pmap.get(t.projectId)?.name || '', Assignee: person(t.assigneeId).name, 'Assigned by': person(t.reporterId).name, Due: t.due, Status: TASK_STATUS[t.status]?.[0] || t.status, Priority: t.priority }))} />
      {has('task.create') && <Btn kind="pri" icon="plus" onClick={() => setUi({ newTask: { projectId: '' } })}>New task</Btn>}</div>} />
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <Tabs tabs={tabs} value={tab} onChange={v => set({ tab: v })} />
      <ViewSwitch value={view} onChange={v => set({ view: v })} options={[['list', 'List', 'list'], ['board', 'Board', 'columns-3'], ['calendar', 'Calendar', 'calendar-days']]} />
    </div>
    <FilterBar active={active} onClear={clear}>
      <SearchBox value={f.q} onChange={v => set({ q: v })} placeholder="Search tasks, TSK-123, project" />
      <MultiFilter label="Status" value={status} onChange={v => set({ status: v.join(',') })} options={Object.entries(TASK_STATUS).map(([value, [label]]) => ({ value, label }))} />
      <MultiFilter label="Priority" value={prio} onChange={v => set({ prio: v.join(',') })} options={['High', 'Medium', 'Low'].map(x => ({ value: x, label: x }))} />
      <MultiFilter label="Project" value={proj} onChange={v => set({ project: v.join(',') })} options={projOpts} />
      {tab !== 'mine' && <MultiFilter label="Assignee" value={who} onChange={v => set({ assignee: v.join(',') })} options={people} />}
      <DateRange label="Due" period={f.period} from={f.from} to={f.to} onChange={v => set(v)} />
      {!status.includes('done') && <Toggle label="Show completed" on={f.done === '1'} onChange={v => set({ done: v ? '1' : '' })} />}
      {view === 'list' && <>
        <Choice label="Group" value={f.group as Group} onChange={v => set({ group: v })} options={[['due', 'Due date'], ['status', 'Status'], ['project', 'Project'], ['assignee', 'Assignee'], ['priority', 'Priority']]} />
        <Choice label="Sort" value={f.sort} onChange={v => set({ sort: v })} options={[['due', 'Due date'], ['-due', 'Due date (latest)'], ['priority', 'Priority'], ['title', 'Title'], ['key', 'Task number']]} />
      </>}
    </FilterBar>

    {view === 'list' && <>
      <BulkBar count={sel.count} onClear={sel.clear}>
        <select aria-label="Set status" value="" onChange={e => e.target.value && bulk({ status: e.target.value })} style={bulkCtl}><option value="">Status…</option>{Object.entries(TASK_STATUS).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}</select>
        <select aria-label="Set priority" value="" onChange={e => e.target.value && bulk({ priority: e.target.value })} style={bulkCtl}><option value="">Priority…</option>{['High', 'Medium', 'Low'].map(x => <option key={x}>{x}</option>)}</select>
        {has('task.assign') && <select aria-label="Reassign" value="" onChange={e => e.target.value && bulk({ assigneeId: e.target.value })} style={bulkCtl}><option value="">Assign to…</option>{activePeople.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        <label style={{ ...bulkCtl, display: 'inline-flex', alignItems: 'center', gap: 6 }}>Due<input type="date" aria-label="Set due date" onChange={e => e.target.value && bulk({ due: e.target.value })} style={{ background: 'transparent', border: 0, color: '#fff', colorScheme: 'dark' }} /></label>
        {has('task.delete') && <button onClick={() => bulk({ delete: true }, `Delete ${sel.count} task${sel.count === 1 ? '' : 's'}? This can’t be undone.`)} style={{ ...bulkCtl, borderColor: 'rgba(254,205,211,.5)', color: '#fecdd3' }}>Delete</button>}
      </BulkBar>
      <Card style={{ overflow: 'hidden' }}>
        {list.length > 0 && <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 20px', fontSize: 13, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
          <input type="checkbox" checked={sel.allOn} onChange={() => (sel.allOn ? sel.clear() : sel.all())} style={{ width: 16, height: 16, accentColor: '#0052ff' }} />Select all {list.length}</label>}
        {groups.map(g => (
          <div key={g.label}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', borderTop: '1px solid #e2e8f0', marginTop: -1 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: g.c }}>{g.label}</span><span style={{ fontSize: 13, color: '#94a3b8' }}>{g.rows.length}</span>
            </div>
            {g.rows.map(t => <TaskListRow key={t.id} t={t} p={pmap.get(t.projectId)} select={{ on: sel.has(t.id), toggle: () => sel.toggle(t.id) }} />)}
          </div>
        ))}
        {!groups.length && (active ? <EmptyFiltered onClear={clear} /> : <EmptyFiltered text={tab === 'mine' ? 'Nothing assigned to you. Enjoy it.' : 'Nothing here.'} />)}
        {showDone && moreOlder && <div style={{ padding: 12, display: 'flex', justifyContent: 'center', borderTop: '1px solid #f1f5f9' }}><Btn onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? 'Loading…' : 'Load tasks completed more than 30 days ago'}</Btn></div>}
      </Card>
    </>}
    {view === 'board' && (list.length || !active ? <TaskBoard tasks={list} projects={pmap} /> : <Card><EmptyFiltered onClear={clear} /></Card>)}
    {view === 'calendar' && <TaskCalendar tasks={list} month={f.month || today.slice(0, 7)} onMonth={m => set({ month: m })} onDay={d => set({ view: 'list', period: 'custom', from: d, to: d })} />}
  </>;
}
