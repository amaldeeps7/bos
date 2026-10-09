'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtD, healthTone, inr } from '@bos/shared';
import { useApp, useQ } from '@/lib/app';
import { barColor, projStats } from '@/lib/domain';
import type { Project } from '@/lib/types';
import { Btn, Card, PageHead, badgeStyle } from '@/components/ui';
import { ProjectDialog } from '@/components/forms';

const Dot = () => <span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor' }} />;
const COLS = 'minmax(240px,2.2fr) minmax(150px,1.2fr) 120px minmax(150px,1fr) 130px 90px';

export default function Projects() {
  const { isMobile, has } = useApp(); const router = useRouter(); const [creating, setCreating] = useState(false);
  const projects = useQ<Project[]>('projects').data || [];
  return <>
    <PageHead title="Projects" sub="Engagements, their milestones, and what's left to bill." right={has('project.create') && <Btn kind="pri" icon="plus" onClick={() => setCreating(true)}>New project</Btn>} />
    {creating && <ProjectDialog onClose={() => setCreating(false)} />}
    {!isMobile ? (
      <Card style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 860 }}>
          <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: COLS }}><span>Project</span><span>Customer</span><span>Health</span><span>Progress</span><span style={{ textAlign: 'right' }}>Contract</span><span style={{ textAlign: 'right' }}>Ends</span></div>
          {projects.map(p => { const st = projStats(p);
            return (
              <button key={p.id} onClick={() => router.push(`/projects/${p.id}`)} className="row-btn" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '14px 20px' }}>
                <span><span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{p.name}</span><span className="mono" style={{ display: 'block', fontSize: 12.5, color: '#64748b' }}>{p.code} · {p.bu}</span></span>
                <span>{p.customer}</span>
                <span><span style={badgeStyle(healthTone(p.health))}><Dot />{p.health}</span></span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ flex: 1, height: 6, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: st.pct + '%', borderRadius: 999, background: barColor(p.health) }} /></span><span className="num" style={{ fontSize: 13, color: '#64748b', width: 34 }}>{st.pct}%</span></span>
                <span className="num" style={{ textAlign: 'right', fontWeight: 500 }}>{inr(p.contract)}</span>
                <span style={{ textAlign: 'right', color: '#64748b' }}>{fmtD(p.endDate)}</span>
              </button>
            ); })}
        </div>
      </Card>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {projects.map(p => { const st = projStats(p);
          return (
            <button key={p.id} onClick={() => router.push(`/projects/${p.id}`)} style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' }}><span><span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{p.name}</span><span style={{ display: 'block', fontSize: 13, color: '#64748b' }}>{p.customer}</span></span><span style={badgeStyle(healthTone(p.health))}>{p.health}</span></div>
              <div style={{ width: '100%', height: 6, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}><div style={{ height: '100%', width: st.pct + '%', borderRadius: 999, background: barColor(p.health) }} /></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 13, color: '#64748b' }}><span>{st.pct}% complete</span><span className="num" style={{ color: '#0f172a', fontWeight: 500 }}>{inr(p.contract)}</span></div>
            </button>
          ); })}
      </div>
    )}
  </>;
}
