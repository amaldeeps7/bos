'use client';
import { useRouter } from 'next/navigation';
import { QUOTE_STATUS, fmtD, inr } from '@bos/shared';
import { ExportBtn } from '@/components/export-btn';
import { DateRange, EmptyFiltered, FilterBar, MultiFilter, SearchBox, SortHead, Toggle, inRange, listOf, rangeOf, sortRows, useUrlState } from '@/components/filters';
import { useApp, useQ } from '@/lib/app';
import type { Customer, Quote } from '@/lib/types';
import { Btn, Card, PageHead, Status, Tabs } from '@/components/ui';

type Tab = 'all' | 'draft' | 'sent' | 'won';
const COLS = 'minmax(240px,2fr) minmax(160px,1.2fr) 150px 100px 130px';

export default function Quotes() {
  const router = useRouter(); const { has, me, today } = useApp();
  const quotes = useQ<Quote[]>('quotes').data || [];
  const cust = new Map((useQ<Customer[]>('customers').data || []).map(c => [c.id, c.name]));
  const [fl, set] = useUrlState({ tab: 'all', q: '', customer: '', period: '', from: '', to: '', sort: '' });
  const tab = fl.tab as Tab; const setTab = (t: Tab) => set({ tab: t });
  const custF = listOf(fl.customer); const range = rangeOf(fl.period, fl.from, fl.to, today, me.org.fyStart); const q = fl.q.trim().toLowerCase();
  const active = !!(fl.q || fl.customer || fl.period);
  const clear = () => set({ q: '', customer: '', period: '', from: '', to: '' });
  const sortBy = (s: string) => set({ sort: s });
  const matches = (x: Quote) => (!q || `${x.no} ${x.title} ${cust.get(x.customerId) || ''}`.toLowerCase().includes(q)) && (!custF.length || custF.includes(x.customerId)) && inRange(x.date, range);
  const f: Record<Tab, (q: Quote) => boolean> = { all: () => true, draft: q => ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(q.status), sent: q => q.status === 'SENT', won: q => ['ACCEPTED', 'CONVERTED'].includes(q.status) };
  const rows = sortRows(quotes.filter(x => f[tab](x) && matches(x)).sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no)), fl.sort,
    (x, k) => (k === 'no' ? x.no : k === 'customer' ? cust.get(x.customerId) || '' : k === 'status' ? x.status : k === 'valid' ? x.validUntil : x.calc.grand));
  return <>
    <PageHead title="Quotations" sub="Priced proposals. Accepted ones become a project or an invoice without re-keying." right={<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <ExportBtn name="quotations" rows={() => rows.map(q => ({ 'Quotation no.': q.no, Version: q.ver, Date: q.date, 'Valid until': q.validUntil, Status: QUOTE_STATUS[q.status]?.[0] || q.status, Customer: cust.get(q.customerId) || '', Title: q.title, 'Issued by': q.entity, Subtotal: q.calc.sub, Discount: q.calc.disc, 'Taxable value': q.calc.taxable, GST: q.calc.tax, Total: q.calc.grand }))} />
      {has('quote.create') && <Btn kind="pri" icon="plus" onClick={() => router.push('/quotes/new')}>New quotation</Btn>}</div>} />
    <Tabs tabs={([['all', 'All'], ['draft', 'In progress'], ['sent', 'With customer'], ['won', 'Won']] as [Tab, string][]).map(([id, label]) => ({ id, label, count: quotes.filter(x => f[id](x) && matches(x)).length }))} value={tab} onChange={setTab} />
    <FilterBar active={active} onClear={clear}>
      <SearchBox value={fl.q} onChange={v => set({ q: v })} placeholder="Search number, title, customer" />
      <MultiFilter label="Customer" value={custF} onChange={v => set({ customer: v.join(',') })} options={[...new Set(quotes.map(x => x.customerId))].map(id => ({ value: id, label: cust.get(id) || '' })).sort((a, b) => a.label.localeCompare(b.label))} />
      <DateRange label="Date" period={fl.period} from={fl.from} to={fl.to} onChange={v => set(v)} />
    </FilterBar>
    <Card style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 820 }}>
        <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: COLS }}><SortHead label="Quotation" k="no" sort={fl.sort} onSort={sortBy} /><SortHead label="Customer" k="customer" sort={fl.sort} onSort={sortBy} /><SortHead label="Status" k="status" sort={fl.sort} onSort={sortBy} /><SortHead label="Valid until" k="valid" sort={fl.sort} onSort={sortBy} /><SortHead label="Total" k="total" sort={fl.sort} onSort={sortBy} align="right" /></div>
        {rows.map(q => (
          <button key={q.id} onClick={() => router.push(`/quotes/${q.id}`)} className="row-btn" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '12px 20px' }}>
            <span><span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{q.title}</span><span className="mono" style={{ display: 'block', fontSize: 12.5, color: '#64748b' }}>{q.no}</span></span>
            <span>{cust.get(q.customerId)}</span>
            <span><Status def={QUOTE_STATUS[q.status]} /></span>
            <span style={{ color: '#64748b' }}>{fmtD(q.validUntil)}</span>
            <span className="num" style={{ textAlign: 'right', fontWeight: 500 }}>{inr(q.calc.grand)}</span>
          </button>
        ))}
        {!rows.length && <EmptyFiltered onClear={active ? clear : undefined} text={active ? undefined : 'Nothing here.'} />}
      </div>
    </Card>
  </>;
}
