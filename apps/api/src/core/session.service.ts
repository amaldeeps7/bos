import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import { RedisService } from './redis.service';
import { MailService, htmlOf } from './mail.service';
import { PrismaService } from './prisma.service';
import { COOKIE } from './cookies';
import { runAs } from './tenant';
import { mfaRequired } from './mfa';
import type { TokenPayload } from './auth.types';

/** What sign-in returns when a second step is needed: enter a code, or set two-factor up first. */
export type Challenge = { mfa: 'code' | 'setup'; ticket: string; org: string } | { verify: 'email'; email: string; ticket: string; org: string };

const TIMEOUTS: Record<string, number> = { '30 minutes': 1800, '8 hours': 8 * 3600, '7 days': 7 * 86400, '30 days': 30 * 86400 };
/** Settings → Security "Sign out after inactivity": the session lasts this long after the last request. */
export const sessionTtl = (security: unknown) => TIMEOUTS[(security as any)?.timeout] || 8 * 3600;
const REFRESH_AFTER = 300; // re-issue the cookie at most every 5 minutes of activity
export type EmailToken = { accountId: string; email: string; kind: 'verify' | 'change' };
type SessionInfo = { at: string; seen: string; device: string; ip: string; org: string };

/** Issues the session cookie: { sub: accountId, org, mid } (spec §5.1). Only called after membership is checked. */
@Injectable()
export class SessionService {
  constructor(private jwt: JwtService, private prisma: PrismaService, private redis: RedisService, private mail: MailService) {}

