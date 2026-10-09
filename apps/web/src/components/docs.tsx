'use client';
import { Fragment, ReactNode, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { INVOICE_STATUS, QUOTE_STATUS, UNISSUED, Calc, Line, calc, diffDays, fmtD, gstText, inr } from '@bos/shared';
import { useAct, useApp, useQ } from '@/lib/app';
import { api, ApiError } from '@/lib/api';
import { editorStore } from '@/lib/editor-store';
import type { CatalogItem, Customer, Invoice, Payment, Project, Quote } from '@/lib/types';
import { Back, Banner, Btn, Card, CardHead, Icon, Metric, Metrics, PageHead, Status } from './ui';
import { useQueryClient } from '@tanstack/react-query';

const Dot = () => <span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor' }} />;
function CompactRow({ title, no, meta, status, amount, onClick }: { title: string; no: string; meta: string; status: ReactNode; amount: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="row-btn" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', padding: '12px 20px' }}>
      <span style={{ flex: '1 1 180px', minWidth: 0 }}><span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{title}</span><span style={{ display: 'block', fontSize: 13, color: '#64748b' }}><span className="mono" style={{ fontSize: 12.5 }}>{no}</span> · {meta}</span></span>
      {status}
      <span className="num" style={{ width: 110, textAlign: 'right', fontSize: 14, fontWeight: 500 }}>{amount}</span>
    </button>
  );
}
export function QuoteRowCompact({ q }: { q: Quote }) {
  const router = useRouter();
  return <CompactRow title={q.title} no={q.no} meta={`valid to ${fmtD(q.validUntil)}`} status={<Status def={QUOTE_STATUS[q.status]} />} amount={inr(q.calc.grand)} onClick={() => router.push(`/quotes/${q.id}`)} />;
}
export function InvoiceRowCompact({ i }: { i: Invoice }) {
  const router = useRouter();
  return <CompactRow title={i.title} no={i.no} meta={`due ${fmtD(i.due)}`} status={<Status def={INVOICE_STATUS[i.displayStatus]} />} amount={inr(i.calc.grand)} onClick={() => router.push(`/invoices/${i.id}`)} />;
}

function totalsRows(k: Calc) {
  const rows: [string, string, boolean?][] = [['Subtotal', inr(k.sub)], ...(k.disc ? [['Discount', '−' + inr(k.disc)] as [string, string]] : []), ['Taxable value', inr(k.taxable)], ...k.taxRows.map(([l, v]) => [l, inr(v), true] as [string, string, boolean])];
  return rows.map(([label, value, muted]) => <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14, color: muted ? '#64748b' : '#0f172a' }}><span>{label}</span><span>{value}</span></div>);
}
const kindStyle = (c: string) => ({ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' as const, color: c });
const DCOLS = 'minmax(220px,2.4fr) 76px 90px 110px 60px 120px 110px 120px';

type Act = { label: string; icon: string; kind: 'pri' | 'sec' | 'demo'; go: () => void };

/** A quotation or invoice: header with status actions, banner, figures, the printable body and payments. */
export function DocView({ kind, id }: { kind: 'quote' | 'invoice'; id: string }) {
  const router = useRouter(); const act = useAct();
  const { me, setUi, has, person, today } = useApp();
  const customers = useQ<Customer[]>('customers').data || [];
  const quotes = useQ<Quote[]>(kind === 'quote' ? 'quotes' : null).data;
  const invoices = useQ<Invoice[]>('invoices', kind === 'invoice' || has('invoice.read')).data;
  const projects = useQ<Project[]>('projects').data || [];
  const payments = useQ<Payment[]>(kind === 'invoice' && has('payment.read') ? 'payments' : null).data || [];
  const actorsQ = useQ<Record<string, { self: boolean; name: string } | null>>('invoices/actors', has('invoice.read'));
  const actors = actorsQ.data || {};
  // Hold the action buttons until we know who can carry out each step, so they don't shift under the pointer.
  const actorsReady = !has('invoice.read') || !!actorsQ.data;
  const doc = kind === 'quote' ? quotes?.find(q => q.id === id) : invoices?.find(i => i.id === id);
  if (!doc) return <p style={{ color: '#64748b' }}>Loading…</p>;
  const c = customers.find(x => x.id === doc.customerId); const k = doc.calc;
  const tpl = me.org.templates?.[kind] || { title: kind === 'quote' ? 'Quotation' : 'Tax invoice', accent: '#0052ff' };
  const le = me.org.entity;
  const A: Act[] = []; const add = (label: string, icon: string, kind_: Act['kind'], go: () => void) => A.push({ label, icon, kind: kind_, go });
  const path = kind === 'quote' ? 'quotes' : 'invoices';
  const run = (action: string, body: object = {}) => act(`${path}/${doc.id}/${action}`, body);
  const actorBtn = (perm: string, label: string, icon: string, action: string, verb: string) => {
    const a = actors[perm]; if (!a) return;
    a.self ? add(label, icon, 'pri', () => run(action)) : me.demo && add(`${verb} as ${a.name.split(' ')[0]} (demo)`, 'icon-user-check', 'demo', () => run(action));
  };
  const appr = doc.approval; const mine = appr?.approverId === me.user.id;
  const approveBtns = () => {
    if (!appr) return;
    if (mine) { add('Send back', 'icon-undo-2', 'sec', () => run('reject')); add('Approve', 'icon-check', 'pri', () => run('approve')); }
    else if (me.demo) add(`Approve as ${appr.approverName.split(' ')[0]} (demo)`, 'icon-user-check', 'demo', () => kind === 'quote' ? act(`approvals/${appr.id}/decide`, { approve: true, demo: true }, { msg: `${doc.no} approved — it can go to the customer.` }) : run('approve', { demo: true }));
  };
  let banner: { tone: any; icon: string; title: string; text: string; actions?: Act[] } | null = null;
  let metrics: ReactNode; let meta: [string, string][]; let sub: string; let badge: ReactNode; let pays: ReactNode = null;

  if (kind === 'quote') {
    const q = doc as Quote;
    if (q.status === 'DRAFT') { has('quote.update') && add('Edit', 'icon-pencil', 'sec', () => router.push(`/quotes/${q.id}/edit`)); has('quote.create') && add('Submit for approval', 'icon-send', 'pri', () => run('submit')); }
    if (q.status === 'PENDING_APPROVAL') approveBtns();
    if (q.status === 'APPROVED') actorBtn('quote.send', 'Send to customer', 'icon-mail', 'send', 'Send');
    if (q.status === 'SENT') { has('quote.update') && add('Revise', 'icon-pencil', 'sec', () => router.push(`/quotes/${q.id}/edit`)); add('Customer declined', 'icon-x', 'sec', () => run('decline')); add('Customer accepted', 'icon-check', 'pri', () => run('accept')); }
    add('PDF', 'icon-download', 'sec', () => window.open(`/api/quotes/${q.id}/pdf`, '_blank'));
    if (q.status === 'DRAFT' && q.rejected) banner = { tone: 'danger', icon: 'icon-undo-2', title: 'Sent back for changes.', text: q.rejected };
    if (q.status === 'PENDING_APPROVAL') banner = { tone: 'warning', icon: 'icon-hourglass', title: mine ? `${person(q.byId).name} needs your approval.` : `Waiting on ${appr?.approverName || 'the Owner'}.`, text: k.maxDisc > me.org.discLimit ? `A ${k.maxDisc}% discount is above the ${me.org.discLimit}% limit, so a second person signs off. Whoever raises a quotation can't approve it.` : 'Routed by approval policy.' };
    if (q.status === 'ACCEPTED') banner = { tone: 'success', icon: 'icon-circle-check', title: 'The customer accepted this quotation.', text: 'Turn it into a project with milestones, or bill it in full now.', actions: [
      ...(has('project.create') ? [{ label: 'Create project', icon: 'icon-folder-plus', kind: 'sec' as const, go: async () => { const r = await run('to-project'); if (r?.projectId) router.push(`/projects/${r.projectId}`); } }] : []),
      ...(has('invoice.create') ? [{ label: 'Raise invoice', icon: 'icon-file-plus', kind: 'pri' as const, go: async () => { const r = await run('to-invoice'); if (r?.invoiceId) router.push(`/invoices/${r.invoiceId}`); } }] : [])] };
    if (q.status === 'CONVERTED') { const p = projects.find(x => x.id === q.projectId); const i = invoices?.find(x => x.id === q.invoiceId);
      banner = { tone: 'info', icon: 'icon-link', title: p ? `Converted into ${p.name} (${p.code}).` : i ? `Billed on ${i.no}.` : 'Converted.', text: 'The lines carried over, so nobody re-keyed them.',
        actions: p ? [{ label: 'Open project', icon: 'icon-arrow-right', kind: 'sec', go: () => router.push(`/projects/${p.id}`) }] : i ? [{ label: 'Open invoice', icon: 'icon-arrow-right', kind: 'sec', go: () => router.push(`/invoices/${i.id}`) }] : [] }; }
    if (q.status === 'DECLINED') banner = { tone: 'danger', icon: 'icon-circle-x', title: 'The customer declined.', text: 'Revise and resend, or leave it closed.' };
    const expired = diffDays(q.validUntil, today) < 0 && !['CONVERTED', 'DECLINED'].includes(q.status);
    metrics = <><Metric label="Total incl. GST" value={inr(k.grand)} /><Metric label="Taxable value" value={inr(k.taxable)} /><Metric label="Discount given" value={k.disc ? inr(k.disc) : '—'} /><Metric label="Valid until" value={fmtD(q.validUntil)} danger={expired} /></>;
    meta = [['Quotation no.', q.no], ['Date', fmtD(q.date)], ['Valid until', fmtD(q.validUntil)], ['Prepared by', person(q.byId).name]];
    sub = `${q.title} for ${c?.name || ''}`;
    badge = <>{<Status def={QUOTE_STATUS[q.status]} />}{q.ver > 1 && <span style={{ fontSize: 14, color: '#64748b' }}>Version {q.ver}</span>}</>;
  } else {
    const i = doc as Invoice;
    const pay = () => { if (!has('payment.create') && !actors['payment.create']) return; A.push({ label: actors['payment.create']?.self ? 'Record payment' : `Record payment${me.demo ? ` as ${actors['payment.create']?.name.split(' ')[0]} (demo)` : ''}`, icon: 'icon-wallet', kind: actors['payment.create']?.self ? 'pri' : 'demo', go: () => setUi({ pay: i.id }) }); };
    const remind: Act = { label: 'Send reminder', icon: 'icon-bell-ring', kind: 'sec', go: () => run('remind') };
    if (i.status === 'DRAFT') { has('invoice.update_draft') && add('Edit', 'icon-pencil', 'sec', () => router.push(`/invoices/${i.id}/edit`)); has('invoice.create') && add('Submit for approval', 'icon-send', 'pri', () => run('submit')); }
    if (i.status === 'PENDING_APPROVAL') approveBtns();
    if (i.status === 'APPROVED') actorBtn('invoice.issue', 'Issue invoice', 'icon-stamp', 'issue', 'Issue');
    if (i.status === 'ISSUED') actorBtn('invoice.send', 'Send to customer', 'icon-mail', 'send', 'Send');
    if (['SENT', 'PARTIALLY_PAID'].includes(i.status) && !i.overdue) { A.push(remind); pay(); }
    if (i.overdue) pay();
    if (i.projectId) add('Project', 'icon-folder-kanban', 'sec', () => router.push(`/projects/${i.projectId}`));
    if (!UNISSUED.includes(i.status) && i.bal > 0 && has('credit_note.create')) add('Credit note', 'icon-receipt', 'sec', () => setUi({ credit: i.id }));
    if (['SENT', 'PARTIALLY_PAID'].includes(i.status) && actors['invoice.send']?.self) add('Email again', 'icon-mail', 'sec', () => run('send'));
    add('PDF', 'icon-download', 'sec', () => window.open(`/api/invoices/${i.id}/pdf`, '_blank'));
    if (i.status === 'DRAFT') banner = i.rejected ? { tone: 'danger', icon: 'icon-undo-2', title: 'Sent back for changes.', text: i.rejected } : { tone: 'neutral', icon: 'icon-file-pen', title: 'Draft — not yet sent anywhere.', text: 'Submit it and Finance approves before it is issued.' };
    if (i.status === 'PENDING_APPROVAL') banner = { tone: 'warning', icon: 'icon-hourglass', title: mine ? `${person(i.byId).name} needs your approval to issue this.` : `Waiting on ${appr?.approverName || 'Finance'}.`, text: 'Whoever raises an invoice can’t approve it themselves.' };
    if (i.status === 'APPROVED') banner = { tone: 'info', icon: 'icon-badge-check', title: 'Approved — ready to issue.', text: 'Issuing locks the figures. After that, corrections go on a credit note.' };
    if (i.overdue) banner = { tone: 'danger', icon: 'icon-circle-alert', title: `Overdue by ${-diffDays(i.due, today)} days.`, text: `${inr(i.bal)} outstanding. Billing contact: ${c?.contact}, ${c?.email}.`, actions: [remind] };
    const mine_ = payments.filter(r => r.allocations.some(a => a.invoiceId === i.id));
    if (i.status === 'PAID') { const last = mine_[0]; banner = { tone: 'success', icon: 'icon-circle-check', title: 'Paid in full.', text: last ? `Last receipt ${last.no} on ${fmtD(last.date)} by ${last.method}.` : '' }; }
    metrics = <><Metric label="Total incl. GST" value={inr(k.grand)} /><Metric label="Received" value={inr(i.paid)} />{i.credited > 0 && <Metric label="Credited" value={inr(i.credited)} />}<Metric label="Balance due" value={inr(i.bal)} danger={i.overdue} /><Metric label="Due" value={fmtD(i.due)} danger={i.overdue} /></>;
    meta = [['Invoice no.', i.no], ['Invoice date', fmtD(i.date)], ['Due date', fmtD(i.due)], ['Terms', `Net ${diffDays(i.due, i.date)}`]];
    sub = `${i.title} · ${c?.name || ''}`;
    badge = <Status def={INVOICE_STATUS[i.displayStatus]} />;
    const rows = mine_.flatMap(r => r.allocations.filter(a => a.invoiceId === i.id).map(a => ({ ...r, amt: a.amount })));
    if (rows.length) pays = (
      <Card>
        <CardHead title="Payments received" />
        {rows.map(r => (
          <div key={r.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 16px', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
            <span className="mono" style={{ fontSize: 13, width: 130 }}>{r.no}</span>
            <span style={{ flex: '1 1 200px', color: '#64748b' }}>{fmtD(r.date)} · {r.method} · {r.ref}</span>
            <span className="num" style={{ fontWeight: 500 }}>{inr(r.amt)}</span>
          </div>
        ))}
      </Card>
    );
  }
  const btn = (a: Act, i: number) => <Btn key={i} kind={a.kind} icon={a.icon} onClick={a.go} style={{ gap: 6 }}>{a.label}</Btn>;

  return <>
    <Back label={kind === 'quote' ? 'Quotations' : 'Invoices'} onClick={() => router.push(`/${path}`)} />
    <PageHead title={doc.no} badge={badge} sub={sub} right={<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, minHeight: 40 }}>{actorsReady && A.map(btn)}</div>} />
    {banner && <Banner tone={banner.tone} icon={banner.icon} title={banner.title} text={banner.text} actions={banner.actions?.length ? banner.actions.map(btn) : undefined} />}
    <Metrics>{metrics}</Metrics>
    <Card>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px 16px', padding: '20px 28px 0' }}>
        <p style={kindStyle(tpl.accent)}>{tpl.title}</p>
        <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{k.intra ? 'Intra-state supply · CGST + SGST' : `Inter-state supply to ${c?.state} · IGST`}</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '20px 28px', padding: '16px 28px 22px', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: '0 0 4px', fontSize: 13, color: '#64748b' }}>From</p>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{le?.name}</p>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: '#475569' }}>GSTIN <span className="mono">{le?.gstin}</span></p>
          <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>{le?.address}</p>
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: '0 0 4px', fontSize: 13, color: '#64748b' }}>Bill to</p>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{c?.name}</p>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: '#475569' }}>GSTIN <span className="mono">{c?.gstin}</span></p>
          <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>{c?.city}, {c?.state}</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px', alignContent: 'start', fontSize: 13 }}>
          {meta.map(([kk, v]) => <Fragment key={kk}><span style={{ color: '#64748b' }}>{kk}</span><span style={{ fontWeight: 500, textAlign: 'right' }}>{v}</span></Fragment>)}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 900 }}>
          <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: DCOLS, gap: 12, padding: '10px 28px' }}><span>Description</span><span>SAC</span><span style={{ textAlign: 'right' }}>Qty</span><span style={{ textAlign: 'right' }}>Rate</span><span style={{ textAlign: 'right' }}>Disc.</span><span style={{ textAlign: 'right' }}>Taxable</span><span style={{ textAlign: 'right' }}>GST</span><span style={{ textAlign: 'right' }}>Total</span></div>
          {k.rows.map((r, i) => (
            <div key={i} className="num" style={{ display: 'grid', gridTemplateColumns: DCOLS, gap: 12, alignItems: 'baseline', padding: '12px 28px', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
              <span style={{ fontWeight: 500 }}>{r.d}</span><span className="mono" style={{ fontSize: 12.5, color: '#64748b' }}>{r.sac}</span>
              <span style={{ textAlign: 'right' }}>{r.qty} {r.unit}</span><span style={{ textAlign: 'right' }}>{inr(r.rate)}</span><span style={{ textAlign: 'right', color: '#64748b' }}>{+r.disc ? r.disc + '%' : '—'}</span>
              <span style={{ textAlign: 'right' }}>{inr(r.taxable)}</span><span style={{ textAlign: 'right', color: '#64748b' }}>{inr(r.tax)}</span><span style={{ textAlign: 'right', fontWeight: 500 }}>{inr(r.total)}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '20px 40px', padding: '18px 28px 24px' }}>
        <div style={{ flex: '1 1 260px', maxWidth: '52ch' }}>{doc.notes && <><p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Notes</p><p style={{ margin: '4px 0 0', fontSize: 14, lineHeight: 1.5 }}>{doc.notes}</p></>}</div>
        <div className="num" style={{ width: 300, maxWidth: '100%' }}>
          {totalsRows(k)}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingTop: 10, borderTop: '1px solid #cbd5e1', fontSize: 16, fontWeight: 600 }}><span>Total (INR)</span><span>{inr(k.grand)}</span></div>
        </div>
      </div>
    </Card>
    {pays}
  </>;
}

