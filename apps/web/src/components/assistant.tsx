'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAct, useApp } from '@/lib/app';
import { editorStore } from '@/lib/editor-store';
import type { AiReply } from '@/lib/types';
import { Icon } from './ui';
import { useTitle } from './title';

type Msg = { role: 'user' | 'bot' } & AiReply;
let saved: Msg[] = [];

const SUG: Record<string, [string, string][]> = {
  mywork: [['plan', 'Plan my day'], ['risk', 'What’s at risk this week?'], ['status', 'Draft a status update for a customer']],
  tasks: [['load', 'Who on my team is overloaded?'], ['plan', 'Plan my day']], meetings: [['plan', 'Plan my day']],
  approvals: [['approvals', 'Summarise what’s waiting on me'], ['bill', 'What can be billed now?']],
  pipeline: [['deals', 'Which deals need a follow-up?']], projects: [['risk', 'What’s at risk this week?'], ['bill', 'What can be billed now?']],
  project: [['summary', 'Summarise this project'], ['bill', 'What can be billed now?'], ['load', 'Rebalance the team’s workload']],
  settings: [['role', 'What can Field staff do?'], ['perm', 'Who can approve invoices?']], credits: [['owed', 'Who owes us the most?']], catalog: [['quotes', 'Which quotes need a nudge?']],
  customers: [['owed', 'Who owes us the most?']], customer: [['owed', 'Who owes us the most?'], ['quotes', 'Which quotes need a nudge?']],
  quotes: [['quotes', 'Which quotes need a nudge?']], quote: [['quotes', 'Which quotes need a nudge?']],
  invoices: [['overdue', 'Chase overdue invoices'], ['bill', 'What can be billed now?']], invoice: [['overdue', 'Chase overdue invoices']],
  payments: [['overdue', 'Chase overdue invoices'], ['owed', 'Who owes us the most?']], reports: [['month', 'How did last month go?']],
  assets: [['assets', 'What equipment is free?']], qeditor: [['policy', 'Check this against pricing policy']], ieditor: [['policy', 'Check this against pricing policy']],
};

/** Lets other screens (e.g. a project's "Summarise" button) ask the assistant a suggested question. */
export const askAssistant = (key: string, label: string) => window.dispatchEvent(new CustomEvent('bos:ask', { detail: { key, label } }));

