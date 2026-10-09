import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { AccessService } from '../core/access.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { Me, Perm } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';
import { d, toDate } from '../core/util';
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
