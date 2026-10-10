'use client';
import { useState } from 'react';
import { relTime } from '@bos/shared';
import { api, ApiError } from '@/lib/api';
import { useApp, useQ } from '@/lib/app';
import { Badge, Btn, Card, CardHead, Icon } from './ui';
import { flashNext } from './orgs';

const err = (x: unknown, f: string) => (x instanceof ApiError ? x.message : f);

/** Profile → Password: change it with the current one; other devices are signed out. */
export function PasswordCard() {
  const { toast } = useApp();
  const [open, setOpen] = useState(false); const [f, setF] = useState({ current: '', password: '', confirm: '' }); const [e, setE] = useState(''); const [busy, setBusy] = useState(false);
  const close = () => { setOpen(false); setF({ current: '', password: '', confirm: '' }); setE(''); setBusy(false); };
  const save = async () => {
    if (f.password !== f.confirm) return setE('The new passwords don’t match.');
    setBusy(true); setE('');
    try { const r = await api<{ message: string }>('auth/password', { body: { current: f.current, password: f.password } }); toast(r.message); close(); }
    catch (x) { setE(err(x, 'Could not change the password.')); setBusy(false); }
  };
  return (
    <Card>
      <CardHead title="Password" sub="Changing it signs out every other device." right={!open && <Btn size="sm" onClick={() => setOpen(true)}>Change password</Btn>} />
      {open && (
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
          <label className="label">Current password<input className="input" type="password" autoComplete="current-password" autoFocus value={f.current} onChange={x => setF({ ...f, current: x.target.value })} /></label>
          <label className="label">New password<input className="input" type="password" autoComplete="new-password" value={f.password} onChange={x => setF({ ...f, password: x.target.value })} /><span className="hint">At least 12 characters (your organisation may ask for more).</span></label>
          <label className="label">Confirm new password<input className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={x => setF({ ...f, confirm: x.target.value })} /></label>
          {e && <p role="alert" style={{ margin: 0, fontSize: 14, color: '#be123c' }}>{e}</p>}
          <div style={{ display: 'flex', gap: 8 }}><Btn onClick={close}>Cancel</Btn><Btn kind="pri" onClick={save} disabled={busy || !f.current || !f.password}>{busy ? 'Saving…' : 'Change password'}</Btn></div>
        </div>
      )}
    </Card>
  );
}

type Session = { id: string; device: string; ip: string; at: string; seen: string; current: boolean };

