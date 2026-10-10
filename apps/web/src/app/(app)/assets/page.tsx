'use client';
import { useState } from 'react';
import { ASSET_STATUS, inr } from '@bos/shared';
import { AssetDialog } from '@/components/forms';
import { useAct, useApp, useQ } from '@/lib/app';
import type { Asset, Project } from '@/lib/types';
import { Btn, Card, Icon, PageHead, badgeStyle } from '@/components/ui';
import { EmptyFiltered, FilterBar, MultiFilter, SearchBox, SortHead, listOf, sortRows, useUrlState } from '@/components/filters';
import { ExportBtn } from '@/components/export-btn';

const COLS = 'minmax(220px,2fr) 120px minmax(170px,1.4fr) 120px 110px 170px';

export default function Assets() {
  const act = useAct(); const { person, has } = useApp();
  const allAssets = useQ<Asset[]>('assets').data || [];
  const [f, set] = useUrlState({ q: '', status: '', cat: '', holder: '', sort: '' });
  const [stF, catF, holderF] = [listOf(f.status), listOf(f.cat), listOf(f.holder)]; const q = f.q.trim().toLowerCase();
  const active = !!(f.q || f.status || f.cat || f.holder); const clear = () => set({ q: '', status: '', cat: '', holder: '' }); const sortBy = (s: string) => set({ sort: s });
  const assets = sortRows(allAssets.filter(a => (!q || `${a.code} ${a.name} ${a.cat}`.toLowerCase().includes(q)) && (!stF.length || stF.includes(a.status)) && (!catF.length || catF.includes(a.cat))
    && (!holderF.length || holderF.includes(a.holderId || 'none'))), f.sort, (a, k) => (k === 'name' ? a.name : k === 'cat' ? a.cat : k === 'status' ? a.status : k === 'holder' ? (a.holderId ? person(a.holderId).name : '') : a.value));
  const projects = useQ<Project[]>('projects').data || [];
  const [dlg, setDlg] = useState<Asset | 'new' | null>(null); const manage = has('asset.manage');
  return <>
    {dlg && <AssetDialog asset={dlg === 'new' ? undefined : dlg} onClose={() => setDlg(null)} />}
    <PageHead title="Assets" sub={`${allAssets.length} items worth ${inr(allAssets.reduce((a, x) => a + x.value, 0))} · ${allAssets.filter(a => a.status === 'AVAILABLE').length} available to assign.`} right={<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <ExportBtn name="assets" rows={() => assets.map(a => ({ Code: a.code, Name: a.name, Category: a.cat, Status: ASSET_STATUS[a.status]?.[0] || a.status, 'Held by': a.holderId ? person(a.holderId).name : '', Project: projects.find(p => p.id === a.projectId)?.name || '', Value: a.value }))} />
      {manage && <Btn kind="pri" icon="plus" onClick={() => setDlg('new')}>Add asset</Btn>}</div>} />
    <FilterBar active={active} onClear={clear}>
      <SearchBox value={f.q} onChange={v => set({ q: v })} placeholder="Search code, name, category" />
      <MultiFilter label="Status" value={stF} onChange={v => set({ status: v.join(',') })} options={Object.entries(ASSET_STATUS).map(([value, [label]]) => ({ value, label }))} />
      <MultiFilter label="Category" value={catF} onChange={v => set({ cat: v.join(',') })} options={[...new Set(allAssets.map(a => a.cat))].sort().map(c => ({ value: c, label: c }))} />
      <MultiFilter label="Held by" value={holderF} onChange={v => set({ holder: v.join(',') })} options={[{ value: 'none', label: 'Nobody (available)' }, ...[...new Set(allAssets.map(a => a.holderId).filter((x): x is string => !!x))].map(id => ({ value: id, label: person(id).name }))]} />
    </FilterBar>
    <Card style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 860 }}>
        <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: COLS }}><SortHead label="Asset" k="name" sort={f.sort} onSort={sortBy} /><SortHead label="Category" k="cat" sort={f.sort} onSort={sortBy} /><SortHead label="With" k="holder" sort={f.sort} onSort={sortBy} /><SortHead label="Status" k="status" sort={f.sort} onSort={sortBy} /><SortHead label="Value" k="value" sort={f.sort} onSort={sortBy} align="right" /><span /></div>
        {assets.map(a => { const [label, tone] = ASSET_STATUS[a.status]; const pj = projects.find(p => p.id === a.projectId);
          return (
            <div key={a.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
              <span><span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{a.name}</span><span className="mono" style={{ display: 'block', fontSize: 12.5, color: '#64748b' }}>{a.code}</span></span>
              <span style={{ color: '#64748b' }}>{a.cat}</span>
              <span><span style={{ display: 'block' }}>{a.holderId ? person(a.holderId).name : pj ? pj.name : '—'}</span><span style={{ display: 'block', fontSize: 13, color: '#64748b' }}>{a.holderId && pj ? pj.name : pj && !a.holderId ? 'Project pool' : ''}</span></span>
              <span><span style={badgeStyle(tone)}><span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor' }} />{label}</span></span>
              <span className="num" style={{ textAlign: 'right' }}>{inr(a.value)}</span>
              <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>{manage && <button onClick={() => setDlg(a)} title="Edit asset" aria-label={`Edit ${a.name}`} className="outline-blue" style={{ width: 32, height: 32, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="pencil" size={14} /></button>}{a.status !== 'IN_REPAIR' && has('asset.assign') && <button className="btn btn-sec" onClick={() => act(`assets/${a.id}/${a.status === 'IN_USE' ? 'return' : 'assign'}`)} style={{ height: 32, padding: '0 12px', fontSize: 13, boxShadow: 'none' }}>{a.status === 'IN_USE' ? 'Return' : 'Assign to me'}</button>}{a.status === 'AVAILABLE' && !has('asset.assign') && <button className="btn btn-sec" onClick={() => act(`assets/${a.id}/request`)} style={{ height: 32, padding: '0 12px', fontSize: 13, boxShadow: 'none' }}>Request</button>}</span>
            </div>
          ); })}
        {!assets.length && <EmptyFiltered onClear={active ? clear : undefined} text={active ? undefined : 'No assets yet.'} />}
      </div>
    </Card>
  </>;
}
