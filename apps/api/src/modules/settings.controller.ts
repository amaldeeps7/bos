import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ALL_PERMS, MODULES, PERM_GROUPS, UNISSUED, formatNumber, placeOf, relTime } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { AccessService } from '../core/access.service';
import { AuditService } from '../core/audit.service';
import { OrgService } from '../core/org.service';
import { Me, Perm } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';
import { gstParty, num, oneOf, str } from '../core/util';
import { MailService, fill, htmlOf } from '../core/mail.service';
import { orgId, Scope } from '../core/tenant';
import { MembersService } from '../core/members.service';
import { FinanceService } from './finance.service';
import { Limit } from '../core/rate-limit';
import { planAllows, planOf } from '../core/plans';

/** Stored scope → the Access to select's value: all | le:<id> | bu:<id>. */
const scopeKey = (s: unknown, owner: boolean) => {
  const v = (s || {}) as { entityIds?: string[]; unitIds?: string[] };
  return owner ? 'all' : v.entityIds?.[0] ? `le:${v.entityIds[0]}` : v.unitIds?.[0] ? `bu:${v.unitIds[0]}` : 'all';
};

const anyAdmin = (me: AuthUser) => {
  if (!['settings.manage', 'role.manage', 'role.read', 'user.read'].some(p => AccessService.has(me, p))) throw new ForbiddenException('You can’t open settings');
};
const lastActive = (x: Date | null) => (!x ? '—' : Date.now() - x.getTime() < 10 * 60e3 ? 'Now' : relTime(x).replace(/ (hour|hours) ago/, h => h).replace(/^(\d+) min ago$/, '$1 min ago'));

@Controller('settings')
export class SettingsController {
  constructor(private prisma: PrismaService, private access: AccessService, private audit: AuditService, private orgs: OrgService, private mail: MailService, private members: MembersService, private fin: FinanceService) {}

  private async org() { return this.prisma.organization.findUniqueOrThrow({ where: { id: orgId() } }); }
  private async patchJson(field: 'security' | 'policy' | 'taxOpts' | 'reminders' | 'templates' | 'modules', patch: Record<string, unknown>) {
    const org = await this.org();
    const next = { ...(org[field] as Record<string, unknown>), ...patch };
    await this.prisma.organization.update({ where: { id: orgId() }, data: { [field]: next } });
    return next;
  }

  @Get()
  async all(@Me() me: AuthUser) {
    anyAdmin(me);
    const { today } = await this.orgs.ctx();
    const [org, entities, units, users, roles, series, sac, catalog, projects] = await Promise.all([
      this.org(), this.prisma.legalEntity.findMany({ orderBy: { name: 'asc' } }), this.prisma.businessUnit.findMany({ include: { entity: true, head: true } }),
      this.prisma.membership.findMany({ include: { role: true, account: { select: { mfaSecret: true } } }, orderBy: { createdAt: 'asc' } }), this.prisma.role.findMany({ orderBy: { sort: 'asc' } }),
      this.prisma.series.findMany(), this.prisma.sac.findMany({ orderBy: { code: 'asc' } }), this.prisma.catalogItem.findMany(), this.prisma.project.findMany({ select: { unitId: true } }),
    ]);
    const entityOrder = (id: string | null) => (id ? entities.findIndex(e => e.id === id) : -1);
    return {
      org: { name: org.name, slug: org.slug, currency: org.currency, tz: org.tz, country: org.country, fy: org.fyStart, dateFmt: org.dateFmt, createdAt: org.createdAt.toISOString(), status: 'Active' },
      modules: MODULES.map(m => ({ ...m, on: (org.modules as any)[m.id] !== false })),
      security: org.security, policy: org.policy, taxOpts: org.taxOpts, reminders: org.reminders, templates: org.templates,
      entities: entities.map(e => ({ ...e, stateCode: e.state, state: placeOf(e) || 'Unrecognised code' })),
      units: units.map(u => ({ id: u.id, name: u.name, code: u.code, entity: u.entity.name, entityId: u.entityId, headId: u.headId, head: u.head?.name || 'Not set', projects: projects.filter(p => p.unitId === u.id).length })),
      users: users.map(u => ({ id: u.id, name: u.name, email: u.email, title: u.title, role: u.role.name, mfa: !!u.account.mfaSecret, scope: scopeKey(u.scope, u.role.builtIn), status: u.status, last: u.status === 'Invited' ? '—' : lastActive(u.lastActiveAt) })),
      roles: roles.map(r => ({ id: r.id, name: r.name, desc: r.desc, builtIn: r.builtIn, perms: r.builtIn ? ALL_PERMS : r.perms })),
      // One row per type and issuing entity, in the design's order.
      series: ['INVOICE', 'QUOTATION', 'CREDIT_NOTE', 'RECEIPT', 'PROJECT'].flatMap(t => series.filter(s => s.type === t).sort((a, b) => entityOrder(a.entityId) - entityOrder(b.entityId)))
        .map(s => { const e = entities.find(x => x.id === s.entityId); return { ...s, entity: e ? `${e.name} · ${e.gst ? `GSTIN ${e.gstin.slice(0, 2)}` : placeOf(e)}` : 'All entities', sample: formatNumber(s, today, org.fyStart) }; }),
      sac: sac.map(x => ({ ...x, used: catalog.filter(c => c.sac === x.code).length })),
    };
  }

