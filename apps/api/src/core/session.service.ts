import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { PrismaService } from './prisma.service';
import { COOKIE } from './auth.guard';
import { runAs } from './tenant';
import { mfaRequired } from './mfa';

/** What sign-in returns when a second step is needed: enter a code, or set two-factor up first. */
export type Challenge = { mfa: 'code' | 'setup'; ticket: string; org: string };

const TIMEOUTS: Record<string, number> = { '30 minutes': 1800, '8 hours': 8 * 3600, '7 days': 7 * 86400, '30 days': 30 * 86400 };

/** Issues the session cookie: { sub: accountId, org, mid } (spec §5.1). Only called after membership is checked. */
@Injectable()
export class SessionService {
  constructor(private jwt: JwtService, private prisma: PrismaService) {}
  async issue(res: Response, accountId: string, membershipId: string, org: { id: string; security: unknown }, otp = false) {
    const ttl = TIMEOUTS[(org.security as any)?.timeout] || 8 * 3600;
    const token = await this.jwt.signAsync({ sub: accountId, org: org.id, mid: membershipId, amr: otp ? ['pwd', 'otp'] : ['pwd'] }, { expiresIn: ttl });
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookies(), maxAge: ttl * 1000, path: '/' });
    await this.prisma.account.update({ where: { id: accountId }, data: { lastOrgId: org.id } });
  }

  /**
   * Opens a session after the password (or invitation) checked out, unless a second step is needed:
   * a code when the account has two-factor on, or setting it up when the organisation requires it for this role.
   * `otp` carries over a second factor already passed in this browser (switching organisation).
   */
  async enter(res: Response, account: { id: string; mfaSecret: string | null }, m: { id: string; role: { name: string } },
    org: { id: string; slug: string; security: unknown; demo: boolean }, otp = false): Promise<Challenge | null> {
    const step = account.mfaSecret && !otp ? 'code' : !account.mfaSecret && mfaRequired(org, m.role.name) ? 'setup' : null;
    if (step) return { mfa: step, org: org.slug, ticket: await this.jwt.signAsync({ sub: account.id, org: org.id, mid: m.id, typ: 'mfa' }, { expiresIn: 600 }) };
    await this.issue(res, account.id, m.id, org, otp);
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

/** Cookies are Secure everywhere except plain-http local development (COOKIE_SECURE=false to override). */
export const secureCookies = () => process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';
