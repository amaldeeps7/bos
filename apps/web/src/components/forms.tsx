'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { STAGES, addDays, inr } from '@bos/shared';
import { api, ApiError } from '@/lib/api';
import { useApp, useQ } from '@/lib/app';
import type { Asset, Customer, Milestone, Opportunity, Payment, Project, Settings } from '@/lib/types';
import { Btn, Dialog, Icon } from './ui';

const grid = { padding: '18px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 } as const;
const full = { gridColumn: '1/-1' } as const;
const Err = ({ msg }: { msg: string }) => (msg ? <p style={{ gridColumn: '1/-1', margin: 0, fontSize: 14, color: '#be123c' }}>{msg}</p> : null);

/** Saves through the API, refreshes data, toasts the server's message, and keeps errors in the dialog. */
function useSave() {
  const qc = useQueryClient(); const { toast } = useApp(); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async <T = any,>(path: string, method: string, body?: unknown): Promise<T | null> => {
    setErr(''); setBusy(true);
    try { const r = await api<T>(path, { method, body }); await qc.invalidateQueries(); const m = (r as any)?.message; if (m) toast(m); setBusy(false); return r; }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Something went wrong.'); setBusy(false); return null; }
  };
  return { save, err, setErr, busy };
}
const footer = (onClose: () => void, label: string, onSave: () => void, busy: boolean, extra?: React.ReactNode) =>
  <>{extra}<Btn onClick={onClose} style={{ boxShadow: 'none' }}>Cancel</Btn><Btn kind="pri" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : label}</Btn></>;

