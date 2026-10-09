import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { AccessService } from '../core/access.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { Me, Perm } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';
import { d, num, oneOf, str, toDate } from '../core/util';
import { FinanceService } from './finance.service';

@Controller('projects')
export class ProjectsController {
  constructor(private prisma: PrismaService, private fin: FinanceService, private audit: AuditService, private numbering: NumberingService) {}

  @Get() @Perm('project.read')
  async list() {
    const rows = await this.prisma.project.findMany({ include: { milestones: { orderBy: { seq: 'asc' } }, customer: true }, orderBy: { code: 'asc' } });
    return rows.map(p => ({ id: p.id, name: p.name, code: p.code, customerId: p.customerId, customer: p.customer.name, bu: p.bu, contract: p.contract, endDate: d(p.endDate),
      health: p.health, status: p.status, ownerId: p.ownerId, quoteId: p.quoteId, createdAt: p.createdAt.toISOString(),
      milestones: p.milestones.map(m => ({ id: m.id, seq: m.seq, name: m.name, pct: m.pct, value: m.value, status: m.status, due: d(m.due), changedAt: m.changedAt?.toISOString() || null })) }));
  }

  /** Starts a project, optionally with its milestones (percentages of the contract). */
  @Post() @Perm('project.create')
  async create(@Me() me: AuthUser, @Body() b: any) {
    const name = str(b.name, 'Name', { max: 200 }).trim(); if (!name) throw new BadRequestException('Name the project.');
    const cust = await this.prisma.customer.findUnique({ where: { id: str(b.customerId, 'Customer', { required: true }) } }); if (!cust) throw new BadRequestException('Pick a customer');
    const contract = Math.round(num(b.contract ?? 0, 'Contract value', { min: 0 }));
    const ms: any[] = Array.isArray(b.milestones) ? b.milestones.filter((m: any) => String(m?.name || '').trim()) : [];
    const p = await this.prisma.$transaction(async tx => {
      const code = await this.numbering.next('PROJECT', tx);
      return tx.project.create({ data: { name, code, customerId: cust.id, bu: str(b.bu || 'Software', 'Business unit', { max: 80 }), contract, endDate: toDate(b.endDate), health: 'On track', status: 'ACTIVE', ownerId: b.ownerId || me.id,
        milestones: { create: ms.map((m, i) => { const pct = num(m.pct ?? 0, 'Share', { min: 0, max: 100 }); return { seq: i + 1, name: String(m.name).trim(), pct, value: Math.round(contract * pct / 100), due: toDate(m.due || b.endDate), status: i === 0 ? 'IN_PROGRESS' : 'PENDING' }; }) } } });
    });
    await this.audit.log(me, `Started ${p.code} ${p.name} for ${cust.name}`, 'icon-folder-plus', 'project');
    return { id: p.id, message: `${p.code} created.` };
  }

