'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app';
import type { SearchHit, SearchResult } from '@/lib/types';
import { Icon } from './ui';
import { useOpenNewMeeting } from './dialogs';

const ICON: Record<string, string> = { customer: 'icon-building-2', project: 'icon-folder-kanban', task: 'icon-list-checks', meeting: 'icon-calendar', quote: 'icon-scroll-text', invoice: 'icon-file-text',
  payment: 'icon-wallet', credit: 'icon-receipt', deal: 'icon-kanban', asset: 'icon-laptop', person: 'icon-user', action: 'icon-plus', page: 'icon-arrow-right' };

type Item = SearchHit & { run?: () => void };

/** ⌘K: search everything you can see, jump to any page, or start something new. */
export function CommandPalette() {
  const { ui, setUi, can, has, isMobile } = useApp(); const router = useRouter(); const newMeeting = useOpenNewMeeting();
  const [q, setQ] = useState(''); const [res, setRes] = useState<SearchResult | null>(null); const [busy, setBusy] = useState(false); const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null); const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); setUi(u => ({ search: !u.search })); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [setUi]);
  useEffect(() => { if (!ui.search) { setQ(''); setRes(null); setHi(0); } }, [ui.search]);
  useEffect(() => {
    const term = q.trim(); if (term.length < 2) { setRes(null); setBusy(false); return; }
    setBusy(true); const t = setTimeout(async () => {
      try { const r = await api<SearchResult>(`search?q=${encodeURIComponent(term)}`); if (r.q === term) { setRes(r); setHi(0); } } catch { /* keep last results */ }
      setBusy(false);
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const close = () => setUi({ search: false });
  const quick: { label: string; items: Item[] }[] = useMemo(() => {
    const a = (title: string, sub: string, run: () => void): Item => ({ type: 'action', id: title, title, sub, run });
    const pg = (title: string, href: string, ok = true): Item | null => (ok ? { type: 'page', id: href, title, sub: href, href } : null);
    const actions = [has('task.create') && a('New task', 'Raise a task on a project', () => setUi({ newTask: { projectId: '' } })), a('New meeting', 'Book time and send invites', () => newMeeting()),
      has('customer.create') && a('Add customer', 'With GSTIN validation', () => setUi({ customer: 'new' })), has('quote.create') && a('New quotation', 'Open the quotation builder', () => router.push('/quotes/new')),
      has('invoice.create') && a('New invoice', 'Open the invoice builder', () => router.push('/invoices/new'))].filter(Boolean) as Item[];
    const pages = [pg('My Work', '/'), pg('Tasks', '/tasks', can('tasks')), pg('Meetings', '/meetings'), pg('Approvals', '/approvals', can('approvals')), pg('Customers', '/customers', can('crm')), pg('Pipeline', '/pipeline', can('crm')),
      pg('Quotations', '/quotes', can('sales')), pg('Catalogue', '/catalog', can('sales')), pg('Projects', '/projects', can('projects')), pg('Assets', '/assets', can('assets')), pg('Invoices', '/invoices', can('billing')),
      pg('Credit notes', '/credit-notes', can('billing')), pg('Payments', '/payments', can('payments')), pg('Reports', '/reports', can('reports')), pg('Settings', '/settings', has('settings.manage') || has('role.manage'))].filter(Boolean) as Item[];
    return [{ label: 'Create', items: actions }, { label: 'Go to', items: pages }];
  }, [can, has, newMeeting, router, setUi]);

  const term = q.trim().toLowerCase();
  const groups = term.length < 2 ? quick.map(g => ({ ...g, items: g.items.filter(i => !term || i.title.toLowerCase().includes(term)) })).filter(g => g.items.length)
    : [...(res?.groups || []).map(g => ({ label: g.label, items: g.hits as Item[] })), ...quick.map(g => ({ ...g, items: g.items.filter(i => i.title.toLowerCase().includes(term)) })).filter(g => g.items.length)];
  const flat = groups.flatMap(g => g.items);
  useEffect(() => { list.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }); }, [hi]);
  if (!ui.search) return null;

  const pick = (it: Item) => {
    close();
    if (it.run) return it.run();
    if (it.open === 'task') return setUi({ taskId: it.id, meetId: null });
    if (it.open === 'meeting') return setUi({ meetId: it.id, taskId: null });
    if (it.href) router.push(it.href);
  };
  let i = -1;
  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) close(); }} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(15,23,42,.4)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: isMobile ? 12 : '12vh 16px 16px' }}>
      <div role="dialog" aria-label="Search" style={{ width: 640, maxWidth: '100%', maxHeight: isMobile ? '100%' : '70vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 14, boxShadow: '0 24px 64px -16px rgba(15,23,42,.45)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 56, borderBottom: '1px solid #e2e8f0', flex: 'none' }}>
          <Icon name={busy ? 'loader-circle' : 'search'} size={18} style={{ color: '#94a3b8', animation: busy ? 'spin 1s linear infinite' : undefined }} />
          <input ref={input} autoFocus value={q} onChange={e => { setQ(e.target.value); setHi(0); }} placeholder="Search customers, invoices, tasks, people… or type a command"
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, flat.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); if (flat[hi]) pick(flat[hi]); }
              else if (e.key === 'Escape') close();
            }}
            aria-label="Search" style={{ flex: 1, minWidth: 0, border: 0, outline: 0, fontSize: 16, background: 'transparent' }} />
          <kbd onClick={close} style={{ cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 6px', color: '#64748b' }}>Esc</kbd>
        </div>
        <div ref={list} style={{ overflowY: 'auto', padding: 6 }}>
          {groups.map(g => (
            <div key={g.label} style={{ padding: '4px 0' }}>
              <p style={{ margin: 0, padding: '6px 10px 4px', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: '#94a3b8' }}>{g.label}</p>
              {g.items.map(it => { i++; const idx = i; const on = idx === hi;
                return (
                  <button key={it.type + it.id} data-i={idx} onMouseMove={() => setHi(idx)} onClick={() => pick(it)}
                    style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', border: 0, borderRadius: 8, cursor: 'pointer', background: on ? '#eef4ff' : 'transparent' }}>
                    <span style={{ width: 30, height: 30, flex: 'none', borderRadius: 8, background: on ? '#fff' : '#f1f5f9', color: on ? '#0052ff' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={ICON[it.type] || 'icon-circle'} size={15} /></span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="ellipsis" style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#0f172a' }}>{it.title}</span>
                      {it.type !== 'page' && <span className="ellipsis" style={{ display: 'block', fontSize: 12.5, color: '#64748b' }}>{it.sub}</span>}
                    </span>
                    {on && <Icon name="corner-down-left" size={14} style={{ color: '#94a3b8' }} />}
                  </button>
                ); })}
            </div>
          ))}
          {term.length >= 2 && !busy && res && !res.groups.length && !flat.length && <p style={{ margin: 0, padding: '28px 16px', textAlign: 'center', fontSize: 14, color: '#64748b' }}>Nothing matches “{q.trim()}”.</p>}
          {term.length === 1 && !flat.length && <p style={{ margin: 0, padding: '20px 16px', fontSize: 14, color: '#64748b' }}>Keep typing…</p>}
        </div>
        {!isMobile && <div style={{ flex: 'none', display: 'flex', gap: 16, padding: '8px 16px', borderTop: '1px solid #f1f5f9', fontSize: 12, color: '#94a3b8' }}><span>↑↓ to move</span><span>↵ to open</span><span>Esc to close</span><span style={{ marginLeft: 'auto' }}>Numbers work too: INV-2026-0131, TSK-101, a GSTIN or UTR</span></div>}
      </div>
    </div>
  );
}