export function ProjectDialog({ project, onClose }: { project?: Project; onClose: () => void }) {
  const { today, people, has, me } = useApp(); const router = useRouter(); const { save, err, setErr, busy } = useSave();
  const customers = useQ<Customer[]>('customers').data || [];
  const units = useQ<Settings>(has('settings.manage') || has('role.manage') ? 'settings' : null).data?.units.map(u => u.name) || ['Software', 'Cybersecurity'];
  const [f, setF] = useState({ name: project?.name || '', customerId: project?.customerId || '', bu: project?.bu || 'Software', contract: String(project?.contract ?? ''), endDate: project?.endDate || addDays(today, 90),
    health: project?.health || 'On track', status: project?.status || 'ACTIVE', ownerId: project?.ownerId || me.user.id });
  const [ms, setMs] = useState([{ name: '', pct: '' , due: addDays(today, 30) }]);
  useEffect(() => { if (!f.customerId && customers[0]) setF(x => ({ ...x, customerId: customers[0].id })); }, [customers, f.customerId]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  const total = ms.reduce((a, m) => a + (+m.pct || 0), 0);
  const submit = async () => {
    if (project) { const r = await save(`projects/${project.id}`, 'PATCH', { ...f, contract: +f.contract || 0, ownerId: f.ownerId !== project.ownerId ? f.ownerId : undefined }); if (r) onClose(); return; }
    const r = await save<{ id: string }>('projects', 'POST', { ...f, contract: +f.contract || 0, milestones: ms.filter(m => m.name.trim()).map(m => ({ ...m, pct: +m.pct || 0 })) });
    if (r) { onClose(); router.push(`/projects/${r.id}`); }
  };
  return (
    <Dialog width={600} title={project ? `Edit ${project.name}` : 'New project'} sub={project ? `${project.code} · changes are written to the audit log.` : 'Usually a project comes from an accepted quotation. Start one here for work agreed another way.'} onClose={onClose} footer={footer(onClose, project ? 'Save changes' : 'Create project', submit, busy)}>
      <div style={grid}>
        <label className="label" style={full}>Project name<input className="input" autoFocus value={f.name} onChange={set('name')} placeholder="e.g. Fleet Portal phase 2" /></label>
        <label className="label">Customer<select className="select" value={f.customerId} onChange={set('customerId')} disabled={!!project}>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="label">Business unit<select className="select" value={f.bu} onChange={set('bu')}>{[...new Set([...units, f.bu])].map(u => <option key={u}>{u}</option>)}</select></label>
        <label className="label">Contract value (₹, before GST)<input className="input num" inputMode="numeric" value={f.contract} onChange={e => setF({ ...f, contract: e.target.value.replace(/[^\d]/g, '') })} /><span className="hint">{+f.contract ? inr(+f.contract) : ' '}</span></label>
        <label className="label">Ends<input className="input" type="date" value={f.endDate} onChange={set('endDate')} /></label>
        {project && <>
          <label className="label">Health<select className="select" value={f.health} onChange={set('health')}>{['On track', 'At risk', 'On hold'].map(h => <option key={h}>{h}</option>)}</select></label>
          <label className="label">Status<select className="select" value={f.status} onChange={set('status')}>{[['ACTIVE', 'Active'], ['ON_HOLD', 'On hold'], ['COMPLETED', 'Completed'], ['CANCELLED', 'Cancelled']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </>}
        <label className="label">Project owner<select className="select" value={f.ownerId} onChange={set('ownerId')} disabled={!!project && !has('project.change_owner')}>{[...people.values()].filter(p => p.status === 'Active').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {!project && (
          <div style={{ ...full, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>Milestones <span style={{ fontWeight: 400, fontSize: 13, color: total === 100 || !ms.some(m => m.name) ? '#64748b' : '#b45309' }}>{ms.some(m => m.name) ? `${total}% of the contract allocated` : 'Optional — you can add them later'}</span></span>
            {ms.map((m, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 80px 150px 32px', gap: 8 }}>
                <input className="input" value={m.name} onChange={e => setMs(ms.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder={`Milestone ${i + 1}`} style={{ height: 38 }} />
                <input className="input num" inputMode="numeric" value={m.pct} onChange={e => setMs(ms.map((x, j) => (j === i ? { ...x, pct: e.target.value.replace(/[^\d.]/g, '') } : x)))} placeholder="%" style={{ height: 38, textAlign: 'right' }} />
                <input className="input" type="date" value={m.due} onChange={e => setMs(ms.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)))} style={{ height: 38 }} />
                <button className="trash" aria-label="Remove milestone" onClick={() => setMs(ms.length > 1 ? ms.filter((_, j) => j !== i) : [{ name: '', pct: '', due: m.due }])}><Icon name="trash-2" size={15} /></button>
              </div>
            ))}
            <button className="link" onClick={() => setMs([...ms, { name: '', pct: '', due: addDays(ms[ms.length - 1].due, 30) }])} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="plus" size={14} />Add milestone</button>
          </div>
        )}
        <Err msg={err} />
      </div>
    </Dialog>
  );
}

export function MilestoneDialog({ project, milestone, onClose }: { project: Project; milestone?: Milestone; onClose: () => void }) {
  const { today, me } = useApp(); const { save, err, busy } = useSave();
  const [f, setF] = useState({ name: milestone?.name || '', value: String(milestone?.value ?? ''), due: milestone?.due || addDays(today, 30), reason: '' });
  const locked = !!milestone && ['INVOICED', 'PAID'].includes(milestone.status);
  const needsApproval = !!milestone && f.due !== milestone.due && project.ownerId !== me.user.id;
  const submit = async () => { const r = milestone ? await save(`projects/${project.id}/milestones/${milestone.id}`, 'PATCH', { name: f.name, due: f.due, reason: f.reason || undefined, ...(locked ? {} : { value: +f.value || 0 }) }) : await save(`projects/${project.id}/milestones`, 'POST', { ...f, value: +f.value || 0 }); if (r) onClose(); };
  const remove = async () => { if (milestone && confirm(`Remove ${milestone.name}?`)) { const r = await save(`projects/${project.id}/milestones/${milestone.id}`, 'DELETE'); if (r) onClose(); } };
  return (
    <Dialog title={milestone ? `Edit ${milestone.name}` : 'Add milestone'} sub={locked ? 'This milestone is invoiced, so its value is locked.' : `Contract value ${inr(project.contract)}.`} onClose={onClose}
      footer={footer(onClose, milestone ? 'Save' : 'Add milestone', submit, busy, milestone && ['PENDING', 'IN_PROGRESS'].includes(milestone.status) ? <Btn kind="danger" icon="trash-2" onClick={remove} style={{ marginRight: 'auto' }}>Remove</Btn> : undefined)}>
      <div style={grid}>
        <label className="label" style={full}>Name<input className="input" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="label">Value (₹)<input className="input num" inputMode="numeric" disabled={locked} value={f.value} onChange={e => setF({ ...f, value: e.target.value.replace(/[^\d]/g, '') })} /><span className="hint">{project.contract ? `${Math.round((+f.value || 0) / project.contract * 1000) / 10}% of the contract` : ' '}</span></label>
        <label className="label">Due<input className="input" type="date" value={f.due} onChange={e => setF({ ...f, due: e.target.value })} /></label>
        {needsApproval && <label className="label" style={full}>Why the date moves<input className="input" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} placeholder="The project owner approves date changes" /></label>}
        <Err msg={err} />
      </div>
    </Dialog>
  );
}

export function DealDialog({ deal, onClose }: { deal?: Opportunity; onClose: () => void }) {
  const { people, me } = useApp(); const { save, err, busy } = useSave();
  const customers = useQ<Customer[]>('customers').data || [];
  const [f, setF] = useState({ name: deal?.name || '', customerId: deal?.customerId || '', value: String(deal?.value ?? ''), stage: String(deal?.stage ?? 0), next: deal?.next || '', ownerId: deal?.ownerId || me.user.id });
  useEffect(() => { if (!f.customerId && customers[0]) setF(x => ({ ...x, customerId: customers[0].id })); }, [customers, f.customerId]);
  const submit = async () => { const body = { ...f, value: +f.value || 0, stage: +f.stage }; const r = deal ? await save(`opportunities/${deal.id}`, 'PATCH', body) : await save('opportunities', 'POST', body); if (r) onClose(); };
  const remove = async () => { if (deal && confirm(`Remove ${deal.name} from the pipeline?`)) { const r = await save(`opportunities/${deal.id}`, 'DELETE'); if (r) onClose(); } };
  return (
    <Dialog title={deal ? `Edit ${deal.name}` : 'New deal'} sub="Leads and opportunities, from first contact to signed work." onClose={onClose}
      footer={footer(onClose, deal ? 'Save' : 'Add to pipeline', submit, busy, deal ? <Btn kind="danger" icon="trash-2" onClick={remove} style={{ marginRight: 'auto' }}>Remove</Btn> : undefined)}>
      <div style={grid}>
        <label className="label" style={full}>Deal<input className="input" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. Pen test retainer 2027" /></label>
        <label className="label">Customer<select className="select" value={f.customerId} onChange={e => setF({ ...f, customerId: e.target.value })}>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="label">Value (₹)<input className="input num" inputMode="numeric" value={f.value} onChange={e => setF({ ...f, value: e.target.value.replace(/[^\d]/g, '') })} /></label>
        <label className="label">Stage<select className="select" value={f.stage} onChange={e => setF({ ...f, stage: e.target.value })}>{STAGES.map((s, i) => <option key={s} value={String(i)}>{s}</option>)}</select></label>
        <label className="label">Owner<select className="select" value={f.ownerId} onChange={e => setF({ ...f, ownerId: e.target.value })}>{[...people.values()].filter(p => p.status === 'Active').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="label" style={full}>Next step<input className="input" value={f.next} onChange={e => setF({ ...f, next: e.target.value })} placeholder="e.g. Intro call booked for Monday" /></label>
        <p style={{ ...full, margin: 0, fontSize: 13, color: '#64748b' }}>New customer? Add them first under Customers — their GSTIN decides how they're taxed.</p>
        <Err msg={err} />
      </div>
    </Dialog>
  );
}

export function AssetDialog({ asset, onClose }: { asset?: Asset; onClose: () => void }) {
  const { people } = useApp(); const { save, err, busy } = useSave();
  const projects = useQ<Project[]>('projects').data || [];
  const [f, setF] = useState({ name: asset?.name || '', code: asset?.code || '', cat: asset?.cat || 'Laptop', value: String(asset?.value ?? ''), status: asset?.status || 'AVAILABLE', holderId: asset?.holderId || '', projectId: asset?.projectId || '' });
  const submit = async () => {
    const body = asset ? { name: f.name, cat: f.cat, value: +f.value || 0, status: f.status, ...(f.status === 'IN_USE' ? { holderId: f.holderId || null, projectId: f.projectId || null } : {}) } : { name: f.name, code: f.code, cat: f.cat, value: +f.value || 0 };
    const r = asset ? await save(`assets/${asset.id}`, 'PATCH', body) : await save('assets', 'POST', body); if (r) onClose();
  };
  return (
    <Dialog title={asset ? `Edit ${asset.name}` : 'Add asset'} sub={asset ? asset.code : 'Gets the next asset tag unless you set one.'} onClose={onClose} footer={footer(onClose, asset ? 'Save' : 'Add asset', submit, busy)}>
      <div style={grid}>
        <label className="label" style={full}>Name<input className="input" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. MacBook Pro 14″ M4" /></label>
        {!asset && <label className="label">Asset tag<input className="input mono" value={f.code} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="Automatic" /></label>}
        <label className="label">Category<input className="input" list="asset-cats" value={f.cat} onChange={e => setF({ ...f, cat: e.target.value })} /><datalist id="asset-cats">{['Laptop', 'Test device', 'Security kit', 'Peripheral', 'Furniture', 'Software licence'].map(c => <option key={c} value={c} />)}</datalist></label>
        <label className="label">Value (₹)<input className="input num" inputMode="numeric" value={f.value} onChange={e => setF({ ...f, value: e.target.value.replace(/[^\d]/g, '') })} /></label>
        {asset && <label className="label">Status<select className="select" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>{[['AVAILABLE', 'Available'], ['IN_USE', 'In use'], ['IN_REPAIR', 'In repair']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
        {asset && f.status === 'IN_USE' && <>
          <label className="label">With<select className="select" value={f.holderId} onChange={e => setF({ ...f, holderId: e.target.value })}><option value="">Nobody (project pool)</option>{[...people.values()].filter(p => p.status === 'Active').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="label">Project<select className="select" value={f.projectId} onChange={e => setF({ ...f, projectId: e.target.value })}><option value="">None</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        </>}
        <Err msg={err} />
      </div>
    </Dialog>
  );
}

export function PaymentDialogEdit({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const { save, err, busy } = useSave();
  const [f, setF] = useState({ method: payment.method, ref: payment.ref, date: payment.date });
  const submit = async () => { const r = await save(`payments/${payment.id}`, 'PATCH', f); if (r) onClose(); };
  return (
    <Dialog width={460} title={`Edit ${payment.no}`} sub={`${inr(payment.amount)} · the amount and allocation stay as recorded.`} onClose={onClose} footer={footer(onClose, 'Save', submit, busy)}>
      <div style={grid}>
        <label className="label">Method<select className="select" value={f.method} onChange={e => setF({ ...f, method: e.target.value })}>{['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque'].map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="label">Received on<input className="input" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
        <label className="label" style={full}>Bank reference / UTR<input className="input mono" value={f.ref} onChange={e => setF({ ...f, ref: e.target.value })} /></label>
        <Err msg={err} />
      </div>
    </Dialog>
  );
}

/** Add a person with a password you set, or edit someone's details (name, job title, role, password reset). */
export function UserDialog({ settings, user, onClose }: { settings: Settings; user?: Settings['users'][number]; onClose: () => void }) {
  const { me } = useApp(); const { save, err, busy } = useSave();
  const min = Number(settings.security.pwd) || 12; const domain = String(settings.security.domains || '').split(',')[0].trim();
  const [f, setF] = useState({ name: user?.name || '', email: user?.email || '', title: user?.title || '', role: user?.role || 'Field staff', password: '', welcome: true });
  const [show, setShow] = useState(false);
  const gen = () => { const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const a = new Uint32Array(min + 2); crypto.getRandomValues(a); setF({ ...f, password: [...a].map(n => c[n % c.length]).join('') }); setShow(true); };
  const submit = async () => {
    const r = user ? await save(`settings/users/${user.id}`, 'PATCH', { name: f.name, title: f.title, ...(user.id !== me.user.id ? { role: f.role } : {}), ...(f.password ? { password: f.password } : {}) })
      : await save('settings/users', 'POST', f);
    if (r) onClose();
  };
  return (
    <Dialog width={540} title={user ? `Edit ${user.name}` : 'Add person'} sub={user ? user.email : 'They can sign in straight away with the password you set. To let them choose their own, use Invite instead.'} onClose={onClose} footer={footer(onClose, user ? 'Save' : 'Add person', submit, busy)}>
      <div style={grid}>
        <label className="label">Full name<input className="input" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="label">Job title<input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="e.g. Engineer" /></label>
        {!user && <label className="label" style={full}>Work email<input className="input" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder={domain ? `name@${domain}` : 'name@company.com'} /></label>}
        <label className="label">Role<select className="select" value={f.role} disabled={user?.id === me.user.id} onChange={e => setF({ ...f, role: e.target.value })}>{settings.roles.map(r => <option key={r.id}>{r.name}</option>)}</select></label>
        <label className="label">{user ? 'Reset password' : 'Password'}
          <span style={{ display: 'flex', gap: 6 }}>
            <input className="input mono" type={show ? 'text' : 'password'} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} placeholder={user ? 'Leave blank to keep' : `${min}+ characters`} autoComplete="new-password" style={{ flex: 1 }} />
            <button type="button" className="btn btn-sec" onClick={gen} title="Generate a strong password" style={{ height: 42, padding: '0 10px', boxShadow: 'none' }}><Icon name="wand-sparkles" size={15} /></button>
          </span>
          {show && f.password && <span className="hint">Share this with them securely. It won't be shown again.</span>}
        </label>
        {!user && <label style={{ ...full, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}><input type="checkbox" checked={f.welcome} onChange={e => setF({ ...f, welcome: e.target.checked })} />Email them a welcome note with the sign-in link (the password isn't included)</label>}
        <Err msg={err} />
      </div>
    </Dialog>
  );
}
