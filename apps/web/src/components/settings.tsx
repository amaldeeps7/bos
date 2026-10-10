'use client';
import { CSSProperties, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ALL_PERMS, PERM_GROUPS, SERIES_TOKENS, STATE_CODES, fmtD, fmtDLong, formatNumber, permLabel, addDays } from '@bos/shared';
import { useAct, useApp, useQ } from '@/lib/app';
import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import type { Settings } from '@/lib/types';
import { Badge, Btn, Card, CardHead, Check, Icon, Switch, ToggleRow, badgeStyle, tabStyle } from './ui';
import { UserDialog } from './forms';
import { DataExport, EntityDialog, PlanBilling } from './workspace';

const GROUPS: [string, [string, string, string][]][] = [
  ['Organisation', [['org', 'Organisation', 'icon-building'], ['entities', 'Legal entities', 'icon-landmark'], ['units', 'Business units', 'icon-network'], ['modules', 'Modules', 'icon-blocks']]],
  ['People & access', [['users', 'Users', 'icon-users'], ['roles', 'Roles & permissions', 'icon-key-round'], ['security', 'Security', 'icon-shield-check']]],
  ['Documents & money', [['templates', 'Templates', 'icon-layout-template'], ['numbering', 'Numbering', 'icon-hash'], ['tax', 'Tax & GST', 'icon-percent'], ['approvalRules', 'Approval rules', 'icon-badge-check'], ['reminders', 'Reminders', 'icon-bell-ring']]],
  ['Workspace', [['plan', 'Plan & billing', 'icon-credit-card'], ['data', 'Data & export', 'icon-database']]],
  ['Records', [['email', 'Email', 'icon-mail'], ['audit', 'Audit log', 'icon-history']]],
];
const ALL_TABS = GROUPS.flatMap(g => g[1]);
const Foot = ({ children, top = true }: { children: React.ReactNode; top?: boolean }) => <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: top ? '1px solid #e2e8f0' : 0, background: '#f8fafc', borderRadius: '0 0 12px 12px' }}>{children}</div>;
const Kv = ({ k, v, mono, style }: { k: string; v: React.ReactNode; mono?: boolean; style?: CSSProperties }) => <div style={{ minWidth: 0, ...style }}><p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{k}</p><p className={mono ? 'mono' : ''} style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 500, overflowWrap: 'anywhere' }}>{v}</p></div>;

