import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, HttpException, HttpStatus, Param, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcryptjs';
import { placeOf } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { RedisService } from '../core/redis.service';
import { OrgService } from '../core/org.service';
import { COOKIE } from '../core/auth.guard';
import { SessionService } from '../core/session.service';
import { Me, Public } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';
import { planOf } from '../core/plans';
import { runAs } from '../core/tenant';
import { str } from '../core/util';
import { codeStep, mfaRequired, newBackupCodes, newSecret, openSecret, otpauthUri, sealSecret, useBackupCode } from '../core/mfa';
import type { TokenPayload } from '../core/auth.types';
import { Limit } from '../core/rate-limit';
import { AuditService } from '../core/audit.service';

export const ini = (n: string) => n.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();

/** "Growth plan" / "Trial · 9 days left" for the organisation menu. */
export function planLabel(o: { plan: string; trialEndsAt: Date | null }) {
  if (o.plan === 'trial') {
    const days = o.trialEndsAt ? Math.max(0, Math.ceil((o.trialEndsAt.getTime() - Date.now()) / 86400000)) : 0;
    return `Trial · ${days} ${days === 1 ? 'day' : 'days'} left`;
  }
  return `${planOf(o.plan).name} plan`;
}

@Controller('auth')
export class AuthController {
  constructor(private prisma: PrismaService, private session: SessionService, private redis: RedisService, private orgs: OrgService, private jwt: JwtService, private audit: AuditService) {}

  issue(res: Response, accountId: string, membershipId: string, org: { id: string; security: unknown }) { return this.session.issue(res, accountId, membershipId, org); }

  memberships(accountId: string) { return this.session.memberships(accountId); }