  // organisation
  @Patch('org') @Perm('organization.update')
  async org_(@Me() me: AuthUser, @Body() b: any) {
    const data: any = {};
    if (b.name !== undefined) { data.name = str(b.name, 'Name', { max: 120 }).trim(); if (!data.name) throw new BadRequestException('Name the organisation'); }
    if (b.currency !== undefined) data.currency = oneOf(b.currency, 'Currency', ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD']);
    if (b.tz !== undefined) data.tz = oneOf(b.tz, 'Time zone', ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC']);
    if (b.country !== undefined) { data.country = str(b.country, 'Country', { max: 2 }).toUpperCase(); if (!/^[A-Z]{2}$/.test(data.country)) throw new BadRequestException('Use a two-letter country code'); }
    if (b.fy !== undefined) data.fyStart = oneOf(b.fy, 'Financial year', ['April', 'January']);
    if (b.dateFmt !== undefined) data.dateFmt = oneOf(b.dateFmt, 'Date format', ['8 Oct 2026', '08/10/2026', '2026-10-08']);
    await this.prisma.organization.update({ where: { id: orgId() }, data });
    await this.audit.log(me, 'Updated organisation details');
    return { message: 'Organisation saved. New records use these defaults.' };
  }

  // legal entities & units
  @Patch('entities/:id') @Perm('settings.manage')
  async entity(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const data: any = {};
    for (const f of ['name', 'address', 'bank', 'upi', 'cin'] as const) if (b[f] !== undefined) data[f] = str(b[f], f, { max: 300 }).trim();
    const cur = await this.prisma.legalEntity.findUniqueOrThrow({ where: { id } });
    if (b.gst !== undefined || b.gstin !== undefined || b.state !== undefined) {
      const gst = b.gst === undefined ? cur.gst : !!b.gst;
      const g = gstParty({ gstin: gst ? b.gstin ?? cur.gstin : '', state: b.state ?? cur.state }, gst);
      if (g.gstin && await this.prisma.legalEntity.findFirst({ where: { gstin: g.gstin, id: { not: id } } })) throw new BadRequestException('An entity with this GSTIN already exists.');
      Object.assign(data, { gst, gstin: g.gstin, state: g.state });
    }
    if (b.pan !== undefined) { data.pan = String(b.pan).toUpperCase().trim(); if (data.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(data.pan)) throw new BadRequestException('Enter a valid 10-character PAN.'); }
    const e = await this.prisma.$transaction(async tx => {
      const e = await tx.legalEntity.update({ where: { id }, data });
      // Documents not yet issued follow the entity; issued ones keep what they were issued with.
      if (e.gst !== cur.gst) {
        await tx.quote.updateMany({ where: { entityId: id, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] } }, data: { gst: e.gst } });
        await tx.invoice.updateMany({ where: { entityId: id, status: { in: UNISSUED } }, data: { gst: e.gst } });
      }
      return e;
    });
    await this.audit.log(me, e.gst !== cur.gst ? `Turned GST ${e.gst ? 'on' : 'off'} for ${e.name}` : `Updated legal entity ${e.name}`, 'icon-landmark');
    if (e.gst !== cur.gst) return { message: e.gst ? `GST is on for ${e.name}. Drafts now charge GST; issued documents are unchanged.` : `GST is off for ${e.name}. New quotations and invoices carry no tax; issued documents are unchanged.` };
    return { message: `${e.name} saved. Issued documents keep the details they were issued with.` };
  }

