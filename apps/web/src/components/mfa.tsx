'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApp, useQ } from '@/lib/app';
import { Btn, Card, CardHead, Icon } from './ui';

/** What sign-in returns when a second step is needed. */
export type Challenge = { mfa: 'code' | 'setup'; ticket: string; org?: string };
const KEY = 'bos:mfa';

/** Sign-up, invitations and switching organisation hand the second step to the sign-in page. */
export function continueSignIn(c: Challenge, next?: 'setup') {
  try { sessionStorage.setItem(KEY, JSON.stringify({ mfa: c.mfa, ticket: c.ticket })); } catch { /* storage blocked: they sign in again */ }
  location.href = `/login?step=2fa${next ? `&next=${next}` : ''}`;
}
export function takeChallenge(): Challenge | null {
  try { const v = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}

const codeInput = { height: 46, fontSize: 22, letterSpacing: '.3em', textAlign: 'center' as const, fontVariantNumeric: 'tabular-nums' };
const err = (x: unknown, fallback: string) => (x instanceof ApiError ? x.message : fallback);

/** The second step of sign-in: enter a code, or (when the organisation requires it) set two-factor up. */
export function MfaStep({ challenge, onDone, onCancel }: { challenge: Challenge; onDone: (message?: string) => void; onCancel: () => void }) {
  const [code, setCode] = useState(''); const [backup, setBackup] = useState(false);
  const [e, setE] = useState(''); const [busy, setBusy] = useState(false);
  if (challenge.mfa === 'setup') return (
    <Card style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Set up two-factor sign-in</p>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: '#475569' }}>Your organisation requires it for your role. It takes a minute, with an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.</p>
      </div>
      <Enrol ticket={challenge.ticket} onDone={onDone} />
      <button className="link" onClick={onCancel} style={{ alignSelf: 'flex-start' }}>Use a different account</button>
    </Card>
  );
  const submit = async (ev: FormEvent) => {
    ev.preventDefault(); setBusy(true); setE('');
    try { const r = await api<{ message?: string }>('auth/mfa/verify', { body: { ticket: challenge.ticket, code } }); onDone(r.message); }
    catch (x) { setE(err(x, 'Could not check the code.')); setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ width: 36, height: 36, flex: 'none', borderRadius: 9, background: '#eff4ff', color: '#0052ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="shield-check" size={18} /></span>
        <div><p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Two-factor sign-in</p>
          <p style={{ margin: '2px 0 0', fontSize: 14, color: '#475569' }}>{backup ? 'Enter one of the backup codes you saved. Each works once.' : 'Enter the 6-digit code from your authenticator app.'}</p></div>
      </div>
      <input className="input mono" autoFocus value={code} onChange={x => { setCode(backup ? x.target.value : x.target.value.replace(/\D/g, '').slice(0, 6)); setE(''); }}
        inputMode={backup ? 'text' : 'numeric'} autoComplete="one-time-code" placeholder={backup ? 'xxxx-xxxx' : '000000'} aria-label={backup ? 'Backup code' : 'Authentication code'} style={codeInput} />
      {e && <p role="alert" style={{ margin: 0, fontSize: 14, color: '#be123c' }}>{e}</p>}
      <button className="btn btn-pri" type="submit" disabled={busy || (!backup && code.length !== 6)} style={{ justifyContent: 'center' }}>{busy ? 'Checking…' : 'Verify'}</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
        <button type="button" className="link" onClick={() => { setBackup(!backup); setCode(''); setE(''); }}>{backup ? 'Use the authenticator app' : 'Lost your phone? Use a backup code'}</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** Scan the QR code, confirm a code, then save the backup codes. With a ticket it's part of sign-in; without, the signed-in person. */
export function Enrol({ ticket, onDone }: { ticket?: string; onDone: (message?: string) => void }) {
  const [s, setS] = useState<{ secret: string; qr: string } | null>(null); const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState(''); const [e, setE] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ secret: string; qr: string }>('auth/mfa/setup', { body: { ticket } }).then(setS).catch(x => setE(err(x, 'Could not start setup.'))); }, [ticket]);
  if (codes) return <BackupCodes codes={codes} onDone={() => onDone('Two-factor sign-in is on.')} />;
  const confirm = async (ev: FormEvent) => {
    ev.preventDefault(); setBusy(true); setE('');
    try { const r = await api<{ codes: string[] }>('auth/mfa/enable', { body: { ticket, code } }); setCodes(r.codes); }
    catch (x) { setE(err(x, 'Could not confirm the code.')); setBusy(false); }
  };
  return (
    <form onSubmit={confirm} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <div style={{ width: 164, height: 164, flex: 'none', borderRadius: 10, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
          {s ? <img src={s.qr} alt="QR code for your authenticator app" width={150} height={150} /> : <span style={{ fontSize: 13, color: '#94a3b8' }}>Loading…</span>}
        </div>
        <ol style={{ flex: '1 1 200px', margin: 0, paddingLeft: 18, fontSize: 14, color: '#334155', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li>Open your authenticator app and add an account.</li>
          <li>Scan the QR code. Can’t scan? Enter this key: <span className="mono" style={{ fontSize: 13, wordBreak: 'break-all', background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>{s?.secret.replace(/(.{4})/g, '$1 ').trim()}</span></li>
          <li>Enter the 6-digit code it shows.</li>
        </ol>
      </div>
      <input className="input mono" value={code} onChange={x => { setCode(x.target.value.replace(/\D/g, '').slice(0, 6)); setE(''); }} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" aria-label="Code from the app" style={codeInput} />
      {e && <p role="alert" style={{ margin: 0, fontSize: 14, color: '#be123c' }}>{e}</p>}
      <button className="btn btn-pri" type="submit" disabled={busy || !s || code.length !== 6} style={{ justifyContent: 'center' }}>{busy ? 'Checking…' : 'Turn on two-factor'}</button>
    </form>
  );
}

function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = `Business OS backup codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join('\n')}\n`;
  const download = () => { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'business-os-backup-codes.txt' }); a.click(); setSaved(true); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 10, background: '#ecfdf5', border: '1px solid rgba(4,120,87,.2)', fontSize: 14 }}><Icon name="circle-check" size={16} style={{ color: '#047857', marginTop: 2 }} /><span>Two-factor is on. If you lose your phone, these backup codes get you in. Each works once, and you won’t see them again.</span></div>
      <div className="mono" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '6px 16px', padding: 14, borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 15 }}>{codes.map(c => <span key={c}>{c}</span>)}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Btn icon="download" onClick={download}>Download</Btn>
        <Btn icon="copy" onClick={() => { navigator.clipboard?.writeText(text); setSaved(true); }}>Copy</Btn>
        <Btn kind="pri" onClick={onDone} disabled={!saved} title={saved ? undefined : 'Download or copy them first'} style={{ marginLeft: 'auto' }}>I’ve saved them</Btn>
      </div>
    </div>
  );
}

