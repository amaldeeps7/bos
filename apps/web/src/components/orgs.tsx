'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_ROLES, STATE_CODES, formatNumber, todayISO } from '@bos/shared';
import { api, ApiError } from '@/lib/api';
import { useAct, useApp, useQ } from '@/lib/app';
import type { SetupState } from '@/lib/types';
import { Btn, Icon } from './ui';
import { Challenge, continueSignIn } from './mfa';

const ini = (n: string) => n.trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const FLASH = 'bos_flash';
/** Shown once after a full reload (switching organisation reloads the app so nothing from the last one lingers). */
export const takeFlash = () => { try { const m = sessionStorage.getItem(FLASH); sessionStorage.removeItem(FLASH); return m; } catch { return null; } };
export const flashNext = (m: string) => { try { sessionStorage.setItem(FLASH, m); } catch { /* private mode */ } };

/** Switches the session to another organisation, then reloads so every cached record is dropped. */
export async function switchOrg(id: string, name: string, setupDone?: boolean) {
  const r = await api<Partial<Challenge>>('auth/switch', { body: { orgId: id } });
  if (r.mfa && r.ticket) return continueSignIn(r as Challenge); // that organisation asks for a code
  flashNext(`Switched to ${name}.`);
  location.href = setupDone === false ? '/setup' : '/';
}

