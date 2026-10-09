import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ALL_PERMS, MODULES, PERM_GROUPS, formatNumber, isValidGstin, relTime, stateOf } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { AccessService } from '../core/access.service';
import { AuditService } from '../core/audit.service';
import { OrgService } from '../core/org.service';
import { Me, Perm } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';
import { num, oneOf, str } from '../core/util';

const anyAdmin = (me: AuthUser) => {
  if (!['settings.manage', 'role.manage', 'role.read', 'user.read'].some(p => AccessService.has(me, p))) throw new ForbiddenException('You can’t open settings');
};
const lastActive = (x: Date | null) => (!x ? '—' : Date.now() - x.getTime() < 10 * 60e3 ? 'Now' : relTime(x).replace(/ (hour|hours) ago/, h => h).replace(/^(\d+) min ago$/, '$1 min ago'));

@Controller('settings')
export class SettingsController {
  constructor(private prisma: PrismaService, private access: AccessService, private audit: AuditService, private orgs: OrgService) {}

  private async org() { return this.prisma.organization.findUniqueOrThrow({ where: { id: 'org' } }); }
  private async patchJson(field: 'security' | 'policy' | 'taxOpts' | 'reminders' | 'templates' | 'modules', patch: Record<string, unknown>) {
    const org = await this.org();
    const next = { ...(org[field] as Record<string, unknown>), ...patch };
    await this.prisma.organization.update({ where: { id: 'org' }, data: { [field]: next } });
    return next;
  }