  /** Another GSTIN = another entity, with its own invoice, credit note and receipt series. Limited by plan. */
  @Post('entities') @Perm('settings.manage')
  async addEntity(@Me() me: AuthUser, @Body() b: any) {
    const org = await this.org(); const p = planOf(org.plan);
    const count = await this.prisma.legalEntity.count();
    if (p.entities && count >= p.entities) throw new ForbiddenException(`The ${p.name} plan includes ${p.entities} legal ${p.entities === 1 ? 'entity' : 'entities'}. Upgrade in Settings → Plan & billing.`);
    const name = str(b.name, 'Registered name', { max: 200 }).trim(); if (!name) throw new BadRequestException('Enter the registered name.');
    const gst = b.gst !== false; const { gstin, state } = gstParty({ gstin: gst ? b.gstin : '', state: b.state }, gst);
    if (gstin && await this.prisma.legalEntity.findFirst({ where: { gstin } })) throw new BadRequestException('An entity with this GSTIN already exists.');
    const pan = gstin ? gstin.slice(2, 12) : str(b.pan, 'PAN', { max: 10 }).trim().toUpperCase();
    if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw new BadRequestException('Enter a valid 10-character PAN.');
    const e = await this.prisma.legalEntity.create({ data: { name, gst, gstin, state, pan, cin: str(b.cin, 'CIN', { max: 30 }).trim(), address: str(b.address, 'Address', { max: 500 }).trim(),
      bank: str(b.bank, 'Bank', { max: 300 }).trim(), upi: str(b.upi, 'UPI', { max: 100 }).trim(), isDefault: count === 0 } });
    await this.audit.log(me, `Added legal entity ${name}${gstin ? ` (${gstin})` : ' (not registered for GST)'}`, 'icon-landmark');
    return { id: e.id, message: `${name} added. Its invoice, credit note and receipt numbers start at 1.` };
  }

  @Post('entities/:id/default') @HttpCode(200) @Perm('settings.manage')
  async makeDefault(@Me() me: AuthUser, @Param('id') id: string) {
    const e = await this.prisma.legalEntity.findUniqueOrThrow({ where: { id } });
    await this.prisma.$transaction(async tx => { await tx.legalEntity.updateMany({ data: { isDefault: false } }); await tx.legalEntity.update({ where: { id }, data: { isDefault: true } }); });
    await this.audit.log(me, `Made ${e.name} the default issuing entity`, 'icon-landmark');
    return { message: `${e.name} now issues new documents.` };
  }

  @Post('units') @Perm('settings.manage')
  async unit(@Me() me: AuthUser, @Body() b: any) {
    const name = str(b.name, 'Name', { max: 80 }).trim(); if (!name) throw new BadRequestException('Name the unit first.');
    if (await this.prisma.businessUnit.findFirst({ where: { name } })) throw new BadRequestException('A unit with that name exists');
    const e = (b.entityId && await this.prisma.legalEntity.findUnique({ where: { id: String(b.entityId) } })) || (await this.prisma.legalEntity.findFirst({ where: { isDefault: true } })) || (await this.prisma.legalEntity.findFirstOrThrow());
    await this.prisma.businessUnit.create({ data: { name, code: (str(b.code, 'Code', { max: 4 }).toUpperCase() || name.slice(0, 2).toUpperCase()), entityId: e.id } });
    await this.audit.log(me, `Added business unit ${name}`, 'icon-network');
    return { message: `${name} added. Its numbering starts with the first document it issues.` };
  }

  @Patch('units/:id') @Perm('settings.manage')
  async editUnit(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const u = await this.prisma.businessUnit.findUniqueOrThrow({ where: { id } }); const data: any = {};
    if (b.name !== undefined) { data.name = str(b.name, 'Name', { max: 80 }).trim(); if (!data.name) throw new BadRequestException('Name the unit.'); }
    if (b.code !== undefined) data.code = str(b.code, 'Code', { max: 4 }).toUpperCase();
    if (b.headId !== undefined) data.headId = b.headId || null;
    if (b.entityId !== undefined) data.entityId = String(b.entityId);
    await this.prisma.businessUnit.update({ where: { id }, data });
    await this.audit.log(me, `Updated business unit ${data.name || u.name}`, 'icon-network');
    return { message: `${data.name || u.name} saved.` };
  }