/** The organisation menu under the sidebar header (and the mobile header badge). */
export function OrgMenu() {
  const { me, ui, setUi, isMobile, toast } = useApp();
  if (!ui.orgMenu) return null;
  const close = () => setUi({ orgMenu: false });
  return <>
    <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 89 }} />
    <div role="menu" aria-label="Your organisations" style={{ position: 'fixed', top: 60, left: 12, width: 310, maxWidth: 'calc(100% - 24px)', zIndex: 90, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 16px 48px -12px rgba(15,23,42,.22),0 4px 12px -4px rgba(15,23,42,.08)', overflow: 'hidden' }}>
      <p style={{ margin: 0, padding: '12px 14px 6px', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: '#94a3b8' }}>Your organisations</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 6px 6px' }}>
        {me.orgs.map(t => (
          <button key={t.id} role="menuitem" className="hov-soft" onClick={async () => { if (t.current) return close(); try { await switchOrg(t.id, t.name, t.setupDone); } catch (e) { toast(e instanceof ApiError ? e.message : 'Couldn’t switch.'); } }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, padding: 8, border: 0, borderRadius: 8, background: 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
            <span style={{ width: 32, height: 32, flex: 'none', borderRadius: 8, background: '#eef4ff', color: '#0052ff', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t.ini}</span>
            <span style={{ minWidth: 0, flex: 1 }}><span className="ellipsis" style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{t.name}</span><span style={{ display: 'block', fontSize: 13, color: '#64748b' }}>{t.current && ui.viewAs ? ui.viewAs : t.role} · {t.sub}</span></span>
            {t.current && <Icon name="check" size={16} style={{ color: '#0052ff' }} />}
          </button>
        ))}
      </div>
      <div style={{ borderTop: '1px solid #e2e8f0', padding: 6 }}>
        <button onClick={() => setUi({ orgMenu: false, newOrg: true })} className="hov-blue" style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: 8, border: 0, borderRadius: 8, background: 'transparent', cursor: 'pointer', width: '100%', fontSize: 14, fontWeight: 500, color: '#0052ff' }}>
          <span style={{ width: 32, height: 32, flex: 'none', borderRadius: 8, border: '1px dashed #94a3b8', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={16} /></span>Create organisation
        </button>
      </div>
      <p style={{ margin: 0, padding: '10px 14px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', fontSize: 13, color: '#64748b', textWrap: 'pretty' as any }}>Each organisation keeps its own people, records and settings. Nothing is shared between them.</p>
      {isMobile && null}
    </div>
  </>;
}

const PATTERNS: [string, string][] = [['{prefix}-{fy}-{seq}', 'Financial year · INV-26-27-0001'], ['{prefix}-{yyyy}-{seq}', 'Calendar year · INV-2026-0001'], ['{prefix}/{yy}/{seq}', 'Short · INV/26/0001']];
const STEPS = [
  ['Organisation', 'Name your organisation', 'The account your team signs in to. You can belong to several organisations; each keeps its own data.'],
  ['Legal entity', 'Who issues your invoices?', 'The registered business on your quotations and tax invoices. One entity per GSTIN.'],
  ['Numbering', 'How should documents be numbered?', 'Numbers come from a locked counter, so two documents never share one. You can change this later, forward only.'],
  ['Team', 'Invite your team', 'Optional. You can invite people any time from Settings → Users.'],
] as const;
const slugOf = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Four steps to a new organisation. Signed in, it's added to your organisation menu (you're its Owner);
 * on the public sign-up page (`account`), the first step also creates your sign-in.
 */
export function OrgWizard({ onClose, account = false }: { onClose: () => void; account?: boolean }) {
  const [ob, setOb] = useState({ step: 0, name: '', slug: '', slugTouched: false, currency: 'INR', fy: 'April', le: '', gst: true, gstin: '', state: '', addr: '', inv: 'INV', qt: 'QT', pattern: PATTERNS[0][0],
    invites: [{ email: '', role: 'Project manager' }, { email: '', role: 'Finance' }], you: '', email: '', password: '', err: '', busy: false });
  const set = (patch: Partial<typeof ob>) => setOb(o => ({ ...o, ...patch, err: '' }));
  const g = ob.gstin; const gs = STATE_CODES[g.slice(0, 2)];
  const gHint = !g ? 'The first two digits are your state code. They decide whether you charge CGST + SGST or IGST.' : g.length < 15 ? `${g.length} of 15 characters${gs ? ` · ${gs}` : ''}` : gs ? `${gs} · PAN ${g.slice(2, 12)}` : 'That state code isn’t recognised.';
  const sample = (p: string) => formatNumber({ prefix: p, pattern: ob.pattern, padding: 4, next: 1 }, todayISO('Asia/Kolkata'), ob.fy);
  const emails = ob.invites.map(x => x.email.trim().toLowerCase()).filter(Boolean);
  const err = (m: string) => setOb(o => ({ ...o, err: m, busy: false }));
  const next = async () => {
    if (ob.step === 0) {
      if (!ob.name.trim()) return err('Give the organisation a name.');
      if (ob.slug.length < 3) return err('The address needs at least 3 characters.');
      if (account) {
        if (!ob.you.trim()) return err('Enter your name.');
        if (!EMAIL.test(ob.email.trim())) return err('Enter your work email.');
        if (ob.password.length < 12) return err('Use a password of at least 12 characters.');
      }
      try { const r = await api<{ ok: boolean }>(`signup/slug/${encodeURIComponent(ob.slug)}`); if (!r.ok) return err(`${ob.slug}.bos.app is taken. Try another.`); } catch { /* checked again on create */ }
    }
    if (ob.step === 1) { if (!ob.le.trim()) return err('Enter the registered name.'); if (ob.gst ? g.length !== 15 || !gs : !ob.state) return err(ob.gst ? 'Enter a valid 15-character GSTIN.' : 'Pick your state.'); }
    if (ob.step === 2 && (!ob.inv || !ob.qt)) return err('Both prefixes are needed.');
    if (ob.step < 3) return setOb(o => ({ ...o, step: o.step + 1, err: '' }));
    const bad = emails.find(m => !EMAIL.test(m)); if (bad) return err(`${bad} isn’t a valid email address.`);
    setOb(o => ({ ...o, busy: true, err: '' }));
    try {
      const r = await api<{ message: string } & Partial<Challenge>>('signup', { body: {
        name: ob.name.trim(), slug: ob.slug, currency: ob.currency, fy: ob.fy, entity: { name: ob.le.trim(), gst: ob.gst, gstin: ob.gst ? g : '', state: ob.state, address: ob.addr.trim() },
        numbering: { inv: ob.inv, qt: ob.qt, pattern: ob.pattern }, invites: ob.invites.filter(x => x.email.trim()),
        ...(account ? { account: { name: ob.you.trim(), email: ob.email.trim().toLowerCase(), password: ob.password } } : {}),
      } });
      flashNext(r.message); if (r.mfa && r.ticket) return continueSignIn(r as Challenge, 'setup'); location.href = '/setup';
    } catch (e) { err(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'); }
  };
  const back = () => (ob.step ? setOb(o => ({ ...o, step: o.step - 1, err: '' })) : onClose());
  const [, title, sub] = STEPS[ob.step];
  const input = { height: 42, width: '100%', border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 12px', fontSize: 14, fontWeight: 400, outlineColor: '#0052ff', background: '#fff' } as const;
  const lbl = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 500, minWidth: 0 } as const;
  const grid = (min: number) => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit,minmax(${min}px,1fr))`, gap: 16 }) as const;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 95, background: '#fafafa', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 64, flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', borderBottom: '1px solid #e2e8f0', background: '#fff' }}>
        <span style={{ width: 32, height: 32, flex: 'none', borderRadius: 8, backgroundImage: 'linear-gradient(135deg,#0052ff,#4d7cff)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 }}>{ob.name.trim() ? ini(ob.name) : '+'}</span>
        <p style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600 }}>New organisation</p>
        <button onClick={onClose} aria-label="Close" className="ghost-icon" style={{ width: 40, height: 40 }}><Icon name="x" size={19} /></button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '28px 20px 48px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8 }}>
            {STEPS.map(([label], i) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <div style={{ height: 4, borderRadius: 999, background: i <= ob.step ? '#0052ff' : '#e2e8f0' }} />
                <span className="ellipsis" style={{ fontSize: 13, fontWeight: i === ob.step ? 600 : 500, color: i <= ob.step ? '#0f172a' : '#94a3b8' }}>{i + 1}. {label}</span>
              </div>
            ))}
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>{title}</h1>
            <p style={{ margin: '4px 0 0', fontSize: 15, color: '#64748b', textWrap: 'pretty' as any }}>{sub}</p>
          </div>
          <div className="card">
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {ob.step === 0 && <>
                <label style={lbl}>Organisation name<input autoFocus style={input} value={ob.name} placeholder="e.g. Raman Advisory" onChange={e => { const v = e.target.value; setOb(o => ({ ...o, name: v, slug: o.slugTouched ? o.slug : slugOf(v), err: '' })); }} /></label>
                <label style={lbl}>Workspace address
                  <div style={{ display: 'flex', alignItems: 'center', height: 42, border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
                    <input value={ob.slug} placeholder="your-company" onChange={e => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30), slugTouched: true })} className="mono" style={{ flex: 1, minWidth: 0, height: '100%', border: 0, padding: '0 12px', fontSize: 14, fontWeight: 400, outline: 0 }} />
                    <span style={{ padding: '0 12px', height: '100%', display: 'flex', alignItems: 'center', background: '#f8fafc', borderLeft: '1px solid #e2e8f0', color: '#64748b', fontSize: 14, fontWeight: 400 }}>.bos.app</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 400, color: '#64748b' }}>Where your team signs in. Letters, numbers and hyphens.</span>
                </label>
                <div style={grid(200)}>
                  <label style={lbl}>Currency<select style={input} value={ob.currency} onChange={e => set({ currency: e.target.value })}>{[['INR', 'INR — Indian rupee'], ['USD', 'USD — US dollar'], ['AED', 'AED — UAE dirham'], ['SGD', 'SGD — Singapore dollar']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                  <label style={lbl}>Financial year starts<select style={input} value={ob.fy} onChange={e => set({ fy: e.target.value })}><option value="April">April (Indian financial year)</option><option value="January">January</option></select></label>
                </div>
                {account && <>
                  <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: '#94a3b8' }}>Your sign-in</p>
                  <div style={grid(200)}>
                    <label style={lbl}>Your name<input style={input} value={ob.you} onChange={e => set({ you: e.target.value })} autoComplete="name" /></label>
                    <label style={lbl}>Work email<input style={input} type="email" value={ob.email} onChange={e => set({ email: e.target.value })} autoComplete="email" /></label>
                  </div>
                  <label style={lbl}>Password<input style={input} type="password" value={ob.password} onChange={e => set({ password: e.target.value })} autoComplete="new-password" placeholder="12+ characters" /></label>
                </>}
              </>}
              {ob.step === 1 && <>
                <label style={lbl}>Registered name<input autoFocus style={input} value={ob.le} placeholder={ob.gst ? 'As on your GST certificate' : 'Your business name'} onChange={e => set({ le: e.target.value })} /></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}><input type="checkbox" checked={!ob.gst} onChange={e => set({ gst: !e.target.checked })} style={{ width: 18, height: 18, accentColor: '#0052ff' }} />Not registered for GST <span style={{ color: '#64748b' }}>— plain invoices, no tax</span></label>
                {ob.gst ? <label style={lbl}>GSTIN<input className="mono" style={{ ...input, letterSpacing: '.02em' }} value={g} placeholder="15 characters" maxLength={15} onChange={e => set({ gstin: e.target.value.toUpperCase().replace(/\s/g, '').slice(0, 15) })} />
                  <span style={{ fontSize: 13, fontWeight: 400, color: g.length === 15 ? (gs ? '#047857' : '#be123c') : '#64748b' }}>{gHint}</span></label>
                  : <label style={lbl}>State<select style={input} value={ob.state} onChange={e => set({ state: e.target.value })}><option value="">Pick a state…</option>{Object.entries(STATE_CODES).sort((a, b) => a[1].localeCompare(b[1])).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
                    <span style={{ fontSize: 13, fontWeight: 400, color: '#64748b' }}>You can switch GST on later in Settings → Legal entities, once you register.</span></label>}
                <label style={lbl}>Registered address<textarea rows={2} value={ob.addr} placeholder="Prints on every quotation and invoice" onChange={e => set({ addr: e.target.value })} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '10px 12px', fontSize: 14, fontWeight: 400, fontFamily: 'inherit', resize: 'vertical', outlineColor: '#0052ff' }} /></label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 14, color: '#334155' }}><Icon name="info" size={16} style={{ color: '#64748b', marginTop: 2 }} /><span style={{ textWrap: 'pretty' as any }}>Registered in more than one state? Each GSTIN is its own entity with its own invoice series. Add the others later in Settings → Legal entities.</span></div>
              </>}
              {ob.step === 2 && <>
                <div style={grid(160)}>
                  <label style={lbl}>Invoice prefix<input className="mono" style={input} value={ob.inv} onChange={e => set({ inv: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 6) })} /></label>
                  <label style={lbl}>Quotation prefix<input className="mono" style={input} value={ob.qt} onChange={e => set({ qt: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 6) })} /></label>
                </div>
                <label style={lbl}>Format<select style={input} value={ob.pattern} onChange={e => set({ pattern: e.target.value })}>{PATTERNS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                <div style={grid(200)}>
                  {[['First invoice', sample(ob.inv || 'INV')], ['First quotation', sample(ob.qt || 'QT')]].map(([l, v]) => (
                    <div key={l} style={{ padding: '12px 16px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}><p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{l}</p><p className="mono" style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 600 }}>{v}</p></div>
                  ))}
                </div>
              </>}
              {ob.step === 3 && <>
                {ob.invites.map((iv, i) => (
                  <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    <input aria-label={`Invite ${i + 1} email`} value={iv.email} placeholder="name@company.com" onChange={e => set({ invites: ob.invites.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)) })} style={{ ...input, flex: '1 1 220px', width: 'auto' }} />
                    <select aria-label={`Invite ${i + 1} role`} value={iv.role} onChange={e => set({ invites: ob.invites.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })} style={{ ...input, flex: '0 1 190px', width: 'auto' }}>{DEFAULT_ROLES.filter(r => !r.builtIn).map(r => <option key={r.name}>{r.name}</option>)}</select>
                  </div>
                ))}
                <Btn size="sm" icon="plus" onClick={() => set({ invites: [...ob.invites, { email: '', role: 'Field staff' }] })} style={{ alignSelf: 'flex-start', boxShadow: 'none' }}>Add another</Btn>
                <p style={{ margin: 0, fontSize: 14, color: '#64748b', textWrap: 'pretty' as any }}>They get an email to join this organisation only. Anyone who already uses Business OS just sees it added to their organisation menu.</p>
              </>}
              {ob.err && <p role="alert" style={{ margin: 0, fontSize: 14, color: '#be123c' }}>{ob.err}</p>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '14px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', borderRadius: '0 0 12px 12px' }}>
              <Btn onClick={back} style={{ boxShadow: 'none' }}>{ob.step ? 'Back' : 'Cancel'}</Btn>
              <Btn kind="pri" onClick={next} disabled={ob.busy}>{ob.busy ? 'Creating…' : ob.step < 3 ? 'Continue' : emails.length ? 'Create and send invites' : 'Create organisation'}</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Get started: the set-up checklist a new organisation lands on. */
export function SetupScreen() {
  const { me, setUi, has } = useApp(); const act = useAct(); const router = useRouter();
  const q = useQ<SetupState>('orgs/current/setup'); const s = q.data;
  if (!s) return <p style={{ color: '#64748b' }}>Loading…</p>;
  const d = s.detail; const st = s.steps;
  const canInvite = has('user.invite'), canCustomer = has('customer.create'), canCatalog = has('catalog.manage') || has('settings.manage');
  const STEPS: [keyof typeof st, string, string, string, string, (() => void) | null][] = [
    ['org', 'icon-building', 'Organisation details', `${d.currency} · financial year from ${d.fy} · ${d.tz}`, '', null],
    ['entity', 'icon-landmark', 'Issuing entity', d.entity, '', null],
    ['numbering', 'icon-hash', 'Document numbering', `Your first invoice will be ${d.firstInvoice}.`, '', null],
    ['team', 'icon-user-plus', 'Invite your team', st.team ? `${d.invited} ${d.invited === 1 ? 'person' : 'people'} invited.` : 'Each person gets a role that decides what they can see and do.', 'Invite', canInvite ? () => router.push('/settings/users?invite=1') : null],
    ['customer', 'icon-building-2', 'Add your first customer', 'Their GSTIN decides CGST + SGST or IGST automatically.', 'Add customer', canCustomer ? () => setUi({ customer: 'new' }) : null],
    ['catalog', 'icon-package', 'Set up your catalogue', 'The services and rates you quote most often.', 'Add items', canCatalog ? () => router.push('/catalog') : null],
    ['calendar', 'icon-calendar', 'Connect your calendar', 'Meeting invites arrive as calendar events in Google Calendar, Outlook or Apple Calendar.', 'Connect', () => act('me/prefs', { calendar: true }, { method: 'PATCH' }).then(() => q.refetch())],
  ];
  const n = STEPS.filter(x => st[x[0]]).length; const all = n === STEPS.length;
  const finish = async () => { const r = await act('orgs/current/setup', { done: true }, { method: 'PATCH' }); if (r) location.href = '/'; };
  return <>
    <div>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>Welcome to {me.org.name}</h1>
      <p style={{ margin: '4px 0 0', fontSize: 15, color: '#64748b', maxWidth: '68ch' }}>{all ? 'All set. Switch modules on in Settings when you need them.' : `You’re the ${me.user.roleName}. Finish these and ${me.org.name} is ready to quote and invoice.`}</p>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
      <div className="card" style={{ flex: '2 1 460px', minWidth: 0 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}><h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.011em' }}>Set-up checklist</h2><span className="num" style={{ fontSize: 14, color: '#64748b' }}>{n} of {STEPS.length} done</span></div>
          <div style={{ height: 6, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}><div style={{ height: '100%', width: `${n / STEPS.length * 100}%`, background: '#0052ff', borderRadius: 999, transition: 'width .3s' }} /></div>
        </div>
        {STEPS.map(([k, icon, title, desc, cta, go]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ width: 32, height: 32, flex: 'none', borderRadius: 999, background: st[k] ? '#ecfdf5' : '#f1f5f9', color: st[k] ? '#047857' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={st[k] ? 'check' : icon.replace('icon-', '')} size={16} /></span>
            <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>{title}</p><p style={{ margin: '2px 0 0', fontSize: 14, color: '#64748b', textWrap: 'pretty' as any }}>{desc}</p></div>
            {!st[k] && cta && go && <Btn onClick={go} style={{ boxShadow: 'none', flex: 'none' }}>{cta}</Btn>}
          </div>
        ))}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 12, padding: '14px 20px' }}>
          {has('settings.manage') && (all ? <Btn kind="pri" icon="arrow-right" onClick={finish}>Go to My Work</Btn>
            : <button className="link" onClick={finish} style={{ fontSize: 14, color: '#64748b' }}>Skip the rest for now</button>)}
        </div>
      </div>
      <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}><h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.011em' }}>This organisation</h2></div>
          <div style={{ padding: '4px 20px 10px', display: 'flex', flexDirection: 'column' }}>
            {s.facts.map(f => <div key={f.label} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}><span style={{ fontSize: 13, color: '#64748b' }}>{f.label}</span><span style={{ fontSize: 14, fontWeight: 500, overflowWrap: 'anywhere' }}>{f.value}</span></div>)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '14px 16px', borderRadius: 12, background: '#eef4ff', border: '1px solid rgba(0,82,255,.15)', fontSize: 14 }}>
          <Icon name="shield-check" size={17} style={{ color: '#0052ff', marginTop: 1 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ textWrap: 'pretty' as any }}>Nothing from your other organisations is visible here. Customers, invoices, people and settings are kept apart.</span>
            <button onClick={() => setUi({ orgMenu: true })} className="link" style={{ alignSelf: 'flex-start', padding: 0 }}>Switch organisation</button>
          </div>
        </div>
      </div>
    </div>
  </>;
}
