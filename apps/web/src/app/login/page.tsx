'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

export default function Login() {
  const [email, setEmail] = useState('priya@democonsulting.in'); const [password, setPassword] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<{ email: string; name: string; role: string }[]>([]);
  useEffect(() => { api<typeof demo>('auth/demo-accounts').then(setDemo).catch(() => undefined); }, []);
  const submit = async (e?: FormEvent, as?: string) => {
    e?.preventDefault(); setBusy(true); setErr('');
    try { await api('auth/login', { body: { email: as || email, password: as ? 'demo1234' : password } }); location.href = '/'; }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not sign in.'); setBusy(false); }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#fafafa' }}>
      <div style={{ width: 400, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 36, height: 36, borderRadius: 9, backgroundImage: 'linear-gradient(135deg,#0052ff,#4d7cff)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600 }}>BO</span>
          <div><p style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Business OS</p><p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Sign in to your workspace</p></div>
        </div>
        <form onSubmit={submit} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label className="label">Work email<input className="input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label className="label">Password<input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} autoFocus /></label>
          {err && <p style={{ margin: 0, fontSize: 14, color: '#be123c' }}>{err}</p>}
          <button className="btn btn-pri" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
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
      </div>
    </div>
  );
}