  @Delete('units/:id') @Perm('settings.manage')
  async deleteUnit(@Me() me: AuthUser, @Param('id') id: string) {
    const u = await this.prisma.businessUnit.findUniqueOrThrow({ where: { id } });
    if (await this.prisma.project.count({ where: { unitId: u.id } })) throw new BadRequestException('Move its projects to another unit first.');
    await this.prisma.businessUnit.delete({ where: { id } });
    await this.audit.log(me, `Removed business unit ${u.name}`, 'icon-trash-2');
    return { message: `${u.name} removed.` };
  }

  // modules
  @Patch('modules/:id') @Perm('settings.manage')
  async module(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const m = MODULES.find(x => x.id === id); if (!m) throw new NotFoundException();
    if (b.on) { const org = await this.org(); if (!planAllows(org.plan, id)) throw new ForbiddenException(`${m.name} isn’t in the ${planOf(org.plan).name} plan. Upgrade in Settings → Plan & billing.`); }
    await this.patchJson('modules', { [id]: !!b.on });
    await this.access.invalidateModules();
    await this.audit.log(me, `${b.on ? 'Switched on' : 'Switched off'} the ${m.name} module`, 'icon-blocks');
    return { message: `${m.name} ${b.on ? 'switched on' : 'switched off for everyone'}.` };
  }

  // users
  @Patch('users/:id') @Perm('user.manage')
  async userUpdate(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const before = await this.prisma.membership.findUniqueOrThrow({ where: { id } });
    const data: any = {}; const msgs: string[] = [];
    if (b.role !== undefined) {
      const role = await this.prisma.role.findFirst({ where: { name: str(b.role, 'Role', { required: true }) } }); if (!role) throw new BadRequestException('Unknown role');
      if (id === me.id && role.id !== me.roleId) throw new BadRequestException('You can’t change your own role');
      if (role.id !== before.roleId) { data.roleId = role.id; msgs.push(`${before.name.split(' ')[0]} is now ${role.name}.`); await this.audit.log(me, `Changed ${before.name} to ${role.name}`, 'icon-user-cog', 'access'); }
    }
    if (b.name !== undefined) { data.name = str(b.name, 'Name', { max: 120 }).trim(); if (!data.name) throw new BadRequestException('Enter a name.'); }
    if (b.title !== undefined) data.title = str(b.title, 'Job title', { max: 120 }).trim();
    if (b.scope !== undefined) {
      const role = await this.prisma.role.findUniqueOrThrow({ where: { id: data.roleId || before.roleId } });
      if (role.builtIn) throw new BadRequestException('The Owner always sees every entity and unit.');
      data.scope = await this.scopeOf(String(b.scope));
      const label = await this.scopeLabel(String(b.scope));
      msgs.push(b.scope === 'all' ? `${before.name.split(' ')[0]} sees records from every entity.` : `${before.name.split(' ')[0]} now sees only ${label} records.`);
      await this.audit.log(me, b.scope === 'all' ? `Gave ${before.name} access to every entity` : `Limited ${before.name} to ${label}`, 'icon-user-cog', 'access');
    }
    if (b.password) {
      await this.members.resetPassword(id, String(b.password)); msgs.push('Password reset.');
      await this.audit.log(me, `Reset the password for ${before.name}`, 'icon-key-round', 'access');
    }
    await this.prisma.membership.update({ where: { id }, data });
    if (data.name) await this.syncAccountName(before.accountId, data.name);
    if (data.name || data.title !== undefined) await this.audit.log(me, `Updated ${data.name || before.name}'s details`, 'icon-user-cog', 'access');
    return { message: msgs.join(' ') || `${data.name || before.name} saved.` };
  }

