'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { inr } from '@bos/shared';
import { ExportBtn } from '@/components/export-btn';
import { useApp, useQ } from '@/lib/app';
import type { Customer } from '@/lib/types';
import { Avatar, Btn, Card, Icon, PageHead } from '@/components/ui';

const COLS = 'minmax(220px,2fr) 190px 80px 140px 170px';

export default function Customers() {
  const { setUi, person, has } = useApp(); const router = useRouter();
  const all = useQ<Customer[]>('customers').data || [];
  const [q, setQ] = useState('');
  const qy = q.trim().toLowerCase();
  const rows = all.filter(c => !qy || (c.name + c.gstin + c.city).toLowerCase().includes(qy));
  return <>
    <PageHead title="Customers" sub="Who you bill, their GST details, and what they owe." right={<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <ExportBtn name="customers" rows={() => rows.map(c => ({ Name: c.name, GSTIN: c.gstin, State: c.state, City: c.city, 'Billing contact': c.contact, 'Billing email': c.email, Phone: c.phone, 'Payment terms (days)': c.terms, 'Account owner': person(c.ownerId).name, 'Customer since': c.since, Projects: c.projects, Billed: c.billed, Outstanding: c.outstanding }))} />
      {has('customer.create') && <Btn kind="pri" icon="plus" onClick={() => setUi({ customer: 'new' })}>Add customer</Btn>}</div>} />
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, width: '100%', maxWidth: 380, padding: '0 12px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }}>
      <Icon name="search" size={15} style={{ color: '#94a3b8' }} />
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, GSTIN or city" style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: 14 }} />
    </div>
    <Card style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 780 }}>
        <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: COLS }}><span>Customer</span><span>GSTIN</span><span style={{ textAlign: 'right' }}>Projects</span><span style={{ textAlign: 'right' }}>Outstanding</span><span>Account owner</span></div>
        {rows.map(c => (
          <button key={c.id} onClick={() => router.push(`/customers/${c.id}`)} className="row-btn" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '12px 20px' }}>
            <span><span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{c.name}</span><span style={{ display: 'block', fontSize: 13, color: '#64748b' }}>{c.city}, {c.state}</span></span>
            <span className="mono" style={{ fontSize: 13, color: c.gstin ? '#334155' : '#94a3b8' }}>{c.gstin || 'No GSTIN'}</span>
            <span className="num" style={{ textAlign: 'right' }}>{c.projects}</span>
            <span className="num" style={{ textAlign: 'right', fontWeight: 500 }}>{c.outstanding ? inr(c.outstanding) : '—'}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={person(c.ownerId).name} />{person(c.ownerId).name}</span>
          </button>
        ))}
        {!rows.length && <p style={{ margin: 0, padding: '28px 20px', fontSize: 14, color: '#64748b' }}>No customer matches that search.</p>}
      </div>
    </Card>
  </>;
}