export function SettingsScreen() {
  const { isMobile, me } = useApp(); const router = useRouter();
  const params = useParams<{ tab?: string[] }>(); const tab = params.tab?.[0] || 'org';
  const s = useQ<Settings>('settings').data;
  const go = (id: string) => router.push(`/settings/${id}`);
  return <>
    <div>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>Settings</h1>
      <p style={{ margin: '4px 0 0', fontSize: 15, color: '#64748b', maxWidth: '72ch' }}>What {me.org.name} sets once and every record inherits. Changes apply to new documents; issued ones keep the details they were issued with.</p>
    </div>
    {isMobile && <select value={tab} onChange={e => go(e.target.value)} style={{ height: 44, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 10px', fontSize: 15, fontWeight: 500, background: '#fff' }}>{ALL_TABS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>}
    <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
      {!isMobile && (
        <nav style={{ flex: '0 0 210px', display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 0 }}>
          {GROUPS.map(([label, items]) => (
            <div key={label}>
              <p style={{ margin: 0, padding: '0 10px 6px', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: '#94a3b8' }}>{label}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {items.map(([id, l, icon]) => <button key={id} onClick={() => go(id)} className={tab === id ? '' : 'hov-soft'} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 36, padding: '6px 10px', border: 0, borderRadius: 8, cursor: 'pointer', fontSize: 14, width: '100%', textAlign: 'left', background: tab === id ? '#eef4ff' : 'transparent', color: tab === id ? '#0052ff' : '#334155', fontWeight: tab === id ? 600 : 500 }}><Icon name={icon} size={16} /><span>{l}</span></button>)}
              </div>
            </div>
          ))}
        </nav>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {!s ? <p style={{ color: '#64748b' }}>Loading…</p> : <>
          {tab === 'org' && <Org s={s} />}{tab === 'entities' && <Entities s={s} />}{tab === 'units' && <Units s={s} />}{tab === 'modules' && <Modules s={s} />}
          {tab === 'users' && <Users s={s} />}{tab === 'roles' && <Roles s={s} />}{tab === 'security' && <Security s={s} />}{tab === 'templates' && <Templates s={s} />}
          {tab === 'numbering' && <Numbering s={s} />}{tab === 'tax' && <Tax s={s} />}{tab === 'approvalRules' && <Policy s={s} />}{tab === 'reminders' && <Reminders s={s} />}{tab === 'audit' && <Audit />}{tab === 'email' && <Email />}
          {tab === 'plan' && <PlanBilling s={s} />}{tab === 'data' && <DataExport />}
        </>}
      </div>
    </div>
  </>;
}

function Org({ s }: { s: Settings }) {
  const act = useAct(); const { me } = useApp(); const [o, setO] = useState(s.org);
  const set = (k: keyof typeof o) => (e: { target: { value: string } }) => setO({ ...o, [k]: k === 'country' ? e.target.value.toUpperCase() : e.target.value });
  const sel = (k: keyof typeof o, opts: [string, string][], hint?: string) => <><select className="select" value={o[k]} onChange={set(k)} style={{ width: '100%' }}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>{hint && <span className="hint">{hint}</span>}</>;
  return <>
    <Card>
      <CardHead title="Organisation" sub="The defaults new records inherit. Existing documents keep what they were created with." />
      <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>
        <label className="label">Name<input className="input" value={o.name} onChange={set('name')} style={{ width: '100%' }} /></label>
        <label className="label">Default currency{sel('currency', [['INR', 'INR — Indian rupee'], ['USD', 'USD — US dollar'], ['EUR', 'EUR — Euro'], ['GBP', 'GBP — Pound sterling'], ['AED', 'AED — UAE dirham'], ['SGD', 'SGD — Singapore dollar']], 'What a new invoice or quotation proposes.')}</label>
        <label className="label">Time zone{sel('tz', ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'].map(x => [x, x]), 'Decides where a day ends for due dates and reminders.')}</label>
        <label className="label">Country<input className="input" value={o.country} onChange={set('country')} maxLength={2} style={{ width: '100%', textTransform: 'uppercase' }} /><span className="hint">Two-letter ISO code.</span></label>
        <label className="label">Financial year starts{sel('fy', [['April', 'April (Indian financial year)'], ['January', 'January']])}</label>
        <label className="label">Date format{sel('dateFmt', ['8 Oct 2026', '08/10/2026', '2026-10-08'].map(x => [x, x]))}</label>
      </div>
      <Foot><Btn kind="pri" onClick={() => act('settings/org', o, { method: 'PATCH' })}>Save changes</Btn></Foot>
    </Card>
    <Card>
      <CardHead title="Fixed details" sub="These identify the organisation and can't be changed here." />
      <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: '14px 20px' }}>
        <Kv k="Identifier" v={s.org.slug} mono />
        <div><p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Status</p><p style={{ margin: '4px 0 0' }}><Badge tone="success" dot>Active</Badge></p></div>
        <Kv k="Created" v={fmtDLong(s.org.createdAt.slice(0, 10))} />
        <Kv k="Signed in as" v={me.user.email} />
      </div>
    </Card>
    {me.user.roleName === 'Owner' && me.user.builtIn && <HandOver s={s} />}
  </>;
}

/** The Owner gives the organisation to another active member and picks their own new role. */
function HandOver({ s }: { s: Settings }) {
  const act = useAct(); const { me } = useApp();
  const [open, setOpen] = useState(false); const [f, setF] = useState({ memberId: '', roleId: '', password: '' });
  const people = s.users.filter(u => u.status === 'Active' && u.id !== me.user.id);
  const roles = s.roles.filter(r => !r.builtIn);
  const go = async () => {
    const to = people.find(p => p.id === f.memberId);
    if (!to || !confirm(`Make ${to.name} the Owner? You’ll become ${roles.find(r => r.id === f.roleId)?.name}, and only they can give it back.`)) return;
    const r = await act('settings/owner', f); if (r) location.reload();
  };
  return (
    <Card>
      <CardHead title="Hand over ownership" sub="The Owner holds every permission, manages billing and can close the organisation. There is one Owner." right={!open && <Btn size="sm" onClick={() => setOpen(true)} disabled={!people.length}>Choose new Owner</Btn>} />
      {open && (
        <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
          <label className="label">New Owner<select className="select" value={f.memberId} onChange={e => setF({ ...f, memberId: e.target.value })}><option value="">Choose a person…</option>{people.map(p => <option key={p.id} value={p.id}>{p.name} — {p.role}</option>)}</select></label>
          <label className="label">Your role after<select className="select" value={f.roleId} onChange={e => setF({ ...f, roleId: e.target.value })}><option value="">Choose a role…</option>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <label className="label">Your password<input className="input" type="password" autoComplete="current-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></label>
          <div style={{ gridColumn: '1/-1', display: 'flex', gap: 8 }}><Btn onClick={() => { setOpen(false); setF({ memberId: '', roleId: '', password: '' }); }}>Cancel</Btn><Btn kind="danger" onClick={go} disabled={!f.memberId || !f.roleId || !f.password}>Hand over</Btn></div>
        </div>
      )}
    </Card>
  );
}

const stateOptions = Object.entries(STATE_CODES).sort((a, b) => a[1].localeCompare(b[1])).map(([c, n]) => <option key={c} value={c}>{n}</option>);

function Entities({ s }: { s: Settings }) {
  const act = useAct(); const [edit, setEdit] = useState<string | null>(null); const [draft, setDraft] = useState<any>(null); const [adding, setAdding] = useState(false);
  const field = (k: string, label: string, opts: { full?: boolean; mono?: boolean; max?: number } = {}) => (
    <label className="label" style={opts.full ? { gridColumn: '1/-1' } : undefined}>{label}<input className={'input' + (opts.mono ? ' mono' : '')} maxLength={opts.max} value={draft[k]} onChange={e => setDraft({ ...draft, [k]: ['gstin', 'pan'].includes(k) ? e.target.value.toUpperCase() : e.target.value })} /></label>
  );
  return (
    <Card>
      <CardHead title="Legal entities" sub="Who issues each document. One entity per GSTIN (or one not registered for GST), each with its own invoice, credit note and receipt numbers." right={<Btn size="sm" icon="plus" onClick={() => setAdding(true)}>Add entity</Btn>} />
      {adding && <EntityDialog onClose={() => setAdding(false)} />}
      {s.entities.map(le => (
        <div key={le.id} style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, flex: '1 1 220px' }}>{le.name}</p>
            {le.isDefault ? <span style={{ ...badgeStyle('primary'), gap: 0 }}>Issues new documents</span> : <button className="link" onClick={() => act(`settings/entities/${le.id}/default`)}>Make default</button>}
            {edit !== le.id && <Btn size="sm" onClick={() => { setEdit(le.id); setDraft({ ...le, state: le.stateCode }); }} style={{ boxShadow: 'none' }}>Edit</Btn>}
          </div>
          {edit !== le.id ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: '12px 20px' }}>
              {le.gst ? <Kv k="GSTIN" v={le.gstin} mono /> : <Kv k="GST" v="Not registered — no tax on its documents" />}<Kv k="State" v={le.state} /><Kv k="PAN" v={le.pan || '—'} mono /><Kv k="CIN / LLPIN" v={le.cin} mono />
              <Kv k="Registered address" v={le.address} style={{ gridColumn: '1/-1' }} />
              <Kv k="Bank account" v={le.bank} style={{ gridColumn: 'span 2' }} /><Kv k="UPI" v={le.upi} />
            </div>
          ) : <>
            <ToggleRow label="Registered for GST" desc={draft.gst ? 'Quotations and invoices charge GST and print the GSTIN.' : 'Plain quotations and invoices: no GSTIN, SAC, tax or place of supply. Drafts follow; issued documents don’t change.'}
              on={draft.gst} onClick={() => setDraft({ ...draft, gst: !draft.gst, gstin: draft.gst ? '' : le.gstin })} style={{ padding: 0 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
              {field('name', 'Registered name', { full: true })}
              {draft.gst ? field('gstin', 'GSTIN', { mono: true, max: 15 }) : <label className="label">State<select className="select" value={draft.state} onChange={e => setDraft({ ...draft, state: e.target.value })}><option value="">Pick a state…</option>{stateOptions}</select></label>}
              {field('pan', 'PAN', { mono: true, max: 10 })}
              {field('address', 'Registered address', { full: true })}{field('bank', 'Bank account')}{field('upi', 'UPI ID')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><Btn onClick={() => setEdit(null)} style={{ boxShadow: 'none' }}>Cancel</Btn><Btn kind="pri" onClick={async () => { const r = await act(`settings/entities/${le.id}`, draft, { method: 'PATCH' }); if (r) setEdit(null); }}>Save entity</Btn></div>
          </>}
        </div>
      ))}
    </Card>
  );
}

function Units({ s }: { s: Settings }) {
  const act = useAct(); const { people } = useApp(); const [nu, setNu] = useState({ name: '', code: '' });
  const [edit, setEdit] = useState<{ id: string; name: string; code: string; headId: string; entityId: string } | null>(null);
  const COLS = 'minmax(160px,1.4fr) 80px minmax(200px,1.6fr) 160px 70px 80px';
  const iconBtn = { width: 32, height: 32, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <Card>
      <CardHead title="Business units" sub="Lines of business inside an entity. Projects and reports group by unit." />
      <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 720 }}>
        <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: COLS }}><span>Unit</span><span>Code</span><span>Legal entity</span><span>Head</span><span style={{ textAlign: 'right' }}>Projects</span><span /></div>
        {s.units.map(u => edit?.id === u.id ? (
          <div key={u.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '8px 20px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
            <input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} style={{ height: 36 }} />
            <input className="input mono" value={edit.code} onChange={e => setEdit({ ...edit, code: e.target.value.toUpperCase().slice(0, 4) })} style={{ height: 36 }} />
            <select className="select" value={edit.entityId} onChange={e => setEdit({ ...edit, entityId: e.target.value })} style={{ height: 36 }}>{s.entities.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}</select>
            <select className="select" value={edit.headId} onChange={e => setEdit({ ...edit, headId: e.target.value })} style={{ height: 36 }}><option value="">Not set</option>{[...people.values()].filter(p => p.status === 'Active').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <span className="num" style={{ textAlign: 'right', fontSize: 14 }}>{u.projects}</span>
            <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button onClick={async () => { const r = await act(`settings/units/${u.id}`, edit, { method: 'PATCH' }); if (r) setEdit(null); }} title="Save" aria-label="Save unit" style={{ ...iconBtn, background: '#0052ff', color: '#fff', border: 0 }}><Icon name="check" size={15} /></button>
              <button onClick={() => setEdit(null)} title="Cancel" aria-label="Cancel" style={iconBtn}><Icon name="x" size={15} /></button>
            </span>
          </div>
        ) : (
          <div key={u.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>{u.name}</span><span className="mono" style={{ fontSize: 13 }}>{u.code}</span><span style={{ color: '#64748b' }}>{u.entity}</span><span>{u.head}</span><span className="num" style={{ textAlign: 'right' }}>{u.projects}</span>
            <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button onClick={() => setEdit({ id: u.id, name: u.name, code: u.code, headId: u.headId || '', entityId: u.entityId })} title="Edit unit" aria-label={`Edit ${u.name}`} className="outline-blue" style={iconBtn}><Icon name="pencil" size={14} /></button>
              {!u.projects && <button onClick={() => confirm(`Remove ${u.name}?`) && act(`settings/units/${u.id}`, undefined, { method: 'DELETE' })} title="Remove unit" aria-label={`Remove ${u.name}`} className="outline-red" style={iconBtn}><Icon name="trash-2" size={14} /></button>}
            </span>
          </div>
        ))}
      </div></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '14px 20px', background: '#f8fafc', borderRadius: '0 0 12px 12px' }}>
        <input className="input" value={nu.name} onChange={e => setNu({ ...nu, name: e.target.value })} placeholder="New unit, e.g. Cloud" style={{ flex: '1 1 200px', height: 40 }} />
        <input className="input mono" value={nu.code} onChange={e => setNu({ ...nu, code: e.target.value.toUpperCase().slice(0, 4) })} placeholder="Code" style={{ width: 90, height: 40 }} />
        <Btn icon="plus" onClick={async () => { const r = await act('settings/units', nu); if (r) setNu({ name: '', code: '' }); }} style={{ boxShadow: 'none', gap: 6 }}>Add unit</Btn>
      </div>
    </Card>
  );
}

