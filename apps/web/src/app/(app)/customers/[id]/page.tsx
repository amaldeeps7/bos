'use client';
import { useParams, useRouter } from 'next/navigation';
import { fmtMonYear, gstText, healthTone, inr } from '@bos/shared';
import { useApp, useQ } from '@/lib/app';
import type { Customer, Invoice, Project, Quote } from '@/lib/types';
import { Back, Btn, Card, CardHead, Metric, Metrics, PageHead, badgeStyle } from '@/components/ui';
import { InvoiceRowCompact, QuoteRowCompact } from '@/components/docs';

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>(); const router = useRouter();
  const { person, can, has, setUi } = useApp();
  const c = useQ<Customer[]>('customers').data?.find(x => x.id === id);
  const projects = (useQ<Project[]>(can('projects') ? 'projects' : null).data || []).filter(p => p.customerId === id);
  const quotes = (useQ<Quote[]>(can('sales') ? 'quotes' : null).data || []).filter(q => q.customerId === id);
  const invoices = (useQ<Invoice[]>(can('billing') ? 'invoices' : null).data || []).filter(i => i.customerId === id);
  if (!c) return <p style={{ color: '#64748b' }}>Loading…</p>;
  const openQ = quotes.filter(q => ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED'].includes(q.status)).reduce((a, q) => a + q.calc.grand, 0);
  const details: [string, string][] = [['GSTIN', c.gstin], ['State', `${c.state} (${c.gstin.slice(0, 2)})`], ['GST on invoices', gstText(c.intra)], ['Payment terms', `Net ${c.terms} days`], ['Billing contact', c.contact || '—'], ['Billing email', c.email || '—'], ['Phone', c.phone || '—'], ['Customer since', fmtMonYear(c.since)]];
  return <>
    <Back label="Customers" onClick={() => router.push('/customers')} />
    <PageHead title={c.name} sub={`${c.city}, ${c.state} · account owner ${person(c.ownerId).name}`} right={
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {has('customer.update') && <Btn icon="pencil" onClick={() => setUi({ customer: c.id })}>Edit</Btn>}
        {can('sales') && has('quote.create') && <Btn icon="scroll-text" onClick={() => router.push(`/quotes/new?customer=${c.id}`)}>New quotation</Btn>}
        {can('billing') && has('invoice.create') && <Btn kind="pri" icon="file-plus" onClick={() => router.push(`/invoices/new?customer=${c.id}`)}>New invoice</Btn>}
      </div>} />
    <Metrics><Metric label="Billed to date" value={inr(c.billed)} /><Metric label="Outstanding" value={inr(c.outstanding)} /><Metric label="Open quotations" value={inr(openQ)} /><Metric label="Projects" value={String(c.projects)} /></Metrics>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,400px),1fr))', gap: 20, alignItems: 'start' }}>
      <Card>
        <CardHead title="Contact & tax details" />
        <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: '14px 20px' }}>
          {details.map(([k, v]) => <div key={k} style={{ minWidth: 0 }}><p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{k}</p><p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 500, overflowWrap: 'anywhere' }}>{v}</p></div>)}
        </div>
      </Card>
      <Card>
        <CardHead title="Projects" />
        {projects.map(p => (
          <button key={p.id} onClick={() => router.push(`/projects/${p.id}`)} className="row-btn" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px' }}>
            <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{p.name}</span><span className="mono" style={{ display: 'block', fontSize: 12.5, color: '#64748b' }}>{p.code}</span></span>
            <span style={badgeStyle(healthTone(p.health))}><span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor' }} />{p.health}</span>
          </button>
        ))}
        {!projects.length && <p style={{ margin: 0, padding: 20, fontSize: 14, color: '#64748b' }}>No projects yet. An accepted quotation becomes one.</p>}
      </Card>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,400px),1fr))', gap: 20, alignItems: 'start' }}>
      {can('sales') && <Card>
        <CardHead title="Quotations" />
        {quotes.map(q => <QuoteRowCompact key={q.id} q={q} />)}
        {!quotes.length && <p style={{ margin: 0, padding: 20, fontSize: 14, color: '#64748b' }}>No quotations yet.</p>}
      </Card>}
      {can('billing') && <Card>
        <CardHead title="Invoices" />
        {invoices.map(i => <InvoiceRowCompact key={i.id} i={i} />)}
        {!invoices.length && <p style={{ margin: 0, padding: 20, fontSize: 14, color: '#64748b' }}>Nothing billed yet.</p>}
      </Card>}
    </div>
  </>;
}
