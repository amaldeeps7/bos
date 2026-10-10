'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Notification } from '@/lib/types';
import { Btn, Card, Icon, PageHead, Tabs } from '@/components/ui';

type Page = { rows: (Notification & { at: string })[]; more: boolean; unread: number };

/** Every notification, newest first, in pages of 30; All or Unread. Opening one marks it read. */
export default function Notifications() {
  const router = useRouter(); const qc = useQueryClient();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [rows, setRows] = useState<Page['rows']>([]); const [more, setMore] = useState(false); const [unread, setUnread] = useState(0); const [busy, setBusy] = useState(true);
  const load = async (before?: string) => {
    setBusy(true);
    const p = await api<Page>(`notifications/all?${tab === 'unread' ? 'unread=1&' : ''}${before ? `before=${before}` : ''}`);
    setRows(r => (before ? [...r, ...p.rows] : p.rows)); setMore(p.more); setUnread(p.unread); setBusy(false);
  };
  useEffect(() => { void load(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = async (n: Notification) => {
    if (!n.read) { await api(`notifications/${n.id}/read`, { body: {} }); void qc.invalidateQueries({ queryKey: ['notifications'] }); }
    if (n.link) router.push(n.link); else setRows(r => r.map(x => (x.id === n.id ? { ...x, read: true } : x)));
  };
  const readAll = async () => { await api('notifications/read-all', { body: {} }); void qc.invalidateQueries({ queryKey: ['notifications'] }); void load(); };
  return <>
    <PageHead title="Notifications" sub={unread ? `${unread} unread` : 'All caught up.'} right={unread > 0 && <Btn icon="check-check" onClick={readAll}>Mark all read</Btn>} />
    <Tabs tabs={[{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread', count: unread }]} value={tab} onChange={setTab} />
    <Card>
      {rows.map(n => (
        <button key={n.id} onClick={() => open(n)} className="row-btn" style={{ display: 'flex', gap: 12, padding: '14px 20px', borderBottom: '1px solid #f1f5f9', background: n.read ? '#fff' : '#fbfdff' }}>
          <Icon name={n.icon} size={16} style={{ color: n.read ? '#94a3b8' : '#0052ff', marginTop: 2 }} />
          <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
            <span style={{ display: 'block', fontSize: 14, lineHeight: 1.4, fontWeight: n.read ? 400 : 500 }}>{n.text}</span>
            <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: '#94a3b8' }}>{n.when}</span>
          </span>
          {!n.read && <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: 999, background: '#0052ff', marginTop: 6, flex: 'none' }} />}
        </button>
      ))}
      {!rows.length && !busy && <p style={{ margin: 0, padding: '28px 20px', textAlign: 'center', fontSize: 14, color: '#64748b' }}>{tab === 'unread' ? 'Nothing unread.' : 'No notifications yet.'}</p>}
      {more && <div style={{ padding: 12, display: 'flex', justifyContent: 'center' }}><Btn onClick={() => load(rows.at(-1)?.id)} disabled={busy}>{busy ? 'Loading…' : 'Load older'}</Btn></div>}
    </Card>
  </>;
}