  @Get()
  async all(@Me() me: AuthUser) {
    anyAdmin(me);
    const { today } = await this.orgs.ctx();
    const [org, entities, units, users, roles, series, sac, catalog, projects] = await Promise.all([
      this.org(), this.prisma.legalEntity.findMany({ orderBy: { name: 'asc' } }), this.prisma.businessUnit.findMany({ include: { entity: true, head: true } }),
      this.prisma.user.findMany({ include: { role: true }, orderBy: { createdAt: 'asc' } }), this.prisma.role.findMany({ orderBy: { sort: 'asc' } }),
      this.prisma.series.findMany(), this.prisma.sac.findMany({ orderBy: { code: 'asc' } }), this.prisma.catalogItem.findMany(), this.prisma.project.findMany(),
    ]);
    return {
      org: { name: org.name, slug: org.slug, currency: org.currency, tz: org.tz, country: org.country, fy: org.fyStart, dateFmt: org.dateFmt, createdAt: org.createdAt.toISOString(), status: 'Active' },
      modules: MODULES.map(m => ({ ...m, on: (org.modules as any)[m.id] !== false })),
      security: org.security, policy: org.policy, taxOpts: org.taxOpts, reminders: org.reminders, templates: org.templates,
      entities: entities.map(e => ({ ...e, state: stateOf(e.gstin) || 'Unrecognised code' })),
      units: units.map(u => ({ id: u.id, name: u.name, code: u.code, entity: u.entity.name, head: u.head?.name || 'Not set', projects: projects.filter(p => p.bu === u.name).length })),
      users: users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role.name, status: u.status, last: u.status === 'Invited' ? '—' : lastActive(u.lastActiveAt) })),
      roles: roles.map(r => ({ id: r.id, name: r.name, desc: r.desc, builtIn: r.builtIn, perms: r.builtIn ? ALL_PERMS : r.perms })),
      series: ['INVOICE', 'QUOTATION', 'CREDIT_NOTE', 'RECEIPT', 'PROJECT'].map(t => series.find(s => s.type === t)!).filter(Boolean).map(s => ({ ...s, sample: formatNumber(s, today, org.fyStart) })),
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
    await this.prisma.organization.update({ where: { id: 'org' }, data });
    await this.audit.log(me, 'Updated organisation details');
    return { message: 'Organisation saved. New records use these defaults.' };
  }

  // legal entities & units
  @Patch('entities/:id') @Perm('settings.manage')
  async entity(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const data: any = {};
    for (const f of ['name', 'address', 'bank', 'upi', 'cin'] as const) if (b[f] !== undefined) data[f] = str(b[f], f, { max: 300 }).trim();
    if (b.gstin !== undefined) { data.gstin = String(b.gstin).toUpperCase().trim(); if (!isValidGstin(data.gstin)) throw new BadRequestException('Enter a valid 15-character GSTIN.'); }
    if (b.pan !== undefined) { data.pan = String(b.pan).toUpperCase().trim(); if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(data.pan)) throw new BadRequestException('Enter a valid 10-character PAN.'); }
    const e = await this.prisma.legalEntity.update({ where: { id }, data });
    await this.audit.log(me, `Updated legal entity ${e.name}`, 'icon-landmark');
    return { message: `${e.name} saved. Issued documents keep the details they were issued with.` };
  }

  @Post('entities/:id/default') @HttpCode(200) @Perm('settings.manage')
  async makeDefault(@Me() me: AuthUser, @Param('id') id: string) {
    const e = await this.prisma.legalEntity.findUniqueOrThrow({ where: { id } });
    await this.prisma.$transaction([this.prisma.legalEntity.updateMany({ data: { isDefault: false } }), this.prisma.legalEntity.update({ where: { id }, data: { isDefault: true } })]);
    await this.audit.log(me, `Made ${e.name} the default issuing entity`, 'icon-landmark');
    return { message: `${e.name} now issues new documents.` };
  }

  @Post('units') @Perm('settings.manage')
  async unit(@Me() me: AuthUser, @Body() b: any) {
    const name = str(b.name, 'Name', { max: 80 }).trim(); if (!name) throw new BadRequestException('Name the unit first.');
    if (await this.prisma.businessUnit.findUnique({ where: { name } })) throw new BadRequestException('A unit with that name exists');
    const e = (await this.prisma.legalEntity.findFirst({ where: { isDefault: true } })) || (await this.prisma.legalEntity.findFirstOrThrow());
    await this.prisma.businessUnit.create({ data: { name, code: (str(b.code, 'Code', { max: 4 }).toUpperCase() || name.slice(0, 2).toUpperCase()), entityId: e.id } });
    await this.audit.log(me, `Added business unit ${name}`, 'icon-network');
    return { message: `${name} added. Its numbering starts with the first document it issues.` };
  }

  // modules
  @Patch('modules/:id') @Perm('settings.manage')
  async module(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const m = MODULES.find(x => x.id === id); if (!m) throw new NotFoundException();
    await this.patchJson('modules', { [id]: !!b.on });
    await this.access.invalidateModules();
    await this.audit.log(me, `${b.on ? 'Switched on' : 'Switched off'} the ${m.name} module`, 'icon-blocks');
    return { message: `${m.name} ${b.on ? 'switched on' : 'switched off for everyone'}.` };
  }

  // users
  @Patch('users/:id') @Perm('user.manage')
  async userRole(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const role = await this.prisma.role.findUnique({ where: { name: str(b.role, 'Role', { required: true }) } }); if (!role) throw new BadRequestException('Unknown role');
    if (id === me.id) throw new BadRequestException('You can’t change your own role');
    const u = await this.prisma.user.update({ where: { id }, data: { roleId: role.id } });
    await this.audit.log(me, `Changed ${u.name} to ${role.name}`, 'icon-user-cog', 'access');
    return { message: `${u.name.split(' ')[0]} is now ${role.name}.` };
  }

  @Post('users/:id/toggle') @HttpCode(200) @Perm('user.read')
  async userToggle(@Me() me: AuthUser, @Param('id') id: string) {
    if (id === me.id) throw new BadRequestException('You can’t deactivate yourself');
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    if (u.status === 'Invited') { AccessService.require(me, 'user.invite'); await this.audit.log(me, `Resent the invitation to ${u.email}`, 'icon-user-plus', 'access'); return { message: `Invitation resent to ${u.email}.` }; }
    AccessService.require(me, 'user.manage');
    const status = u.status === 'Active' ? 'Deactivated' : 'Active';
    await this.prisma.user.update({ where: { id }, data: { status } });
    await this.audit.log(me, `${status === 'Active' ? 'Reactivated' : 'Deactivated'} ${u.name}`, 'icon-user-x', 'access');
    return { message: status === 'Active' ? `${u.name} can sign in again.` : `${u.name} is signed out everywhere. Their records stay.` };
  }

  @Post('users/invite') @Perm('user.invite')
  async invite(@Me() me: AuthUser, @Body() b: any) {
    const email = str(b.email, 'Email', { max: 200 }).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('Enter a valid email address.');
    const org = await this.org();
    const doms = String((org.security as any).domains || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    if (doms.length && !doms.includes(email.split('@')[1])) throw new BadRequestException(`Only ${doms.join(', ')} addresses can join (Settings → Security).`);
    if (await this.prisma.user.findUnique({ where: { email } })) throw new BadRequestException('That person is already in this workspace.');
    const role = await this.prisma.role.findUnique({ where: { name: str(b.role, 'Role', { required: true }) } }); if (!role) throw new BadRequestException('Unknown role');
    const local = email.split('@')[0];
    await this.prisma.user.create({ data: { email, name: local.charAt(0).toUpperCase() + local.slice(1), roleId: role.id, status: 'Invited' } });
    await this.audit.log(me, `Invited ${email} as ${role.name}`, 'icon-user-plus', 'access');
    return { message: `Invitation sent to ${email}.` };
  }

  // roles & permissions
  @Post('roles') @Perm('role.manage')
  async createRole(@Me() me: AuthUser, @Body() b: any) {
    const name = str(b.name, 'Role name', { max: 60 }).trim(); if (!name) throw new BadRequestException('Name the role.');
    if (await this.prisma.role.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })) throw new BadRequestException('A role with that name already exists.');
    const from = await this.prisma.role.findUnique({ where: { name: str(b.from, 'Start from', { required: true }) } }); if (!from) throw new BadRequestException('Unknown role');
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
      await this.prisma.sac.update({ where: { code: String(b.sac) }, data: { rate } });
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
  test(@Me() me: AuthUser) { return { message: `Test reminder sent to ${me.email}.` }; }

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

  @Patch('series/:type') @Perm('numbering.manage')
  async series(@Me() me: AuthUser, @Param('type') type: string, @Body() b: any) {
    const s = await this.prisma.series.findUniqueOrThrow({ where: { type } });
    const pattern = str(b.pattern, 'Pattern', { max: 60 }); const next = Math.round(num(b.next, 'Next number', { min: 1 }));
    if (!pattern.includes('{seq}')) throw new BadRequestException('The pattern must include {seq}.');
    if (next < s.next) throw new BadRequestException(`Forward only. Numbers below ${s.next} are already on documents.`);
    const upd = await this.prisma.series.update({ where: { type }, data: { prefix: str(b.prefix, 'Prefix', { max: 10 }).toUpperCase(), pattern, padding: Math.round(num(b.padding, 'Digits', { min: 0, max: 8 })), next } });
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
