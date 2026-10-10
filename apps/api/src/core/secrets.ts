import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/** Encrypts secrets kept in the database (two-factor secrets, organisations' API keys) with AES-256-GCM,
    so a database dump alone doesn't reveal them. Key: MFA_KEY, else JWT_SECRET. */
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

