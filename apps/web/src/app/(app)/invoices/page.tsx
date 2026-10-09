'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { INVOICE_STATUS, fmtD, inr } from '@bos/shared';
import { useApp, useQ } from '@/lib/app';
import type { Customer, Invoice } from '@/lib/types';
import { Btn, Card, PageHead, Status, Tabs } from '@/components/ui';

type Tab = 'all' | 'action' | 'unpaid' | 'paid';
const COLS = 'minmax(240px,2fr) minmax(150px,1.1fr) 140px 90px 120px 120px';

export default function Invoices() {
  const router = useRouter(); const { has } = useApp();
  const invoices = useQ<Invoice[]>('invoices').data || [];
  const cust = new Map((useQ<Customer[]>('customers').data || []).map(c => [c.id, c.name]));
  const [tab, setTab] = useState<Tab>('all');
  const f: Record<Tab, (i: Invoice) => boolean> = { all: () => true, action: i => ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED'].includes(i.status), unpaid: i => i.bal > 0, paid: i => i.status === 'PAID' };
  const rows = invoices.filter(f[tab]);
  const stat = (label: string, v: string, red?: boolean) => <div><p style={{ margin: 0, fontSize: 13, color: '#64748b', fontWeight: 500 }}>{label}</p><p className="num" style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 600, color: red ? '#be123c' : undefined }}>{v}</p></div>;
  return <>
    <PageHead title="Invoices" sub="Raised from milestones, quotations, or from scratch. GST follows the customer's place of supply." subStyle={{ maxWidth: '62ch' }} right={
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '16px 28px' }}>
        {stat('Outstanding', inr(invoices.reduce((a, i) => a + i.bal, 0)))}{stat('Overdue', inr(invoices.filter(i => i.overdue).reduce((a, i) => a + i.bal, 0)), true)}
        {has('invoice.create') && <Btn kind="pri" icon="plus" onClick={() => router.push('/invoices/new')}>New invoice</Btn>}
      </div>} />
    <Tabs tabs={([['all', 'All'], ['action', 'To finish'], ['unpaid', 'Unpaid'], ['paid', 'Paid']] as [Tab, string][]).map(([id, label]) => ({ id, label, count: invoices.filter(f[id]).length }))} value={tab} onChange={setTab} />
    <Card style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 900 }}>
        <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: COLS }}><span>Invoice</span><span>Customer</span><span>Status</span><span>Due</span><span style={{ textAlign: 'right' }}>Total</span><span style={{ textAlign: 'right' }}>Balance</span></div>
        {rows.map(i => (
          <button key={i.id} onClick={() => router.push(`/invoices/${i.id}`)} className="row-btn" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '12px 20px' }}>
            <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{i.title}</span><span className="mono" style={{ display: 'block', fontSize: 12.5, color: '#64748b' }}>{i.no}</span></span>
            <span>{cust.get(i.customerId)}</span>
            <span><Status def={INVOICE_STATUS[i.displayStatus]} /></span>
            <span style={{ color: '#64748b' }}>{fmtD(i.due)}</span>
            <span className="num" style={{ textAlign: 'right' }}>{inr(i.calc.grand)}</span>
            <span className="num" style={{ textAlign: 'right', fontWeight: 500, color: i.overdue ? '#be123c' : i.bal ? '#0f172a' : '#94a3b8' }}>{i.bal ? inr(i.bal) : '—'}</span>
          </button>
        ))}
        {!rows.length && <p style={{ margin: 0, padding: '28px 20px', fontSize: 14, color: '#64748b' }}>Nothing here.</p>}
      </div>
    </Card>
  </>;
}
