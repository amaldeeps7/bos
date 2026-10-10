'use client';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AuthFrame } from '@/components/auth-frame';

/** Opened from the emailed link: confirms the address, or completes a change of address. */
export default function VerifyEmail() {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null); const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return; ran.current = true;
    const token = new URLSearchParams(location.search).get('token') || ''; history.replaceState(null, '', '/verify-email');
    if (!token) { setState({ ok: false, text: 'This page needs the link from the email.' }); return; }
    api<{ message: string }>('auth/verify-email', { body: { token } }).then(r => setState({ ok: true, text: r.message }))
      .catch(x => setState({ ok: false, text: x instanceof ApiError ? x.message : 'Something went wrong. Try the link again.' }));
  }, []);
  return (
    <AuthFrame sub="Confirm your email address">
      <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!state ? <p style={{ margin: 0, fontSize: 14, color: '#64748b' }}>Checking the link…</p> : <>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{state.ok ? 'Done' : 'That didn’t work'}</p>
          <p role={state.ok ? 'status' : 'alert'} style={{ margin: 0, fontSize: 14, color: state.ok ? '#334155' : '#be123c' }}>{state.text}</p>
          <a href="/login" className="btn btn-pri" style={{ justifyContent: 'center', textDecoration: 'none' }}>Go to sign in</a>
        </>}
      </div>
    </AuthFrame>
  );
}
