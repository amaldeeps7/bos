'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AuthFrame } from '@/components/auth-frame';

export default function ResetPassword() {
  const [token, setToken] = useState(''); const [f, setF] = useState({ password: '', confirm: '' });
  const [err, setErr] = useState(''); const [done, setDone] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { setToken(new URLSearchParams(location.search).get('token') || ''); history.replaceState(null, '', '/reset-password'); }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (f.password !== f.confirm) return setErr('The passwords don’t match.');
    setBusy(true);
    try { setDone((await api<{ message: string }>('auth/reset', { body: { token, password: f.password } })).message); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Something went wrong. Try again.'); setBusy(false); }
  };
  return (
    <AuthFrame sub="Choose a new password">
      {done ? (
        <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Password changed</p>
          <p style={{ margin: 0, fontSize: 14, color: '#475569' }}>{done} Every device was signed out.</p>
          <a href="/login" className="btn btn-pri" style={{ justifyContent: 'center', textDecoration: 'none' }}>Sign in</a>
        </div>
      ) : (
        <form onSubmit={submit} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!token && <p role="alert" style={{ margin: 0, fontSize: 14, color: '#be123c' }}>This page needs the link from the reset email. <a href="/forgot-password" className="link">Ask for a new one</a>.</p>}
          <label className="label">New password<input className="input" type="password" autoComplete="new-password" autoFocus value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /><span className="hint">At least 12 characters (your organisation may ask for more).</span></label>
          <label className="label">Confirm<input className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={e => setF({ ...f, confirm: e.target.value })} /></label>
          {err && <p role="alert" style={{ margin: 0, fontSize: 14, color: '#be123c' }}>{err}{/expired/.test(err) && <> <a href="/forgot-password" className="link">Ask for a new link</a>.</>}</p>}
          <button className="btn btn-pri" type="submit" disabled={busy || !token || !f.password} style={{ justifyContent: 'center' }}>{busy ? 'Saving…' : 'Change password'}</button>
        </form>
      )}
    </AuthFrame>
  );
}
