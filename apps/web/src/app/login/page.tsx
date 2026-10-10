'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Challenge, MfaStep, takeChallenge } from '@/components/mfa';
import { flashNext } from '@/components/orgs';

export default function Login() {
  const [email, setEmail] = useState('priya@democonsulting.in'); const [password, setPassword] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<{ email: string; name: string; role: string }[]>([]);
  const [challenge, setChallenge] = useState<Challenge | null>(null); const [reason, setReason] = useState<string | null>(null);
  useEffect(() => { api<typeof demo>('auth/demo-accounts').then(setDemo).catch(() => undefined); setChallenge(takeChallenge()); setReason(new URLSearchParams(location.search).get('reason')); }, []);
  // After the second step: brand-new organisations go to their checklist.
  const done = (message?: string) => { if (message) flashNext(message); location.href = new URLSearchParams(location.search).get('next') === 'setup' ? '/setup' : '/'; };
  const submit = async (e?: FormEvent, as?: string) => {
    e?.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await api<Partial<Challenge>>('auth/login', { body: { email: as || email, password: as ? 'demo1234' : password } });
      if (r.mfa && r.ticket) { setChallenge(r as Challenge); setBusy(false); setPassword(''); return; }
      location.href = '/';
    }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not sign in.'); setBusy(false); }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#fafafa' }}>
      <div style={{ width: 400, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 36, height: 36, borderRadius: 9, backgroundImage: 'linear-gradient(135deg,#0052ff,#4d7cff)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600 }}>BO</span>
          <div><p style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Business OS</p><p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Sign in to your workspace</p></div>
        </div>
        {challenge ? <MfaStep challenge={challenge} onDone={done} onCancel={() => { setChallenge(null); history.replaceState(null, '', '/login'); }} /> : <>
        {reason === '2fa' && <div role="status" style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 10, background: '#eff4ff', border: '1px solid rgba(0,82,255,.2)', fontSize: 14, color: '#0f172a' }}><span className="icon-shield-check" aria-hidden style={{ color: '#0052ff', fontSize: 16, marginTop: 2 }} /><span>Your organisation now requires two-factor sign-in. Sign in again and we’ll help you set it up.</span></div>}
        <form onSubmit={submit} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label className="label">Work email<input className="input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label className="label">Password<input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} autoFocus /></label>
          {err && <p style={{ margin: 0, fontSize: 14, color: '#be123c' }}>{err}</p>}
          <button className="btn btn-pri" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p style={{ margin: 0, fontSize: 14, color: '#64748b', textAlign: 'center' }}>New to Business OS? <a href="/signup" className="link" style={{ textDecoration: 'none' }}>Create an organisation</a></p>
        {demo.length > 0 && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-head" style={{ padding: '12px 16px' }}><p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Demo accounts</p><p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>Password for every account: demo1234</p></div>
            {demo.map(d => (
              <button key={d.email} className="row-btn" onClick={() => submit(undefined, d.email)} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 16px' }}>
                <span><span style={{ display: 'block', fontWeight: 500 }}>{d.name}</span><span style={{ display: 'block', fontSize: 13, color: '#64748b' }}>{d.email}</span></span>
                <span style={{ fontSize: 13, color: '#64748b', alignSelf: 'center' }}>{d.role}</span>
              </button>
            ))}
          </div>
        )}
        </>}
      </div>
    </div>
  );
}
