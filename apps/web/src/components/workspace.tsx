'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { STATE_CODES, isValidGstin, stateOf } from '@bos/shared';
import { api, ApiError } from '@/lib/api';
import { useAct, useApp, useQ } from '@/lib/app';
import type { DataInfo, PlanInfo, Settings } from '@/lib/types';
import { Badge, Btn, Card, CardHead, Dialog, Icon, badgeStyle } from './ui';

const meter = (label: string, used: number, max: number, note: string, fmt: (n: number) => string = String) => {
  const pct = max ? Math.min(100, used / max * 100) : 4;
  return (
    <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14 }}><span style={{ fontWeight: 500 }}>{label}</span><span className="num" style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{max ? `${fmt(used)} of ${fmt(max)}` : fmt(used)}</span></div>
      <div style={{ height: 6, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct}%`, background: max && used / max > 0.85 ? '#b45309' : '#0052ff', borderRadius: 999 }} /></div>
      <span style={{ fontSize: 13, color: '#64748b' }}>{note}</span>
    </div>
  );
};
const mb = (b: number) => (b < 1048576 ? `${Math.max(0, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);

export function PlanBilling({ s }: { s: Settings }) {
  const act = useAct(); const { me, toast } = useApp();
  const p = useQ<PlanInfo>('orgs/current/plan').data;
  const [email, setEmail] = useState<string | null>(null);
  if (!p) return <p style={{ color: '#64748b' }}>Loading…</p>;
  const owner = me.user.builtIn; const u = p.usage;
  const cur = p.plans.find(x => x.id === p.plan);
  const monthEnd = new Date(Date.UTC(+u.month.slice(0, 4), +u.month.slice(5, 7), 1)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return <>
    <Card>
      <CardHead title="Plan" sub={p.plan === 'trial' ? `${p.label}. You have Growth’s features until then; pick a plan any time.` : `${cur?.name || p.plan} plan · billed yearly`} />
      <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 14 }}>
        {p.plans.map(x => { const isCur = x.id === p.plan;
          return (
            <div key={x.id} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderRadius: 12, background: '#fff', border: isCur ? '1px solid #0052ff' : '1px solid #e2e8f0', boxShadow: isCur ? '0 0 0 3px rgba(0,82,255,.1)' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 15, fontWeight: 600 }}>{x.name}</span>{isCur && <span style={badgeStyle('primary')}>Current</span>}</div>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>{x.price}{x.price.startsWith('₹') && <span style={{ fontSize: 13, fontWeight: 400, letterSpacing: 0, color: '#64748b' }}> / month</span>}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, color: '#334155' }}>{x.feats.map(t => <div key={t} style={{ display: 'flex', gap: 8 }}><Icon name="check" size={15} style={{ color: '#047857', marginTop: 3 }} /><span>{t}</span></div>)}</div>
              {!isCur && <button disabled={!owner} title={owner ? undefined : 'Only the Owner changes the plan'} onClick={() => act('orgs/current/plan', { plan: x.id }, { method: 'PATCH' })} className="btn btn-sec" style={{ marginTop: 'auto', height: 36, boxShadow: 'none', opacity: owner ? 1 : 0.55 }}>{x.id === 'enterprise' ? 'Contact sales' : `Switch to ${x.name}`}</button>}
            </div>
          ); })}
      </div>
      {!owner && <p style={{ margin: 0, padding: '0 20px 16px', fontSize: 14, color: '#64748b' }}><Icon name="lock" size={14} style={{ color: '#94a3b8', verticalAlign: '-2px', marginRight: 6 }} />Only the Owner changes the plan.</p>}
    </Card>
    <Card>
      <CardHead title="Usage" sub="Limits come from your plan. Nothing stops working at the limit; we ask you to upgrade first." />
      <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '20px 28px' }}>
        {meter('People', u.seats, u.seatLimit, 'Active and invited. Deactivated people don’t count.')}
        {meter('Legal entities', u.entities, u.entityLimit, 'One per GSTIN.')}
        {meter('Documents', u.documents, 0, 'Quotations, invoices and credit notes this month.')}
        {meter('Storage', u.storageBytes, 0, 'Data exports kept for download.', mb)}
        {meter('Assistant requests', u.aiRequests, 0, `This month. Resets on ${monthEnd}.`)}
      </div>
    </Card>
    <Card>
      <CardHead title="Billing" sub="Your subscription is invoiced with GST, so you can claim input tax credit." />
      <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16, borderBottom: '1px solid #e2e8f0' }}>
        <label className="label">Bill to<select className="select" value={p.billEntityId || s.entities.find(e => e.isDefault)?.id || ''} onChange={e => act('orgs/current/billing', { billEntityId: e.target.value }, { method: 'PATCH' })} style={{ width: '100%' }}>
          {s.entities.map(le => <option key={le.id} value={le.id}>{le.name} · {le.state}</option>)}
        </select></label>
        <label className="label">Billing email<input className="input" type="email" value={email ?? p.billingEmail} placeholder="accounts@company.com" onChange={e => setEmail(e.target.value)}
          onBlur={async () => { if (email !== null && email !== p.billingEmail) { const r = await act('orgs/current/billing', { billingEmail: email }, { method: 'PATCH' }); if (r) setEmail(null); } }} style={{ width: '100%' }} /></label>
      </div>
      {p.invoices.length ? null : <p style={{ margin: 0, padding: '16px 20px', fontSize: 14, color: '#64748b' }}>No subscription invoices yet. They’ll be listed here, with a PDF for each, once billing starts.</p>}
    </Card>
  </>;
}