  /** Someone lost their phone: turn their two-factor off so they can sign in and set it up again.
      Only for accounts that belong to this organisation alone, so one organisation can't weaken another's sign-in. */
  @Post('users/:id/reset-mfa') @HttpCode(200) @Perm('user.manage')
  async resetMfa(@Me() me: AuthUser, @Param('id') id: string) {
    if (id === me.id) throw new BadRequestException('Turn your own two-factor off from your profile.');
    const u = await this.prisma.membership.findUniqueOrThrow({ where: { id }, include: { account: true } });
    if (!u.account.mfaSecret) throw new BadRequestException(`${u.name} doesn’t have two-factor on.`);
    const [{ n }] = await this.prisma.$queryRaw<{ n: number }[]>`SELECT account_org_count(${u.accountId}) AS n`;
    if (Number(n) > 1) throw new BadRequestException(`${u.name} also uses Business OS with another organisation, so only they can reset it (with a backup code).`);
    await this.prisma.account.update({ where: { id: u.accountId }, data: { mfaSecret: null, mfaBackup: [], mfaStep: 0 } });
    await this.audit.log(me, `Reset two-factor sign-in for ${u.name}`, 'icon-shield-off', 'access');
    return { message: `${u.name} can sign in with their password and will be asked to set two-factor up again.` };
  }

  @Post('users/:id/toggle') @HttpCode(200) @Perm('user.read')
  async userToggle(@Me() me: AuthUser, @Param('id') id: string) {
    if (id === me.id) throw new BadRequestException('You can’t deactivate yourself');
    const u = await this.prisma.membership.findUniqueOrThrow({ where: { id } });
    if (u.status === 'Invited') {
      AccessService.require(me, 'user.invite'); const r = await this.members.sendInvite(u.id, me);
      await this.audit.log(me, `Resent the invitation to ${u.email}`, 'icon-user-plus', 'access');
      return { message: r.ok ? `Invitation resent to ${u.email}.` : `Invitation not sent: ${r.error}` };
    }
    AccessService.require(me, 'user.manage');
    const status = u.status === 'Active' ? 'Deactivated' : 'Active';
    await this.prisma.membership.update({ where: { id }, data: { status } });
    await this.audit.log(me, `${status === 'Active' ? 'Reactivated' : 'Deactivated'} ${u.name}`, 'icon-user-x', 'access');
    const moved = status === 'Deactivated' ? await this.fin.reassignApprovals(u.id, u.name) : 0;
    if (moved) return { message: `${u.name} is signed out everywhere. Their records stay, and ${moved} approval${moved > 1 ? 's' : ''} waiting on them moved to someone else.` };
    return { message: status === 'Active' ? `${u.name} can sign in again.` : `${u.name} is signed out everywhere. Their records stay.` };
  }

  private webOrigin() { return (process.env.WEB_ORIGIN || 'http://localhost:3000').split(',')[0].replace(/\/$/, ''); }

  /** "all" | "le:<entityId>" | "bu:<unitId>" → stored scope. */
  private async scopeOf(v: string): Promise<Scope> {
    if (v === 'all') return { all: true };
    const [k, id] = v.split(':');
    if (k === 'le' && await this.prisma.legalEntity.findUnique({ where: { id } })) return { entityIds: [id] };
    if (k === 'bu' && await this.prisma.businessUnit.findUnique({ where: { id } })) return { unitIds: [id] };
    throw new BadRequestException('Unknown entity or unit');
  }
  private async scopeLabel(v: string) {
    const [k, id] = v.split(':');
    if (k === 'le') return (await this.prisma.legalEntity.findUnique({ where: { id } }))?.name || 'that entity';
    if (k === 'bu') return `${(await this.prisma.businessUnit.findUnique({ where: { id } }))?.name || 'that'} unit`;
    return 'every entity';
  }
  /** Names live on the Account; this organisation's copy follows. Other organisations update on next sign-in. */
  private async syncAccountName(accountId: string, name: string) {
    const [{ n }] = await this.prisma.$queryRaw<{ n: number }[]>`SELECT account_org_count(${accountId}) AS n`;
    if (n <= 1) await this.prisma.account.update({ where: { id: accountId }, data: { name } });
  }