/** Profile → Where you're signed in: sign out one device, or everywhere else. */
export function SessionsCard() {
  const { toast } = useApp();
  const q = useQ<Session[]>('auth/sessions'); const rows = q.data || [];
  const run = async (path: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    try { const r = await api<{ message: string }>(path, { body: {} }); toast(r.message); q.refetch(); }
    catch (x) { toast(err(x, 'Something went wrong.')); }
  };
  return (
    <Card>
      <CardHead title="Where you’re signed in" sub="Sign out a device you don’t recognise, or one you’ve left signed in."
        right={rows.length > 1 && <Btn size="sm" onClick={() => run('auth/sessions/revoke-others', 'Sign out every other device? This one stays signed in.')}>Sign out everywhere else</Btn>} />
      {rows.map(s => (
        <div key={s.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
          <span style={{ width: 36, height: 36, flex: 'none', borderRadius: 9, background: '#f1f5f9', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={/iOS|Android/.test(s.device) ? 'smartphone' : 'monitor'} size={17} /></span>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{s.device || 'Browser'} {s.current && <Badge tone="success">This device</Badge>}</p>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>{s.ip ? `${s.ip} · ` : ''}active {relTime(s.seen)} · signed in {relTime(s.at)}</p>
          </div>
          {!s.current && <Btn size="sm" onClick={() => run(`auth/sessions/${s.id}/revoke`)}>Sign out</Btn>}
        </div>
      ))}
      {!rows.length && <p style={{ margin: 0, padding: '14px 20px', fontSize: 14, color: '#64748b' }}>Only this device.</p>}
    </Card>
  );
}

/** Profile → Email: confirm your address, or change it (the new one confirms by link). */
export function EmailCard({ email, verified }: { email: string; verified: boolean }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false); const [f, setF] = useState({ email: '', password: '' }); const [e, setE] = useState('');
  const send = async () => { try { toast((await api<{ message: string }>('auth/verify-email/send', { body: {} })).message); } catch (x) { toast(err(x, 'Could not send the link.')); } };
  const change = async () => {
    setE('');
    try { toast((await api<{ message: string }>('me/email', { body: f })).message); setOpen(false); setF({ email: '', password: '' }); }
    catch (x) { setE(err(x, 'Could not start the change.')); }
  };
  return (
    <Card>
      <CardHead title="Email" sub={<span>{email} · {verified ? <span style={{ color: '#047857' }}>confirmed</span> : <span style={{ color: '#b45309' }}>not confirmed yet</span>}</span>}
        right={!open && <div style={{ display: 'flex', gap: 8 }}>{!verified && <Btn size="sm" onClick={send}>Send confirmation link</Btn>}<Btn size="sm" onClick={() => setOpen(true)}>Change email</Btn></div>} />
      {open && (
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
          <label className="label">New email<input className="input" type="email" autoFocus value={f.email} onChange={x => setF({ ...f, email: x.target.value })} /></label>
          <label className="label">Your password<input className="input" type="password" autoComplete="current-password" value={f.password} onChange={x => setF({ ...f, password: x.target.value })} /><span className="hint">We’ll email the new address a link. The change happens when it’s opened; until then you keep signing in as {email}.</span></label>
          {e && <p role="alert" style={{ margin: 0, fontSize: 14, color: '#be123c' }}>{e}</p>}
          <div style={{ display: 'flex', gap: 8 }}><Btn onClick={() => { setOpen(false); setE(''); }}>Cancel</Btn><Btn kind="pri" onClick={change} disabled={!f.email || !f.password}>Send link</Btn></div>
        </div>
      )}
    </Card>
  );
}

/** Profile → Leave or delete: leaving this organisation, or deleting the account everywhere. */
export function DangerCard({ isOwner, orgName, email }: { isOwner: boolean; orgName: string; email: string }) {
  const [mode, setMode] = useState<null | 'leave' | 'delete'>(null); const [f, setF] = useState({ password: '', confirm: '' }); const [e, setE] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setE('');
    try {
      const r = await api<{ message: string; next?: string | null }>(mode === 'leave' ? 'me/leave' : 'me/delete', { body: f });
      flashNext(r.message);
      location.href = mode === 'leave' && r.next ? '/' : '/login';
    } catch (x) { setE(err(x, 'Something went wrong.')); setBusy(false); }
  };
  return (
    <Card>
      <CardHead title="Leave or delete" sub={isOwner ? `You own ${orgName}: hand ownership to someone else first (Settings → Organisation) before leaving.` : 'Your records stay with the organisation, under your name.'}
        right={!mode && <div style={{ display: 'flex', gap: 8 }}>{!isOwner && <Btn size="sm" onClick={() => setMode('leave')}>Leave {orgName}</Btn>}<Btn size="sm" kind="danger" onClick={() => setMode('delete')}>Delete account</Btn></div>} />
      {mode && (
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 440 }}>
          <p style={{ margin: 0, fontSize: 14, color: '#334155' }}>{mode === 'leave' ? `You’ll lose access to ${orgName}. Approvals waiting on you move to someone else. An admin can add you back later.` : 'You’ll leave every organisation and can no longer sign in. Your photo is removed. This can’t be undone.'}</p>
          <label className="label">Your password<input className="input" type="password" autoComplete="current-password" autoFocus value={f.password} onChange={x => setF({ ...f, password: x.target.value })} /></label>
          {mode === 'delete' && <label className="label">Type your email to confirm<input className="input" value={f.confirm} onChange={x => setF({ ...f, confirm: x.target.value })} placeholder={email} /></label>}
          {e && <p role="alert" style={{ margin: 0, fontSize: 14, color: '#be123c' }}>{e}</p>}
          <div style={{ display: 'flex', gap: 8 }}><Btn onClick={() => { setMode(null); setE(''); setF({ password: '', confirm: '' }); }}>Cancel</Btn>
            <Btn kind="danger" onClick={go} disabled={busy || !f.password || (mode === 'delete' && !f.confirm)}>{mode === 'leave' ? `Leave ${orgName}` : 'Delete my account'}</Btn></div>
        </div>
      )}
    </Card>
  );
}