/** Profile → Two-factor sign-in: turn on, make new backup codes, or turn off (where policy allows). */
export function MfaCard() {
  const { toast } = useApp();
  const q = useQ<{ on: boolean; backupLeft: number; required: boolean }>('auth/mfa'); const st = q.data;
  const [mode, setMode] = useState<null | 'enrol' | 'codes' | 'off'>(null);
  const [f, setF] = useState({ code: '', password: '' }); const [e, setE] = useState(''); const [codes, setCodes] = useState<string[] | null>(null);
  if (!st) return null;
  const close = () => { setMode(null); setF({ code: '', password: '' }); setE(''); setCodes(null); q.refetch(); };
  const run = async (path: string, body: object) => {
    setE('');
    try { const r = await api<{ codes?: string[]; message: string }>(path, { body }); if (r.codes) setCodes(r.codes); else { toast(r.message); close(); } }
    catch (x) { setE(err(x, 'Something went wrong.')); }
  };
  return (
    <Card>
      <CardHead title="Two-factor sign-in" sub={mode === 'enrol' ? 'Scan the code, confirm it, then save your backup codes.' : st.on ? `On · ${st.backupLeft} backup code${st.backupLeft === 1 ? '' : 's'} left` : st.required ? 'Required by your organisation for your role.' : 'Off. A code from your phone, on top of your password, keeps your account safe if the password leaks.'}
        right={!mode && (st.on ? <div style={{ display: 'flex', gap: 8 }}><Btn size="sm" onClick={() => setMode('codes')}>New backup codes</Btn>{!st.required && <Btn size="sm" onClick={() => setMode('off')}>Turn off</Btn>}</div> : <Btn size="sm" kind="pri" icon="shield-check" onClick={() => setMode('enrol')}>Turn on</Btn>)} />
      {mode === 'enrol' && <div style={{ padding: '16px 20px', maxWidth: 560 }}><Enrol onDone={m => { toast(m || 'Two-factor sign-in is on.'); close(); }} /></div>}
      {mode && mode !== 'enrol' && (
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
          {codes ? <BackupCodes codes={codes} onDone={() => { toast('New backup codes saved.'); close(); }} /> : <>
            {mode === 'off' && <label className="label">Password<input className="input" type="password" autoComplete="current-password" value={f.password} onChange={x => setF({ ...f, password: x.target.value })} /></label>}
            <label className="label">{mode === 'off' ? 'Code from your app, or a backup code' : 'Code from your app'}<input className="input mono" inputMode="numeric" autoComplete="one-time-code" value={f.code} onChange={x => setF({ ...f, code: x.target.value })} /></label>
            {e && <p role="alert" style={{ margin: 0, fontSize: 14, color: '#be123c' }}>{e}</p>}
            <div style={{ display: 'flex', gap: 8 }}><Btn onClick={close}>Cancel</Btn>
              {mode === 'codes' ? <Btn kind="pri" onClick={() => run('auth/mfa/backup-codes', { code: f.code })}>Make new codes</Btn> : <Btn kind="danger" onClick={() => run('auth/mfa/disable', f)}>Turn off two-factor</Btn>}</div>
          </>}
        </div>
      )}
    </Card>
  );
}
