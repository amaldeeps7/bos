import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, HttpException, HttpStatus, Param, Post, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import * as bcrypt from 'bcryptjs';
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
  constructor(private prisma: PrismaService, private session: SessionService, private redis: RedisService, private orgs: OrgService) {}

  issue(res: Response, accountId: string, membershipId: string, org: { id: string; security: unknown }) { return this.session.issue(res, accountId, membershipId, org); }

  memberships(accountId: string) { return this.session.memberships(accountId); }

  @Public() @Post('login') @HttpCode(200)
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
    await this.issue(res, acc.id, pick.m.id, pick.org);
    await runAs({ orgId: pick.org.id }, () => this.prisma.membership.update({ where: { id: pick.m.id }, data: { lastActiveAt: new Date() } }));
    return { ok: true, org: pick.org.slug };
  }

  @Public() @Post('logout') @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) { res.clearCookie(COOKIE, { path: '/' }); return { ok: true }; }

  /** Switch organisation: verifies the membership, then re-issues the cookie (spec §5.1). */
  @Post('switch') @HttpCode(200)
  async switch(@Me() me: AuthUser, @Body() b: any, @Res({ passthrough: true }) res: Response) {
    const target = str(b.orgId, 'Organisation', { required: true });
    const hit = (await this.memberships(me.accountId)).find(x => x.org.id === target);
    if (!hit) throw new ForbiddenException('You aren’t a member of that organisation');
    await this.issue(res, me.accountId, hit.m.id, hit.org);
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
  @Public() @Get('invite/:token')
  async inviteInfo(@Param('token') token: string) {
    const { org, u } = await this.invite(token);
    return { email: u.email, name: u.name, role: u.role.name, org: org.name, minPassword: Number((org.security as any).pwd) || 12, hasAccount: !!u.account.passwordHash };
  }

  @Public() @Post('accept-invite') @HttpCode(200)
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
    await this.issue(res, u.accountId, u.id, org);
    return { ok: true };
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
      entities: entities.map(e => ({ id: e.id, name: e.name, gstin: e.gstin, isDefault: e.isDefault })),
      units: units.map(u => ({ id: u.id, name: u.name, entityId: u.entityId })),
      orgs: list.map(({ m, org: o }) => ({ id: o.id, name: o.name, ini: ini(o.name), slug: o.slug, role: m.role.name, sub: planLabel(o), current: o.id === org.id, setupDone: o.setupDone })),
      demo: me.demo, serverTime: new Date().toISOString(),
    };
  }
}