function Modules({ s }: { s: Settings }) {
  const act = useAct(); const { me } = useApp();
  return <>
    <div><h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.011em' }}>Modules</h2><p style={{ margin: '4px 0 0', fontSize: 14, color: '#64748b', maxWidth: '70ch' }}>Switch on only what {me.org.name} uses. A module that's off disappears for everyone, whatever their role says.</p></div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,250px),1fr))', gap: 12 }}>
      {s.modules.map(m => (
        <div key={m.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 14, opacity: m.on ? 1 : 0.6 }}>
          <span style={{ width: 36, height: 36, flex: 'none', borderRadius: 8, background: '#f1f5f9', color: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={m.icon} size={18} /></span>
          <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{m.name}</p><p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b', lineHeight: 1.4 }}>{m.desc}</p></div>
          <Switch on={m.on} onClick={async () => { await act(`settings/modules/${m.id}`, { on: !m.on }, { method: 'PATCH' }); }} label={`Toggle ${m.name}`} />
        </div>
      ))}
    </div>
  </>;
}

function Users({ s }: { s: Settings }) {
  const act = useAct(); const { me, has, toast } = useApp(); const qc = useQueryClient(); const [inv, setInv] = useState<{ email: string; role: string } | null>(null); const [err, setErr] = useState('');
  const [dlg, setDlg] = useState<Settings['users'][number] | 'new' | null>(null);
  const params = useSearchParams();
  // "Invite" on the Get started checklist opens the invite row straight away.
  useEffect(() => { if (params.get('invite') && has('user.invite')) setInv({ email: '', role: 'Project manager' }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const COLS = 'minmax(240px,2fr) 190px 210px 120px 110px 170px';
  const scopeOpts = [{ value: 'all', label: 'All entities' }, ...s.entities.map(le => ({ value: 'le:' + le.id, label: le.name })), ...s.units.map(u => ({ value: 'bu:' + u.id, label: `${u.name} unit` }))];
  const send = async () => { setErr(''); try { const r = await api<{ message: string }>('settings/users/invite', { body: inv }); setInv(null); toast(r.message); await qc.invalidateQueries(); } catch (e: any) { setErr(e.message); } };
  const tone: Record<string, any> = { Active: 'success', Invited: 'warning', Deactivated: 'neutral' };
  return (
    <Card>
      <CardHead title="Users" sub={`${s.users.filter(u => u.status === 'Active').length} active · ${s.users.filter(u => u.status === 'Invited').length} invited. Role decides what someone can do; Access to decides whose records they see.`}
        right={<div style={{ display: 'flex', gap: 8 }}>
          {has('user.invite') && <button className="btn btn-sec" onClick={() => { setInv({ email: '', role: 'Field staff' }); setErr(''); }} style={{ height: 36, gap: 6, boxShadow: 'none' }}><Icon name="send" size={15} />Invite by email</button>}
          {has('user.manage') && <button className="btn btn-pri" onClick={() => setDlg('new')} style={{ height: 36, gap: 6 }}><Icon name="user-plus" size={15} />Add person</button>}
        </div>} />
      {dlg && <UserDialog settings={s} user={dlg === 'new' ? undefined : dlg} onClose={() => setDlg(null)} />}
      {inv && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10, padding: '14px 20px', background: '#eef4ff', borderBottom: '1px solid rgba(0,82,255,.15)' }}>
          <label className="label" style={{ flex: '1 1 240px' }}>Work email<input className="input" value={inv.email} onChange={e => { setInv({ ...inv, email: e.target.value }); setErr(''); }} placeholder={`name@${String(s.security.domains).split(',')[0]}`} style={{ height: 40 }} /></label>
          <label className="label" style={{ flex: '0 1 200px' }}>Role<select className="select" value={inv.role} onChange={e => setInv({ ...inv, role: e.target.value })} style={{ height: 40 }}>{s.roles.map(r => <option key={r.id}>{r.name}</option>)}</select></label>
          <Btn onClick={() => setInv(null)} style={{ boxShadow: 'none' }}>Cancel</Btn>
          <Btn kind="pri" onClick={send}>Send invite</Btn>
          {err && <p style={{ flexBasis: '100%', margin: 0, fontSize: 14, color: '#be123c' }}>{err}</p>}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 1000 }}>
        <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: COLS }}><span>Person</span><span>Role</span><span>Access to</span><span>Status</span><span>Last active</span><span /></div>
        {s.users.map(u => { const self = u.id === me.user.id;
          return (
            <div key={u.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}><span style={{ width: 32, height: 32, flex: 'none', borderRadius: 999, background: '#f1f5f9', color: '#64748b', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{u.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span><span style={{ minWidth: 0 }}><span style={{ display: 'block', fontWeight: 500 }}>{u.name}{u.title && <span style={{ fontWeight: 400, color: '#64748b' }}> · {u.title}</span>}</span><span className="ellipsis" style={{ display: 'block', fontSize: 13, color: '#64748b' }}>{u.email}</span></span></span>
              <select disabled={self || !has('user.manage')} value={u.role} onChange={e => act(`settings/users/${u.id}`, { role: e.target.value }, { method: 'PATCH' })} style={{ height: 36, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 8px', fontSize: 14, background: '#fff' }}>{s.roles.map(r => <option key={r.id}>{r.name}</option>)}</select>
              <select aria-label={`What ${u.name} can see`} disabled={!has('user.manage') || u.role === 'Owner'} title={u.role === 'Owner' ? 'The Owner always sees every entity and unit.' : undefined} value={u.role === 'Owner' ? 'all' : u.scope} onChange={e => act(`settings/users/${u.id}`, { scope: e.target.value }, { method: 'PATCH' })} style={{ height: 36, minWidth: 0, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 8px', fontSize: 14, background: '#fff' }}>{scopeOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}><Badge tone={tone[u.status]} dot>{u.status}</Badge>{u.mfa && <span title="Two-factor sign-in is on" aria-label="Two-factor on" style={{ display: 'inline-flex', alignItems: 'center', color: '#047857' }}><Icon name="shield-check" size={15} /></span>}</span>
              <span style={{ color: '#64748b' }}>{u.last}</span>
              <span style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                {has('user.manage') && u.mfa && !self && <button onClick={() => confirm(`Reset two-factor for ${u.name}? Use this when they’ve lost their phone. They sign in with their password and set it up again.`) && act(`settings/users/${u.id}/reset-mfa`)} title="Reset two-factor (lost phone)" aria-label={`Reset two-factor for ${u.name}`} className="outline-blue" style={{ width: 32, height: 32, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="shield-off" size={14} /></button>}
                {has('user.manage') && u.status !== 'Invited' && <button onClick={() => setDlg(u)} title="Edit details" aria-label={`Edit ${u.name}`} className="outline-blue" style={{ width: 32, height: 32, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="pencil" size={14} /></button>}
                {u.status === 'Invited' && has('user.invite') && <button onClick={() => confirm(`Withdraw the invitation to ${u.email}? The link in their email stops working.`) && act(`settings/users/${u.id}`, undefined, { method: 'DELETE' })} title="Withdraw invitation" aria-label={`Withdraw the invitation to ${u.email}`} className="outline-red" style={{ width: 32, height: 32, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={14} /></button>}
                {self ? <span style={{ fontSize: 13, color: '#94a3b8', width: 92, textAlign: 'center' }}>You</span> : <button className="btn btn-sec" onClick={() => act(`settings/users/${u.id}/toggle`)} style={{ height: 32, padding: '0 12px', fontSize: 13, boxShadow: 'none' }}>{u.status === 'Active' ? 'Deactivate' : u.status === 'Invited' ? 'Resend invite' : 'Reactivate'}</button>}
              </span>
            </div>
          ); })}
      </div></div>
    </Card>
  );
}

function Roles({ s }: { s: Settings }) {
  const act = useAct(); const { ui, setUi, toast, me, has } = useApp(); const params = useSearchParams(); const qc = useQueryClient();
  const [sel, setSel] = useState(params.get('role') || 'Project manager'); const [view, setView] = useState<'one' | 'all'>('one');
  const [nr, setNr] = useState<{ name: string; from: string } | null>(null); const [err, setErr] = useState('');
  const editable = has('role.manage');
  const role = s.roles.find(r => r.name === sel) || s.roles[0];
  const people = (rn: string) => s.users.filter(u => u.role === rn && u.status !== 'Deactivated').length;
  const ppl = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
  const toggle = (r: typeof role, k: string) => { if (r.builtIn) return toast('Owner is built in and always holds every permission.'); if (!editable) return; act(`settings/roles/${r.id}/perms`, { perms: k, on: !r.perms.includes(k) }, { method: 'PATCH', quiet: true }); };
  const setGroup = (r: typeof role, keys: string[], on: boolean) => act(`settings/roles/${r.id}/perms`, { perms: keys, on }, { method: 'PATCH', quiet: true });
  const create = async () => { setErr(''); try { const r = await api<{ message: string }>('settings/roles', { body: nr }); const name = nr!.name.trim(); setNr(null); toast(r.message); await qc.invalidateQueries(); setSel(name); setView('one'); } catch (e: any) { setErr(e.message); } };
  const modOff = (m: string | null) => !!m && me.user.modules[m] === false;
  const cols = `minmax(240px,2.2fr) repeat(${s.roles.length}, minmax(92px,1fr))`;
  return <>
    <Card>
      <CardHead title="Roles" sub="Permissions are granted by role, never hard-coded into a screen. The API enforces exactly what you see here." right={editable && <Btn icon="plus" onClick={() => { setNr({ name: '', from: 'Field staff' }); setErr(''); }} style={{ height: 36, boxShadow: 'none', gap: 6 }}>New role</Btn>} />
      {nr && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10, padding: '14px 20px', background: '#eef4ff', borderBottom: '1px solid rgba(0,82,255,.15)' }}>
          <label className="label" style={{ flex: '1 1 220px' }}>Role name<input className="input" value={nr.name} onChange={e => { setNr({ ...nr, name: e.target.value }); setErr(''); }} placeholder="e.g. Delivery lead" style={{ height: 40 }} /></label>
          <label className="label" style={{ flex: '0 1 200px' }}>Start from<select className="select" value={nr.from} onChange={e => setNr({ ...nr, from: e.target.value })} style={{ height: 40 }}>{s.roles.map(r => <option key={r.id}>{r.name}</option>)}</select></label>
          <Btn onClick={() => setNr(null)} style={{ boxShadow: 'none' }}>Cancel</Btn><Btn kind="pri" onClick={create}>Create role</Btn>
          {err && <p style={{ flexBasis: '100%', margin: 0, fontSize: 14, color: '#be123c' }}>{err}</p>}
        </div>
      )}
      <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 10 }}>
        {s.roles.map(r => { const on = r.name === role.name && view === 'one';
          return (
            <button key={r.id} onClick={() => { setSel(r.name); setView('one'); }} style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 10, cursor: 'pointer', border: on ? '1px solid #0052ff' : '1px solid #e2e8f0', background: on ? '#eef4ff' : '#fff' }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%' }}><span style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>{r.name}</span><span style={{ fontSize: 12, color: '#64748b' }}>{r.builtIn ? 'Built in' : 'Custom'}</span></span>
              <span style={{ fontSize: 13, color: '#64748b' }}>{r.perms.length} of {ALL_PERMS.length} permissions · {ppl(people(r.name))}</span>
            </button>
          ); })}
      </div>
    </Card>
    <div style={{ display: 'flex', gap: 4, padding: 4, background: '#f1f5f9', borderRadius: 10, alignSelf: 'flex-start', maxWidth: '100%', overflowX: 'auto' }}>
      {([['one', 'One role'], ['all', 'All roles side by side']] as const).map(([id, l]) => <button key={id} onClick={() => setView(id)} style={tabStyle(view === id)}>{l}</button>)}
    </div>
    {view === 'one' ? (
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px 16px', padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ minWidth: 0, flex: '1 1 280px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}><h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.011em' }}>{role.name}</h2><Badge tone="neutral">{role.builtIn ? 'Built in' : 'Custom'}</Badge></div>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: '#64748b' }}>{role.desc}</p>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#94a3b8' }}>{role.perms.length} of {ALL_PERMS.length} permissions · held by {ppl(people(role.name))}</p>
          </div>
          {editable && <div style={{ display: 'flex', gap: 8 }}>
            <Btn size="sm" icon="copy" onClick={() => setNr({ name: `${role.name} (copy)`, from: role.name })} style={{ height: 36, boxShadow: 'none' }}>Duplicate</Btn>
            {!role.builtIn && people(role.name) === 0 && s.users.every(u => u.role !== role.name) && <Btn size="sm" kind="danger" icon="trash-2" onClick={async () => { if (confirm(`Delete ${role.name}?`)) { await act(`settings/roles/${role.id}`, undefined, { method: 'DELETE' }); setSel('Project manager'); } }} style={{ height: 36 }}>Delete</Btn>}
          </div>}
        </div>
        {role.builtIn && <p style={{ margin: 0, padding: '10px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 14, color: '#475569' }}>Owner is built in and always holds every permission, so nobody can lock the organisation out of itself. Duplicate it to make a narrower admin role.</p>}
        {PERM_GROUPS.map(g => { const n = g.perms.filter(([k]) => role.perms.includes(k)).length;
          return (
            <div key={g.area} style={{ borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', padding: '12px 20px', background: '#f8fafc' }}>
                <Icon name={g.icon} size={16} style={{ color: '#64748b' }} /><span style={{ fontSize: 14, fontWeight: 600 }}>{g.name}</span><span style={{ fontSize: 13, color: '#94a3b8' }}>{n} of {g.perms.length}</span>
                {modOff(g.mod) && <Badge tone="warning" style={{ fontSize: 12, padding: '0 8px' }}>Module off</Badge>}
                <span style={{ flex: 1 }} />
                {!role.builtIn && editable && <span style={{ display: 'flex', gap: 12 }}><button onClick={() => setGroup(role, g.perms.map(p => p[0]), true)} style={{ border: 0, background: 'none', padding: 0, color: '#0052ff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Grant all</button><button onClick={() => setGroup(role, g.perms.map(p => p[0]), false)} style={{ border: 0, background: 'none', padding: 0, color: '#64748b', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Clear</button></span>}
              </div>
              {g.perms.map(([k, d]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 20px', borderTop: '1px solid #f1f5f9' }}>
                  <Check on={role.perms.includes(k)} locked={role.builtIn || !editable} onClick={() => toggle(role, k)} label={k} />
                  <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{permLabel(k)} <span className="mono" style={{ fontSize: 12, fontWeight: 400, color: '#94a3b8' }}>{k}</span></p><p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b', lineHeight: 1.45 }}>{d}</p></div>
                </div>
              ))}
            </div>
          ); })}
      </Card>
    ) : <>
      <Card style={{ overflow: 'auto', maxHeight: '72vh' }}>
        <div style={{ minWidth: 280 + s.roles.length * 104 }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'end', padding: '10px 20px', background: '#fff', borderBottom: '1px solid #e2e8f0', fontSize: 13, fontWeight: 600, color: '#334155', position: 'sticky', top: 0, zIndex: 2 }}>
            <span>Permission</span>{s.roles.map(r => <span key={r.id} style={{ textAlign: 'center', lineHeight: 1.3 }}>{r.name}<span style={{ display: 'block', fontSize: 12, fontWeight: 400, color: '#94a3b8' }}>{r.perms.length} of {ALL_PERMS.length}</span></span>)}
          </div>
          {PERM_GROUPS.map(g => (
            <div key={g.area}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', borderTop: '1px solid #e2e8f0', marginTop: -1 }}>
                <Icon name={g.icon} size={15} style={{ color: '#64748b' }} /><span style={{ fontSize: 13, fontWeight: 600 }}>{g.name}</span>
                {modOff(g.mod) && <Badge tone="warning" style={{ fontSize: 12, padding: '0 8px' }}>Module off</Badge>}
              </div>
              {g.perms.map(([k, d]) => (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', padding: '8px 20px', borderBottom: '1px solid #f1f5f9' }}>
                  <span title={d} style={{ minWidth: 0 }}><span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{permLabel(k)}</span><span className="mono" style={{ display: 'block', fontSize: 12, color: '#94a3b8' }}>{k}</span></span>
                  {s.roles.map(r => { const on = r.perms.includes(k); return <span key={r.id} title={`${r.name}: ${on ? 'granted' : 'not granted'}`} style={{ display: 'flex', justifyContent: 'center' }}><Check on={on} locked={r.builtIn || !editable} onClick={() => toggle(r, k)} label={`${r.name} ${k}`} style={{ margin: '0 auto' }} /></span>; })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
      <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Click any box to grant or remove. Changes take effect on the person's next request and are written to the audit log.</p>
    </>}
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', padding: '14px 20px', border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff' }}>
      <span style={{ fontSize: 14, color: '#64748b' }}>Preview navigation as</span>
      {s.roles.filter(r => !r.builtIn).map(r => { const on = (ui.viewAs || me.user.roleName) === r.name;
        return <button key={r.id} onClick={() => { const own = r.name === me.user.roleName; setUi({ viewAs: own ? null : r.name }); if (!own) toast(`Previewing as ${r.name}.`); }} style={{ height: 32, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', border: '1px solid', borderColor: on ? '#0052ff' : '#cbd5e1', background: on ? '#eef4ff' : '#fff', color: on ? '#0052ff' : '#0f172a' }}>{r.name}</button>; })}
    </div>
  </>;
}

function Security({ s }: { s: Settings }) {
  const act = useAct(); const { me } = useApp(); const [sec, setSec] = useState(s.security); const owner = me.user.roleName === 'Owner' && me.user.builtIn;
  useEffect(() => setSec(s.security), [s.security]);
  const t = (k: string, label: string, desc: string) => <ToggleRow key={k} label={label} desc={desc} on={!!s.security[k]} onClick={() => act('settings/security', { [k]: !s.security[k], label, on: !s.security[k] }, { method: 'PATCH', quiet: true })} />;
  return <>
    <Card>
      <CardHead title="Sign-in" />
      {t('mfaAll', 'Require two-factor sign-in for everyone', `A code from an authenticator app at every sign-in. Anyone without it sets it up next time they sign in.${me.demo ? ' Not enforced in the sample workspace.' : ''}`)}
      {t('mfaFin', 'Always require two-factor for Owner and Finance', 'Applies even when the rule above is off. Lost phone? An admin can reset it from Users.')}
      {t('newDevice', 'Email people when they sign in from a new device', 'With the time, browser and IP address, so they can spot sign-ins that weren’t them.')}
      {/* Can lock people out, so only the Owner decides (the API enforces this too). */}
      <ToggleRow label="Require a confirmed email address" desc={owner ? 'People confirm their address from an emailed link before they can sign in. Accepting an invitation counts as confirming.' : 'Only the Owner can change this.'}
        on={!!s.security.verifyEmail} onClick={() => owner && act('settings/security', { verifyEmail: !s.security.verifyEmail, label: 'Require a confirmed email address', on: !s.security.verifyEmail }, { method: 'PATCH', quiet: true })} style={owner ? undefined : { opacity: 0.6 }} />
    </Card>
    <Card>
      <CardHead title="Sessions & passwords" />
      <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>
        <label className="label">Sign out after inactivity<select className="select" value={sec.timeout} onChange={e => setSec({ ...sec, timeout: e.target.value })}>{['30 minutes', '8 hours', '7 days', '30 days'].map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="label">Minimum password length<select className="select" value={sec.pwd} onChange={e => setSec({ ...sec, pwd: e.target.value })}>{['12', '16'].map(x => <option key={x} value={x}>{x} characters</option>)}</select></label>
        <label className="label" style={{ gridColumn: '1/-1' }}>Allowed sign-in domains<input className="input" value={sec.domains} onChange={e => setSec({ ...sec, domains: e.target.value })} /><span className="hint">Comma-separated. Invitations to other domains are refused.</span></label>
      </div>
      <Foot><Btn kind="pri" onClick={() => act('settings/security', { timeout: sec.timeout, pwd: sec.pwd, domains: sec.domains }, { method: 'PATCH' })}>Save changes</Btn></Foot>
    </Card>
  </>;
}

const SAMPLE = [{ d: 'Senior engineer', sac: '998314', qty: '10 day', rate: '₹28,000', amt: '₹2,80,000' }, { d: 'Delivery management', sac: '998314', qty: '1 fixed', rate: '₹40,000', amt: '₹40,000' }];
function Templates({ s }: { s: Settings }) {
  const act = useAct(); const { me, today } = useApp(); const [kind, setKind] = useState<'invoice' | 'quote'>('invoice');
  const [t, setT] = useState(s.templates[kind]);
  useEffect(() => setT(s.templates[kind]), [kind, s.templates]);
  const isInv = kind === 'invoice'; const le = s.entities.find(e => e.isDefault) || s.entities[0];
  const compact = t.layout === 'Compact', modern = t.layout === 'Modern';
  const isInv0 = kind === 'invoice'; const le0 = s.entities.find(e => e.isDefault) || s.entities[0];
  const gst = le0?.gst !== false; const sac = t.show.sac && gst; // a non-GST entity's documents carry no SAC or tax
  const title0 = t.title || (isInv0 ? 'Tax invoice' : 'Quotation'); const title = gst ? title0 : title0.replace(/^tax\s+invoice/i, 'Invoice');
  const grid = sac ? '1fr 50px 44px 66px 74px' : '1fr 44px 66px 74px';
  const gTot: CSSProperties = { fontWeight: 600, paddingTop: 5, marginTop: 2, borderTop: '1px solid #cbd5e1', fontSize: '1.15em' };
  const def = s.entities.find(e => e.isDefault)?.id;
  const sr = s.series.find(x => x.type === (isInv ? 'INVOICE' : 'QUOTATION') && (!isInv || x.entityId === def)) || s.series.find(x => x.type === (isInv ? 'INVOICE' : 'QUOTATION'))!;
  const no = formatNumber(sr, today, s.org.fy);
  const ini = me.org.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const cust = { name: 'Halcyon Logistics', gstin: '29AADCH7713P1ZQ', city: 'Bengaluru' };
  return <>
    <div style={{ display: 'flex', gap: 4, padding: 4, background: '#f1f5f9', borderRadius: 10, alignSelf: 'flex-start' }}>{([['invoice', 'Invoice'], ['quote', 'Quotation']] as const).map(([id, l]) => <button key={id} onClick={() => setKind(id)} style={tabStyle(kind === id)}>{l}</button>)}</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 20, alignItems: 'start' }}>
      <Card>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16, borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><span style={{ fontSize: 14, fontWeight: 500 }}>Layout</span>
            <div style={{ display: 'flex', gap: 4, padding: 4, background: '#f1f5f9', borderRadius: 10, alignSelf: 'flex-start' }}>{['Classic', 'Modern', 'Compact'].map(l => <button key={l} onClick={() => setT({ ...t, layout: l })} style={tabStyle(t.layout === l)}>{l}</button>)}</div></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><span style={{ fontSize: 14, fontWeight: 500 }}>Accent colour</span>
            <div style={{ display: 'flex', gap: 10 }}>{['#0052ff', '#0f172a', '#047857', '#7c3aed'].map(c => <button key={c} onClick={() => setT({ ...t, accent: c })} aria-label={c} style={{ width: 30, height: 30, borderRadius: 999, padding: 0, cursor: 'pointer', background: c, border: '2px solid #fff', boxShadow: t.accent === c ? `0 0 0 2px ${c}` : '0 0 0 1px #cbd5e1' }} />)}</div></div>
          <label className="label">Document title<input className="input" value={t.title} onChange={e => setT({ ...t, title: e.target.value })} style={{ height: 40 }} /></label>
        </div>
        <p style={{ margin: 0, padding: '14px 20px 4px', fontSize: 14, fontWeight: 500 }}>Show on the document</p>
        {([['logo', 'Logo'], ['sac', 'SAC column'], ['bank', 'Bank details'], ['upi', 'UPI QR code'], ['sign', 'Authorised signatory'], ['words', 'Amount in words']] as const).map(([k, l]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 20px' }}><span style={{ flex: 1, fontSize: 14 }}>{l}</span><Switch on={!!t.show[k]} onClick={() => setT({ ...t, show: { ...t.show, [k]: !t.show[k] } })} label={l} /></div>
        ))}
        <div style={{ padding: '14px 20px 18px', display: 'flex', flexDirection: 'column', gap: 14, borderTop: '1px solid #e2e8f0', marginTop: 8 }}>
          <label className="label">Terms printed at the foot<textarea className="textarea" rows={3} value={t.terms} onChange={e => setT({ ...t, terms: e.target.value })} /></label>
          <label className="label">Email subject<input className="input" value={t.subject} onChange={e => setT({ ...t, subject: e.target.value })} style={{ height: 40 }} /><span className="hint">Tokens: {'{number}'}, {'{customer}'}, {'{amount}'}, {'{due}'}</span></label>
        </div>
        <Foot><Btn kind="pri" onClick={() => act(`settings/templates/${kind}`, { ...t, save: true }, { method: 'PATCH' })}>Save template</Btn></Foot>
      </Card>
      <div style={{ background: '#e7ebf0', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#475569' }}>Preview, with sample figures</p>
        <div style={{ background: '#fff', borderRadius: 4, boxShadow: '0 8px 24px -8px rgba(15,23,42,.25)', padding: compact ? 18 : 28, display: 'flex', flexDirection: 'column', gap: compact ? 10 : 16, fontSize: compact ? 10.5 : 11.5, lineHeight: 1.45, color: '#0f172a', width: '100%', maxWidth: 560, minHeight: compact ? 560 : 680, margin: '0 auto', borderTop: modern ? 'none' : `4px solid ${t.accent}`, overflow: 'hidden' }}>
          {modern && <div style={{ margin: compact ? '-18px -18px 0' : '-28px -28px 0', padding: compact ? '12px 18px' : '16px 28px', background: t.accent, color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 15, fontWeight: 600 }}><span>{title}</span><span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>{no}</span></div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
              {t.show.logo && <span style={{ width: 34, height: 34, flex: 'none', borderRadius: 8, background: t.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>{ini}</span>}
              <div style={{ minWidth: 0 }}><p style={{ margin: 0, fontWeight: 600, fontSize: '1.15em' }}>{le.name}</p><p style={{ margin: '2px 0 0', color: '#475569' }}>{le.address}</p>{gst && <p style={{ margin: '2px 0 0', color: '#475569' }}>GSTIN {le.gstin}</p>}</div>
            </div>
            {!modern && <div style={{ textAlign: 'right', flex: 'none' }}><p style={{ margin: 0, fontSize: compact ? 15 : 18, fontWeight: 600, color: t.accent, letterSpacing: '-0.01em' }}>{title}</p><p className="mono" style={{ margin: '2px 0 0', color: '#475569' }}>{no}</p></div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, padding: '10px 0', borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>
            <div><p style={{ margin: 0, color: '#64748b' }}>{isInv ? 'Bill to' : 'Prepared for'}</p><p style={{ margin: '2px 0 0', fontWeight: 600 }}>{cust.name}</p><p style={{ margin: 0, color: '#475569' }}>{gst ? `GSTIN ${cust.gstin} · ` : ''}{cust.city}</p></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '2px 12px', alignContent: 'start' }}><span style={{ color: '#64748b' }}>Date</span><span style={{ textAlign: 'right' }}>{fmtDLong(today)}</span><span style={{ color: '#64748b' }}>{isInv ? 'Due date' : 'Valid until'}</span><span style={{ textAlign: 'right' }}>{fmtD(addDays(today, 30))}</span></div>
          </div>
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 8, padding: compact ? '4px 0' : '6px 0', borderBottom: `1.5px solid ${t.accent}`, fontWeight: 600, color: t.accent }}><span>Description</span>{sac && <span>SAC</span>}<span style={{ textAlign: 'right' }}>Qty</span><span style={{ textAlign: 'right' }}>Rate</span><span style={{ textAlign: 'right' }}>Amount</span></div>
            {SAMPLE.map(l => <div key={l.d} style={{ display: 'grid', gridTemplateColumns: grid, gap: 8, padding: compact ? '4px 0' : '7px 0', borderBottom: '1px solid #e2e8f0' }}><span>{l.d}</span>{sac && <span className="mono" style={{ color: '#64748b' }}>{l.sac}</span>}<span style={{ textAlign: 'right' }}>{l.qty}</span><span style={{ textAlign: 'right' }}>{l.rate}</span><span style={{ textAlign: 'right' }}>{l.amt}</span></div>)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><div className="num" style={{ width: '58%', display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 12px' }}>
            {gst ? <><span>Taxable value</span><span style={{ textAlign: 'right' }}>₹3,20,000</span><span style={{ color: '#64748b' }}>CGST 9%</span><span style={{ textAlign: 'right', color: '#64748b' }}>₹28,800</span><span style={{ color: '#64748b' }}>SGST 9%</span><span style={{ textAlign: 'right', color: '#64748b' }}>₹28,800</span></> : <><span>Subtotal</span><span style={{ textAlign: 'right' }}>₹3,20,000</span></>}
            <span style={gTot}>Total</span><span style={{ ...gTot, textAlign: 'right', color: t.accent }}>{gst ? '₹3,77,600' : '₹3,20,000'}</span>
          </div></div>
          {t.show.words && <p style={{ margin: 0, color: '#475569' }}><span style={{ color: '#64748b' }}>In words: </span>{gst ? 'Rupees three lakh seventy-seven thousand six hundred only' : 'Rupees three lakh twenty thousand only'}</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 'auto' }}>
            {t.show.bank && <div style={{ minWidth: 0, flex: '1 1 150px' }}><p style={{ margin: 0, color: '#64748b' }}>Bank details</p><p style={{ margin: '2px 0 0' }}>{le.bank}</p></div>}
            {t.show.upi && <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}><span style={{ width: 60, height: 60, border: '1px dashed #94a3b8', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>UPI QR</span><span style={{ color: '#64748b' }}>{le.upi}</span></div>}
            {t.show.sign && <div style={{ textAlign: 'right' }}><div style={{ width: 120, height: 26, borderBottom: '1px solid #94a3b8', marginLeft: 'auto' }} /><p style={{ margin: '4px 0 0', color: '#64748b' }}>Authorised signatory</p></div>}
          </div>
          {!!t.terms.trim() && <p style={{ margin: 0, paddingTop: 10, borderTop: '1px solid #e2e8f0', color: '#64748b', whiteSpace: 'pre-wrap' }}>{t.terms}</p>}
        </div>
      </div>
    </div>
  </>;
}

function Numbering({ s }: { s: Settings }) {
  const act = useAct(); const { today } = useApp(); const [se, setSe] = useState<Settings['series'][number] | null>(null);
  const COLS = 'minmax(150px,1.2fr) minmax(200px,1.5fr) 70px 150px 70px';
  const orig = se && s.series.find(x => x.id === se.id);
  const err = !se ? '' : !String(se.pattern).includes('{seq}') ? 'The pattern must include {seq}.' : (+se.next || 0) < orig!.next ? `Forward only. Numbers below ${orig!.next} are already on documents.` : '';
  return <>
    <Card>
      <CardHead title="Numbering" sub="One counter per document type and issuing entity. GST needs a separate invoice series for each GSTIN, and two people issuing at once never get the same number." />
      <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 680 }}>
        <div className="grid-head" style={{ display: 'grid', gridTemplateColumns: COLS }}><span>Documents</span><span>Format</span><span style={{ textAlign: 'right' }}>Issued</span><span>Next</span><span /></div>
        {s.series.map(r => (
          <div key={r.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
            <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontWeight: 500 }}>{r.label}</span><span className="ellipsis" style={{ display: 'block', fontSize: 13, color: '#475569' }}>{r.entity}</span><span style={{ display: 'block', fontSize: 13, color: '#94a3b8' }}>Resets: {r.reset}</span></span>
            <span className="mono" style={{ fontSize: 13, color: '#64748b' }}>{r.pattern}</span>
            <span className="num" style={{ textAlign: 'right', color: '#64748b' }}>{r.next - 1}</span>
            <span className="mono" style={{ fontSize: 14, fontWeight: 500 }}>{r.sample}</span>
            <span style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-sec" onClick={() => setSe({ ...r })} style={{ height: 32, padding: '0 12px', fontSize: 13, boxShadow: 'none' }}>Edit</button></span>
          </div>
        ))}
      </div></div>
      <p style={{ margin: 0, padding: '14px 20px', fontSize: 14, color: '#64748b' }}>Numbers come from a locked counter, so documents never collide; the counter only moves forward.</p>
    </Card>
    {se && (
      <div style={{ background: '#fff', border: '1px solid #0052ff', borderRadius: 12, boxShadow: '0 0 0 3px rgba(0,82,255,.1)' }}>
        <CardHead title={`${se.label} numbering`} sub={se.entity} />
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ padding: '12px 16px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}><p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Next document</p><p className="mono" style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>{formatNumber(se, today, s.org.fy)}</p></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14 }}>
            <label className="label">Prefix<input className="input mono" value={se.prefix} onChange={e => setSe({ ...se, prefix: e.target.value.toUpperCase() })} style={{ height: 40 }} /></label>
            <label className="label">Pattern<input className="input mono" value={se.pattern} onChange={e => setSe({ ...se, pattern: e.target.value })} style={{ height: 40 }} /></label>
            <label className="label">Digits<input className="input" inputMode="numeric" value={String(se.padding)} onChange={e => setSe({ ...se, padding: +e.target.value || 0 })} style={{ height: 40 }} /></label>
            <label className="label">Next number<input className="input" inputMode="numeric" value={String(se.next)} onChange={e => setSe({ ...se, next: +e.target.value || 0 })} style={{ height: 40 }} /></label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '4px 16px', fontSize: 13 }}>{SERIES_TOKENS.map(([tk, m]) => <span key={tk}><span className="mono" style={{ color: '#334155' }}>{tk}</span> <span style={{ color: '#64748b' }}>{m}</span></span>)}</div>
          {err && <p style={{ margin: 0, fontSize: 14, color: '#be123c' }}>{err}</p>}
        </div>
        <Foot><Btn onClick={() => setSe(null)} style={{ boxShadow: 'none' }}>Cancel</Btn><Btn kind="pri" disabled={!!err} onClick={async () => { const r = await act(`settings/series/${se.id}`, se, { method: 'PATCH' }); if (r) setSe(null); }}>Save</Btn></Foot>
      </div>
    )}
  </>;
}

function Tax({ s }: { s: Settings }) {
  const act = useAct();
  return <>
    <Card>
      <CardHead title="GST registrations" sub={<span style={{ display: 'block', maxWidth: '70ch' }}>Customer in the same state as the issuing entity: CGST + SGST. Different state: IGST. Worked out per document from the two GSTINs.</span>} />
      {s.entities.map(e => <div key={e.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 20px', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}><span style={{ flex: '1 1 220px', fontWeight: 500 }}>{e.name}</span><span className="mono" style={{ fontSize: 13 }}>{e.gst ? e.gstin : 'Not registered'}</span><span style={{ width: 130, color: '#64748b' }}>{e.state}</span></div>)}
    </Card>
    <Card>
      <CardHead title="Service codes (SAC)" sub="The GST rate each code charges. Changing one affects new lines only." />
      {s.sac.map(x => (
        <div key={x.code} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 20px', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
          <span className="mono" style={{ width: 70, fontSize: 13, fontWeight: 500 }}>{x.code}</span>
          <span style={{ flex: '1 1 220px' }}><span style={{ display: 'block' }}>{x.desc}</span><span style={{ display: 'block', fontSize: 13, color: '#94a3b8' }}>On {x.used} catalogue item{x.used === 1 ? '' : 's'}</span></span>
          <select value={String(x.rate)} onChange={e => act('settings/tax', { sac: x.code, rate: +e.target.value }, { method: 'PATCH' })} style={{ height: 36, width: 96, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 8px', fontSize: 14, background: '#fff' }}>{[0, 5, 12, 18, 28].map(r => <option key={r} value={String(r)}>{r}%</option>)}</select>
        </div>
      ))}
    </Card>
    <Card>
      <CardHead title="Rules" />
      {([['round', 'Round totals to the nearest rupee', 'The difference prints as a rounding line.'], ['einv', 'E-invoicing (IRN)', 'Fetch an IRN and signed QR from the GST portal when an invoice is issued. Required above ₹5 crore turnover.'], ['lut', 'Export of services under LUT', 'Zero-rate invoices to customers outside India.']] as const)
        .map(([k, l, d]) => <ToggleRow key={k} label={l} desc={d} on={!!s.taxOpts[k]} onClick={() => act('settings/tax', { [k]: !s.taxOpts[k], label: l, on: !s.taxOpts[k] }, { method: 'PATCH', quiet: true })} />)}
    </Card>
  </>;
}

function Policy({ s }: { s: Settings }) {
  const act = useAct(); const [p, setP] = useState(s.policy);
  useEffect(() => setP(s.policy), [s.policy]);
  return <>
    <Card>
      <CardHead title="Thresholds" sub="Above these, a document waits for a second person before it can go out." />
      {([['discount', 'Quotation discount limit', 'Any line discounted above this goes to the Owner.', '%'], ['quoteMax', 'Large quotation', 'Quotations above this total go to the Owner, whatever the discount.', '₹'], ['assetMax', 'Asset requests', 'Requests above this value need a second approver.', '₹']] as const).map(([k, l, d, u]) => (
        <div key={k} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 20px', padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}><p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{l}</p><p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>{d}</p></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 40, width: 160, padding: '0 12px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }}>
            {u === '₹' && <span style={{ color: '#64748b', fontSize: 14 }}>₹</span>}
            <input value={String(p[k])} onChange={e => setP({ ...p, [k]: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" className="num" style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: 14, textAlign: 'right' }} />
            {u === '%' && <span style={{ color: '#64748b', fontSize: 14 }}>%</span>}
          </div>
        </div>
      ))}
    </Card>
    <Card>
      <CardHead title="Rules" />
      {([['invAll', 'Finance approves every invoice before it is issued', 'Turn off to let the author issue directly.'], ['noSelf', 'Nobody approves a document they raised', 'Roles holding “Approve own” are the exception.'], ['msDates', 'Moving a milestone date needs approval', 'The billing date moves with it.']] as const)
        .map(([k, l, d]) => <ToggleRow key={k} label={l} desc={d} on={!!p[k]} onClick={() => setP({ ...p, [k]: !p[k] })} />)}
      <Foot top={false}><Btn kind="pri" onClick={() => act('settings/policy', { ...p, save: true }, { method: 'PATCH' })}>Save rules</Btn></Foot>
    </Card>
  </>;
}

function Reminders({ s }: { s: Settings }) {
  const act = useAct(); const r = s.reminders; const [m, setM] = useState({ subject: r.subject, body: r.body });
  useEffect(() => setM({ subject: r.subject, body: r.body }), [r.subject, r.body]);
  const patch = (b: object) => act('settings/reminders', b, { method: 'PATCH', quiet: true });
  return <>
    <Card>
      <CardHead title="Payment reminders" sub="Sent automatically from 9 am to the customer's billing email, with the invoice attached. Each step goes once per invoice; switched-off steps are skipped." />
      {r.steps.map((x: any, i: number) => <ToggleRow key={i} label={x.label} desc={x.desc} on={x.on} onClick={() => patch({ steps: r.steps.map((y: any, j: number) => (j === i ? { ...y, on: !y.on } : y)) })} />)}
      <ToggleRow label="Pause reminders when a part payment arrives" desc="They resume if the rest is still unpaid 7 days later." on={r.stopPartial} onClick={() => patch({ stopPartial: !r.stopPartial })} style={{ background: '#f8fafc', borderBottom: 0, borderRadius: '0 0 12px 12px' }} />
    </Card>
    <Card>
      <CardHead title="Message" />
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="label">Subject<input className="input" value={m.subject} onChange={e => setM({ ...m, subject: e.target.value })} /></label>
        <label className="label">Body<textarea className="textarea" rows={7} value={m.body} onChange={e => setM({ ...m, body: e.target.value })} /><span className="hint">Tokens: {'{contact}'}, {'{customer}'}, {'{number}'}, {'{amount}'}, {'{due}'}</span></label>
      </div>
      <Foot><Btn onClick={() => act('settings/reminders/test')} style={{ boxShadow: 'none' }}>Send me a test</Btn><Btn kind="pri" onClick={() => act('settings/reminders', { ...m, save: true }, { method: 'PATCH' })}>Save</Btn></Foot>
    </Card>
  </>;
}

function Audit() {
  const { has } = useApp();
  const rows = useQ<{ id: string; icon: string; text: string; who: string; when: string; area: string }[]>(has('audit.read') ? 'settings/audit' : null).data || [];
  const [tab, setTab] = useState('all');
  const AF: Record<string, (a: { area: string }) => boolean> = { all: () => true, documents: a => ['invoice', 'quote', 'payment', 'project'].includes(a.area), access: a => a.area === 'access', settings: a => a.area === 'settings' };
  if (!has('audit.read')) return <p style={{ color: '#64748b' }}>Your role can't read the audit log.</p>;
  return <>
    <div style={{ display: 'flex', gap: 4, padding: 4, background: '#f1f5f9', borderRadius: 10, alignSelf: 'flex-start', maxWidth: '100%', overflowX: 'auto' }}>
      {[['all', 'All'], ['documents', 'Documents'], ['access', 'Access'], ['settings', 'Settings']].map(([id, l]) => <button key={id} onClick={() => setTab(id)} style={tabStyle(tab === id)}>{l} <span style={{ color: '#94a3b8', fontWeight: 500 }}>{rows.filter(AF[id]).length}</span></button>)}
    </div>
    <Card>
      {rows.filter(AF[tab]).map(a => (
        <div key={a.id} style={{ display: 'flex', gap: 12, padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
          <Icon name={a.icon} size={16} style={{ color: '#64748b', marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontSize: 14 }}>{a.text}</p><p style={{ margin: '2px 0 0', fontSize: 13, color: '#94a3b8' }}>{a.who} · {a.when}</p></div>
        </div>
      ))}
    </Card>
    <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>The audit log can't be edited or deleted, including by the Owner.</p>
  </>;
}

function Email() {
  const act = useAct();
  const q = useQ<{ configured: boolean; from: string; rows: { id: string; to: string; subject: string; kind: string; ref: string | null; status: string; error: string | null; when: string }[] }>('settings/email');
  const d = q.data; const [kind, setKind] = useState('all');
  if (!d) return <p style={{ color: '#64748b' }}>Loading…</p>;
  const KINDS: [string, string][] = [['all', 'All'], ['invoice', 'Invoices'], ['quote', 'Quotations'], ['reminder', 'Reminders'], ['meeting', 'Meetings'], ['invite', 'Invites']];
  const rows = d.rows.filter(r => kind === 'all' || r.kind === kind || (kind === 'invite' && ['invite', 'welcome'].includes(r.kind)));
  return <>
    <Card>
      <CardHead title="Outgoing email" sub="Quotations, invoices, credit notes, payment reminders, meeting invites and user invitations." right={<Btn size="sm" icon="send" onClick={() => act('settings/reminders/test')} style={{ boxShadow: 'none' }}>Send me a test</Btn>} />
      <div style={{ padding: '16px 20px', display: 'flex', flexWrap: 'wrap', gap: '12px 28px', alignItems: 'center' }}>
        <div><p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Status</p><p style={{ margin: '4px 0 0' }}>{d.configured ? <Badge tone="success" dot>Sending</Badge> : <Badge tone="warning" dot>Not set up</Badge>}</p></div>
        {d.from && <div><p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Sent from</p><p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 500 }}>{d.from}</p></div>}
        {!d.configured && <p style={{ margin: 0, flex: '1 1 300px', fontSize: 14, color: '#475569' }}>Set <span className="mono">SMTP_URL</span> (and optionally <span className="mono">EMAIL_FROM</span>) on the API server, e.g. <span className="mono">smtps://user:password@smtp.example.com:465</span>. Until then emails are logged here but not sent.</p>}
      </div>
    </Card>
    <div style={{ display: 'flex', gap: 4, padding: 4, background: '#f1f5f9', borderRadius: 10, alignSelf: 'flex-start', maxWidth: '100%', overflowX: 'auto' }}>
      {KINDS.map(([id, l]) => <button key={id} onClick={() => setKind(id)} style={tabStyle(kind === id)}>{l}</button>)}
    </div>
    <Card>
      {rows.map(r => (
        <div key={r.id} style={{ display: 'flex', gap: 12, padding: '12px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'flex-start' }}>
          <Icon name={r.status === 'sent' ? 'icon-mail-check' : 'icon-mail-x'} size={16} style={{ color: r.status === 'sent' ? '#047857' : '#be123c', marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{r.subject}</p>
            <p className="ellipsis" style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>To {r.to} · {r.when}</p>
            {r.error && <p style={{ margin: '2px 0 0', fontSize: 13, color: '#be123c' }}>{r.error}</p>}
          </div>
          <Badge tone={r.status === 'sent' ? 'success' : 'danger'}>{r.status === 'sent' ? 'Sent' : 'Not sent'}</Badge>
        </div>
      ))}
      {!rows.length && <p style={{ margin: 0, padding: '28px 20px', fontSize: 14, color: '#64748b' }}>Nothing sent yet.</p>}
    </Card>
  </>;
}