  @Public() @Post('login') @HttpCode(200) @Limit('login', 100, 600)
  async login(@Body() body: any, @Res({ passthrough: true }) res: Response) {
    const email = str(body.email, 'Email', { required: true, max: 200 }).trim().toLowerCase();
    const password = str(body.password, 'Password', { required: true, max: 200 });
    if ((await this.redis.hit(`bos:login:${email}`, 300)) > 10) throw new HttpException('Too many attempts. Try again in a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    const acc = await this.prisma.account.findUnique({ where: { email } });
    if (!acc?.passwordHash || !(await bcrypt.compare(password, acc.passwordHash))) throw new UnauthorizedException('That email and password don’t match.');
    const list = await this.memberships(acc.id);
    if (!list.length) throw new UnauthorizedException('You aren’t a member of any active organisation. Ask for an invitation, or create one.');
    await this.redis.del(`bos:login:${email}`);
    const want = body.org ? String(body.org) : acc.lastOrgId;
    const pick = list.find(x => x.org.slug === want || x.org.id === want) || list[0];
    // Two-factor on, or required by the organisation: no session yet, just a ticket for the second step.
    const challenge = await this.session.enter(res, acc, pick.m, pick.org);
    if (challenge) return challenge;
    await runAs({ orgId: pick.org.id }, () => this.prisma.membership.update({ where: { id: pick.m.id }, data: { lastActiveAt: new Date() } }));
    return { ok: true, org: pick.org.slug };
  }

  // ── Two-factor sign-in ───────────────────────────────────────────────────────

  /** Who's asking: the holder of a challenge ticket (mid-sign-in), else the signed-in person. */
  private async who(req: Request, ticket?: unknown) {
    let p: TokenPayload | null = null;
    if (ticket) {
      try { p = await this.jwt.verifyAsync<TokenPayload>(String(ticket)); } catch { /* expired */ }
      if (!p || p.typ !== 'mfa') throw new UnauthorizedException('That sign-in took too long. Start again.');
    }
    const accountId = p?.sub || (req as any).user?.accountId;
    if (!accountId) throw new UnauthorizedException('Sign in to continue');
    const acc = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    if ((await this.redis.hit(`bos:mfa:${acc.id}`, 300)) > 10) throw new HttpException('Too many attempts. Try again in a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    return { acc, ticket: p };
  }

  /** Checks an authenticator code (or, if allowed, a backup code) and records it as used. */
  private async check(acc: { id: string; mfaSecret: string | null; mfaStep: number; mfaBackup: string[] }, code: unknown, backup = true) {
    if (!acc.mfaSecret) throw new BadRequestException('Two-factor isn’t on for this account.');
    const step = codeStep(openSecret(acc.mfaSecret), String(code || ''));
    if (step !== null && step > acc.mfaStep) { await this.prisma.account.update({ where: { id: acc.id }, data: { mfaStep: step } }); return { backup: false, left: acc.mfaBackup.length }; }
    const rest = backup ? useBackupCode(acc.mfaBackup, String(code || '')) : null;
    if (rest) { await this.prisma.account.update({ where: { id: acc.id }, data: { mfaBackup: rest } }); return { backup: true, left: rest.length }; }
    // 400, not 401: the session (if any) is fine, only the code is wrong; 401 would send the browser back to sign-in.
    throw new BadRequestException(step !== null ? 'That code was already used. Wait for the next one.' : 'That code didn’t work. Check your authenticator app and try again.');
  }

  /** The membership a ticket was issued for, if it's still active. */
  private async target(p: TokenPayload) {
    const hit = (await this.memberships(p.sub)).find(x => x.m.id === p.mid);
    if (!hit) throw new UnauthorizedException('You no longer have access to that organisation.');
    return hit;
  }

  /** Second step of sign-in: a 6-digit code from the authenticator app, or a backup code. */
  @Public() @Post('mfa/verify') @HttpCode(200) @Limit('mfa', 30, 300)
  async mfaVerify(@Req() req: Request, @Body() b: any, @Res({ passthrough: true }) res: Response) {
    const { acc, ticket } = await this.who(req, str(b.ticket, 'Ticket', { required: true }));
    const used = await this.check(acc, b.code);
    const { m, org } = await this.target(ticket!);
    await this.session.issue(res, acc.id, m.id, org, true);
    await this.redis.del(`bos:mfa:${acc.id}`, `bos:login:${acc.email}`);
    return { ok: true, org: org.slug, ...(used.backup ? { message: `Signed in with a backup code. ${used.left} left — make new ones from your profile if you’re running low.` } : {}) };
  }

  /** Starts enrolment: a new secret as a QR code. It's kept aside until a code from it is confirmed. */
  @Public() @Post('mfa/setup') @HttpCode(200) @Limit('mfa', 30, 300)
  async mfaSetup(@Req() req: Request, @Body() b: any) {
    const { acc } = await this.who(req, b.ticket);
    if (acc.mfaSecret) throw new BadRequestException('Two-factor is already on. Turn it off first to move it to another device.');
    const secret = newSecret(); const uri = otpauthUri(acc.email, secret);
    await this.redis.setJSON(`bos:mfa:pending:${acc.id}`, secret, 900);
    return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
  }

  /** Confirms enrolment with a code from the app; returns the backup codes (shown once). Mid-sign-in, it also opens the session. */
  @Public() @Post('mfa/enable') @HttpCode(200) @Limit('mfa', 30, 300)
  async mfaEnable(@Req() req: Request, @Body() b: any, @Res({ passthrough: true }) res: Response) {
    const { acc, ticket } = await this.who(req, b.ticket);
    const secret = await this.redis.getJSON<string>(`bos:mfa:pending:${acc.id}`);
    if (!secret) throw new BadRequestException('Setup timed out. Start again to get a new QR code.');
    const step = codeStep(secret, String(b.code || ''));
    if (step === null) throw new BadRequestException('That code didn’t work. Make sure the app shows Business OS, and enter the current code.');
    const { codes, hashes } = newBackupCodes();
    await this.prisma.account.update({ where: { id: acc.id }, data: { mfaSecret: sealSecret(secret), mfaStep: step, mfaBackup: hashes } });
    await this.redis.del(`bos:mfa:pending:${acc.id}`, `bos:mfa:${acc.id}`);
    const me = (req as any).user as AuthUser | undefined;
    if (ticket) { const { m, org } = await this.target(ticket); await this.session.issue(res, acc.id, m.id, org, true); }
    else if (me) {
      // Stay signed in, now with the second factor on this session.
      await this.session.issue(res, acc.id, me.id, await this.prisma.organization.findUniqueOrThrow({ where: { id: me.orgId } }), true);
      await this.audit.log(me, `${me.name} turned on two-factor sign-in`, 'icon-shield-check', 'access');
    }
    return { ok: true, codes, message: 'Two-factor sign-in is on. Save your backup codes somewhere safe.' };
  }

  @Get('mfa')
  async mfaStatus(@Me() me: AuthUser) {
    const acc = await this.prisma.account.findUniqueOrThrow({ where: { id: me.accountId } });
    return { on: !!acc.mfaSecret, backupLeft: acc.mfaBackup.length, required: !!me.mfa };
  }

  /** New backup codes (the old ones stop working). Needs a current code from the app. */
  @Post('mfa/backup-codes') @HttpCode(200)
  async mfaBackupCodes(@Me() me: AuthUser, @Req() req: Request, @Body() b: any) {
    const { acc } = await this.who(req);
    await this.check(acc, b.code, false);
    const { codes, hashes } = newBackupCodes();
    await this.prisma.account.update({ where: { id: acc.id }, data: { mfaBackup: hashes } });
    await this.audit.log(me, `${me.name} made new two-factor backup codes`, 'icon-shield-check', 'access');
    return { codes, message: 'New backup codes made. The old ones no longer work.' };
  }

  /** Turns two-factor off: needs the password and a code, and isn't allowed where an organisation requires it. */
  @Post('mfa/disable') @HttpCode(200)
  async mfaDisable(@Me() me: AuthUser, @Req() req: Request, @Body() b: any) {
    const { acc } = await this.who(req);
    if (!acc.passwordHash || !(await bcrypt.compare(String(b.password || ''), acc.passwordHash))) throw new BadRequestException('That password isn’t right.');
    await this.check(acc, b.code);
    const needs = (await this.memberships(acc.id)).find(x => mfaRequired(x.org, x.m.role.name));
    if (needs) throw new BadRequestException(`${needs.org.name} requires two-factor sign-in for ${needs.m.role.name === 'Owner' || needs.m.role.name === 'Finance' ? `the ${needs.m.role.name} role` : 'everyone'}, so it has to stay on.`);
    await this.prisma.account.update({ where: { id: acc.id }, data: { mfaSecret: null, mfaBackup: [], mfaStep: 0 } });
    await this.audit.log(me, `${me.name} turned off two-factor sign-in`, 'icon-shield-off', 'access');
    return { ok: true, message: 'Two-factor sign-in is off.' };
  }

  @Public() @Post('logout') @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) { res.clearCookie(COOKIE, { path: '/' }); return { ok: true }; }

  /** Switch organisation: verifies the membership, then re-issues the cookie (spec §5.1). */
  @Post('switch') @HttpCode(200)
  async switch(@Me() me: AuthUser, @Body() b: any, @Res({ passthrough: true }) res: Response) {
    const target = str(b.orgId, 'Organisation', { required: true });
    const hit = (await this.memberships(me.accountId)).find(x => x.org.id === target);
    if (!hit) throw new ForbiddenException('You aren’t a member of that organisation');
    // A second factor passed in this session carries over; otherwise the other organisation may ask for one.
    const acc = await this.prisma.account.findUniqueOrThrow({ where: { id: me.accountId } });
    const challenge = await this.session.enter(res, acc, hit.m, hit.org, !!me.otp);
    if (challenge) return challenge;
    return { ok: true, message: `Switched to ${hit.org.name}.` };
  }

  /** Demo accounts for the sign-in screen (sample workspace only, and only in demo mode). */
  @Public() @Get('demo-accounts')
  async demo() {
    if (process.env.DEMO_MODE !== 'true') return [];
    const org = await this.prisma.organization.findFirst({ where: { demo: true, status: 'active' } });
    if (!org) return [];
    const users = await runAs({ orgId: org.id }, () => this.prisma.membership.findMany({ where: { status: 'Active' }, include: { role: true }, orderBy: { role: { sort: 'asc' } } }));
    return users.map(u => ({ email: u.email, name: u.name, role: u.role.name }));
  }

  /** Invitation tokens are "<orgId>.<random>", so the tenant is known before anything is read. */
  private async invite(token: string) {
    const orgId = String(token).split('.')[0];
    const org = orgId ? await this.prisma.organization.findUnique({ where: { id: orgId } }) : null;
    const u = org && org.status === 'active' ? await runAs({ orgId }, () => this.prisma.membership.findUnique({ where: { inviteToken: String(token) }, include: { role: true, account: true } })) : null;
    if (!org || !u || u.status !== 'Invited' || !u.inviteExpiry || u.inviteExpiry < new Date()) throw new BadRequestException('This invitation has expired or was already used. Ask for a new one.');
    return { org, u };
  }

  /** Who an invitation is for, so the accept page can greet them. */
  @Public() @Get('invite/:token') @Limit('invite-token', 20, 600)
  async inviteInfo(@Param('token') token: string) {
    const { org, u } = await this.invite(token);
    return { email: u.email, name: u.name, role: u.role.name, org: org.name, minPassword: Number((org.security as any).pwd) || 12, hasAccount: !!u.account.passwordHash };
  }

  @Public() @Post('accept-invite') @HttpCode(200) @Limit('invite-token', 20, 600)
  async accept(@Body() b: any, @Res({ passthrough: true }) res: Response) {
    const { org, u } = await this.invite(str(b.token, 'Invitation', { required: true }));
    const min = Number((org.security as any).pwd) || 12;
    const name = str(b.name, 'Name', { max: 120 }).trim() || u.account.name; if (!name) throw new BadRequestException('Enter your name.');
    if (u.account.passwordHash) {
      // Someone who already uses Business OS confirms with their existing password.
      if (!(await bcrypt.compare(String(b.password || ''), u.account.passwordHash))) throw new BadRequestException('Enter your existing Business OS password to join.');
    } else {
      const password = String(b.password || ''); if (password.length < min) throw new BadRequestException(`Use at least ${min} characters.`);
      await this.prisma.account.update({ where: { id: u.accountId }, data: { name, passwordHash: await bcrypt.hash(password, 10) } });
    }
    await runAs({ orgId: org.id }, async () => {
      await this.prisma.membership.update({ where: { id: u.id }, data: { name, title: str(b.title, 'Job title', { max: 120 }).trim() || u.title, status: 'Active', inviteToken: null, inviteExpiry: null, lastActiveAt: new Date() } });
      await this.prisma.auditLog.create({ data: { userId: u.id, who: name, text: `${name} accepted the invitation and joined`, icon: 'icon-user-plus', area: 'access' } });
    });
    const challenge = await this.session.enter(res, await this.prisma.account.findUniqueOrThrow({ where: { id: u.accountId } }), u, org);
    return challenge || { ok: true };
  }

  @Get('me')
  async me(@Me() me: AuthUser) {
    const c = await this.orgs.ctx(); const org = c.org;
    await this.prisma.membership.update({ where: { id: me.id }, data: { lastActiveAt: new Date() } });
    const [entities, units, list] = await Promise.all([
      this.prisma.legalEntity.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
      this.prisma.businessUnit.findMany({ orderBy: { name: 'asc' } }),
      this.memberships(me.accountId),
    ]);
    return {
      user: me,
      org: { id: org.id, name: org.name, slug: org.slug, ini: ini(org.name), plan: org.plan, planLabel: planLabel(org), setupDone: org.setupDone, tz: org.tz, currency: org.currency, fyStart: org.fyStart,
        ourState: c.ourState || '', discLimit: c.discLimit, sacRates: c.sacRates, templates: org.templates, entity: c.entity },
      entities: entities.map(e => ({ id: e.id, name: e.name, gst: e.gst, gstin: e.gstin, state: placeOf(e) || '', isDefault: e.isDefault, address: e.address, bank: e.bank, upi: e.upi })),
      units: units.map(u => ({ id: u.id, name: u.name, entityId: u.entityId })),
      orgs: list.map(({ m, org: o }) => ({ id: o.id, name: o.name, ini: ini(o.name), slug: o.slug, role: m.role.name, sub: planLabel(o), current: o.id === org.id, setupDone: o.setupDone })),
      demo: me.demo, serverTime: new Date().toISOString(),
    };
  }
}
