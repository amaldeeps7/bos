import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from './prisma.service';
import { MailService, htmlOf } from './mail.service';
import { planOf } from './plans';
import { orgId } from './tenant';
import type { AuthUser } from './auth.types';

const webOrigin = () => (process.env.WEB_ORIGIN || 'http://localhost:3000').split(',')[0].replace(/\/$/, '');

/**
 * Adding people to the current organisation. A person is a global Account plus one Membership per
 * organisation, so someone who already uses Business OS just gets this organisation added.
 */
@Injectable()
export class MembersService {
  constructor(private prisma: PrismaService, private mail: MailService) {}

  private org() { return this.prisma.organization.findUniqueOrThrow({ where: { id: orgId() } }); }

  /** Plan seat limit: active and invited people count (spec §7 PlanGuard). */
  async assertSeat(extra = 1) {
    const org = await this.org(); const p = planOf(org.plan);
    if (!p.seats) return;
    const used = await this.prisma.membership.count({ where: { status: { not: 'Deactivated' } } });
    if (used + extra > p.seats) throw new ForbiddenException(`The ${p.name} plan includes ${p.seats} people and you have ${used}. Upgrade in Settings → Plan & billing.`);
  }

  async checkEmail(email: string) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('Enter a valid email address.');
    const org = await this.org();
    const doms = String((org.security as any).domains || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    if (doms.length && !doms.includes(email.split('@')[1])) throw new BadRequestException(`Only ${doms.join(', ')} addresses can join (Settings → Security).`);
    if (await this.prisma.membership.findFirst({ where: { email } })) throw new BadRequestException('That person is already in this organisation.');
    return org;
  }

  /** Invite by email. New people get a 7-day link to set a password; existing users are added straight away. */
  async invite(email: string, roleId: string, by: AuthUser | { id: string; name: string; email: string }, name = '') {
    const org = await this.checkEmail(email);
    await this.assertSeat();
    const local = email.split('@')[0];
    const acc = await this.prisma.account.findUnique({ where: { email } })
      ?? await this.prisma.account.create({ data: { email, name: name || local.charAt(0).toUpperCase() + local.slice(1) } });
    const existing = !!acc.passwordHash;
    const m = await this.prisma.membership.create({ data: { accountId: acc.id, email, name: name || acc.name, roleId, status: existing ? 'Active' : 'Invited' }, include: { role: true } });
    if (existing) {
      const text = `Hi ${acc.name.split(' ')[0]},\n\n${by.name} added you to ${org.name} on Business OS as ${m.role.name}. It’s in your organisation menu next time you sign in:\n${webOrigin()}/login`;
      return { ...(await this.mail.send({ to: email, subject: `${by.name} added you to ${org.name}`, text, html: htmlOf(text), replyTo: by.email, kind: 'invite', ref: email, userId: by.id })), joined: true, m };
    }
    return { ...(await this.sendInvite(m.id, by)), joined: false, m };
  }

  /** Emails a link to set a password and join. The token names the organisation. Valid for 7 days. */
  async sendInvite(membershipId: string, by: { id: string; name: string; email: string }) {
    const token = `${orgId()}.${randomBytes(24).toString('hex')}`;
    const u = await this.prisma.membership.update({ where: { id: membershipId }, data: { inviteToken: token, inviteExpiry: new Date(Date.now() + 7 * 86400_000) }, include: { role: true } });
    const org = await this.org(); const link = `${webOrigin()}/accept-invite?token=${token}`;
    const text = `Hi,\n\n${by.name} has invited you to join ${org.name} on Business OS as ${u.role.name}.\n\nSet your password and sign in here (the link works for 7 days):\n${link}\n\nIf you weren't expecting this, you can ignore this email.`;
    return this.mail.send({ to: u.email, subject: `${by.name} invited you to ${org.name}`, text, html: htmlOf(text), replyTo: by.email, kind: 'invite', ref: u.email, userId: by.id });
  }

  /** Add someone directly. A new account gets the password the admin sets; an existing user keeps their own. */
  async add(d: { email: string; name: string; title: string; roleId: string; password: string }) {
    const org = await this.checkEmail(d.email);
    await this.assertSeat();
    const acc = await this.prisma.account.findUnique({ where: { email: d.email } });
    if (!acc?.passwordHash) {
      const min = Number((org.security as any).pwd) || 12;
      if (d.password.length < min) throw new BadRequestException(`The password must be at least ${min} characters (Settings → Security).`);
    }
    const hash = acc?.passwordHash ? null : await bcrypt.hash(d.password, 10);
    const a = acc ? (hash ? await this.prisma.account.update({ where: { id: acc.id }, data: { passwordHash: hash, name: d.name } }) : acc)
      : await this.prisma.account.create({ data: { email: d.email, name: d.name, passwordHash: hash } });
    const m = await this.prisma.membership.create({ data: { accountId: a.id, email: d.email, name: d.name, title: d.title, roleId: d.roleId, status: 'Active' } });
    return { m, existing: !!acc?.passwordHash, org };
  }

  /** An admin may reset a password only for someone who belongs to this organisation alone. */
  async resetPassword(membershipId: string, password: string) {
    const m = await this.prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });
    const [{ n }] = await this.prisma.$queryRaw<{ n: number }[]>`SELECT account_org_count(${m.accountId}) AS n`;
    if (n > 1) throw new ForbiddenException(`${m.name} also belongs to another organisation, so only they can change their password.`);
    const org = await this.org(); const min = Number((org.security as any).pwd) || 12;
    if (password.length < min) throw new BadRequestException(`The password must be at least ${min} characters.`);
    await this.prisma.account.update({ where: { id: m.accountId }, data: { passwordHash: await bcrypt.hash(password, 10) } });
  }
}
