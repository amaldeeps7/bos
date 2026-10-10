'use client';
import { useRouter } from 'next/navigation';
import { INVOICE_STATUS, fmtD, inr } from '@bos/shared';
import { ExportBtn } from '@/components/export-btn';
import { DateRange, EmptyFiltered, FilterBar, MultiFilter, SearchBox, SortHead, Toggle, inRange, listOf, rangeOf, sortRows, useUrlState } from '@/components/filters';
import { useApp, useQ } from '@/lib/app';
import type { Customer, Invoice } from '@/lib/types';
import { Btn, Card, PageHead, Status, Tabs } from '@/components/ui';

type Tab = 'all' | 'action' | 'unpaid' | 'paid';
const COLS = 'minmax(240px,2fr) minmax(150px,1.1fr) 140px 90px 120px 120px';

export default function Invoices() {
  const router = useRouter(); const { has, me, today } = useApp();
  const invoices = useQ<Invoice[]>('invoices').data || [];
  const custs = useQ<Customer[]>('customers').data || [];
  const cust = new Map(custs.map(c => [c.id, c.name])); const cfull = new Map(custs.map(c => [c.id, c]));
  const [f, set] = useUrlState({ tab: 'all', q: '', customer: '', entity: '', period: '', from: '', to: '', overdue: '', sort: '' });
  const tab = f.tab as Tab; const setTab = (t: Tab) => set({ tab: t });
  const custF = listOf(f.customer), entF = listOf(f.entity); const range = rangeOf(f.period, f.from, f.to, today, me.org.fyStart);
  const q = f.q.trim().toLowerCase();
  const active = !!(f.q || f.customer || f.entity || f.period || f.overdue);
  const clear = () => set({ q: '', customer: '', entity: '', period: '', from: '', to: '', overdue: '' });
  const sortBy = (s: string) => set({ sort: s });
  // One row per invoice, with the GST split an accountant files from.
  const tax = (i: Invoice, kind: string) => i.calc.taxRows.filter(([l]) => l.startsWith(kind)).reduce((a, [, v]) => a + v, 0);
  const csvRows = () => rows.map(i => { const c = cfull.get(i.customerId); return {
    'Invoice no.': i.no.startsWith('DRAFT-') ? '' : i.no, Date: i.date, 'Due date': i.due, Status: INVOICE_STATUS[i.displayStatus]?.[0] || i.displayStatus,
    Customer: c?.name || '', 'Customer GSTIN': c?.gstin || '', 'Place of supply': c?.state || '', 'Issued by': i.entity, Title: i.title,
    'Taxable value': i.calc.taxable, CGST: tax(i, 'CGST'), SGST: tax(i, 'SGST'), IGST: tax(i, 'IGST'), Total: i.calc.grand, Received: i.paid, Credited: i.credited, Balance: i.bal }; });
  const tf: Record<Tab, (i: Invoice) => boolean> = { all: () => true, action: i => ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED'].includes(i.status), unpaid: i => i.bal > 0, paid: i => i.status === 'PAID' };
  const matches = (i: Invoice) => (!q || `${i.no} ${i.title} ${cust.get(i.customerId) || ''}`.toLowerCase().includes(q)) && (!custF.length || custF.includes(i.customerId))
    && (!entF.length || entF.includes(i.entityId)) && inRange(i.date, range) && (!f.overdue || i.overdue);
  const rows = sortRows(invoices.filter(x => tf[tab](x) && matches(x)), f.sort, (i, k) => (k === 'no' ? i.no : k === 'customer' ? cust.get(i.customerId) || '' : k === 'status' ? i.displayStatus : k === 'due' ? i.due : k === 'total' ? i.calc.grand : k === 'balance' ? i.bal : i.date));
  const stat = (label: string, v: string, red?: boolean) => <div><p style={{ margin: 0, fontSize: 13, color: '#64748b', fontWeight: 500 }}>{label}</p><p className="num" style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 600, color: red ? '#be123c' : undefined }}>{v}</p></div>;
  return <>
    <PageHead title="Invoices" sub="Raised from milestones, quotations, or from scratch. GST follows the customer's place of supply." subStyle={{ maxWidth: '62ch' }} right={
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '16px 28px' }}>
        {stat('Outstanding', inr(invoices.reduce((a, i) => a + i.bal, 0)))}{stat('Overdue', inr(invoices.filter(i => i.overdue).reduce((a, i) => a + i.bal, 0)), true)}
        <ExportBtn name="invoices" rows={csvRows} />
        {has('invoice.create') && <Btn kind="pri" icon="plus" onClick={() => router.push('/invoices/new')}>New invoice</Btn>}
      </div>} />
    <Tabs tabs={([['all', 'All'], ['action', 'To finish'], ['unpaid', 'Unpaid'], ['paid', 'Paid']] as [Tab, string][]).map(([id, label]) => ({ id, label, count: invoices.filter(x => tf[id](x) && matches(x)).length }))} value={tab} onChange={setTab} />
    <FilterBar active={active} onClear={clear}>
      <SearchBox value={f.q} onChange={v => set({ q: v })} placeholder="Search number, title, customer" />
      <MultiFilter label="Customer" value={custF} onChange={v => set({ customer: v.join(',') })} options={[...new Set(invoices.map(i => i.customerId))].map(id => ({ value: id, label: cust.get(id) || '' })).sort((a, b) => a.label.localeCompare(b.label))} />
      {me.entities.length > 1 && <MultiFilter label="Issued by" value={entF} onChange={v => set({ entity: v.join(',') })} options={me.entities.map(e => ({ value: e.id, label: e.name }))} />}
      <DateRange label="Invoice date" period={f.period} from={f.from} to={f.to} onChange={v => set(v)} />
      <Toggle label="Overdue only" on={!!f.overdue} onChange={v => set({ overdue: v ? '1' : '' })} />
    </FilterBar>
    <Card style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 900 }}>
        <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: COLS }}><SortHead label="Invoice" k="no" sort={f.sort} onSort={sortBy} /><SortHead label="Customer" k="customer" sort={f.sort} onSort={sortBy} /><SortHead label="Status" k="status" sort={f.sort} onSort={sortBy} /><SortHead label="Due" k="due" sort={f.sort} onSort={sortBy} /><SortHead label="Total" k="total" sort={f.sort} onSort={sortBy} align="right" /><SortHead label="Balance" k="balance" sort={f.sort} onSort={sortBy} align="right" /></div>
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
        {!rows.length && <EmptyFiltered onClear={active ? clear : undefined} text={active ? undefined : 'Nothing here.'} />}
      </div>
    </Card>
  </>;
}
