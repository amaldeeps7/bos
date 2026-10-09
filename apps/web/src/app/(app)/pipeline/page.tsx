'use client';
import { useState } from 'react';
import { STAGES, STAGE_PROB, inr } from '@bos/shared';
import { DealDialog } from '@/components/forms';
import { useAct, useApp, useQ } from '@/lib/app';
import type { Opportunity } from '@/lib/types';
import { Avatar, Btn, Icon, PageHead } from '@/components/ui';

export default function Pipeline() {
  const { person, has } = useApp(); const act = useAct();
  const opps = useQ<Opportunity[]>('opportunities').data || [];
  const open = opps.filter(o => o.stage < 4);
  const [deal, setDeal] = useState<Opportunity | 'new' | null>(null); const edit = has('customer.update');
  return <>
    <PageHead title="Pipeline" sub="Leads and opportunities, from first contact to signed work." right={
      <div style={{ display: 'flex', gap: 28 }}>
        <div><p style={{ margin: 0, fontSize: 13, color: '#64748b', fontWeight: 500 }}>Open value</p><p className="num" style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 600 }}>{inr(open.reduce((a, o) => a + o.value, 0))}</p></div>
        <div><p style={{ margin: 0, fontSize: 13, color: '#64748b', fontWeight: 500 }}>Weighted</p><p className="num" style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 600 }}>{inr(open.reduce((a, o) => a + o.value * STAGE_PROB[o.stage], 0))}</p></div>
        {edit && <Btn kind="pri" icon="plus" onClick={() => setDeal('new')} style={{ alignSelf: 'flex-end' }}>New deal</Btn>}
      </div>} />
    {deal && <DealDialog deal={deal === 'new' ? undefined : deal} onClose={() => setDeal(null)} />}
    <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
      {STAGES.map((name, i) => { const cards = opps.filter(o => o.stage === i);
        return (
          <div key={name} style={{ flex: '0 0 264px', display: 'flex', flexDirection: 'column', gap: 10, background: '#f1f5f9', borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '2px 4px' }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{name} <span style={{ color: '#94a3b8', fontWeight: 500 }}>{cards.length}</span></span>
              <span className="num" style={{ fontSize: 13, color: '#64748b' }}>{inr(cards.reduce((a, o) => a + o.value, 0))}</span>
            </div>
            {cards.map(o => (
              <div key={o.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 1px 2px rgba(15,23,42,.04)' }}>
                <button onClick={() => edit && setDeal(o)} disabled={!edit} title={edit ? 'Edit deal' : undefined} style={{ textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: edit ? 'pointer' : 'default' }}><p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{o.name}</p><p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>{o.customer}</p></button>
                <p style={{ margin: 0, fontSize: 13, color: '#64748b', lineHeight: 1.4 }}>{o.next}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>{inr(o.value)}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Avatar name={person(o.ownerId).name} />
                    {o.stage < 4 && has('customer.update') && <button onClick={() => act(`opportunities/${o.id}/advance`)} aria-label="Move to next stage" title="Move to next stage" className="adv" style={{ width: 28, height: 28, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}><Icon name="arrow-right" size={14} /></button>}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ); })}
    </div>
  </>;
}
