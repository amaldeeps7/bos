'use client';
import { useRouter } from 'next/navigation';
import { fmtD, fyStart, inr } from '@bos/shared';
import { useApp, useQ } from '@/lib/app';
import type { CreditNote, Customer } from '@/lib/types';
import { Card, Icon, PageHead } from '@/components/ui';
import { ExportBtn } from '@/components/export-btn';

const COLS = '140px 140px minmax(150px,1fr) minmax(220px,2fr) 80px 120px 40px';

export default function CreditNotes() {
  const router = useRouter(); const { me, today } = useApp();
  const notes = useQ<CreditNote[]>('credit-notes').data || [];
  const cname = new Map((useQ<Customer[]>('customers').data || []).map(c => [c.id, c.name]));
  return <>
    <PageHead title="Credit notes" sub="Corrections to issued invoices. The invoice keeps its own figures; the credit reduces what the customer owes. Raise one from the invoice." subStyle={{ maxWidth: '66ch' }}
      right={<div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '16px 28px' }}><ExportBtn name="credit-notes" rows={() => notes.map(r => ({ 'Credit note no.': r.no, Date: r.date, 'Against invoice': r.invoiceNo, Customer: cname.get(r.customerId) || '', Reason: r.reason, 'Taxable value': r.taxable, GST: r.total - r.taxable, Total: r.total }))} /><div><p style={{ margin: 0, fontSize: 13, color: '#64748b', fontWeight: 500 }}>Credited this year</p><p className="num" style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 600 }}>{inr(notes.filter(c => c.date >= fyStart(today, me.org.fyStart)).reduce((a, c) => a + c.total, 0))}</p></div></div>} />
    <Card style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 900 }}>
        <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: COLS }}><span>Note</span><span>Against</span><span>Customer</span><span>Reason</span><span>Date</span><span style={{ textAlign: 'right' }}>Amount</span><span /></div>
        {notes.map(r => (
          <button key={r.id} onClick={() => router.push(`/invoices/${r.invoiceId}`)} className="row-btn" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '12px 20px' }}>
            <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{r.no}</span>
            <span className="mono" style={{ fontSize: 13, color: '#0052ff' }}>{r.invoiceNo}</span>
            <span>{cname.get(r.customerId)}</span>
            <span style={{ color: '#64748b', lineHeight: 1.4 }}>{r.reason}</span>
            <span style={{ color: '#64748b' }}>{fmtD(r.date)}</span>
            <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{inr(r.total)}</span>
            <span role="link" title="Download PDF" aria-label={`Download ${r.no} PDF`} onClick={e => { e.stopPropagation(); window.open(`/api/credit-notes/${r.id}/pdf`, '_blank'); }} className="ghost-icon" style={{ width: 32, height: 32 }}><Icon name="download" size={15} /></span>
          </button>
        ))}
        {!notes.length && <p style={{ margin: 0, padding: '28px 20px', fontSize: 14, color: '#64748b' }}>No credit notes yet.</p>}
      </div>
    </Card>
  </>;
}
