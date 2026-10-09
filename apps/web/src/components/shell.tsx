'use client';
import { ReactNode, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { diffDays } from '@bos/shared';
import { useAct, useApp, useQ } from '@/lib/app';
import { MOD_OF_SCREEN, SCREENS, screenOf } from '@/lib/domain';
import type { Approval, Meeting, Notification } from '@/lib/types';
import { Icon } from './ui';
import { Assistant } from './assistant';
import { TaskPanel, MeetingPanel } from './overlays';
import { MeetingDialog, NewTaskDialog, CustomerDialog, PaymentDialog, CreditDialog } from './dialogs';
import { useTitle } from './title';

const navBtn = (active: boolean) => ({ display: 'flex', alignItems: 'center', gap: 12, minHeight: 42, padding: '8px 12px', border: 0, borderRadius: 8, cursor: 'pointer', fontSize: 15, width: '100%', background: active ? '#eef4ff' : 'transparent', color: active ? '#0052ff' : '#64748b', fontWeight: active ? 600 : 500 } as const);
const Count = ({ n, small }: { n: number; small?: boolean }) => small
  ? <span style={{ position: 'absolute', top: -4, right: -10, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, background: '#0052ff', color: '#fff', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
  : <span style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: '#0052ff', color: '#fff', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>;

export function AppShell({ children }: { children: ReactNode }) {
  const app = useApp(); const { me, ui, setUi, can, has, isMobile, wide, today, now } = app;
  const router = useRouter(); const path = usePathname();
  const { screen } = screenOf(path);
  const parent: Record<string, string> = { project: 'projects', customer: 'customers', quote: 'quotes', invoice: 'invoices', qeditor: 'quotes', ieditor: 'invoices' };
  const canSettings = has('settings.manage') || has('role.manage');
  const allowed = can(MOD_OF_SCREEN[screen] ?? null) && (screen !== 'settings' || canSettings) && (screen !== 'qeditor' || has('quote.create')) && (screen !== 'ieditor' || has('invoice.create'));
  useEffect(() => { if (!allowed) router.replace('/'); }, [allowed, router]);

  const approvals = useQ<Approval[]>(can('approvals') ? 'approvals' : null).data || [];
  const waiting = approvals.filter(a => a.status === 'waiting').length;
  const meetings = useQ<Meeting[]>('meetings').data || [];
  const leftToday = meetings.filter(m => diffDays(m.date, today) === 0 && m.start + m.dur > now).length;
  const notifs = useQ<Notification[]>('notifications').data || [];
  const unread = notifs.some(n => !n.read);
  const act = useAct();
  const title = useTitle();

  const canAi = can('ai');
  const aiOpen = canAi && (ui.aiOpen ?? (!isMobile && wide));
  const go = (href: string) => { setUi({ notifOpen: false, aiOpen: isMobile ? false : ui.aiOpen }); router.push(href); document.querySelector('main')?.scrollTo(0, 0); };
  const item = (id: string, href: string, label: string, icon: string, count?: number) => ({ id, href, label, icon, count, active: screen === id || parent[screen] === id });
  const groups = [
    { label: '', items: [item('mywork', '/', 'My Work', 'icon-house'), can('tasks') && item('tasks', '/tasks', 'Tasks', 'icon-list-checks'), item('meetings', '/meetings', 'Meetings', 'icon-calendar'), can('approvals') && item('approvals', '/approvals', 'Approvals', 'icon-badge-check', waiting)] },
    { label: 'Sales', items: [can('crm') && item('customers', '/customers', 'Customers', 'icon-building-2'), can('crm') && item('pipeline', '/pipeline', 'Pipeline', 'icon-kanban'), can('sales') && item('quotes', '/quotes', 'Quotations', 'icon-scroll-text'), can('sales') && item('catalog', '/catalog', 'Catalogue', 'icon-package')] },
    { label: 'Delivery', items: [can('projects') && item('projects', '/projects', 'Projects', 'icon-folder-kanban'), can('assets') && item('assets', '/assets', 'Assets', 'icon-laptop')] },
    { label: 'Finance', items: [can('billing') && item('invoices', '/invoices', 'Invoices', 'icon-file-text'), can('billing') && item('credits', '/credit-notes', 'Credit notes', 'icon-receipt'), can('payments') && item('payments', '/payments', 'Payments', 'icon-wallet')] },
    { label: 'Insights', items: [can('reports') && item('reports', '/reports', 'Reports', 'icon-chart-column')] },
    { label: 'Organisation', items: [canSettings && item('settings', '/settings', 'Settings', 'icon-settings-2')] },
  ].map(g => ({ ...g, items: g.items.filter(Boolean) as ReturnType<typeof item>[] })).filter(g => g.items.length);

  const tabs = [item('mywork', '/', 'My Work', 'icon-house'), can('tasks') && item('tasks', '/tasks', 'Tasks', 'icon-list-checks'), item('meetings', '/meetings', 'Meetings', 'icon-calendar', leftToday),
    can('projects') && item('projects', '/projects', 'Projects', 'icon-folder-kanban'), can('approvals') && item('approvals', '/approvals', 'Approvals', 'icon-badge-check', waiting)].filter(Boolean) as ReturnType<typeof item>[];

  const orgIni = me.org.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/login'; };

  return (
    <div style={{ height: '100vh', background: '#fafafa' }}>
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', overflow: 'hidden' }}>
        {!isMobile && (
          <nav style={{ width: 248, flex: 'none', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e2e8f0', background: '#fafafa', height: '100%' }}>
            <div style={{ height: 64, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderBottom: '1px solid #e2e8f0' }}>
              <span style={{ width: 32, height: 32, borderRadius: 8, backgroundImage: 'linear-gradient(135deg,#0052ff,#4d7cff)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 }}>{orgIni}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 600, lineHeight: 1.2 }}>{me.org.name}</span>
                <span style={{ display: 'block', fontSize: 12, color: '#64748b', lineHeight: 1.2 }}>Business OS</span>
              </span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 18 }}>
              {groups.map(g => (
                <div key={g.label || 'home'}>
                  {g.label && <p style={{ margin: 0, padding: '0 12px 8px', fontSize: 13, fontWeight: 500, color: '#94a3b8' }}>{g.label}</p>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {g.items.map(it => (
                      <button key={it.id} onClick={() => go(it.href)} style={navBtn(it.active)} className={it.active ? '' : 'hov-soft'}>
                        <Icon name={it.icon} size={18} /><span style={{ flex: 1, textAlign: 'left' }}>{it.label}</span>{!!it.count && <Count n={it.count} />}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ flex: 'none', borderTop: '1px solid #e2e8f0', padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px' }}>
                <span style={{ width: 32, height: 32, borderRadius: 999, background: '#f1f5f9', color: '#64748b', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{me.user.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 500, lineHeight: 1.2 }}>{me.user.name}</span>
                  <span style={{ display: 'block', fontSize: 13, color: '#64748b', lineHeight: 1.3 }}>{ui.viewAs || me.user.roleName}</span>
                </span>
                <button onClick={logout} className="ghost-icon" title="Sign out" aria-label="Sign out" style={{ width: 32, height: 32 }}><Icon name="log-out" size={16} /></button>
              </div>
            </div>
          </nav>
        )}

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
          <header style={{ height: 64, flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', borderBottom: '1px solid #e2e8f0', background: 'rgba(255,255,255,.85)', backdropFilter: 'blur(12px)', position: 'relative', zIndex: 20 }}>
            {isMobile ? <>
              <span style={{ width: 30, height: 30, borderRadius: 8, backgroundImage: 'linear-gradient(135deg,#0052ff,#4d7cff)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>{orgIni}</span>
              <p className="ellipsis" style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.011em', minWidth: 0 }}>{title.title}</p>
            </> : <p className="ellipsis" style={{ margin: 0, minWidth: 0, fontSize: 15, fontWeight: 500, color: '#64748b' }}>{SCREENS[screen]?.group}</p>}
            <div style={{ flex: 1 }} />
            {!isMobile && app.width >= 1000 && (
              <button className="hov-soft" style={{ height: 36, flex: 'none', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 12px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', color: '#64748b', fontSize: 14, cursor: 'pointer', boxShadow: '0 1px 2px rgba(15,23,42,.04)' }}>
                <Icon name="search" size={14} /><span style={{ paddingRight: 28 }}>Search…</span>
                <kbd style={{ fontFamily: 'inherit', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 4px', lineHeight: 1 }}>⌘ K</kbd>
              </button>
            )}
            <button onClick={() => setUi({ notifOpen: !ui.notifOpen })} aria-label="Notifications" className="ghost-icon" style={{ position: 'relative', width: 40, height: 40 }}>
              <Icon name="bell" size={19} />
              {unread && <span style={{ position: 'absolute', top: 8, right: 9, width: 8, height: 8, borderRadius: 999, background: '#be123c', border: '2px solid #fff' }} />}
            </button>
            {canAi && (
              <button onClick={() => setUi({ aiOpen: !aiOpen })} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: 'none', whiteSpace: 'nowrap', height: 36, padding: isMobile ? '0 10px' : '0 12px', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 500, border: '1px solid', borderColor: aiOpen ? 'rgba(0,82,255,.25)' : '#cbd5e1', background: aiOpen ? '#eef4ff' : '#fff', color: aiOpen ? '#0052ff' : '#0f172a' }}>
                <Icon name="sparkles" size={16} />{!isMobile && <span>Assistant</span>}
              </button>
            )}
            {isMobile && <button onClick={logout} className="ghost-icon" aria-label="Sign out" style={{ width: 36, height: 36 }}><Icon name="log-out" size={17} /></button>}
            {ui.notifOpen && (
              <div style={{ position: 'absolute', top: 58, right: 16, width: 340, maxWidth: 'calc(100% - 32px)', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 16px 48px -12px rgba(15,23,42,.2),0 4px 12px -4px rgba(15,23,42,.08)', overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>Notifications</span>
                  <button onClick={() => { act('notifications/read-all', {}, { quiet: true }); setUi({ notifOpen: false }); }} style={{ border: 0, background: 'none', color: '#0052ff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Mark all read</button>
                </div>
                <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                  {notifs.map(n => (
                    <button key={n.id} onClick={() => n.link && go(n.link)} className="row-btn" style={{ display: 'flex', gap: 12, padding: '12px 16px', background: n.read ? '#fff' : '#fbfdff' }}>
                      <Icon name={n.icon} size={16} style={{ color: '#64748b', marginTop: 2 }} />
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.4, fontWeight: n.read ? 400 : 500 }}>{n.text}</p>
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94a3b8' }}>{n.when}</p>
                      </div>
                    </button>
                  ))}
                  {!notifs.length && <p style={{ margin: 0, padding: 16, fontSize: 14, color: '#64748b' }}>You're all caught up.</p>}
                </div>
              </div>
            )}
          </header>

          {ui.viewAs && (
            <div style={{ flex: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '10px 20px', background: '#eef4ff', borderBottom: '1px solid rgba(0,82,255,.15)', fontSize: 14, color: '#0f172a' }}>
              <span><strong style={{ fontWeight: 600 }}>Previewing as {ui.viewAs}.</strong> Navigation shows only what this role can reach.</span>
              <button onClick={() => setUi({ viewAs: null })} style={{ border: 0, background: 'none', color: '#0052ff', fontWeight: 500, cursor: 'pointer', padding: 0 }}>Exit preview</button>
            </div>
          )}

          <main style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }} onClick={() => ui.notifOpen && setUi({ notifOpen: false })}>
            <div style={{ maxWidth: 1240, margin: '0 auto', padding: isMobile ? '18px 16px 28px' : '28px 32px 48px', display: 'flex', flexDirection: 'column', gap: isMobile ? 16 : 20 }}>
              {allowed ? children : null}
            </div>
          </main>

          {isMobile && (
            <nav style={{ flex: 'none', display: 'flex', borderTop: '1px solid #e2e8f0', background: '#fff', padding: '6px 4px 10px' }}>
              {tabs.map(tb => {
                const active = !aiOpen && tb.active;
                return (
                  <button key={tb.id} onClick={() => go(tb.href)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '6px 0', border: 0, background: 'transparent', cursor: 'pointer', fontSize: 11, fontWeight: 500, color: active ? '#0052ff' : '#64748b', minHeight: 48 }}>
                    <span style={{ position: 'relative', lineHeight: 1 }}><Icon name={tb.icon} size={21} />{!!tb.count && <Count n={tb.count} small />}</span>
                    <span>{tb.label}</span>
                  </button>
                );
              })}
            </nav>
          )}
        </div>

        {aiOpen && <Assistant screen={screen} />}
        <TaskPanel />
        <MeetingPanel />
        <MeetingDialog />
        <NewTaskDialog />
        <CustomerDialog />
        <PaymentDialog />
        <CreditDialog />
        {app.toastMsg && (
          <div role="status" style={{ position: 'absolute', left: '50%', bottom: 84, transform: 'translateX(-50%)', zIndex: 80, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: '#0f172a', color: '#fff', borderRadius: 10, fontSize: 14, boxShadow: '0 16px 48px -12px rgba(15,23,42,.4)', maxWidth: 'calc(100% - 32px)' }}>
            <Icon name="circle-check" size={16} style={{ color: '#6ee7b7' }} /><span>{app.toastMsg}</span>
          </div>
        )}
      </div>
    </div>
  );
}