export function Assistant({ screen }: { screen: string }) {
  const { isMobile, wide, setUi, toast } = useApp(); const { title, id } = useTitle();
  const router = useRouter(); const act = useAct();
  const [msgs, setMsgsState] = useState<Msg[]>(saved);
  const setMsgs = (f: (m: Msg[]) => Msg[]) => setMsgsState(m => (saved = f(m)));
  const [busy, setBusy] = useState(false); const [input, setInput] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);

  const ask = async (key: string, label: string) => {
    setMsgs(m => [...m, { role: 'user', text: label }]); setBusy(true);
    try {
      const r = await api<AiReply>('ai/suggest', { body: { key, projectId: screen === 'project' ? id : undefined, lines: editorStore.lines } });
      setMsgs(m => [...m, { role: 'bot', ...r }]);
    } catch { setMsgs(m => [...m, { role: 'bot', text: 'I couldn’t reach your records just now. Try again.' }]); }
    setBusy(false);
  };
  useEffect(() => {
    const on = (e: Event) => { const { key, label } = (e as CustomEvent).detail; ask(key, label); };
    window.addEventListener('bos:ask', on); return () => window.removeEventListener('bos:ask', on);
  });
  const free = async () => {
    const q = input.trim(); if (!q) return;
    setInput(''); setMsgs(m => [...m, { role: 'user', text: q }]); setBusy(true);
    try { const r = await api<AiReply>('ai/ask', { body: { question: q } }); setMsgs(m => [...m, { role: 'bot', ...r }]); }
    catch { setMsgs(m => [...m, { role: 'bot', text: 'The assistant couldn’t answer just now.' }]); }
    setBusy(false);
  };
  const run = async (m: Msg) => {
    const a = m.action!; const p = a.payload || {};
    if (a.kind === 'navigate') { router.push(p.href); if (isMobile) setUi({ aiOpen: false }); }
    if (a.kind === 'copy') { try { await navigator.clipboard.writeText(m.text.replace(/^Draft for [^:]+:\n\n/, '')); } catch { /* clipboard blocked */ } toast('Draft copied.'); }
    if (a.kind === 'reassign') { const r = await act(`tasks/${p.taskId}`, { assigneeId: p.assigneeId }, { method: 'PATCH', quiet: true }); if (r) toast('Reassigned. They have been notified.'); }
    if (a.kind === 'remind') await act('payments/remind-overdue');
  };

  const panel = isMobile ? { position: 'absolute', inset: 0, zIndex: 50 } : wide ? { width: 380, flex: 'none', height: '100%', borderLeft: '1px solid #e2e8f0' }
    : { position: 'absolute', top: 0, right: 0, bottom: 0, width: 380, maxWidth: '100%', zIndex: 50, borderLeft: '1px solid #e2e8f0', boxShadow: '0 16px 48px -12px rgba(15,23,42,.25)' };

  return (
    <aside style={{ ...(panel as any), background: '#fff', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 64, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderBottom: '1px solid #e2e8f0' }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, backgroundImage: 'linear-gradient(135deg,#0052ff,#4d7cff)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="sparkles" size={15} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.2 }}>Assistant</p>
          <p className="ellipsis" style={{ margin: 0, fontSize: 12, color: '#64748b', lineHeight: 1.3 }}>Looking at: {title}</p>
        </div>
        {msgs.length > 0 && <button onClick={() => setMsgs(() => [])} style={{ border: 0, background: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer', padding: 6 }}>Clear</button>}
        <button onClick={() => setUi({ aiOpen: false })} aria-label="Close assistant" className="ghost-icon" style={{ width: 36, height: 36 }}><Icon name="x" size={18} /></button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!msgs.length && (
          <div style={{ padding: '4px 2px 8px' }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>What can I take off your plate?</p>
            <p style={{ margin: '6px 0 0', fontSize: 14, color: '#64748b', lineHeight: 1.5 }}>I can read the records you have access to: tasks, projects, approvals and the pipeline. I'll ask before changing anything.</p>
          </div>
        )}
        {msgs.map((m, i) => {
          const user = m.role === 'user';
          return (
            <div key={i} style={{ display: 'flex', justifyContent: user ? 'flex-end' : 'flex-start' }}>
              <div style={user ? { maxWidth: '85%', padding: '8px 12px', borderRadius: '12px 12px 4px 12px', background: '#eef4ff', color: '#0f172a', fontSize: 14, lineHeight: 1.5 } : { maxWidth: '100%', fontSize: 14, lineHeight: 1.55, color: '#0f172a' }}>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.text}</p>
                {!!m.bullets?.length && <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>{m.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>}
                {m.action && <button onClick={() => run(m)} style={{ marginTop: 10, height: 32, padding: '0 12px', border: '1px solid #0052ff', borderRadius: 8, background: '#fff', color: '#0052ff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>{m.action.label}</button>}
              </div>
            </div>
          );
        })}
        {busy && <div style={{ display: 'flex', gap: 6, padding: '8px 4px', color: '#94a3b8', fontSize: 14 }}><Icon name="sparkles" size={14} />Thinking…</div>}
        <div ref={end} />
      </div>
      <div style={{ flex: 'none', borderTop: '1px solid #e2e8f0', padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(SUG[screen] || []).map(([k, label]) => <button key={k} className="chip" onClick={() => ask(k, label)} style={{ textAlign: 'left', whiteSpace: 'nowrap', lineHeight: 1.4, padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 999, background: '#fff', fontSize: 13, color: '#0f172a', cursor: 'pointer' }}>{label}</button>)}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', border: '1px solid #cbd5e1', borderRadius: 10, padding: '4px 4px 4px 12px', background: '#fff' }}>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') free(); }} placeholder="Ask about your work…" style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: 14, height: 34 }} />
          <button onClick={free} aria-label="Send" style={{ width: 34, height: 34, border: 0, borderRadius: 8, backgroundImage: 'linear-gradient(135deg,#0052ff,#4d7cff)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-up" size={16} /></button>
        </div>
      </div>
    </aside>
  );
}
