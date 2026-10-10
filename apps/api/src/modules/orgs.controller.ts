import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { DEFAULT_ROLES, formatNumber, placeOf, todayISO } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { RedisService } from '../core/redis.service';
import { SessionService } from '../core/session.service';
import { MembersService } from '../core/members.service';
import { AuditService } from '../core/audit.service';
import { COOKIE } from '../core/auth.guard';
import { Me, Perm, Public } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';
import { DEFAULT_SAC, PLANS, TRIAL_DAYS, orgDefaults, planAllows, planOf } from '../core/plans';
import { orgId, runAs } from '../core/tenant';
import { gstParty, str } from '../core/util';
import { ExportService } from './export.service';
import { Limit } from '../core/rate-limit';
import { ini, planLabel } from './auth.controller';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const RESERVED = new Set(['www', 'app', 'api', 'admin', 'login', 'signup', 'help', 'status', 'mail', 'support', 'bos']);
const CLOSE_DAYS = 30;
const PATTERNS = ['{prefix}-{fy}-{seq}', '{prefix}-{yyyy}-{seq}', '{prefix}/{yy}/{seq}'];
const prefix = (v: unknown, fallback: string) => (String(v || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 6) || fallback);
const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const REGIONS: Record<string, string> = { 'ap-south-1': 'India · Mumbai' };

/** Organisation lifecycle: sign-up, the organisation menu, plan and usage, export, closing (spec §7). */
@Controller()
export class OrgsController {
  constructor(private prisma: PrismaService, private session: SessionService, private members: MembersService, private audit: AuditService,
    private redis: RedisService, private exports: ExportService) {}

  private owner(me: AuthUser) { if (!me.builtIn) throw new ForbiddenException('Only the Owner can do that.'); }
  private org() { return this.prisma.organization.findUniqueOrThrow({ where: { id: orgId() } }); }

  @Public() @Get('signup/slug/:slug') @Limit('slug', 60, 60)
  async slugFree(@Param('slug') slug: string) {
    const s = String(slug).toLowerCase();
    return { ok: SLUG.test(s) && !RESERVED.has(s) && !(await this.prisma.organization.findUnique({ where: { slug: s } })) };
  }

  /**
   * Creates an organisation in one transaction: Owner role and membership, default roles, modules, SAC list,
   * one legal entity and its numbering series. Signed in: adds it to your organisations. Signed out: also creates your account.
   */
  @Public() @Post('signup') @Limit('signup', 5, 3600)
  async signup(@Req() req: any, @Body() b: any, @Res({ passthrough: true }) res: Response) {
    const me: AuthUser | undefined = req.user;
    const name = str(b.name, 'Organisation name', { max: 120 }).trim(); if (!name) throw new BadRequestException('Give the organisation a name.');
    const slug = str(b.slug, 'Workspace address', { max: 30 }).trim().toLowerCase();
    if (slug.length < 3) throw new BadRequestException('The address needs at least 3 characters.');
    if (!SLUG.test(slug) || RESERVED.has(slug)) throw new BadRequestException('Use letters, numbers and hyphens for the address.');
    if (await this.prisma.organization.findUnique({ where: { slug } })) throw new BadRequestException(`${slug}.bos.app is taken. Try another.`);
    const e = b.entity || {};
    const leName = str(e.name, 'Registered name', { max: 200 }).trim(); if (!leName) throw new BadRequestException('Enter the registered name.');
    const gst = e.gst !== false; const { gstin, state } = gstParty({ gstin: gst ? e.gstin : '', state: e.state }, gst); // "Not registered for GST": no GSTIN, a state instead
    const n = b.numbering || {}; const pattern = PATTERNS.includes(n.pattern) ? n.pattern : PATTERNS[0];
    const inv = prefix(n.inv, 'INV'), qt = prefix(n.qt, 'QT');
    const currency = ['INR', 'USD', 'AED', 'SGD'].includes(b.currency) ? b.currency : 'INR';
    const fyStart = b.fy === 'January' ? 'January' : 'April';
    const invites: { email: string; role: string }[] = (Array.isArray(b.invites) ? b.invites : []).map((x: any) => ({ email: String(x?.email || '').trim().toLowerCase(), role: String(x?.role || '') })).filter((x: any) => x.email);
    const bad = invites.find(x => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email)); if (bad) throw new BadRequestException(`${bad.email} isn’t a valid email address.`);

