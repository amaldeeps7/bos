import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { authenticator } from 'otplib';

/** Two-factor sign-in: TOTP (authenticator apps) plus one-time backup codes. */
authenticator.options = { window: 1 }; // accept the previous and next 30-second code, for clock drift

const ISSUER = 'Business OS';
const key = () => createHash('sha256').update(process.env.MFA_KEY || process.env.JWT_SECRET || 'dev-secret-change-me').digest();

/** Secrets are stored encrypted (AES-256-GCM), so a database dump alone can't generate codes. */
export function sealSecret(secret: string) {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}
export function openSecret(sealed: string) {
  const [, iv, tag, body] = sealed.split('.');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64')); d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
}

export const newSecret = () => authenticator.generateSecret(20);
export const otpauthUri = (email: string, secret: string) => authenticator.keyuri(email, ISSUER, secret);

/** The 30-second step a code belongs to, or null if it's wrong. Callers reject steps at or before the last one used. */
export function codeStep(secret: string, code: string, now = Date.now()): number | null {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const delta = authenticator.checkDelta(c, secret);
  return delta === null ? null : Math.floor(now / 30_000) + delta;
}

const hash = (code: string) => createHash('sha256').update(code.replace(/[\s-]/g, '').toLowerCase()).digest('hex');
/** Ten backup codes like "k7m2-9qpx": shown once; only their hashes are kept. */
export function newBackupCodes() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const codes = Array.from({ length: 10 }, () => { const b = randomBytes(8); const s = Array.from(b, x => abc[x % abc.length]).join(''); return `${s.slice(0, 4)}-${s.slice(4)}`; });
  return { codes, hashes: codes.map(hash) };
}
/** The remaining hashes after using `code`, or null if it isn't one of them. */
export function useBackupCode(hashes: string[], code: string): string[] | null {
  const h = hash(code); return hashes.includes(h) ? hashes.filter(x => x !== h) : null;
}

/** Whether an organisation's security policy requires two-factor for someone in this role. The sample workspace is exempt. */
export function mfaRequired(org: { security: unknown; demo: boolean }, roleName: string) {
  if (org.demo && process.env.DEMO_MODE === 'true') return false;
  const s = (org.security || {}) as { mfaAll?: boolean; mfaFin?: boolean };
  return !!s.mfaAll || (!!s.mfaFin && ['Owner', 'Finance'].includes(roleName));
}