  @Post('users/invite') @Perm('user.invite') @Limit('invite', 50, 3600, 'org')
  async invite(@Me() me: AuthUser, @Body() b: any) {
    const email = str(b.email, 'Email', { max: 200 }).trim().toLowerCase();
    const role = await this.prisma.role.findFirst({ where: { name: str(b.role, 'Role', { required: true }) } }); if (!role) throw new BadRequestException('Unknown role');
    if (role.builtIn) throw new BadRequestException('There is one Owner. Invite them with another role.');
    const r = await this.members.invite(email, role.id, me, str(b.name, 'Name', { max: 120 }).trim());
    await this.audit.log(me, `${r.joined ? 'Added' : 'Invited'} ${email} as ${role.name}`, 'icon-user-plus', 'access');
    if (r.joined) return { message: `${email} already uses Business OS, so they’ve been added. This organisation is now in their organisation menu.` };
    return { message: r.ok ? `Invitation emailed to ${email}.` : `${email} added as invited, but the email wasn’t sent: ${r.error}` };
  }
  /** Adds someone directly with a password the admin sets; they can sign in straight away. */
  @Post('users') @Perm('user.manage') @Limit('invite', 50, 3600, 'org')
  async addUser(@Me() me: AuthUser, @Body() b: any) {
    const email = str(b.email, 'Email', { max: 200 }).trim().toLowerCase();
    const name = str(b.name, 'Name', { max: 120 }).trim(); if (!name) throw new BadRequestException('Enter their name.');
    const role = await this.prisma.role.findFirst({ where: { name: str(b.role, 'Role', { required: true }) } }); if (!role) throw new BadRequestException('Unknown role');
    if (role.builtIn) throw new BadRequestException('There is one Owner. Add them with another role.');
    const { existing, org } = await this.members.add({ email, name, title: str(b.title, 'Job title', { max: 120 }).trim(), roleId: role.id, password: String(b.password || '') });
    await this.audit.log(me, `Added ${name} (${email}) as ${role.name}`, 'icon-user-plus', 'access');
    if (existing) return { message: `${name} already uses Business OS, so they sign in with their own password. ${org.name} is now in their organisation menu.` };
    let note = '';
    if (b.welcome) {
      const text = `Hi ${name.split(' ')[0]},\n\n${me.name} has set up your ${org.name} account on Business OS as ${role.name}.\n\nSign in at ${this.webOrigin()}/login with ${email}. ${me.name.split(' ')[0]} will give you your first password.`;
      const r = await this.mail.send({ to: email, subject: `Your ${org.name} account is ready`, text, html: htmlOf(text), replyTo: me.email, kind: 'welcome', ref: email, userId: me.id });
      note = r.ok ? ' Welcome email sent.' : ` The welcome email wasn’t sent: ${r.error}`;
    }
    return { message: `${name} added. They can sign in now.${note}` };
  }