    // Who will own it
    let account: { id: string; name: string; email: string };
    if (me) account = await this.prisma.account.findUniqueOrThrow({ where: { id: me.accountId } });
    else {
      const a = b.account || {};
      const email = str(a.email, 'Your email', { max: 200 }).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('Enter your work email.');
      const you = str(a.name, 'Your name', { max: 120 }).trim(); if (!you) throw new BadRequestException('Enter your name.');
      if (String(a.password || '').length < 12) throw new BadRequestException('Use a password of at least 12 characters.');
      const ex = await this.prisma.account.findUnique({ where: { email } });
      if (ex?.passwordHash) throw new BadRequestException('That email already has a Business OS account. Sign in, then create the organisation from the organisation menu.');
      account = ex ? await this.prisma.account.update({ where: { id: ex.id }, data: { name: you, passwordHash: await bcrypt.hash(String(a.password), 10) } })
        : await this.prisma.account.create({ data: { email, name: you, passwordHash: await bcrypt.hash(String(a.password), 10) } });
    }

    const id = 'org_' + randomBytes(6).toString('hex');
    const made = await runAs({ orgId: id, accountId: account.id }, () => this.prisma.$transaction(async tx => {
      await tx.organization.create({ data: { id, slug, name, plan: 'trial', trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400_000), setupDone: false, currency, fyStart, ...orgDefaults(name) } });
      const roles: Record<string, string> = {};
      for (const [i, r] of DEFAULT_ROLES.entries()) roles[r.name] = (await tx.role.create({ data: { name: r.name, desc: r.desc, builtIn: !!r.builtIn, perms: r.perms, sort: i } })).id;
      const owner = await tx.membership.create({ data: { accountId: account.id, email: account.email, name: account.name, roleId: roles.Owner, status: 'Active', calendar: false, joinedAt: new Date() } });
      const le = await tx.legalEntity.create({ data: { name: leName, gst, gstin, state, pan: gstin ? gstin.slice(2, 12) : '', cin: '', address: str(e.address, 'Address', { max: 500 }).trim(), bank: '', upi: '', isDefault: true } });
      const ser = (type: string, label: string, p: string, entityId: string | null, pat = pattern) =>
        tx.series.create({ data: { type, label, prefix: p, pattern: pat, padding: 4, next: 1, reset: pat.includes('{seq}') && pat !== '{prefix}-{seq}' ? 'every financial year' : 'never', entityId } });
      await ser('INVOICE', 'Invoices', inv, le.id); await ser('CREDIT_NOTE', 'Credit notes', 'CN', le.id); await ser('RECEIPT', 'Receipts', 'RCP', le.id);
      await ser('QUOTATION', 'Quotations', qt, null); await ser('PROJECT', 'Projects', 'PRJ', null, '{prefix}-{seq}');
      await tx.sac.createMany({ data: DEFAULT_SAC });
      await tx.auditLog.create({ data: { userId: owner.id, who: account.name, text: `Created ${name}`, icon: 'icon-building', area: 'settings' } });
      return { owner, roles };
    }));

    // Invitations go out after the organisation exists; failures don't undo it.
    let invited = 0;
    await runAs({ orgId: id, membershipId: made.owner.id, accountId: account.id }, async () => {
      for (const x of invites) {
        const roleId = made.roles[x.role] && x.role !== 'Owner' ? made.roles[x.role] : made.roles['Field staff'];
        try { await this.members.invite(x.email, roleId, { id: made.owner.id, name: account.name, email: account.email }); invited++; } catch { /* reported as not invited */ }
      }
    });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id } });
    // The new organisation's policy may ask the Owner for two-factor (on by default); a signed-in creator keeps theirs.
    const acc = await this.prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    const challenge = await this.session.enter(res, acc, { id: made.owner.id, role: { name: 'Owner' } }, org, !!me?.otp);
    return { ok: true, id, slug, invited, message: `${name} is ready. You’re its Owner.`, ...(challenge || {}) };
  }

  /** Organisations the signed-in account belongs to (for the switcher). */
  @Get('orgs')
  async list(@Me() me: AuthUser) {
    const list = await this.session.memberships(me.accountId);
    return list.map(({ m, org: o }) => ({ id: o.id, name: o.name, ini: ini(o.name), slug: o.slug, role: m.role.name, sub: planLabel(o), current: o.id === me.orgId }));
  }

  /** The Get started checklist for a new organisation. */
  @Get('orgs/current/setup')
  async setup(@Me() me: AuthUser) {
    const org = await this.org();
    const [entity, people, invited, customers, catalog, mine, series] = await Promise.all([
      this.prisma.legalEntity.findFirst({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
      this.prisma.membership.count({ where: { status: 'Active' } }), this.prisma.membership.count({ where: { status: 'Invited' } }),
      this.prisma.customer.count(), this.prisma.catalogItem.count(), this.prisma.membership.findUnique({ where: { id: me.id } }),
      this.prisma.series.findFirst({ where: { type: 'INVOICE' }, orderBy: { next: 'asc' } }),
    ]);
    const team = people + invited - 1;
    return {
      setupDone: org.setupDone, name: org.name,
      steps: { org: true, entity: !!entity, numbering: !!series, team: team > 0, customer: customers > 0, catalog: catalog > 0, calendar: !!mine?.calendar },
      detail: { currency: org.currency, fy: org.fyStart, tz: org.tz, entity: entity ? `${entity.name} · ${entity.gst ? `GSTIN ${entity.gstin}` : 'Not registered for GST'}` : '', invited: team,
        firstInvoice: series ? formatNumber(series, todayISO(org.tz), org.fyStart) : '' },
      facts: [['Address', `${org.slug}.bos.app`], ['Plan', planLabel(org)], ['Your role', me.roleName], ['Data region', REGIONS[org.region] || org.region],
        ['Issuing entity', entity ? `${entity.name} · ${placeOf(entity) || ''}` : '—']].map(([label, value]) => ({ label, value })),
    };
  }

  @Patch('orgs/current/setup') @Perm('settings.manage')
  async finishSetup(@Me() me: AuthUser, @Body() b: any) {
    await this.prisma.organization.update({ where: { id: orgId() }, data: { setupDone: b.done !== false } });
    return { ok: true, message: b.done !== false ? 'All set. Switch modules on in Settings when you need them.' : 'Get started is back on your menu.' };
  }

  /** Seats, entities, documents this month, storage, assistant requests (spec §7). */
  @Get('orgs/current/usage')
  async usage() {
    const org = await this.org(); const p = planOf(org.plan);
    const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
    const month = since.toISOString().slice(0, 7);
    const [seats, entities, quotes, invoices, credits, exp, ai] = await Promise.all([
      this.prisma.membership.count({ where: { status: { not: 'Deactivated' } } }), this.prisma.legalEntity.count(),
      this.prisma.quote.count({ where: { createdAt: { gte: since } } }), this.prisma.invoice.count({ where: { createdAt: { gte: since } } }),
      this.prisma.creditNote.count({ where: { date: { gte: since } } }), this.prisma.dataExport.aggregate({ _sum: { size: true }, where: { status: 'Ready' } }),
      this.redis.getJSON<number>(`bos:${orgId()}:ai:${month}`),
    ]);
    return { seats, seatLimit: p.seats, entities, entityLimit: p.entities, documents: quotes + invoices + credits, storageBytes: exp._sum.size || 0, aiRequests: ai || 0, month };
  }

  @Get('orgs/current/plan')
  async plan() {
    const org = await this.org(); const u = await this.usage();
    return {
      plan: org.plan, label: planLabel(org), trialEndsAt: org.trialEndsAt, billingEmail: org.billingEmail, billEntityId: org.billEntityId,
      plans: Object.entries(PLANS).map(([id, p]) => ({ id, ...p, modules: undefined, current: id === org.plan || (org.plan === 'trial' && false),
        fits: !p.seats || (u.seats <= p.seats && u.entities <= p.entities) })),
      usage: u, invoices: [] as unknown[],
    };
  }

  /** Change plan (Owner). No payment provider is connected yet, so this records the choice and applies its limits. */
  @Patch('orgs/current/plan')
  async setPlan(@Me() me: AuthUser, @Body() b: any) {
    this.owner(me);
    const plan = String(b.plan || ''); const p = PLANS[plan]; if (!p) throw new BadRequestException('Unknown plan');
    if (plan === 'enterprise') return { ok: true, message: 'Thanks. We’ll be in touch within a working day.' };
    const u = await this.usage();
    if (p.seats && (u.seats > p.seats || u.entities > p.entities)) throw new BadRequestException(`${p.name} allows ${p.seats} people and ${p.entities} ${p.entities === 1 ? 'entity' : 'entities'}. You have ${u.seats} and ${u.entities}.`);
    const org = await this.org();
    // Modules the new plan doesn't include are switched off.
    const modules = Object.fromEntries(Object.entries(org.modules as Record<string, boolean>).map(([k, v]) => [k, v && planAllows(plan, k)]));
    await this.prisma.organization.update({ where: { id: org.id }, data: { plan, modules, trialEndsAt: null } });
    await this.redis.del(`bos:${org.id}:modules`);
    await this.audit.log(me, `Changed plan to ${p.name}`, 'icon-credit-card');
    return { ok: true, message: `Plan changed to ${p.name}.` };
  }

  @Patch('orgs/current/billing') @Perm('settings.manage')
  async billing(@Me() me: AuthUser, @Body() b: any) {
    const data: Record<string, unknown> = {};
    if (b.billEntityId !== undefined) { if (!(await this.prisma.legalEntity.findUnique({ where: { id: String(b.billEntityId) } }))) throw new BadRequestException('Unknown entity'); data.billEntityId = String(b.billEntityId); }
    if (b.billingEmail !== undefined) { const e = String(b.billingEmail).trim(); if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new BadRequestException('Enter a valid billing email.'); data.billingEmail = e; }
    await this.prisma.organization.update({ where: { id: orgId() }, data });
    return { ok: true, message: data.billEntityId ? 'Future subscription invoices will carry this GSTIN.' : 'Billing email saved.' };
  }

  /** Where the data lives, and past exports. */
  @Get('orgs/current/data')
  async data() {
    const org = await this.org();
    const rows = await this.prisma.dataExport.findMany({ orderBy: { createdAt: 'desc' }, take: 10 });
    const who = await this.prisma.membership.findMany({ where: { id: { in: rows.map(r => r.requestedById) } } });
    return {
      facts: [['Workspace address', `${org.slug}.bos.app`], ['Organisation ID', org.id], ['Data region', REGIONS[org.region] || org.region], ['Created', fmtDate(org.createdAt)]].map(([label, value]) => ({ label, value })),
      exports: rows.map(r => ({ id: r.id, who: who.find(w => w.id === r.requestedById)?.name || 'Someone', when: r.createdAt.toISOString(), status: r.expiresAt < new Date() && r.status === 'Ready' ? 'Expired' : r.status,
        url: r.status === 'Ready' && r.expiresAt > new Date() ? this.exports.signedUrl(org.id, r.id, r.expiresAt) : null })),
      closeDays: CLOSE_DAYS,
    };
  }

  @Post('orgs/current/export') @Perm('settings.manage') @Limit('export', 5, 3600, 'org')
  async export(@Me() me: AuthUser) {
    const x = await this.exports.start(me);
    await this.audit.log(me, 'Requested a full data export', 'icon-download', 'access');
    return { ok: true, id: x.id, message: 'Export started. We’ll email you a download link.' };
  }

  /** Signed, expiring download link (no session needed: it's emailed). */
  @Public() @Get('exports/:org/:id') @Limit('download', 30, 600)
  async download(@Param('org') org: string, @Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    const file = await this.exports.open(org, id, Number(exp), String(sig || ''));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    file.stream.pipe(res);
  }

  /** Close the organisation (Owner, name confirmation). Everyone loses access now; data is deleted after 30 days. */
  @Delete('orgs/current') @HttpCode(200)
  async close(@Me() me: AuthUser, @Body() b: any, @Res({ passthrough: true }) res: Response) {
    this.owner(me);
    const org = await this.org();
    if (String(b?.confirm || '').trim() !== org.name) throw new BadRequestException(`Type ${org.name} to confirm.`);
    await this.audit.log(me, `Closed ${org.name}. Data will be deleted after ${CLOSE_DAYS} days.`, 'icon-trash-2', 'access');
    await this.prisma.organization.update({ where: { id: org.id }, data: { status: 'closed', closedAt: new Date() } });
    res.clearCookie(COOKIE, { path: '/' });
    return { ok: true, message: `${org.name} is closed. Its data will be deleted on ${fmtDate(new Date(Date.now() + CLOSE_DAYS * 86400_000))}.` };
  }
}

