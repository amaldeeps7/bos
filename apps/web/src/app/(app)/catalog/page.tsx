'use client';
import { useEffect, useState } from 'react';
import { inr } from '@bos/shared';
import { useAct, useApp, useQ } from '@/lib/app';
import type { CatalogItem } from '@/lib/types';
import { Btn, Card, Icon, PageHead } from '@/components/ui';

const COLS = 'minmax(240px,2fr) 120px 100px 140px 70px 40px';
const inp = { height: 38, minWidth: 0, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 10px', fontSize: 14, outlineColor: '#0052ff' } as const;

function Row({ c, sacs, rates, editable }: { c: CatalogItem; sacs: string[]; rates: Record<string, number>; editable: boolean }) {
  const act = useAct(); const [v, setV] = useState(c);
  useEffect(() => setV(c), [c]);
  const save = (patch: Partial<CatalogItem>) => act(`catalog/${c.id}`, patch, { method: 'PATCH', quiet: true });
  const blur = (f: 'd' | 'unit' | 'rate') => () => { if (String(v[f]) !== String(c[f])) save({ [f]: v[f] }); };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, alignItems: 'center', padding: '8px 20px', borderBottom: '1px solid #f1f5f9' }}>
      <input disabled={!editable} value={v.d} onChange={e => setV({ ...v, d: e.target.value })} onBlur={blur('d')} style={inp} />
      <select disabled={!editable} value={v.sac} onChange={e => { setV({ ...v, sac: e.target.value }); save({ sac: e.target.value }); }} className="mono" style={{ ...inp, padding: '0 6px', fontSize: 13, background: '#fff' }}>{sacs.map(s => <option key={s}>{s}</option>)}</select>
      <input disabled={!editable} value={v.unit} onChange={e => setV({ ...v, unit: e.target.value })} onBlur={blur('unit')} style={inp} />
      <input disabled={!editable} value={String(v.rate)} onChange={e => setV({ ...v, rate: +e.target.value.replace(/[^\d.]/g, '') || 0 })} onBlur={blur('rate')} inputMode="decimal" className="num" style={{ ...inp, textAlign: 'right' }} />
      <span style={{ textAlign: 'right', fontSize: 14, color: '#64748b' }}>{rates[c.sac] ?? 18}%</span>
      {editable ? <button onClick={() => act(`catalog/${c.id}`, undefined, { method: 'DELETE', quiet: true })} aria-label="Remove item" className="trash"><Icon name="trash-2" size={15} /></button> : <span />}
    </div>
  );
}

export default function Catalog() {
  const act = useAct(); const { me, has } = useApp();
  const items = useQ<CatalogItem[]>('catalog').data || [];
  const sacs = Object.keys(me.org.sacRates).sort(); const editable = has('catalog.manage');
  return <>
    <PageHead title="Catalogue" sub={`${items.length} services at their standard rates. Quotations and invoices pick from here; changing a rate never touches documents already raised.`} subStyle={{ maxWidth: '68ch' }}
      right={editable && <Btn kind="pri" icon="plus" onClick={() => act('catalog', {}, { quiet: true })}>Add item</Btn>} />
    <Card style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 760 }}>
        <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12 }}><span>Service</span><span>SAC</span><span>Unit</span><span style={{ textAlign: 'right' }}>Rate (₹)</span><span style={{ textAlign: 'right' }}>GST</span><span /></div>
        {items.map(c => <Row key={c.id} c={c} sacs={sacs} rates={me.org.sacRates} editable={editable} />)}
      </div>
    </Card>
    {!editable && <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Rates are read-only for your role. Standard rates: {items.slice(0, 3).map(i => `${i.d} ${inr(i.rate)}/${i.unit}`).join(', ')}…</p>}
  </>;
}
