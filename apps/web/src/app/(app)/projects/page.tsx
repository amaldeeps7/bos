'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtD, healthTone, inr } from '@bos/shared';
import { useApp, useQ } from '@/lib/app';
import { barColor, projStats } from '@/lib/domain';
import type { Project } from '@/lib/types';
import { Btn, Card, PageHead, badgeStyle } from '@/components/ui';
import { ProjectDialog } from '@/components/forms';
import { ExportBtn } from '@/components/export-btn';
import { EmptyFiltered, FilterBar, MultiFilter, SearchBox, SortHead, listOf, sortRows, useUrlState } from '@/components/filters';

const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', ON_HOLD: 'On hold', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };

const Dot = () => <span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor' }} />;
const COLS = 'minmax(240px,2.2fr) minmax(150px,1.2fr) 120px minmax(150px,1fr) 130px 90px';

export default function Projects() {
  const { isMobile, has, person } = useApp(); const router = useRouter(); const [creating, setCreating] = useState(false);
  const all = useQ<Project[]>('projects').data || [];
  const [f, set] = useUrlState({ q: '', status: '', health: '', customer: '', owner: '', bu: '', sort: '' });
  const [status, health, cust, owner, bu] = [listOf(f.status), listOf(f.health), listOf(f.customer), listOf(f.owner), listOf(f.bu)];
  const q = f.q.trim().toLowerCase();
  const opts = (vals: string[], label = (v: string) => v) => [...new Set(vals)].filter(Boolean).map(v => ({ value: v, label: label(v) })).sort((a, b) => a.label.localeCompare(b.label));
  const projects = sortRows(all.filter(p => (!q || `${p.name} ${p.code} ${p.customer}`.toLowerCase().includes(q)) && (!status.length || status.includes(p.status)) && (!health.length || health.includes(p.health))
    && (!cust.length || cust.includes(p.customerId)) && (!owner.length || owner.includes(p.ownerId)) && (!bu.length || bu.includes(p.bu))),
    f.sort, (p, k) => (k === 'name' ? p.name : k === 'customer' ? p.customer : k === 'health' ? p.health : k === 'progress' ? projStats(p).pct : k === 'contract' ? p.contract : p.endDate));
  const active = !!(f.q || f.status || f.health || f.customer || f.owner || f.bu);
  const clear = () => set({ q: '', status: '', health: '', customer: '', owner: '', bu: '' });
  const sortBy = (s: string) => set({ sort: s });
  return <>
    <PageHead title="Projects" sub="Engagements, their milestones, and what's left to bill." right={<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <ExportBtn name="projects" rows={() => projects.map(p => { const billed = p.milestones.filter(m => ['INVOICED', 'PAID'].includes(m.status)).reduce((a, m) => a + m.value, 0); return { Code: p.code, Name: p.name, Customer: p.customer, 'Business unit': p.bu, Owner: person(p.ownerId).name, Status: p.status, Health: p.health, 'End date': p.endDate, 'Contract value': p.contract, Billed: billed, 'Left to bill': p.contract - billed, Milestones: p.milestones.length }; })} />
      {has('project.create') && <Btn kind="pri" icon="plus" onClick={() => setCreating(true)}>New project</Btn>}</div>} />
    {creating && <ProjectDialog onClose={() => setCreating(false)} />}
    <FilterBar active={active} onClear={clear}>
      <SearchBox value={f.q} onChange={v => set({ q: v })} placeholder="Search projects, codes, customers" />
      <MultiFilter label="Status" value={status} onChange={v => set({ status: v.join(',') })} options={opts(all.map(p => p.status), v => STATUS_LABEL[v] || v)} />
      <MultiFilter label="Health" value={health} onChange={v => set({ health: v.join(',') })} options={opts(all.map(p => p.health))} />
      <MultiFilter label="Customer" value={cust} onChange={v => set({ customer: v.join(',') })} options={[...new Map(all.map(p => [p.customerId, p.customer])).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))} />
      <MultiFilter label="Owner" value={owner} onChange={v => set({ owner: v.join(',') })} options={opts(all.map(p => p.ownerId), v => person(v).name)} />
      {new Set(all.map(p => p.bu)).size > 1 && <MultiFilter label="Unit" value={bu} onChange={v => set({ bu: v.join(',') })} options={opts(all.map(p => p.bu))} />}
    </FilterBar>
    {!isMobile ? (
      <Card style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 860 }}>
          <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: COLS }}><SortHead label="Project" k="name" sort={f.sort} onSort={sortBy} /><SortHead label="Customer" k="customer" sort={f.sort} onSort={sortBy} /><SortHead label="Health" k="health" sort={f.sort} onSort={sortBy} /><SortHead label="Progress" k="progress" sort={f.sort} onSort={sortBy} /><SortHead label="Contract" k="contract" sort={f.sort} onSort={sortBy} align="right" /><SortHead label="Ends" k="end" sort={f.sort} onSort={sortBy} align="right" /></div>
          {projects.map(p => { const st = projStats(p);
            return (
              <button key={p.id} onClick={() => router.push(`/projects/${p.id}`)} className="row-btn" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '14px 20px' }}>
                <span><span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{p.name}</span><span className="mono" style={{ display: 'block', fontSize: 12.5, color: '#64748b' }}>{p.code} · {p.bu}</span></span>
                <span>{p.customer}</span>
                <span><span style={badgeStyle(healthTone(p.health))}><Dot />{p.health}</span></span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ flex: 1, height: 6, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: st.pct + '%', borderRadius: 999, background: barColor(p.health) }} /></span><span className="num" style={{ fontSize: 13, color: '#64748b', width: 34 }}>{st.pct}%</span></span>
                <span className="num" style={{ textAlign: 'right', fontWeight: 500 }}>{inr(p.contract)}</span>
                <span style={{ textAlign: 'right', color: '#64748b' }}>{fmtD(p.endDate)}</span>
              </button>
            ); })}
          {!projects.length && <EmptyFiltered onClear={active ? clear : undefined} text={active ? undefined : 'No projects yet.'} />}
        </div>
      </Card>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {projects.map(p => { const st = projStats(p);
          return (
            <button key={p.id} onClick={() => router.push(`/projects/${p.id}`)} style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' }}><span><span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{p.name}</span><span style={{ display: 'block', fontSize: 13, color: '#64748b' }}>{p.customer}</span></span><span style={badgeStyle(healthTone(p.health))}>{p.health}</span></div>
              <div style={{ width: '100%', height: 6, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}><div style={{ height: '100%', width: st.pct + '%', borderRadius: 999, background: barColor(p.health) }} /></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13, color: '#64748b' }}><span>{st.pct}% complete</span><span className="num" style={{ color: '#0f172a', fontWeight: 500 }}>{inr(p.contract)}</span></div>
            </button>
          ); })}
        {!projects.length && <EmptyFiltered onClear={active ? clear : undefined} text={active ? undefined : 'No projects yet.'} />}
      </div>
    )}
  </>;
}