  @Patch(':id') @Perm('project.update')
  async update(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const p = await this.prisma.project.findUnique({ where: { id } }); if (!p) throw new NotFoundException();
    const data: any = {};
    if (b.name !== undefined) { data.name = str(b.name, 'Name', { max: 200 }).trim(); if (!data.name) throw new BadRequestException('Name the project.'); }
    if (b.bu !== undefined) data.bu = str(b.bu, 'Business unit', { max: 80 });
    if (b.contract !== undefined) data.contract = Math.round(num(b.contract, 'Contract value', { min: 0 }));
    if (b.endDate !== undefined) data.endDate = toDate(b.endDate);
    if (b.health !== undefined) data.health = oneOf(b.health, 'Health', ['On track', 'At risk', 'On hold']);
    if (b.status !== undefined) data.status = oneOf(b.status, 'Status', ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']);
    if (b.ownerId !== undefined && b.ownerId !== p.ownerId) {
      AccessService.require(me, 'project.change_owner');
      const u = await this.prisma.user.findUnique({ where: { id: String(b.ownerId) } }); if (!u || u.status !== 'Active') throw new BadRequestException('Pick an active person');
      data.ownerId = u.id;
    }
    await this.prisma.project.update({ where: { id }, data });
    await this.audit.log(me, `Updated ${p.code} ${data.name || p.name}`, 'icon-folder-kanban', 'project');
    return { message: `${data.name || p.name} saved.` };
  }

  @Post(':id/milestones') @Perm('project.update')
  async addMilestone(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const p = await this.prisma.project.findUnique({ where: { id }, include: { milestones: true } }); if (!p) throw new NotFoundException();
    const name = str(b.name, 'Name', { max: 200 }).trim(); if (!name) throw new BadRequestException('Name the milestone.');
    const value = Math.round(num(b.value ?? 0, 'Value', { min: 0 }));
    await this.prisma.milestone.create({ data: { projectId: id, seq: p.milestones.length + 1, name, value, pct: p.contract ? Math.round(value / p.contract * 1000) / 10 : 0, due: toDate(b.due), status: 'PENDING' } });
    await this.audit.log(me, `Added milestone ${name} to ${p.code}`, 'icon-flag', 'project');
    return { message: `${name} added.` };
  }

  /** Edits a milestone. Once invoiced, its value is locked; dates move through approval when policy says so. */
  @Patch(':id/milestones/:mid') @Perm('project.update')
  async editMilestone(@Me() me: AuthUser, @Param('id') id: string, @Param('mid') mid: string, @Body() b: any) {
    const p = await this.prisma.project.findUnique({ where: { id } }); const m = await this.prisma.milestone.findFirst({ where: { id: mid, projectId: id } });
    if (!p || !m) throw new NotFoundException();
    const data: any = {}; let msg = `${m.name} saved.`;
    if (b.name !== undefined) { data.name = str(b.name, 'Name', { max: 200 }).trim(); if (!data.name) throw new BadRequestException('Name the milestone.'); }
    if (b.value !== undefined && Math.round(+b.value) !== m.value) {
      if (['INVOICED', 'PAID'].includes(m.status)) throw new BadRequestException('This milestone is invoiced, so its value is locked.');
      data.value = Math.round(num(b.value, 'Value', { min: 0 })); data.pct = p.contract ? Math.round(data.value / p.contract * 1000) / 10 : 0;
    }
    if (b.due !== undefined && b.due !== d(m.due)) {
      const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: 'org' } });
      if ((org.policy as any).msDates === false || p.ownerId === me.id) data.due = toDate(b.due);
      else { await this.move(me, id, mid, { due: b.due, reason: b.reason }); msg = `${m.name} saved. The new date is waiting on the project owner's approval.`; }
    }
    if (Object.keys(data).length) await this.prisma.milestone.update({ where: { id: mid }, data: { ...data, changedAt: new Date() } });
    if (data.name) msg = msg.replace(m.name, data.name);
    await this.audit.log(me, `Edited milestone ${data.name || m.name} on ${p.code}`, 'icon-flag', 'project');
    return { message: msg };
  }

  @Delete(':id/milestones/:mid') @Perm('project.update')
  async removeMilestone(@Me() me: AuthUser, @Param('id') id: string, @Param('mid') mid: string) {
    const m = await this.prisma.milestone.findFirst({ where: { id: mid, projectId: id } }); if (!m) throw new NotFoundException();
    if (!['PENDING', 'IN_PROGRESS'].includes(m.status)) throw new BadRequestException('Only milestones that haven’t been completed or billed can be removed.');
    await this.prisma.milestone.delete({ where: { id: mid } });
    const rest = await this.prisma.milestone.findMany({ where: { projectId: id }, orderBy: { seq: 'asc' } });
    for (const [i, x] of rest.entries()) if (x.seq !== i + 1) await this.prisma.milestone.update({ where: { id: x.id }, data: { seq: i + 1 } });
    await this.audit.log(me, `Removed milestone ${m.name}`, 'icon-trash-2', 'project');
    return { message: `${m.name} removed.` };
  }

  @Post(':id/milestones/:mid/complete') @HttpCode(200) @Perm('project.update')
  async complete(@Me() me: AuthUser, @Param('id') id: string, @Param('mid') mid: string) {
    const m = await this.prisma.milestone.findFirst({ where: { id: mid, projectId: id } });
    if (!m) throw new NotFoundException();
    if (!['PENDING', 'IN_PROGRESS'].includes(m.status)) throw new BadRequestException('Already complete');
    await this.prisma.milestone.update({ where: { id: mid }, data: { status: 'COMPLETED', changedAt: new Date() } });
    await this.audit.log(me, `Marked ${m.name} complete`, 'icon-circle-check', 'project');
    return { message: `${m.name} marked complete — now billable.` };
  }

  /** Raises the milestone's invoice as a draft and routes it to Finance. */
  @Post(':id/milestones/:mid/bill') @HttpCode(200) @Perm('invoice.create')
  async bill(@Me() me: AuthUser, @Param('id') id: string, @Param('mid') mid: string) {
    const p = await this.prisma.project.findUnique({ where: { id }, include: { customer: true } });
    const m = await this.prisma.milestone.findFirst({ where: { id: mid, projectId: id } });
    if (!p || !m) throw new NotFoundException();
    if (m.status !== 'COMPLETED') throw new BadRequestException('Complete the milestone before billing it');
    const { today } = await this.fin.ctx();
    const inv = await this.prisma.$transaction(async tx => {
      const no = await this.numbering.next('INVOICE', tx);
      await tx.milestone.update({ where: { id: mid }, data: { status: 'INVOICED', changedAt: new Date() } });
      return tx.invoice.create({ data: { no, customerId: p.customerId, title: `${p.name} — ${m.name}`, projectId: p.id, milestoneId: m.id, date: toDate(today),
        due: new Date(toDate(today).getTime() + p.customer.terms * 86400000), status: 'DRAFT', byId: me.id,
        lines: [{ d: `${p.name} — ${m.name} (${m.pct}%)`, qty: 1, unit: 'milestone', rate: m.value, disc: 0, sac: '998314' }] } });
    });
    await this.audit.log(me, `${me.name} raised ${inv.no} for ${m.name}`, 'icon-file-plus', 'invoice');
    const message = await this.fin.submitInvoice(inv.id, me);
    return { invoiceId: inv.id, message };
  }

  /** Asks the project owner to approve a new milestone date (policy: dates move only with approval). */
  @Post(':id/milestones/:mid/move') @HttpCode(200) @Perm('project.read')
  async move(@Me() me: AuthUser, @Param('id') id: string, @Param('mid') mid: string, @Body() b: any) {
    const p = await this.prisma.project.findUnique({ where: { id } });
    const m = await this.prisma.milestone.findFirst({ where: { id: mid, projectId: id } });
    if (!p || !m) throw new NotFoundException();
    const due = toDate(b.due);
    const fmt = (x: Date) => x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: 'org' } });
    if ((org.policy as any).msDates === false || p.ownerId === me.id) {
      AccessService.require(me, 'project.update');
      await this.prisma.milestone.update({ where: { id: mid }, data: { due, changedAt: new Date() } });
      return { message: `${m.name} moved to ${fmt(due)}.` };
    }
    await this.prisma.$transaction(tx => this.fin.requestApproval(tx, { kind: 'Milestone date', ref: p.code, title: `Move “${m.name}” from ${fmt(m.due)} to ${fmt(due)}`, detail: String(b.reason || 'Billing date moves with it; contract value is unchanged.'), payload: { milestoneId: m.id, due: d(due) }, requestedBy: me, approverId: p.ownerId }));
    return { message: 'Sent to the project owner for approval.' };
  }
}