  /**
   * Settings → Security "Email people when they sign in from a new device": each browser carries a long-lived
   * random device id; a sign-in from one this account hasn't used before sends an email. The very first sign-in doesn't.
   */
  async noteDevice(req: Request, res: Response, account: { id: string; email: string; name: string }, org: { id: string; name: string; security: unknown; tz: string }) {
    let device = String(req.cookies?.[DEVICE] || '');
    if (!/^[a-f0-9]{32}$/.test(device)) { device = randomBytes(16).toString('hex'); }
    res.cookie(DEVICE, device, { httpOnly: true, sameSite: 'lax', secure: secureCookies(), maxAge: 400 * 86400_000, path: '/' });
    const key = `bos:devices:${account.id}`;
    const known = (await this.redis.getJSON<string[]>(key)) || [];
    if (known.includes(device)) return;
    await this.redis.setJSON(key, [device, ...known].slice(0, 30), 400 * 86400);
    if (!known.length || !(org.security as any)?.newDevice) return;
    const when = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: org.tz }).format(new Date());
    const browser = describeAgent(String(req.headers['user-agent'] || ''));
    const text = `Hi ${account.name.split(' ')[0]},\n\nYour Business OS account signed in to ${org.name} from a new device.\n\nWhen: ${when}\nDevice: ${browser}\nIP address: ${req.ip}\n\nIf this was you, there's nothing to do. If not, change your password now and sign out everywhere from your profile.`;
    await runAs({ orgId: org.id }, () => this.mail.send({ to: account.email, subject: 'New sign-in to Business OS', text, html: htmlOf(text), kind: 'security' })).catch(() => undefined);
  }
  /**
   * Signs the session cookie. Each session has an id (listed under your profile, revocable on its own) and carries the
   * account's session version (bumped by "sign out everywhere" and password changes, which ends every older session).
   * `sid` keeps the same session when switching organisation.
   */
  async issue(res: Response, accountId: string, membershipId: string, org: { id: string; security: unknown }, otp = false, sid?: string) {
    const ttl = sessionTtl(org.security);
    const acc = await this.prisma.account.update({ where: { id: accountId }, data: { lastOrgId: org.id }, select: { sessionVersion: true } });
    const id = sid || randomBytes(12).toString('hex');
    const token = await this.jwt.signAsync({ sub: accountId, org: org.id, mid: membershipId, amr: otp ? ['pwd', 'otp'] : ['pwd'], sid: id, sv: acc.sessionVersion }, { expiresIn: ttl });
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookies(), maxAge: ttl * 1000, path: '/' });
    if (!sid) await this.track(accountId, id, { org: org.id });
    return id;
  }

  /** Emails a one-time link (24 hours) to confirm an address: the account's own ('verify') or a new one ('change'). */
  async emailLink(acc: { id: string; name: string; lastOrgId: string | null }, to: string, kind: EmailToken['kind'], orgId?: string) {
    const token = randomBytes(32).toString('base64url');
    await this.redis.setJSON(`bos:email:${createHash('sha256').update(token).digest('hex')}`, { accountId: acc.id, email: to, kind } satisfies EmailToken, 24 * 3600);
    const link = `${(process.env.WEB_ORIGIN || 'http://localhost:3000').split(',')[0]}/verify-email?token=${token}`;
    const first = acc.name.split(' ')[0] || 'there';
    const text = kind === 'verify'
      ? `Hi ${first},\n\nConfirm that ${to} is your email address for Business OS:\n${link}\n\nThe link works once, for 24 hours.`
      : `Hi ${first},\n\nYou asked to change your Business OS email address to ${to}. Confirm it here:\n${link}\n\nThe link works once, for 24 hours. Until then, you keep signing in with your current address.`;
    const org = orgId || acc.lastOrgId || (await this.memberships(acc.id))[0]?.org.id;
    if (!org) return;
    await runAs({ orgId: org }, () => this.mail.send({ to, subject: kind === 'verify' ? 'Confirm your email address' : 'Confirm your new email address', text, html: htmlOf(text), kind: 'security' })).catch(() => undefined);
  }

  // ── The session list (Redis): what's signed in where ─────────────────────────────

  private key(accountId: string) { return `bos:sess:${accountId}`; }
  private async track(accountId: string, sid: string, patch: Partial<SessionInfo>) {
    const all = (await this.redis.getJSON<Record<string, SessionInfo>>(this.key(accountId))) || {};
    const now = new Date().toISOString();
    all[sid] = { at: now, seen: now, device: '', ip: '', org: '', ...(all[sid] as Partial<SessionInfo> | undefined), ...patch };
    const keep = Object.entries(all).sort((a, b) => b[1].seen.localeCompare(a[1].seen)).slice(0, 30);
    await this.redis.setJSON(this.key(accountId), Object.fromEntries(keep), 31 * 86400);
  }
  async list(accountId: string) {
    return Object.entries((await this.redis.getJSON<Record<string, SessionInfo>>(this.key(accountId))) || {})
      .map(([id, s]) => ({ id, ...s })).sort((a, b) => b.seen.localeCompare(a.seen));
  }
  /** Ends one session now (sign out, or "sign out" next to a device). */
  async revoke(accountId: string, sid: string) {
    await this.redis.setJSON(`bos:revoked:${sid}`, 1, 31 * 86400);
    const all = (await this.redis.getJSON<Record<string, SessionInfo>>(this.key(accountId))) || {};
    delete all[sid]; await this.redis.setJSON(this.key(accountId), all, 31 * 86400);
  }
  async isRevoked(sid?: string) { return !!sid && !!(await this.redis.getJSON(`bos:revoked:${sid}`)); }
  /** Ends every session of the account (the database version is the backstop if Redis is down). */
  async revokeAll(accountId: string) {
    for (const s of await this.list(accountId)) await this.redis.setJSON(`bos:revoked:${s.id}`, 1, 31 * 86400);
    await this.redis.del(this.key(accountId));
    await this.prisma.account.update({ where: { id: accountId }, data: { sessionVersion: { increment: 1 } } });
  }

  /**
   * Inactivity timeout: while someone keeps using the app, the cookie is re-issued (at most every 5 minutes) with a
   * fresh expiry, so "sign out after 30 minutes" means 30 minutes of inactivity, not 30 minutes after sign-in.
   */
  async refresh(req: Request, res: Response, p: TokenPayload, ttl: number) {
    const now = Math.floor(Date.now() / 1000);
    if (!p.sid || !p.iat || now - p.iat < REFRESH_AFTER || !req.cookies?.[COOKIE]) return;
    const { iat: _i, exp: _e, ...rest } = p;
    const token = await this.jwt.signAsync(rest, { expiresIn: ttl });
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookies(), maxAge: ttl * 1000, path: '/' });
    await this.track(p.sub, p.sid, { seen: new Date().toISOString(), device: describeAgent(String(req.headers['user-agent'] || '')), ip: req.ip || '', org: p.org });
  }

  /**
   * Opens a session after the password (or invitation) checked out, unless a second step is needed:
   * a code when the account has two-factor on, or setting it up when the organisation requires it for this role.
   * `otp` carries over a second factor already passed in this browser (switching organisation).
   */
  async enter(res: Response, account: { id: string; email: string; mfaSecret: string | null; emailVerifiedAt: Date | null }, m: { id: string; role: { name: string } },
    org: { id: string; slug: string; security: unknown; demo: boolean }, otp = false, sid?: string): Promise<Challenge | null> {
    // The organisation can require a confirmed email address (Settings → Security, Owner only).
    if ((org.security as any)?.verifyEmail && !account.emailVerifiedAt)
      return { verify: 'email', email: account.email, org: org.slug, ticket: await this.jwt.signAsync({ sub: account.id, org: org.id, mid: m.id, typ: 'mfa' }, { expiresIn: 3600 }) };
    const step = account.mfaSecret && !otp ? 'code' : !account.mfaSecret && mfaRequired(org, m.role.name) ? 'setup' : null;
    if (step) return { mfa: step, org: org.slug, ticket: await this.jwt.signAsync({ sub: account.id, org: org.id, mid: m.id, typ: 'mfa' }, { expiresIn: 600 }) };
    await this.issue(res, account.id, m.id, org, otp, sid);
    return null;
  }

  /** Every organisation this account can use, newest activity first. */
  async memberships(accountId: string) {
    const ms = await runAs({ accountId }, () => this.prisma.membership.findMany({ where: { accountId, status: 'Active' } }));
    const orgs = await this.prisma.organization.findMany({ where: { id: { in: ms.map(m => m.orgId) }, status: 'active' }, orderBy: { createdAt: 'asc' } });
    // Each role is read inside its own organisation (RLS shows only the current tenant's roles).
    return Promise.all(orgs.map(async org => {
      const m = ms.find(x => x.orgId === org.id)!;
      const role = await runAs({ orgId: org.id }, () => this.prisma.role.findUniqueOrThrow({ where: { id: m.roleId } }));
      return { m: { ...m, role }, org };
    }));
  }
}

const DEVICE = 'bos_device';

/** "Chrome on Windows" from a user-agent string, for security emails and the session list. */
export function describeAgent(ua: string) {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} on ${os}` : b;
}

/** Cookies are Secure everywhere except plain-http local development (COOKIE_SECURE=false to override). */
export const secureCookies = () => process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';
