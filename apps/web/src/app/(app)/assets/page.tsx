'use client';
import { useState } from 'react';
import { ASSET_STATUS, inr } from '@bos/shared';
import { AssetDialog } from '@/components/forms';
import { useAct, useApp, useQ } from '@/lib/app';
import type { Asset, Project } from '@/lib/types';
import { Btn, Card, Icon, PageHead, badgeStyle } from '@/components/ui';

const COLS = 'minmax(220px,2fr) 120px minmax(170px,1.4fr) 120px 110px 170px';

export default function Assets() {
  const act = useAct(); const { person, has } = useApp();
  const assets = useQ<Asset[]>('assets').data || [];
  const projects = useQ<Project[]>('projects').data || [];
  const [dlg, setDlg] = useState<Asset | 'new' | null>(null); const manage = has('asset.manage');
  return <>
    {dlg && <AssetDialog asset={dlg === 'new' ? undefined : dlg} onClose={() => setDlg(null)} />}
    <PageHead title="Assets" sub={`${assets.length} items worth ${inr(assets.reduce((a, x) => a + x.value, 0))} · ${assets.filter(a => a.status === 'AVAILABLE').length} available to assign.`} right={manage && <Btn kind="pri" icon="plus" onClick={() => setDlg('new')}>Add asset</Btn>} />
    <Card style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 860 }}>
        <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: COLS }}><span>Asset</span><span>Category</span><span>With</span><span>Status</span><span style={{ textAlign: 'right' }}>Value</span><span /></div>
        {assets.map(a => { const [label, tone] = ASSET_STATUS[a.status]; const pj = projects.find(p => p.id === a.projectId);
          return (
            <div key={a.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
              <span><span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{a.name}</span><span className="mono" style={{ display: 'block', fontSize: 12.5, color: '#64748b' }}>{a.code}</span></span>
              <span style={{ color: '#64748b' }}>{a.cat}</span>
              <span><span style={{ display: 'block' }}>{a.holderId ? person(a.holderId).name : pj ? pj.name : '—'}</span><span style={{ display: 'block', fontSize: 13, color: '#64748b' }}>{a.holderId && pj ? pj.name : pj && !a.holderId ? 'Project pool' : ''}</span></span>
              <span><span style={badgeStyle(tone)}><span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor' }} />{label}</span></span>
              <span className="num" style={{ textAlign: 'right' }}>{inr(a.value)}</span>
              <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>{manage && <button onClick={() => setDlg(a)} title="Edit asset" aria-label={`Edit ${a.name}`} className="outline-blue" style={{ width: 32, height: 32, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="pencil" size={14} /></button>}{a.status !== 'IN_REPAIR' && has('asset.assign') && <button className="btn btn-sec" onClick={() => act(`assets/${a.id}/${a.status === 'IN_USE' ? 'return' : 'assign'}`)} style={{ height: 32, padding: '0 12px', fontSize: 13, boxShadow: 'none' }}>{a.status === 'IN_USE' ? 'Return' : 'Assign to me'}</button>}</span>
            </div>
          ); })}
      </div>
    </Card>
  </>;
}
