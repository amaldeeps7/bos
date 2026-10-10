'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { diffDays } from '@bos/shared';
import { useApp, useQ } from '@/lib/app';
import type { Project, Task } from '@/lib/types';
import { Btn, Card, PageHead, Tabs } from '@/components/ui';
import { TaskListRow } from '@/components/task-row';
import { ExportBtn } from '@/components/export-btn';

type Tab = 'mine' | 'byme' | 'all';

export default function Tasks() {
  const { me, today, setUi, has, person } = useApp(); const params = useSearchParams();
  const tasks = useQ<Task[]>('tasks').data || [];
  const projects = useQ<Project[]>('projects').data || [];
  const pmap = new Map(projects.map(p => [p.id, p]));
  const [tab, setTab] = useState<Tab>('mine');
  useEffect(() => { const t = params.get('task'); if (t) setUi({ taskId: t }); }, [params, setUi]);
  const filt: Record<Tab, (t: Task) => boolean> = { mine: t => t.assigneeId === me.user.id, byme: t => t.reporterId === me.user.id && t.assigneeId !== me.user.id, all: () => true };
  const tabs = ([['mine', 'Assigned to me'], ['byme', 'I assigned'], ...(has('task.read_all') ? [['all', 'Everyone']] : [])] as [Tab, string][]).map(([id, label]) => ({ id, label, count: tasks.filter(t => filt[id](t) && t.status !== 'done').length }));
  const list = tasks.filter(filt[tab]); const o = (t: Task) => diffDays(t.due, today);
  const buckets: [string, (t: Task) => boolean, string][] = [['Overdue', t => t.status !== 'done' && o(t) < 0, '#be123c'], ['Today', t => t.status !== 'done' && o(t) === 0, '#b45309'], ['This week', t => t.status !== 'done' && o(t) > 0 && o(t) <= 7, '#0f172a'], ['Later', t => t.status !== 'done' && o(t) > 7, '#0f172a'], ['Done', t => t.status === 'done', '#64748b']];
  const groups = buckets.map(([label, f, c]) => ({ label, c, rows: list.filter(f).sort((a, b) => a.due.localeCompare(b.due)) })).filter(g => g.rows.length);
  return <>
    <PageHead title="Tasks" sub="Work you own, and work you've handed out." right={<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <ExportBtn name="tasks" rows={() => list.map(t => ({ Key: t.key, Title: t.title, Project: projects.find(p => p.id === t.projectId)?.name || '', Assignee: person(t.assigneeId).name, 'Assigned by': person(t.reporterId).name, Due: t.due, Status: t.status, Priority: t.priority }))} />
      {has('task.create') && <Btn kind="pri" icon="plus" onClick={() => setUi({ newTask: { projectId: '' } })}>New task</Btn>}</div>} />
    <Tabs tabs={tabs} value={tab} onChange={setTab} />
    <Card style={{ overflow: 'hidden' }}>
      {groups.map(g => (
        <div key={g.label}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', borderTop: '1px solid #e2e8f0', marginTop: -1 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: g.c }}>{g.label}</span><span style={{ fontSize: 13, color: '#94a3b8' }}>{g.rows.length}</span>
          </div>
          {g.rows.map(t => <TaskListRow key={t.id} t={t} p={pmap.get(t.projectId)} />)}
        </div>
      ))}
      {!groups.length && <p style={{ margin: 0, padding: '28px 20px', fontSize: 14, color: '#64748b' }}>Nothing here.</p>}
    </Card>
  </>;
}