const ECOLS = 'minmax(220px,2.4fr) 90px 70px 84px 110px 70px 120px 36px';
const blankLine = (): Line => ({ d: '', qty: 1, unit: 'day', rate: 0, disc: 0, sac: '998314' });

/** Builder for quotations and invoices: catalogue lines, discounts, live GST and the approval-policy check. */
export function DocEditor({ kind, id }: { kind: 'quote' | 'invoice'; id?: string }) {
  const router = useRouter(); const params = useSearchParams(); const { me, toast } = useApp(); const qc = useQueryClient();
  const customers = useQ<Customer[]>('customers').data || [];
  const catalog = useQ<CatalogItem[]>('catalog').data || [];
  const docs = useQ<(Quote | Invoice)[]>(id ? (kind === 'quote' ? 'quotes' : 'invoices') : null).data;
  const doc = id ? docs?.find(x => x.id === id) : undefined;
  const isQ = kind === 'quote';
  const [ed, setEd] = useState<{ cust: string; title: string; days: number; lines: Line[]; notes: string } | null>(null);
  useEffect(() => {
    if (ed || !customers.length || (id && !doc)) return;
    const c = customers.find(x => x.id === (doc?.customerId || params.get('customer'))) || customers[0];
    setEd({ cust: c.id, title: doc?.title || '', notes: doc?.notes || '', lines: doc ? doc.lines.map(l => ({ ...l })) : [blankLine()],
      days: doc ? diffDays(isQ ? (doc as Quote).validUntil : (doc as Invoice).due, doc.date) : isQ ? 30 : c.terms });
  }, [customers, doc, id, ed, isQ, params]);
  const ec = customers.find(x => x.id === ed?.cust);
  const k = useMemo(() => ed ? calc(ed.lines, ec?.state, me.org.ourState, me.org.sacRates) : null, [ed, ec, me.org]);
  useEffect(() => { editorStore.lines = ed?.lines || []; return () => { editorStore.lines = []; }; }, [ed]);
  if (!ed || !k) return <p style={{ color: '#64748b' }}>Loading…</p>;
  const limit = me.org.discLimit; const revise = !!doc && doc.status !== 'DRAFT';
  const setLine = (i: number, f: keyof Line, v: string) => setEd({ ...ed, lines: ed.lines.map((l, j) => (j === i ? { ...l, [f]: v } : l)) });
  const back = () => router.push(id ? `/${isQ ? 'quotes' : 'invoices'}/${id}` : `/${isQ ? 'quotes' : 'invoices'}`);
  const save = async (submit: boolean) => {
    try {
      const r = await api<{ id: string; message: string }>(isQ ? 'quotes' : 'invoices', { body: { id, customerId: ed.cust, title: ed.title, days: ed.days, lines: ed.lines, notes: ed.notes, submit } });
      await qc.invalidateQueries(); toast(r.message); router.push(`/${isQ ? 'quotes' : 'invoices'}/${r.id}`);
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save.'); }
  };
  const opts = isQ ? [15, 30, 45, 60] : [7, 15, 30, 45, 60]; if (!opts.includes(ed.days)) opts.push(ed.days); opts.sort((a, b) => a - b);
  const inp = { height: 38, minWidth: 0, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 8px', fontSize: 14, outlineColor: '#0052ff' } as const;
  const right = { ...inp, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' };
  return <>
    <Back label={isQ ? 'Quotations' : 'Invoices'} onClick={back} />
    <PageHead title={doc ? `${revise ? 'Revise' : 'Edit'} ${doc.no}` : isQ ? 'New quotation' : 'New invoice'}
      sub={isQ ? (revise ? 'Saving creates the next version as a draft. It needs approval again before it goes out.' : `Saved as a draft. Discounts over ${limit}% go to the Owner for approval.`) : 'Saved as a draft. Finance approves before it is issued and numbered for the customer.'} />
    <Card style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '14px 16px' }}>
      <label className="label">Customer<select className="select" value={ed.cust} onChange={e => { const nc = customers.find(x => x.id === e.target.value)!; setEd({ ...ed, cust: nc.id, days: isQ ? ed.days : nc.terms }); }}>{customers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label className="label">{isQ ? 'Quotation title' : 'Invoice title'}<input className="input" value={ed.title} onChange={e => setEd({ ...ed, title: e.target.value })} placeholder="e.g. Parent app — phase 1" /></label>
      <label className="label">{isQ ? 'Valid for' : 'Payment terms'}<select className="select" value={String(ed.days)} onChange={e => setEd({ ...ed, days: +e.target.value })}>{opts.map(n => <option key={n} value={String(n)}>{isQ ? `${n} days` : `Net ${n}`}</option>)}</select></label>
      <div className="label">Place of supply<span className="ellipsis" style={{ height: 42, display: 'flex', alignItems: 'center', padding: '0 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0', fontWeight: 400, color: '#334155' }}>{ec?.state} — {gstText(k.intra)}</span></div>
    </Card>
    <Card>
      <CardHead title="Lines" sub="Pick from the catalogue or type your own. GST is calculated per line." />
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 880 }}>
          <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: ECOLS, gap: 10 }}><span>Description</span><span>SAC</span><span style={{ textAlign: 'right' }}>Qty</span><span>Unit</span><span style={{ textAlign: 'right' }}>Rate (₹)</span><span style={{ textAlign: 'right' }}>Disc. %</span><span style={{ textAlign: 'right' }}>Amount</span><span /></div>
          {ed.lines.map((l, i) => { const over = (+l.disc || 0) > limit;
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: ECOLS, gap: 10, alignItems: 'center', padding: '8px 20px', borderBottom: '1px solid #f1f5f9' }}>
                <input value={l.d} onChange={e => setLine(i, 'd', e.target.value)} placeholder="What are you charging for?" style={{ ...inp, padding: '0 10px' }} />
                <input value={l.sac} onChange={e => setLine(i, 'sac', e.target.value)} className="mono" style={{ ...inp, fontSize: 13 }} />
                <input value={String(l.qty)} onChange={e => setLine(i, 'qty', e.target.value)} inputMode="decimal" style={right} />
                <input value={l.unit} onChange={e => setLine(i, 'unit', e.target.value)} style={inp} />
                <input value={String(l.rate)} onChange={e => setLine(i, 'rate', e.target.value)} inputMode="decimal" style={right} />
                <input value={String(l.disc)} onChange={e => setLine(i, 'disc', e.target.value)} inputMode="decimal" style={{ ...right, border: over ? '1px solid #b45309' : '1px solid #cbd5e1', background: over ? '#fffbeb' : '#fff' }} />
                <span className="num" style={{ textAlign: 'right', fontSize: 14, fontWeight: 500 }}>{inr(k.rows[i].taxable)}</span>
                <button onClick={() => setEd({ ...ed, lines: ed.lines.filter((_, j) => j !== i) })} aria-label="Remove line" className="trash"><Icon name="trash-2" size={15} /></button>
              </div>
            ); })}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
        <select value="" onChange={e => { const x = catalog.find(c => c.id === e.target.value); if (x) setEd({ ...ed, lines: [...ed.lines.filter(l => String(l.d).trim() || +l.rate), { d: x.d, qty: 1, unit: x.unit, rate: x.rate, disc: 0, sac: x.sac }] }); }} style={{ height: 36, maxWidth: '100%', border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 10px', fontSize: 14, background: '#fff', color: '#0f172a' }}>
          <option value="">Add from catalogue…</option>{catalog.map(x => <option key={x.id} value={x.id}>{x.d} — {inr(x.rate)} / {x.unit}</option>)}
        </select>
        <Btn icon="plus" onClick={() => setEd({ ...ed, lines: [...ed.lines, blankLine()] })} style={{ height: 36, boxShadow: 'none', gap: 6 }}>Blank line</Btn>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '20px 40px', padding: '18px 20px 22px' }}>
        <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {isQ && k.maxDisc > limit && <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, background: '#fffbeb', border: '1px solid rgba(180,83,9,.2)', color: '#b45309', fontSize: 14 }}><Icon name="triangle-alert" size={16} style={{ marginTop: 2 }} /><span style={{ color: '#0f172a' }}>A {k.maxDisc}% discount is above the {limit}% limit — the Owner will be asked to approve.</span></div>}
          <label className="label">Notes for the customer<textarea className="textarea" rows={3} value={ed.notes} onChange={e => setEd({ ...ed, notes: e.target.value })} placeholder="Scope, assumptions, payment milestones…" /></label>
        </div>
        <div className="num" style={{ width: 300, maxWidth: '100%' }}>
          {totalsRows(k)}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingTop: 10, borderTop: '1px solid #cbd5e1', fontSize: 16, fontWeight: 600 }}><span>Total (INR)</span><span>{inr(k.grand)}</span></div>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', borderRadius: '0 0 12px 12px' }}>
        <Btn onClick={back} style={{ boxShadow: 'none' }}>Cancel</Btn>
        <Btn onClick={() => save(false)} style={{ boxShadow: 'none' }}>Save draft</Btn>
        <Btn kind="pri" icon="send" onClick={() => save(true)} style={{ gap: 6 }}>Submit for approval</Btn>
      </div>
    </Card>
  </>;
}
