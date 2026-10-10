import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../core/prisma.service';
import { RedisService } from '../core/redis.service';
import { SessionService } from '../core/session.service';
import { MailService, htmlOf } from '../core/mail.service';
import { AuditService } from '../core/audit.service';
import { COOKIE } from '../core/cookies';
import { Me, Public } from '../core/decorators';
import { Limit } from '../core/rate-limit';
import type { AuthUser, TokenPayload } from '../core/auth.types';
import { runAs } from '../core/tenant';
import { str } from '../core/util';
import { imageType, readAvatar, removeAvatar, saveAvatar } from '../core/avatars';
import { FinanceService } from './finance.service';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
import type { EmailToken } from '../core/session.service';

/** Your own account: name, photo, email address (and verifying it), leaving an organisation, deleting the account. */
@Controller()
export class AccountController {
  constructor(private prisma: PrismaService, private redis: RedisService, private session: SessionService, private mail: MailService,
    private audit: AuditService, private jwt: JwtService, private fin: FinanceService) {}

  private async account(accountId: string) { return this.prisma.account.findUniqueOrThrow({ where: { id: accountId } }); }
  private async checkPassword(accountId: string, password: unknown) {
    const acc = await this.account(accountId);
    if (!acc.passwordHash || !(await bcrypt.compare(String(password || ''), acc.passwordHash))) throw new BadRequestException('That password isn’t right.');
    return acc;
  }

  // ── Name and photo ──────────────────────────────────────────────────────────────

  /** Your name, as colleagues see it here (and on your account). Title and team stay with admins. */
  @Patch('me/profile')
  async profile(@Me() me: AuthUser, @Body() b: any) {
    const name = str(b.name, 'Name', { max: 120 }).trim();
    if (!name) throw new BadRequestException('Enter your name.');
    await this.prisma.membership.update({ where: { id: me.id }, data: { name } });
    await this.prisma.account.update({ where: { id: me.accountId }, data: { name } });
    return { message: 'Name updated.' };
  }

  @Post('me/avatar') @HttpCode(200) @Limit('avatar', 20, 3600, 'user')
  async setAvatar(@Me() me: AuthUser, @Body() b: any) {
    await saveAvatar(me.accountId, b.image);
    await this.prisma.account.update({ where: { id: me.accountId }, data: { avatarAt: new Date() } });
    return { message: 'Photo updated.' };
  }

  @Delete('me/avatar')
  async deleteAvatar(@Me() me: AuthUser) {
    await removeAvatar(me.accountId);
    await this.prisma.account.update({ where: { id: me.accountId }, data: { avatarAt: null } });
    return { message: 'Photo removed.' };
  }

