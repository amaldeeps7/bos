'use client';
import { FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AuthFrame } from '@/components/auth-frame';

export default function ForgotPassword() {
  const [email, setEmail] = useState(''); const [done, setDone] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { setDone((await api<{ message: string }>('auth/forgot', { body: { email } })).message); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Something went wrong. Try again.'); }
    setBusy(false);
  };
  return (
    <AuthFrame sub="Reset your password">
      {done ? (
        <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Check your email</p>
          <p style={{ margin: 0, fontSize: 14, color: '#475569' }}>{done}</p>
          <a href="/login" className="link" style={{ fontSize: 14, textDecoration: 'none' }}>Back to sign in</a>
        </div>
      ) : (
        <form onSubmit={submit} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 14, color: '#475569' }}>Enter your work email and we’ll send a link to choose a new password.</p>
          <label className="label">Work email<input className="input" type="email" autoComplete="username" autoFocus required value={email} onChange={e => setEmail(e.target.value)} /></label>
          {err && <p role="alert" style={{ margin: 0, fontSize: 14, color: '#be123c' }}>{err}</p>}
          <button className="btn btn-pri" type="submit" disabled={busy || !email} style={{ justifyContent: 'center' }}>{busy ? 'Sending…' : 'Send reset link'}</button>
          <a href="/login" className="link" style={{ fontSize: 14, textDecoration: 'none', textAlign: 'center' }}>Back to sign in</a>
        </form>
      )}
    </AuthFrame>
  );
}
