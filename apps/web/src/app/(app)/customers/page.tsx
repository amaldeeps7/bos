'use client';
import { useRouter } from 'next/navigation';
import { inr } from '@bos/shared';
import { ExportBtn } from '@/components/export-btn';
import { useApp, useQ } from '@/lib/app';
import type { Customer } from '@/lib/types';
import { EmptyFiltered, FilterBar, MultiFilter, SearchBox, SortHead, Toggle, listOf, sortRows, useUrlState } from '@/components/filters';
import { Avatar, Btn, Card, Icon, PageHead } from '@/components/ui';

const COLS = 'minmax(220px,2fr) 190px 80px 140px 170px';

export default function Customers() {
  const { setUi, person, has } = useApp(); const router = useRouter();
  const all = useQ<Customer[]>('customers').data || [];
  const [f, set] = useUrlState({ q: '', owner: '', state: '', owes: '', sort: '' });
  const qy = f.q.trim().toLowerCase(); const [ownF, stF] = [listOf(f.owner), listOf(f.state)];
  const active = !!(f.q || f.owner || f.state || f.owes); const clear = () => set({ q: '', owner: '', state: '', owes: '' }); const sortBy = (s: string) => set({ sort: s });
  const rows = sortRows(all.filter(c => (!qy || `${c.name} ${c.gstin} ${c.city} ${c.contact} ${c.email}`.toLowerCase().includes(qy)) && (!ownF.length || ownF.includes(c.ownerId))
    && (!stF.length || stF.includes(c.state)) && (!f.owes || c.outstanding > 0)), f.sort, (c, k) => (k === 'name' ? c.name : k === 'gstin' ? c.gstin : k === 'projects' ? c.projects : k === 'owner' ? person(c.ownerId).name : c.outstanding));
  return <>
    <PageHead title="Customers" sub="Who you bill, their GST details, and what they owe." right={<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <ExportBtn name="customers" rows={() => rows.map(c => ({ Name: c.name, GSTIN: c.gstin, State: c.state, City: c.city, 'Billing contact': c.contact, 'Billing email': c.email, Phone: c.phone, 'Payment terms (days)': c.terms, 'Account owner': person(c.ownerId).name, 'Customer since': c.since, Projects: c.projects, Billed: c.billed, Outstanding: c.outstanding }))} />
      {has('customer.create') && <Btn kind="pri" icon="plus" onClick={() => setUi({ customer: 'new' })}>Add customer</Btn>}</div>} />
    <FilterBar active={active} onClear={clear}>
      <SearchBox value={f.q} onChange={v => set({ q: v })} placeholder="Search name, GSTIN, city, contact" />
      <MultiFilter label="Account owner" value={ownF} onChange={v => set({ owner: v.join(',') })} options={[...new Set(all.map(c => c.ownerId))].map(id => ({ value: id, label: person(id).name })).sort((a, b) => a.label.localeCompare(b.label))} />
      <MultiFilter label="State" value={stF} onChange={v => set({ state: v.join(',') })} options={[...new Set(all.map(c => c.state).filter(Boolean))].sort().map(x => ({ value: x, label: x }))} />
      <Toggle label="Owes money" on={!!f.owes} onChange={v => set({ owes: v ? '1' : '' })} />
    </FilterBar>
    <Card style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 780 }}>
        <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: COLS }}><SortHead label="Customer" k="name" sort={f.sort} onSort={sortBy} /><SortHead label="GSTIN" k="gstin" sort={f.sort} onSort={sortBy} /><SortHead label="Projects" k="projects" sort={f.sort} onSort={sortBy} align="right" /><SortHead label="Outstanding" k="outstanding" sort={f.sort} onSort={sortBy} align="right" /><SortHead label="Account owner" k="owner" sort={f.sort} onSort={sortBy} /></div>
        {rows.map(c => (
          <button key={c.id} onClick={() => router.push(`/customers/${c.id}`)} className="row-btn" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '12px 20px' }}>
            <span><span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{c.name}</span><span style={{ display: 'block', fontSize: 13, color: '#64748b' }}>{c.city}, {c.state}</span></span>
            <span className="mono" style={{ fontSize: 13, color: c.gstin ? '#334155' : '#94a3b8' }}>{c.gstin || 'No GSTIN'}</span>
            <span className="num" style={{ textAlign: 'right' }}>{c.projects}</span>
            <span className="num" style={{ textAlign: 'right', fontWeight: 500 }}>{c.outstanding ? inr(c.outstanding) : '—'}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={person(c.ownerId).name} src={person(c.ownerId).avatar} />{person(c.ownerId).name}</span>
          </button>
        ))}
        {!rows.length && <EmptyFiltered onClear={active ? clear : undefined} text={active ? undefined : 'No customers yet.'} />}
      </div>
    </Card>
  </>;
}