  /** A colleague's photo: only for people in your current organisation. */
  @Get('avatars/:accountId')
  async avatar(@Param('accountId') accountId: string, @Res() res: Response) {
    if (!(await this.prisma.membership.findFirst({ where: { accountId }, select: { id: true } }))) throw new NotFoundException();
    const buf = await readAvatar(accountId);
    if (!buf) throw new NotFoundException();
    res.set({ 'Content-Type': imageType(buf) || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' }).send(buf);
  }

  // ── Email address: verifying it, and changing it ─────────────────────────────────

  /** Sends (or resends) the verification link: for the signed-in person, or mid-sign-in with the ticket. */
  @Public() @Post('auth/verify-email/send') @HttpCode(200) @Limit('verify-send', 5, 3600)
  async sendVerify(@Req() req: Request, @Body() b: any) {
    let accountId = ((req as any).user as AuthUser | undefined)?.accountId; let orgId = ((req as any).user as AuthUser | undefined)?.orgId;
    if (b.ticket) {
      const p = await this.jwt.verifyAsync<TokenPayload>(String(b.ticket)).catch(() => null);
      if (!p || p.typ !== 'mfa') throw new UnauthorizedException('That sign-in took too long. Start again.');
      accountId = p.sub; orgId = p.org;
    }
    if (!accountId) throw new UnauthorizedException('Sign in to continue');
    const acc = await this.account(accountId);
    if (acc.emailVerifiedAt) return { message: 'Your email address is already confirmed.' };
    await this.session.emailLink(acc, acc.email, 'verify', orgId);
    return { message: `We sent a confirmation link to ${acc.email}.` };
  }

  /** The emailed link: confirms the address, or completes a change of address. */
  @Public() @Post('auth/verify-email') @HttpCode(200) @Limit('verify', 20, 600)
  async verify(@Body() b: any) {
    const key = `bos:email:${sha(str(b.token, 'Link', { required: true, max: 200 }))}`;
    const t = await this.redis.getJSON<EmailToken>(key);
    if (!t) throw new BadRequestException('This link has expired or was already used.');
    await this.redis.del(key);
    const acc = await this.account(t.accountId);
    if (t.kind === 'verify') {
      if (acc.email !== t.email) throw new BadRequestException('Your email address changed since this link was sent.');
      await this.prisma.account.update({ where: { id: acc.id }, data: { emailVerifiedAt: new Date() } });
      return { message: 'Email address confirmed. You can sign in.' };
    }
    if (await this.prisma.account.findUnique({ where: { email: t.email } })) throw new BadRequestException(`${t.email} is already used by another Business OS account.`);
    const old = acc.email;
    await this.prisma.account.update({ where: { id: acc.id }, data: { email: t.email, emailVerifiedAt: new Date() } });
    // Each organisation keeps a copy of the address on the membership.
    for (const { m, org } of await this.session.memberships(acc.id)) await runAs({ orgId: org.id }, () => this.prisma.membership.update({ where: { id: m.id }, data: { email: t.email } }));
    const text = `Hi ${acc.name.split(' ')[0]},\n\nThe email address on your Business OS account changed from ${old} to ${t.email}. Sign in with the new address from now on.\n\nIf you didn't do this, reply to this email straight away.`;
    if (acc.lastOrgId) await runAs({ orgId: acc.lastOrgId }, () => this.mail.send({ to: old, subject: 'Your Business OS email address changed', text, html: htmlOf(text), kind: 'security' })).catch(() => undefined);
    await this.redis.del(`bos:login:${old}`);
    return { message: `Email address changed to ${t.email}. Sign in with it from now on.` };
  }

  /** Change your email: needs your password; takes effect once the new address confirms it. */
  @Post('me/email') @HttpCode(200) @Limit('verify-send', 5, 3600)
  async changeEmail(@Me() me: AuthUser, @Body() b: any) {
    const acc = await this.checkPassword(me.accountId, b.password);
    const email = str(b.email, 'Email', { required: true, max: 200 }).trim().toLowerCase();
    if (!EMAIL.test(email)) throw new BadRequestException('Enter a valid email address.');
    if (email === acc.email) throw new BadRequestException('That’s already your email address.');
    if (await this.prisma.account.findUnique({ where: { email } })) throw new BadRequestException('That email is already used by another Business OS account.');
    await this.session.emailLink(acc, email, 'change', me.orgId);
    return { message: `Check ${email} for a link to confirm the change.` };
  }

  // ── Leaving and deleting ─────────────────────────────────────────────────────────

  /** Leave this organisation (not the Owner: hand ownership over first). Your records stay. */
  @Post('me/leave') @HttpCode(200)
  async leave(@Me() me: AuthUser, @Body() b: any, @Res({ passthrough: true }) res: Response) {
    await this.checkPassword(me.accountId, b.password);
    if (me.roleName === 'Owner' && me.builtIn) throw new BadRequestException('Hand ownership to someone else first (Settings → Organisation), or close the organisation.');
    await this.prisma.membership.update({ where: { id: me.id }, data: { status: 'Deactivated' } });
    const moved = await this.fin.reassignApprovals(me.id, me.name);
    await this.audit.log(me, `${me.name} left the organisation${moved ? ` (${moved} approval${moved > 1 ? 's' : ''} moved to someone else)` : ''}`, 'icon-log-out', 'access');
    // Carry on in another organisation if there is one; otherwise sign out.
    const next = (await this.session.memberships(me.accountId))[0];
    if (next) { await this.session.issue(res, me.accountId, next.m.id, next.org, false, me.sid); return { message: `You left. Switched to ${next.org.name}.`, next: next.org.slug }; }
    if (me.sid) await this.session.revoke(me.accountId, me.sid);
    res.clearCookie(COOKIE, { path: '/' });
    return { message: 'You left the organisation.', next: null };
  }

  /** Delete your account: you leave every organisation, your sign-in stops working and your photo is removed.
      Records you created stay with the organisations (with your name), as their history. */
  @Post('me/delete') @HttpCode(200)
  async deleteAccount(@Me() me: AuthUser, @Body() b: any, @Res({ passthrough: true }) res: Response) {
    const acc = await this.checkPassword(me.accountId, b.password);
    if (String(b.confirm || '').trim().toLowerCase() !== acc.email) throw new BadRequestException('Type your email address to confirm.');
    const list = await this.session.memberships(acc.id);
    const owns = list.find(x => x.m.role.name === 'Owner' && x.m.role.builtIn);
    if (owns) throw new ForbiddenException(`You own ${owns.org.name}. Hand ownership to someone else or close it first.`);
    for (const { m, org } of list) await runAs({ orgId: org.id, membershipId: m.id, accountId: acc.id }, async () => {
      await this.prisma.membership.update({ where: { id: m.id }, data: { status: 'Deactivated' } });
      await this.fin.reassignApprovals(m.id, m.name);
      await this.prisma.auditLog.create({ data: { userId: m.id, who: m.name, text: `${m.name} deleted their Business OS account and left`, icon: 'icon-user-x', area: 'access' } });
    });
    await this.session.revokeAll(acc.id);
    await removeAvatar(acc.id);
    await this.prisma.account.update({ where: { id: acc.id }, data: {
      email: `deleted-${acc.id}@deleted.invalid`, passwordHash: null, mfaSecret: null, mfaBackup: [], avatarAt: null, emailVerifiedAt: null, lastOrgId: null } });
    res.clearCookie(COOKIE, { path: '/' });
    return { message: 'Your account is deleted.' };
  }
}
