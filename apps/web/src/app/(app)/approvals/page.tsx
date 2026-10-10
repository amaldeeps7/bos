'use client';
import { inr } from '@bos/shared';
import { useAct, useApp, useQ } from '@/lib/app';
import type { Approval } from '@/lib/types';
import { BulkBar, FilterBar, MultiFilter, SearchBox, bulkCtl, listOf, useSelection, useUrlState } from '@/components/filters';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Badge, Btn, Icon, PageHead, Tabs, badgeStyle } from '@/components/ui';

const ICON: Record<string, string> = { Invoice: 'icon-file-text', Quotation: 'icon-scroll-text', 'Milestone date': 'icon-calendar', 'Asset request': 'icon-laptop' };
const TONE: Record<string, any> = { Invoice: 'info', Quotation: 'primary', 'Milestone date': 'warning', 'Asset request': 'neutral' };

export default function Approvals() {
  const act = useAct();
  const all = useQ<Approval[]>('approvals').data || [];
  const { toast } = useApp(); const qc = useQueryClient();
  const [f, set] = useUrlState({ tab: 'waiting', q: '', kind: '' });
  const tab = f.tab as 'waiting' | 'decided'; const setTab = (t: 'waiting' | 'decided') => set({ tab: t });
  const kinds = listOf(f.kind); const q = f.q.trim().toLowerCase();
  const match = (a: Approval) => (!kinds.length || kinds.includes(a.kind)) && (!q || `${a.ref} ${a.title} ${a.detail} ${a.by}`.toLowerCase().includes(q));
  const waiting = all.filter(a => a.status === 'waiting' && match(a)); const decided = all.filter(a => a.status !== 'waiting' && match(a));
  const list = tab === 'waiting' ? waiting : decided;
  const active = !!(f.q || f.kind); const clear = () => set({ q: '', kind: '' });
  const sel = useSelection(waiting.map(a => a.id));
  const bulk = async (approve: boolean) => {
    if (!approve && !confirm(`Send back ${sel.count} item${sel.count === 1 ? '' : 's'}?`)) return;
    try { const r = await api<{ message: string }>('approvals/bulk', { body: { ids: [...sel.sel], approve } }); toast(r.message); sel.clear(); await qc.invalidateQueries(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not decide them.'); }
  };
  return <>
    <PageHead title="Approvals" sub="Decisions routed to you by approval policy. Whoever raises a document can't approve it themselves." subStyle={{ maxWidth: '68ch' }} />
    <Tabs tabs={[{ id: 'waiting', label: 'Waiting on me', count: waiting.length }, { id: 'decided', label: 'Decided & sent', count: decided.length }]} value={tab} onChange={setTab} />
    <FilterBar active={active} onClear={clear}>
      <SearchBox value={f.q} onChange={v => set({ q: v })} placeholder="Search reference, title, who raised it" />
      <MultiFilter label="Kind" value={kinds} onChange={v => set({ kind: v.join(',') })} options={[...new Set(all.map(a => a.kind))].map(k => ({ value: k, label: k }))} />
      {tab === 'waiting' && waiting.length > 1 && <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#475569' }}><input type="checkbox" checked={sel.allOn} onChange={() => (sel.allOn ? sel.clear() : sel.all())} style={{ width: 16, height: 16, accentColor: '#0052ff' }} />Select all</label>}
    </FilterBar>
    {tab === 'waiting' && <BulkBar count={sel.count} onClear={sel.clear}>
      <button onClick={() => bulk(true)} style={{ ...bulkCtl, background: '#0052ff', borderColor: '#0052ff' }}>Approve</button>
      <button onClick={() => bulk(false)} style={bulkCtl}>Send back</button>
    </BulkBar>}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {list.map(a => (
        <div key={a.id} className="card" style={{ padding: '16px 20px', display: 'flex', flexWrap: 'wrap', gap: '16px 24px', alignItems: 'center' }}>
          {a.status === 'waiting' && <input type="checkbox" checked={sel.has(a.id)} onChange={() => sel.toggle(a.id)} aria-label={`Select ${a.ref}`} style={{ width: 16, height: 16, accentColor: '#0052ff', flex: 'none' }} />}
          <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span style={badgeStyle(TONE[a.kind] || 'neutral')}><Icon name={ICON[a.kind] || 'icon-file'} size={13} />{a.kind}</span>
              <span className="mono" style={{ fontSize: 13, color: '#64748b' }}>{a.ref}</span>
            </div>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.011em' }}>{a.title}</p>
            <p style={{ margin: 0, fontSize: 14, color: '#64748b', lineHeight: 1.5 }}>{a.detail}</p>
            <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>Raised by {a.by} · {a.age}</p>
          </div>
          {a.amount != null && <div style={{ textAlign: 'right', minWidth: 120 }}><p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Amount</p><p className="num" style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 600, letterSpacing: '-0.012em' }}>{inr(a.amount)}</p></div>}
          {a.status === 'waiting' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn onClick={() => act(`approvals/${a.id}/decide`, { approve: false })} style={{ boxShadow: 'none' }}>Reject</Btn>
              <Btn kind="pri" icon="check" onClick={() => act(`approvals/${a.id}/decide`, { approve: true })} style={{ gap: 6 }}>Approve</Btn>
            </div>
          ) : (
            <Badge tone={a.status === 'approved' ? 'success' : a.status === 'rejected' ? 'danger' : 'warning'} solid={a.status === 'approved'}>{a.status === 'approved' ? 'Approved' : a.status === 'rejected' ? 'Sent back' : `Awaiting ${a.approver.split(' ')[0]}`}</Badge>
          )}
        </div>
      ))}
      {!list.length && <div style={{ padding: '40px 20px', textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: 12, color: '#64748b', fontSize: 14 }}>{tab === 'waiting' ? 'Nothing is waiting on you.' : 'No decisions yet.'}</div>}
    </div>
  </>;
}