export function DataExport() {
  const act = useAct(); const { me, toast } = useApp();
  const q = useQ<DataInfo>('orgs/current/data'); const d = q.data;
  const [closing, setClosing] = useState(false);
  const preparing = !!d?.exports.some(x => x.status === 'Preparing');
  useEffect(() => { if (!preparing) return; const t = setInterval(() => q.refetch(), 2000); return () => clearInterval(t); }, [preparing, q]);
  if (!d) return <p style={{ color: '#64748b' }}>Loading…</p>;
  const owner = me.user.builtIn;
  const tone: Record<string, any> = { Ready: 'success', Preparing: 'warning', Failed: 'danger', Expired: 'neutral' };
  return <>
    <Card>
      <CardHead title="Where your data lives" sub="This organisation's records are stored apart from every other organisation and never leave this region." />
      <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: '14px 20px' }}>
        {d.facts.map(f => <div key={f.label}><p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{f.label}</p><p className={f.label === 'Organisation ID' ? 'mono' : ''} style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 500, overflowWrap: 'anywhere' }}>{f.value}</p></div>)}
      </div>
    </Card>
    <Card>
      <CardHead title="Export everything" sub="Customers, projects, tasks, documents and payments as CSV and JSON, plus every issued PDF. The link is emailed to you and expires in 7 days."
        right={<Btn size="sm" icon="download" onClick={() => act('orgs/current/export')}>Export</Btn>} />
      {d.exports.map(x => (
        <div key={x.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
          <Icon name="file-archive" size={16} style={{ color: '#64748b' }} />
          <span style={{ flex: '1 1 160px', minWidth: 0 }}>Full export · requested by {x.who}</span>
          <span style={{ color: '#64748b' }}>{new Date(x.when).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
          <Badge tone={tone[x.status] || 'neutral'}>{x.status}</Badge>
          {x.url && <a href={x.url} className="link" style={{ textDecoration: 'none' }}>Download</a>}
        </div>
      ))}
    </Card>
    <div style={{ background: '#fff', border: '1px solid rgba(190,18,60,.25)', borderRadius: 12 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.011em', color: '#be123c' }}>Close organisation</h2>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: '#64748b', maxWidth: '64ch' }}>Everyone loses access at once. Records are kept for {d.closeDays} days, then deleted for good. Issued invoices stay in your export.</p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px 16px', padding: '14px 20px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#475569' }}><Icon name="lock" size={15} style={{ color: '#94a3b8' }} />Only the Owner can close the organisation.</span>
        <button disabled={!owner} onClick={() => setClosing(true)} style={{ height: 36, padding: '0 14px', border: '1px solid rgba(190,18,60,.3)', borderRadius: 8, background: '#fff', color: '#be123c', fontSize: 14, fontWeight: 500, cursor: owner ? 'pointer' : 'not-allowed', opacity: owner ? 1 : 0.55, whiteSpace: 'nowrap' }}>Close organisation</button>
      </div>
    </div>
    {closing && <CloseDialog onClose={() => setClosing(false)} days={d.closeDays} />}
  </>;
}

function CloseDialog({ onClose, days }: { onClose: () => void; days: number }) {
  const { me } = useApp(); const [v, setV] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr('');
    try { await api('orgs/current', { method: 'DELETE', body: { confirm: v } }); location.href = me.orgs.length > 1 ? '/' : '/login'; }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Something went wrong.'); setBusy(false); }
  };
  return (
    <Dialog title={`Close ${me.org.name}?`} sub={`Everyone is signed out of it now. After ${days} days its records are deleted and can’t be recovered.`} onClose={onClose}
      footer={<><Btn onClick={onClose} style={{ boxShadow: 'none' }}>Cancel</Btn><button className="btn" disabled={v !== me.org.name || busy} onClick={go} style={{ background: '#be123c', color: '#fff', border: 0, opacity: v === me.org.name ? 1 : 0.5 }}>{busy ? 'Closing…' : 'Close organisation'}</button></>}>
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label className="label">Type <strong style={{ fontWeight: 600 }}>{me.org.name}</strong> to confirm<input className="input" autoFocus value={v} onChange={e => { setV(e.target.value); setErr(''); }} /></label>
        <p style={{ margin: 0, fontSize: 14, color: '#64748b' }}>Export your data first if you need it: Settings → Data &amp; export.</p>
        {err && <p style={{ margin: 0, fontSize: 14, color: '#be123c' }}>{err}</p>}
      </div>
    </Dialog>
  );
}

/** Another registered business (one per GSTIN), with its own invoice, credit note and receipt series. */
export function EntityDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient(); const { toast } = useApp();
  const [f, setF] = useState({ name: '', gst: true, gstin: '', state: '', address: '', bank: '', upi: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const g = f.gstin; const st = stateOf(g);
  const hint = !g ? 'The first two digits are the state code. They decide CGST + SGST or IGST.' : g.length < 15 ? `${g.length} of 15 characters${st ? ` · ${st}` : ''}` : st ? `${st} · PAN ${g.slice(2, 12)}` : 'That state code isn’t recognised.';
  const save = async () => {
    if (f.gst && !isValidGstin(g)) return setErr('Enter a valid 15-character GSTIN.');
    if (!f.gst && !f.state) return setErr('Pick the state.');
    setBusy(true); setErr('');
    try { const r = await api<{ message: string }>('settings/entities', { body: f }); await qc.invalidateQueries(); toast(r.message); onClose(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Something went wrong.'); setBusy(false); }
  };
  return (
    <Dialog width={540} title="Add legal entity" sub="Registered in another state, or a business that isn't registered for GST? Each is its own entity with its own invoice series." onClose={onClose}
      footer={<><Btn onClick={onClose} style={{ boxShadow: 'none' }}>Cancel</Btn><Btn kind="pri" onClick={save} disabled={busy}>{busy ? 'Adding…' : 'Add entity'}</Btn></>}>
      <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
        <label className="label" style={{ gridColumn: '1/-1' }}>Registered name<input className="input" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="As on the GST certificate" /></label>
        <label style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}><input type="checkbox" checked={!f.gst} onChange={e => { setF({ ...f, gst: !e.target.checked }); setErr(''); }} style={{ width: 18, height: 18, accentColor: '#0052ff' }} />Not registered for GST <span style={{ color: '#64748b' }}>— its documents carry no tax</span></label>
        {f.gst ? <label className="label" style={{ gridColumn: '1/-1' }}>GSTIN<input className="input mono" value={g} maxLength={15} onChange={e => { setF({ ...f, gstin: e.target.value.toUpperCase().replace(/\s/g, '') }); setErr(''); }} placeholder="15 characters" />
          <span className="hint" style={{ color: g.length === 15 ? (st ? '#047857' : '#be123c') : undefined }}>{hint}</span></label>
          : <label className="label" style={{ gridColumn: '1/-1' }}>State<select className="select" value={f.state} onChange={e => { setF({ ...f, state: e.target.value }); setErr(''); }}><option value="">Pick a state…</option>{Object.entries(STATE_CODES).sort((a, b) => a[1].localeCompare(b[1])).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>}
        <label className="label" style={{ gridColumn: '1/-1' }}>Registered address<textarea className="input" rows={2} value={f.address} onChange={e => setF({ ...f, address: e.target.value })} placeholder="Prints on every invoice it issues" style={{ height: 'auto', padding: '10px 12px' }} /></label>
        <label className="label">Bank account<input className="input" value={f.bank} onChange={e => setF({ ...f, bank: e.target.value })} /></label>
        <label className="label">UPI ID<input className="input" value={f.upi} onChange={e => setF({ ...f, upi: e.target.value })} /></label>
        {err && <p style={{ gridColumn: '1/-1', margin: 0, fontSize: 14, color: '#be123c' }}>{err}</p>}
      </div>
    </Dialog>
  );
}
