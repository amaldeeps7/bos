'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp, useQ } from '@/lib/app';
import type { TeamMember } from '@/lib/types';
import { Card, Empty, Icon, PageHead, Tabs } from '@/components/ui';
import { Face, STATUS_COLOR } from '@/components/team';
import { ExportBtn } from '@/components/export-btn';

const line = '#cbd5e1';

export default function TeamPage() {
  const router = useRouter(); const { width } = useApp();
  const people = useQ<TeamMember[]>('team').data;
  const [tab, setTab] = useState<'org' | 'dir'>('org');
  const [q, setQ] = useState('');
  if (!people) return <p style={{ color: '#64748b' }}>Loading…</p>;

  const open = (id: string) => router.push(`/team/${id}`);
  const ids = new Set(people.map(p => p.id));
  const kids = (id: string) => people.filter(p => p.managerId === id);
  // Top of the chart: people with no manager (or whose manager has left).
  const roots = people.filter(p => !p.managerId || !ids.has(p.managerId));
  const count = (id: string): number => kids(id).reduce((a, k) => a + 1 + count(k.id), 0);
  const inMeet = people.filter(p => p.status === 'meeting').length; const away = people.filter(p => p.status === 'leave').length;

  const qq = q.trim().toLowerCase();
  const rows = people.filter(p => !qq || [p.name, p.title, p.dept, p.email].join(' ').toLowerCase().includes(qq));

  /** Everyone below a department head, indented one step per level. */
  const Branch = ({ id, depth }: { id: string; depth: number }) => {
    const ks = kids(id); if (!ks.length) return null;
    return (
      <div style={{ marginLeft: depth ? 14 : 28, padding: '10px 0 4px 16px', borderLeft: `1px solid ${line}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ks.map(k => (
          <div key={k.id}>
            <button onClick={() => open(k.id)} className="org-card" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, cursor: 'pointer', textAlign: 'left' }}>
              <Face name={k.name} src={k.avatar} status={k.status} size={30} />
              <span style={{ minWidth: 0 }}>
                <span className="ellipsis" style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{k.name}</span>
                <span className="ellipsis" style={{ display: 'block', fontSize: 12.5, color: '#64748b' }}>{k.title}</span>
              </span>
            </button>
            <Branch id={k.id} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      <PageHead title="Team" sub={`${people.length} ${people.length === 1 ? 'person' : 'people'} · ${inMeet} in a meeting now · ${away} on leave`}
        right={<ExportBtn name="team" rows={() => rows.map(p => ({ Name: p.name, Title: p.title, Department: p.dept, Email: p.email, Manager: people.find(m => m.id === p.managerId)?.name || '', Status: p.statusLabel }))} />} />
      <Tabs tabs={[{ id: 'org', label: 'Org chart' }, { id: 'dir', label: 'Directory' }]} value={tab} onChange={setTab} />

      {tab === 'org' && <>
        {roots.map(r => {
          const cols = kids(r.id);
          return (
            <div key={r.id} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <button onClick={() => open(r.id)} className="org-card" style={{ width: 300, maxWidth: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: '#fff', border: '1px solid rgba(0,82,255,.25)', borderRadius: 12, boxShadow: '0 1px 2px rgba(15,23,42,.04)', cursor: 'pointer', textAlign: 'left' }}>
                  <Face name={r.name} src={r.avatar} status={r.status} size={40} accent />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{r.name}</span>
                    <span style={{ display: 'block', fontSize: 13, color: '#64748b' }}>{r.title}</span>
                  </span>
                </button>
                {cols.length > 0 && <div style={{ width: 1, height: 24, background: line }} />}
              </div>
              {cols.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,230px),1fr))', gap: '0 16px', borderTop: `1px solid ${line}` }}>
                  {cols.map(h => { const n = count(h.id) + 1;
                    return (
                      <div key={h.id} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <div style={{ width: 1, height: 20, background: line, marginLeft: 28 }} />
                        <p style={{ margin: '0 0 6px', fontSize: 12.5, fontWeight: 600, color: '#64748b' }}>{h.dept || h.title} <span style={{ fontWeight: 500, color: '#94a3b8' }}>· {n} {n === 1 ? 'person' : 'people'}</span></p>
                        <button onClick={() => open(h.id)} className="org-card" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 1px 2px rgba(15,23,42,.04)', cursor: 'pointer', textAlign: 'left' }}>
                          <Face name={h.name} src={h.avatar} status={h.status} />
                          <span style={{ minWidth: 0 }}>
                            <span className="ellipsis" style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{h.name}</span>
                            <span className="ellipsis" style={{ display: 'block', fontSize: 13, color: '#64748b' }}>{h.title}</span>
                          </span>
                        </button>
                        <Branch id={h.id} depth={0} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 13, color: '#64748b' }}>
          {([['available', 'Available'], ['meeting', 'In a meeting'], ['leave', 'On leave']] as const).map(([k, label]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: STATUS_COLOR[k] }} />{label}</span>
          ))}
        </div>
      </>}

      {tab === 'dir' && (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, maxWidth: 360, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 12px', color: '#94a3b8' }}>
              <Icon name="search" size={15} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, role or team" aria-label="Search the directory" style={{ flex: 1, minWidth: 0, border: 0, outline: 0, fontSize: 14, background: 'transparent', color: '#0f172a' }} />
            </div>
          </div>
          {rows.map(r => (
            <button key={r.id} onClick={() => open(r.id)} className="row-btn" style={{ display: 'flex', flexWrap: width < 900 ? 'wrap' : 'nowrap', alignItems: 'center', gap: '8px 20px', padding: '12px 20px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '1 1 220px', minWidth: 0 }}>
                <Face name={r.name} src={r.avatar} status={r.status} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{r.name}</span>
                  <span style={{ display: 'block', fontSize: 13, color: '#64748b' }}>{r.title}</span>
                </span>
              </span>
              <span style={{ width: 120, flex: 'none', fontSize: 14, color: '#475569' }}>{r.dept}</span>
              <span className="ellipsis" style={{ width: 180, flex: 'none', fontSize: 13, color: '#64748b' }}>{r.statusText}</span>
              <span className="ellipsis" style={{ flex: '0 1 230px', minWidth: 60, fontSize: 13, color: '#64748b' }}>{r.email}</span>
            </button>
          ))}
          {!rows.length && <Empty pad="24px 20px">No one matches that search.</Empty>}
        </Card>
      )}
    </>
  );
}
