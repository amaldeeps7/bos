'use client';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

function Accept() {
  const token = useSearchParams().get('token') || '';
  const [info, setInfo] = useState<{ email: string; name: string; role: string; org: string; minPassword: number } | null>(null);
  const [f, setF] = useState({ name: '', title: '', password: '', confirm: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token) { setErr('This link is missing its invitation code.'); return; }
    api<NonNullable<typeof info>>(`auth/invite/${token}`).then(i => { setInfo(i); setF(x => ({ ...x, name: i.name })); }).catch(e => setErr(e instanceof ApiError ? e.message : 'Could not open this invitation.'));
  }, [token]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (f.password !== f.confirm) return setErr('The passwords don’t match.');
    setBusy(true);
    try { await api('auth/accept-invite', { body: { token, name: f.name, title: f.title, password: f.password } }); location.href = '/'; }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not finish joining.'); setBusy(false); }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#fafafa' }}>
      <div style={{ width: 420, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 36, height: 36, borderRadius: 9, backgroundImage: 'linear-gradient(135deg,#0052ff,#4d7cff)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600 }}>BO</span>
          <div><p style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{info ? `Join ${info.org}` : 'Business OS'}</p><p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{info ? `You've been invited as ${info.role}` : 'Accept your invitation'}</p></div>
        </div>
        {info ? (
          <form onSubmit={submit} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label className="label">Work email<input className="input" value={info.email} disabled /></label>
            <label className="label">Your name<input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoComplete="name" required /></label>
            <label className="label">Job title <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: 13, marginTop: -4 }}>Optional</span><input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
            <label className="label">Choose a password<input className="input" type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} autoComplete="new-password" required /><span className="hint">At least {info.minPassword} characters.</span></label>
            <label className="label">Confirm password<input className="input" type="password" value={f.confirm} onChange={e => setF({ ...f, confirm: e.target.value })} autoComplete="new-password" required /></label>
            {err && <p style={{ margin: 0, fontSize: 14, color: '#be123c' }}>{err}</p>}
            <button className="btn btn-pri" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Joining…' : 'Join and sign in'}</button>
          </form>
        ) : (
          <div className="card" style={{ padding: 20 }}>
            <p style={{ margin: 0, fontSize: 14, color: err ? '#be123c' : '#64748b' }}>{err || 'Checking your invitation…'}</p>
            {err && <a href="/login" style={{ display: 'inline-block', marginTop: 12, fontSize: 14 }}>Go to sign in</a>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AcceptInvite() { return <Suspense><Accept /></Suspense>; }
