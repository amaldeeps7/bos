'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { diffDays, fmtD, inr } from '@bos/shared';
import { useAct, useApp, useQ } from '@/lib/app';
import type { Customer, Invoice, Payment } from '@/lib/types';
import { Btn, Card, Icon, PageHead, Tabs } from '@/components/ui';
import { PaymentDialogEdit } from '@/components/forms';

const RC = '150px minmax(160px,1.2fr) 90px minmax(180px,1.4fr) 150px 130px 32px';
const AC = 'minmax(180px,1.6fr) repeat(5,minmax(100px,1fr))';
const AGE = ['Not yet due', '1–30 days overdue', '31–60 days overdue', 'Over 60 days'];

export default function Payments() {
  const router = useRouter(); const act = useAct(); const { today, can, has } = useApp(); const [edit, setEdit] = useState<Payment | null>(null);
  const payments = useQ<Payment[]>('payments').data || [];
  const invoices = useQ<Invoice[]>(can('billing') ? 'invoices' : null).data || [];
  const customers = useQ<Customer[]>('customers').data || [];
  const cname = new Map(customers.map(c => [c.id, c.name]));
  const [tab, setTab] = useState<'receipts' | 'receivables'>('receipts');
  const open = invoices.filter(i => i.bal > 0);
  const bucket = (i: Invoice) => { const o = diffDays(i.due, today); return o >= 0 ? 0 : -o <= 30 ? 1 : -o <= 60 ? 2 : 3; };
  const tot = [0, 0, 0, 0]; open.forEach(i => { tot[bucket(i)] += i.bal; });
  const byCust = [...new Set(open.map(i => i.customerId))].map(cid => { const r = [0, 0, 0, 0]; open.filter(i => i.customerId === cid).forEach(i => { r[bucket(i)] += i.bal; }); return { cid, r }; });
  return <>
    <PageHead title="Payments" sub="Money received, and what customers still owe." right={tab === 'receivables' && <Btn icon="bell-ring" onClick={() => act('payments/remind-overdue')}>Remind overdue customers</Btn>} />
    <Tabs tabs={[{ id: 'receipts', label: 'Receipts', count: payments.length }, { id: 'receivables', label: 'Receivables', count: open.length }]} value={tab} onChange={setTab} />
    {edit && <PaymentDialogEdit payment={edit} onClose={() => setEdit(null)} />}
    {tab === 'receipts' ? (
      <Card style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 900 }}>
          <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: RC }}><span>Receipt</span><span>Customer</span><span>Received</span><span>Method &amp; reference</span><span>Applied to</span><span style={{ textAlign: 'right' }}>Amount</span><span /></div>
          {payments.map(r => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: RC, gap: 16, alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
              <span className="mono" style={{ fontSize: 13 }}>{r.no}</span>
              <span style={{ fontWeight: 500 }}>{cname.get(r.customerId)}</span>
              <span style={{ color: '#64748b' }}>{fmtD(r.date)}</span>
              <span style={{ color: '#64748b' }}>{r.method} · <span className="mono" style={{ fontSize: 12.5 }}>{r.ref}</span></span>
              <button onClick={() => r.allocations[0] && router.push(`/invoices/${r.allocations[0].invoiceId}`)} className="mono" style={{ justifySelf: 'start', border: 0, background: 'none', padding: 0, color: '#0052ff', fontSize: 13, cursor: 'pointer' }}>{r.allocations[0]?.invoiceNo || '—'}</button>
              <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{inr(r.amount)}</span>
              {has('payment.update') ? <button onClick={() => setEdit(r)} title="Edit receipt" aria-label={`Edit ${r.no}`} className="ghost-icon" style={{ width: 32, height: 32 }}><Icon name="pencil" size={14} /></button> : <span />}
            </div>
          ))}
        </div>
      </Card>
    ) : <>
      <Card style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
        {AGE.map((label, b) => <div key={label} style={{ padding: '18px 20px', borderRight: '1px solid #f1f5f9' }}><p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#64748b' }}>{label}</p><p className="num" style={{ margin: '6px 0 0', fontSize: 24, lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.02em', color: b >= 2 && tot[b] ? '#be123c' : '#0f172a' }}>{inr(tot[b])}</p></div>)}
      </Card>
      <Card style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 760 }}>
          <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: AC }}><span>Customer</span><span style={{ textAlign: 'right' }}>Not yet due</span><span style={{ textAlign: 'right' }}>1–30 days</span><span style={{ textAlign: 'right' }}>31–60 days</span><span style={{ textAlign: 'right' }}>Over 60</span><span style={{ textAlign: 'right' }}>Total</span></div>
          {byCust.map(({ cid, r }) => (
            <button key={cid} onClick={() => router.push(`/customers/${cid}`)} className="row-btn num" style={{ display: 'grid', gridTemplateColumns: AC, gap: 16, alignItems: 'center', padding: '12px 20px' }}>
              <span style={{ fontWeight: 500 }}>{cname.get(cid)}</span>
              {r.map((v, b) => <span key={b} style={{ textAlign: 'right', color: !v ? '#94a3b8' : b >= 2 ? '#be123c' : '#0f172a' }}>{v ? inr(v) : '—'}</span>)}
              <span style={{ textAlign: 'right', fontWeight: 600 }}>{inr(r.reduce((a, v) => a + v, 0))}</span>
            </button>
          ))}
          {!byCust.length && <p style={{ margin: 0, padding: '28px 20px', fontSize: 14, color: '#64748b' }}>Nobody owes you anything right now.</p>}
        </div>
      </Card>
    </>}
  </>;
}