@Controller('assets')
export class AssetsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get() @Perm('asset.read')
  async list() {
    return (await this.prisma.asset.findMany({ orderBy: { code: 'asc' } })).map(a => ({ id: a.id, code: a.code, name: a.name, cat: a.cat, holderId: a.holderId, projectId: a.projectId, status: a.status, value: a.value }));
  }

  @Post() @Perm('asset.manage')
  async create(@Me() me: AuthUser, @Body() b: any) {
    const name = str(b.name, 'Name', { max: 200 }).trim(); if (!name) throw new BadRequestException('Name the asset.');
    const max = (await this.prisma.asset.findMany({ select: { code: true } })).map(a => +a.code.replace(/\D/g, '') || 0).reduce((a, x) => Math.max(a, x), 0);
    const code = str(b.code, 'Asset tag', { max: 30 }).trim().toUpperCase() || `AST-${String(max + 1).padStart(4, '0')}`;
    if (await this.prisma.asset.findUnique({ where: { code } })) throw new BadRequestException(`${code} is already used`);
    await this.prisma.asset.create({ data: { code, name, cat: str(b.cat || 'Other', 'Category', { max: 60 }), value: Math.round(num(b.value ?? 0, 'Value', { min: 0 })), status: 'AVAILABLE' } });
    await this.audit.log(me, `Added asset ${name} (${code})`, 'icon-laptop', 'settings');
    return { message: `${name} added as ${code}.` };
  }

  @Patch(':id') @Perm('asset.manage')
  async update(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const a = await this.prisma.asset.findUnique({ where: { id } }); if (!a) throw new NotFoundException();
    const data: any = {};
    if (b.name !== undefined) { data.name = str(b.name, 'Name', { max: 200 }).trim(); if (!data.name) throw new BadRequestException('Name the asset.'); }
    if (b.cat !== undefined) data.cat = str(b.cat, 'Category', { max: 60 });
    if (b.value !== undefined) data.value = Math.round(num(b.value, 'Value', { min: 0 }));
    if (b.status !== undefined) {
      data.status = oneOf(b.status, 'Status', ['IN_USE', 'AVAILABLE', 'IN_REPAIR']);
      if (data.status !== 'IN_USE') { data.holderId = null; data.projectId = null; }
    }
    if (b.holderId !== undefined || b.projectId !== undefined) {
      data.holderId = b.holderId || null; data.projectId = b.projectId || null;
      data.status = data.holderId || data.projectId ? 'IN_USE' : (data.status || 'AVAILABLE');
    }
    await this.prisma.asset.update({ where: { id }, data });
    await this.audit.log(me, `Updated asset ${a.code}`, 'icon-laptop', 'settings');
    return { message: `${data.name || a.name} saved.` };
  }

  @Post(':id/:action') @HttpCode(200) @Perm('asset.assign')
  async act(@Me() me: AuthUser, @Param('id') id: string, @Param('action') action: string, @Body() b: any) {
    const a = await this.prisma.asset.findUnique({ where: { id } });
    if (!a) throw new NotFoundException();
    if (action === 'return') {
      if (a.status !== 'IN_USE') throw new BadRequestException('Not in use');
      await this.prisma.asset.update({ where: { id }, data: { status: 'AVAILABLE', holderId: null, projectId: null } });
      await this.audit.log(me, `${a.name} (${a.code}) returned to the pool`, 'icon-laptop', 'settings');
      return { message: `${a.name} returned to the pool.` };
    }
    if (action === 'assign') {
      if (a.status !== 'AVAILABLE') throw new BadRequestException('Not available');
      const holderId = b.holderId || me.id;
      await this.prisma.asset.update({ where: { id }, data: { status: 'IN_USE', holderId, projectId: b.projectId || null } });
      await this.audit.log(me, `${a.name} (${a.code}) assigned`, 'icon-laptop', 'settings');
      return { message: holderId === me.id ? `${a.name} assigned to you.` : `${a.name} assigned.` };
    }
    throw new BadRequestException('Unknown action');
  }
}