  // roles & permissions
  @Post('roles') @Perm('role.manage')
  async createRole(@Me() me: AuthUser, @Body() b: any) {
    const name = str(b.name, 'Role name', { max: 60 }).trim(); if (!name) throw new BadRequestException('Name the role.');
    if (await this.prisma.role.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })) throw new BadRequestException('A role with that name already exists.');
    const from = await this.prisma.role.findFirst({ where: { name: str(b.from, 'Start from', { required: true }) } }); if (!from) throw new BadRequestException('Unknown role');
    await this.prisma.role.create({ data: { name, desc: `Custom role, started from ${from.name}.`, perms: from.builtIn ? ALL_PERMS : from.perms, sort: 100 } });
    await this.audit.log(me, `Created role ${name} from ${from.name}`, 'icon-key-round', 'access');
    return { message: `${name} created. Adjust its permissions below.` };
  }

  /** Grants or removes permissions. `perms` is one key or a whole module group. Owner can't be narrowed. */
  @Patch('roles/:id/perms') @Perm('role.manage')
  async setPerms(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const r = await this.prisma.role.findUniqueOrThrow({ where: { id } });
    if (r.builtIn) throw new BadRequestException('Owner is built in and always holds every permission.');
    const keys: string[] = (Array.isArray(b.perms) ? b.perms : [b.perms]).map(String);
    if (!keys.length || keys.some(k => !ALL_PERMS.includes(k))) throw new BadRequestException('Unknown permission');
    const set = new Set(r.perms); keys.forEach(k => (b.on ? set.add(k) : set.delete(k)));
    if (r.id === me.roleId && !b.on && keys.includes('role.manage')) throw new BadRequestException('You can’t remove role management from your own role');
    await this.prisma.role.update({ where: { id }, data: { perms: ALL_PERMS.filter(k => set.has(k)) } });
    await this.access.invalidateRole(id);
    const g = keys.length > 1 ? PERM_GROUPS.find(x => x.perms.length === keys.length && x.perms.every(([k]) => keys.includes(k))) : null;
    await this.audit.log(me, g ? `${b.on ? 'Granted every' : 'Removed every'} ${g.name} permission ${b.on ? 'to' : 'from'} ${r.name}` : `${b.on ? 'Granted' : 'Removed'} ${keys[0]} ${b.on ? 'to' : 'from'} ${r.name}`, 'icon-key-round', 'access');
    return { ok: true };
  }

  @Delete('roles/:id') @Perm('role.manage')
  async deleteRole(@Me() me: AuthUser, @Param('id') id: string) {
    const r = await this.prisma.role.findUniqueOrThrow({ where: { id }, include: { users: true } });
    if (r.builtIn) throw new BadRequestException('Owner can’t be deleted');
    if (r.users.length) throw new BadRequestException('Move everyone off this role first');
    await this.prisma.role.delete({ where: { id } });
    await this.audit.log(me, `Deleted role ${r.name}`, 'icon-trash-2', 'access');
    return { message: `${r.name} deleted.` };
  }

  // security, policy, tax, reminders, templates
  @Patch('security') @Perm('settings.manage')
  async security(@Me() me: AuthUser, @Body() b: any) {
    const patch: any = {};
    for (const k of ['mfaAll', 'mfaFin', 'ssoGoogle', 'newDevice'] as const) if (b[k] !== undefined) patch[k] = !!b[k];
    if (b.timeout !== undefined) patch.timeout = oneOf(b.timeout, 'Timeout', ['30 minutes', '8 hours', '7 days', '30 days']);
    if (b.pwd !== undefined) patch.pwd = oneOf(String(b.pwd), 'Password length', ['10', '12', '16']);
    if (b.domains !== undefined) patch.domains = str(b.domains, 'Domains', { max: 500 });
    await this.patchJson('security', patch);
    await this.audit.log(me, b.label ? `${b.on ? 'Turned on' : 'Turned off'}: ${b.label}` : 'Updated session and password rules', 'icon-shield-check', 'access');
    return { message: 'Security settings saved. They apply at each person’s next sign-in.' };
  }

  @Patch('policy') @Perm('settings.manage')
  async policy(@Me() me: AuthUser, @Body() b: any) {
    const patch: any = {};
    for (const k of ['discount', 'quoteMax', 'assetMax'] as const) if (b[k] !== undefined) patch[k] = String(num(b[k] || 0, k, { min: 0 }));
    for (const k of ['invAll', 'noSelf', 'msDates'] as const) if (b[k] !== undefined) patch[k] = !!b[k];
    const next = await this.patchJson('policy', patch);
    if (b.save) await this.audit.log(me, 'Updated approval rules', 'icon-badge-check');
    return { message: `Saved. Discounts above ${(next as any).discount}% now need the Owner.` };
  }

  @Patch('tax') @Perm('settings.manage')
  async tax(@Me() me: AuthUser, @Body() b: any) {
    if (b.sac) {
      const rate = Number(oneOf(String(b.rate), 'Rate', ['0', '5', '12', '18', '28']));
      await this.prisma.sac.update({ where: { orgId_code: { orgId: orgId(), code: String(b.sac) } }, data: { rate } });
      await this.audit.log(me, `Set GST on SAC ${b.sac} to ${rate}%`, 'icon-percent');
      return { message: `SAC ${b.sac} now charges ${rate}% GST on new lines.` };
    }
    const patch: any = {}; for (const k of ['round', 'einv', 'lut'] as const) if (b[k] !== undefined) patch[k] = !!b[k];
    await this.patchJson('taxOpts', patch);
    if (b.label) await this.audit.log(me, `${b.on ? 'Turned on' : 'Turned off'}: ${b.label}`, 'icon-percent');
    return { ok: true };
  }

  @Patch('reminders') @Perm('settings.manage')
  async reminders(@Me() me: AuthUser, @Body() b: any) {
    const patch: any = {};
    if (b.subject !== undefined) patch.subject = str(b.subject, 'Subject', { max: 300 });
    if (b.body !== undefined) patch.body = str(b.body, 'Body', { max: 5000 });
    if (b.stopPartial !== undefined) patch.stopPartial = !!b.stopPartial;
    if (Array.isArray(b.steps)) patch.steps = b.steps.map((s: any) => ({ label: str(s.label, 'Step'), desc: str(s.desc, 'Step'), on: !!s.on }));
    await this.patchJson('reminders', patch);
    if (b.save) await this.audit.log(me, 'Updated payment reminder schedule', 'icon-bell-ring');
    return { message: 'Reminder schedule saved.' };
  }

  @Post('reminders/test') @HttpCode(200) @Perm('settings.manage')
  async test(@Me() me: AuthUser) {
    const org = await this.org(); const rem = org.reminders as any;
    const vars = { contact: me.name.split(' ')[0], customer: 'Sample Customer Pvt Ltd', number: 'INV-SAMPLE-0001', amount: '₹1,18,000', due: 'next Friday' };
    const text = fill(rem.body, vars);
    const r = await this.mail.send({ to: me.email, subject: '[Test] ' + fill(rem.subject, vars), text, html: htmlOf(text), kind: 'test', userId: me.id });
    return { message: r.ok ? `Test reminder sent to ${me.email}.` : `Test not sent: ${r.error}` };
  }

  @Get('email') @Perm('settings.manage')
  async emailLog() {
    const rows = await this.prisma.emailLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    return { configured: this.mail.configured, from: process.env.EMAIL_FROM || '', rows: rows.map(r => ({ id: r.id, to: r.to, subject: r.subject, kind: r.kind, ref: r.ref, status: r.status, error: r.error, when: relTime(r.createdAt) })) };
  }

  @Patch('templates/:kind') @Perm('template.manage')
  async template(@Me() me: AuthUser, @Param('kind') kind: string, @Body() b: any) {
    oneOf(kind, 'Template', ['invoice', 'quote']);
    const org = await this.org(); const all = org.templates as any; const t = { ...all[kind] };
    if (b.layout !== undefined) t.layout = oneOf(b.layout, 'Layout', ['Classic', 'Modern', 'Compact']);
    if (b.accent !== undefined) t.accent = oneOf(b.accent, 'Accent', ['#0052ff', '#0f172a', '#047857', '#7c3aed']);
    for (const f of ['title', 'terms', 'subject'] as const) if (b[f] !== undefined) t[f] = str(b[f], f, { max: 2000 });
    if (b.show && typeof b.show === 'object') t.show = { ...t.show, ...Object.fromEntries(Object.entries(b.show).map(([k, v]) => [k, !!v])) };
    await this.patchJson('templates', { [kind]: t });
    if (b.save) await this.audit.log(me, `Updated the ${kind === 'invoice' ? 'invoice' : 'quotation'} template`, 'icon-layout-template');
    return { message: `${kind === 'invoice' ? 'Invoice' : 'Quotation'} template saved. PDFs generated from now on use it.` };
  }

  @Patch('series/:id') @Perm('numbering.manage')
  async series(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const s = await this.prisma.series.findUniqueOrThrow({ where: { id } });
    const pattern = str(b.pattern, 'Pattern', { max: 60 }); const next = Math.round(num(b.next, 'Next number', { min: 1 }));
    if (!pattern.includes('{seq}')) throw new BadRequestException('The pattern must include {seq}.');
    if (next < s.next) throw new BadRequestException(`Forward only. Numbers below ${s.next} are already on documents.`);
    const upd = await this.prisma.series.update({ where: { id }, data: { prefix: str(b.prefix, 'Prefix', { max: 10 }).toUpperCase(), pattern, padding: Math.round(num(b.padding, 'Digits', { min: 0, max: 8 })), next } });
    const { today, org } = await this.orgs.ctx();
    await this.audit.log(me, `Changed ${s.label.toLowerCase()} numbering to ${pattern}`, 'icon-hash');
    return { message: `Saved. The next one will be ${formatNumber(upd, today, org.fyStart)}.` };
  }

  @Get('audit') @Perm('audit.read')
  async auditLog() {
    const rows = await this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 300 });
    return rows.map(a => ({ id: a.id, icon: a.icon, text: a.text, who: a.who, when: relTime(a.createdAt), area: a.area }));
  }
}
