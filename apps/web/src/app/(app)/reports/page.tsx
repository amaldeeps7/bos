'use client';
import { fyStart, inr } from '@bos/shared';
import { useApp, useQ } from '@/lib/app';
import type { Reports as R } from '@/lib/types';
import { Choice, useUrlState } from '@/components/filters';
import { BarRow, Card, CardHead, PageHead } from '@/components/ui';

const GRAD = 'linear-gradient(135deg,#0052ff,#4d7cff)';

/** The months a period covers (YYYY-MM), in the organisation's financial year. */
function monthsOf(range: string, today: string, fy: string, from: string, to: string): [string, string] {
  const m = (iso: string, n: number) => { const [y, mo] = iso.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };
  const now = today.slice(0, 7); const s = fyStart(today, fy).slice(0, 7);
  if (range === '12m') return [m(now, -11), now];
  if (range === 'fy') return [s, now];
  if (range === 'lastfy') return [m(s, -12), m(s, -1)];
  if (range === 'custom' && from && to) return [from, to];
  return [m(now, -5), now];
}

export default function Reports() {
  const { today, me } = useApp();
  const [f, set] = useUrlState({ range: '6m', from: '', to: '' });
  const [from, to] = monthsOf(f.range, today, me.org.fyStart, f.from, f.to);
  const r = useQ<R>(`reports?from=${from}&to=${to}`).data;
  const picker = (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <Choice label="Period" value={f.range} onChange={v => set({ range: v, ...(v === 'custom' ? { from, to } : { from: '', to: '' }) })} options={[['6m', 'Last 6 months'], ['12m', 'Last 12 months'], ['fy', 'This financial year'], ['lastfy', 'Last financial year'], ['custom', 'Custom…']]} />
      {f.range === 'custom' && <>
        <input type="month" aria-label="From month" value={f.from} max={f.to || undefined} onChange={e => set({ from: e.target.value })} style={{ height: 36, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 8px', fontSize: 14 }} />
        <span style={{ color: '#64748b', fontSize: 14 }}>to</span>
        <input type="month" aria-label="To month" value={f.to} min={f.from || undefined} onChange={e => set({ to: e.target.value })} style={{ height: 36, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 8px', fontSize: 14 }} />
      </>}
    </span>
  );
  if (!r) return <><PageHead title="Reports" right={picker} /><p style={{ color: '#64748b' }}>Loading…</p></>;
  const mx = Math.max(1, ...r.months.flatMap(m => [m.invoiced, m.collected]));
  const bar = (v: number, color: string) => ({ width: '38%', maxWidth: 22, height: Math.max(1, v / mx * 100) + '%', borderRadius: '4px 4px 0 0', background: color });
  const top = r.byCustomer[0]?.value || 1; const ageMax = Math.max(1, ...r.ageing.map(a => a.value));
  return <>
    <PageHead title="Reports" sub={`Billing and collections for ${r.period} (up to 24 months). Ageing and what's left to bill are as of today.`} right={picker} />
    <Card style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
      {[[`Invoiced, ${r.months.length} months`, r.totals.invoiced], [`Collected, ${r.months.length} months`, r.totals.collected], ['Outstanding now', r.totals.outstanding]].map(([l, v]) => (
        <div key={l as string} style={{ padding: '18px 20px', borderRight: '1px solid #f1f5f9' }}><p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#64748b' }}>{l}</p><p className="num" style={{ margin: '6px 0 0', fontSize: 26, lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.02em' }}>{inr(v as number)}</p></div>
      ))}
    </Card>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,440px),1fr))', gap: 20, alignItems: 'start' }}>
      <Card>
        <CardHead title="Invoiced and collected" right={<div style={{ display: 'flex', gap: 14, fontSize: 13, color: '#64748b' }}><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: '#0052ff' }} />Invoiced</span><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: '#a9c1ff' }} />Collected</span></div>} />
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 220, padding: '20px 20px 0' }}>
          {r.months.map(m => <div key={m.month} title={`${m.short}: invoiced ${inr(m.invoiced)}, collected ${inr(m.collected)}`} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 4, borderBottom: '1px solid #e2e8f0' }}><span style={bar(m.invoiced, '#0052ff')} /><span style={bar(m.collected, '#a9c1ff')} /></div>)}
        </div>
        <div style={{ display: 'flex', gap: 12, padding: '8px 20px 16px' }}>{r.months.map(m => <span key={m.month} style={{ flex: 1, textAlign: 'center', fontSize: 12, color: '#64748b' }}>{m.label}</span>)}</div>
      </Card>
      <Card><CardHead title="Billed by customer" /><div style={{ padding: '12px 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>{r.byCustomer.map(b => <BarRow key={b.name} label={b.name} value={inr(b.value)} pct={b.value / top * 100} color={GRAD} />)}</div></Card>
      <Card><CardHead title="Receivables ageing" /><div style={{ padding: '12px 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>{r.ageing.map((b, i) => <BarRow key={b.label} label={b.label} value={inr(b.value)} pct={b.value / ageMax * 100} color={i === 0 ? '#047857' : i === 1 ? '#b45309' : '#be123c'} />)}</div></Card>
      <Card><CardHead title="Left to bill by project" /><div style={{ padding: '12px 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>{r.leftToBill.map(p => <BarRow key={p.name} label={p.name} value={`${inr(p.contract - p.invoiced)} left`} pct={p.invoiced / (p.contract || 1) * 100} color="#0052ff" />)}</div></Card>
    </div>
  </>;
}
