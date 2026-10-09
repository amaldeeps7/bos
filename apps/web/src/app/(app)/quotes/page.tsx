'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { QUOTE_STATUS, fmtD, inr } from '@bos/shared';
import { useApp, useQ } from '@/lib/app';
import type { Customer, Quote } from '@/lib/types';
import { Btn, Card, PageHead, Status, Tabs } from '@/components/ui';

type Tab = 'all' | 'draft' | 'sent' | 'won';
const COLS = 'minmax(240px,2fr) minmax(160px,1.2fr) 150px 100px 130px';

export default function Quotes() {
  const router = useRouter(); const { has } = useApp();
  const quotes = useQ<Quote[]>('quotes').data || [];
  const cust = new Map((useQ<Customer[]>('customers').data || []).map(c => [c.id, c.name]));
  const [tab, setTab] = useState<Tab>('all');
  const f: Record<Tab, (q: Quote) => boolean> = { all: () => true, draft: q => ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(q.status), sent: q => q.status === 'SENT', won: q => ['ACCEPTED', 'CONVERTED'].includes(q.status) };
  const rows = quotes.filter(f[tab]).sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no));
  return <>
    <PageHead title="Quotations" sub="Priced proposals. Accepted ones become a project or an invoice without re-keying." right={has('quote.create') && <Btn kind="pri" icon="plus" onClick={() => router.push('/quotes/new')}>New quotation</Btn>} />
    <Tabs tabs={([['all', 'All'], ['draft', 'In progress'], ['sent', 'With customer'], ['won', 'Won']] as [Tab, string][]).map(([id, label]) => ({ id, label, count: quotes.filter(f[id]).length }))} value={tab} onChange={setTab} />
    <Card style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 820 }}>
        <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: COLS }}><span>Quotation</span><span>Customer</span><span>Status</span><span>Valid until</span><span style={{ textAlign: 'right' }}>Total</span></div>
        {rows.map(q => (
          <button key={q.id} onClick={() => router.push(`/quotes/${q.id}`)} className="row-btn" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '12px 20px' }}>
            <span><span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{q.title}</span><span className="mono" style={{ display: 'block', fontSize: 12.5, color: '#64748b' }}>{q.no}</span></span>
            <span>{cust.get(q.customerId)}</span>
            <span><Status def={QUOTE_STATUS[q.status]} /></span>
            <span style={{ color: '#64748b' }}>{fmtD(q.validUntil)}</span>
            <span className="num" style={{ textAlign: 'right', fontWeight: 500 }}>{inr(q.calc.grand)}</span>
          </button>
        ))}
        {!rows.length && <p style={{ margin: 0, padding: '28px 20px', fontSize: 14, color: '#64748b' }}>Nothing here.</p>}
      </div>
    </Card>
  </>;
}
