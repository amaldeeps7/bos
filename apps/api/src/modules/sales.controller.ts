import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DocumentsService, mailNote } from './documents.service';
import { placeOf, STAGES, UNISSUED } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { OrgService } from '../core/org.service';
import { AccessService } from '../core/access.service';
import { AuditService } from '../core/audit.service';
import { Me, Perm } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';
import { d, gstParty, num, str, toDate } from '../core/util';
import { cleanLines, FinanceService } from './finance.service';
import { NumberingService, draftRef } from '../core/numbering.service';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

@Controller('customers')
export class CustomersController {
  constructor(private prisma: PrismaService, private fin: FinanceService) {}

  @Get() @Perm('customer.read')
  async list() {
    const c = await this.fin.ctx();
    const [rows, invoices, projects] = await Promise.all([
      this.prisma.customer.findMany({ where: { archived: false }, orderBy: { since: 'asc' } }),
      this.prisma.invoice.findMany(), this.prisma.project.groupBy({ by: ['customerId'], _count: true }),
    ]);
    const owed = new Map<string, number>(), billed = new Map<string, number>();
    for (const i of invoices) {
      const f = this.fin.invInfo(i, c);
      owed.set(i.customerId, (owed.get(i.customerId) || 0) + f.bal);
      if (!UNISSUED.includes(i.status)) billed.set(i.customerId, (billed.get(i.customerId) || 0) + f.k.grand);
    }
    const pc = new Map(projects.map(p => [p.customerId, p._count]));
    return rows.map(x => ({ id: x.id, name: x.name, gstin: x.gstin || '', state: placeOf(x) || '', stateCode: x.state, city: x.city, contact: x.contact, email: x.email, phone: x.phone,
      terms: x.terms, ownerId: x.ownerId, since: d(x.since), outstanding: owed.get(x.id) || 0, billed: billed.get(x.id) || 0, projects: pc.get(x.id) || 0, intra: placeOf(x) === c.ourState }));
  }

  @Post() @Perm('customer.create')
  async create(@Me() me: AuthUser, @Body() b: any) {
    const name = str(b.name, 'Business name', { max: 200 }).trim();
    if (!name) throw new BadRequestException('Enter the business name.');
    // Customers not registered for GST have no GSTIN; their state sets the place of supply.
    const { gstin, state } = gstParty(b, false);
    if (gstin && await this.prisma.customer.findFirst({ where: { gstin } })) throw new BadRequestException('A customer with this GSTIN already exists.');
    const email = str(b.email, 'Billing email', { max: 200 }).trim();
    if (email && !EMAIL.test(email)) throw new BadRequestException('Enter a valid billing email.');
    const { today } = await this.fin.ctx();
    const c = await this.prisma.customer.create({ data: { name, gstin: gstin || null, state, city: str(b.city, 'City', { max: 100 }).trim() || '—', contact: str(b.contact, 'Contact', { max: 200 }).trim(), email,
      phone: str(b.phone, 'Phone', { max: 50 }).trim(), terms: num(b.terms ?? 30, 'Payment terms', { min: 0, max: 180 }), ownerId: me.id, since: toDate(today) } });
    return { id: c.id };
  }

  @Patch(':id') @Perm('customer.update')
  async update(@Param('id') id: string, @Body() b: any) {
    const data: any = {};
    for (const f of ['name', 'city', 'contact', 'email', 'phone'] as const) if (b[f] !== undefined) data[f] = str(b[f], f, { max: 200 }).trim();
    if (b.gstin !== undefined || b.state !== undefined) {
      const cur = await this.prisma.customer.findUniqueOrThrow({ where: { id } });
      const g = gstParty({ gstin: b.gstin ?? cur.gstin, state: b.state ?? cur.state }, false); data.gstin = g.gstin || null; data.state = g.state;
    }
    if (b.terms !== undefined) data.terms = num(b.terms, 'Payment terms', { min: 0, max: 180 });
    if (b.email && !EMAIL.test(String(b.email))) throw new BadRequestException('Enter a valid billing email.');
    if (data.gstin) { const dup = await this.prisma.customer.findFirst({ where: { gstin: data.gstin, id: { not: id } } }); if (dup) throw new BadRequestException(`${dup.name} already has this GSTIN.`); }
    if (b.ownerId !== undefined) data.ownerId = String(b.ownerId);
    const c = await this.prisma.customer.update({ where: { id }, data });
    return { message: `${c.name} saved. New documents use these details.` };
  }

  @Delete(':id') @Perm('customer.archive')
  async archive(@Param('id') id: string) { const c = await this.prisma.customer.update({ where: { id }, data: { archived: true } }); return { message: `${c.name} archived. Their documents stay.` }; }
}

@Controller('opportunities')
export class OpportunitiesController {
  constructor(private prisma: PrismaService) {}

  @Get() @Perm('customer.read')
  async list() {
    const rows = await this.prisma.opportunity.findMany({ include: { customer: true }, orderBy: { value: 'desc' } });
    return rows.map(o => ({ id: o.id, name: o.name, customerId: o.customerId, customer: o.customer.name, value: o.value, ownerId: o.ownerId, stage: o.stage, next: o.next }));
  }

  private async fields(b: any, partial: boolean) {
    const data: any = {};
    if (!partial || b.name !== undefined) { data.name = str(b.name, 'Name', { max: 200 }).trim(); if (!data.name) throw new BadRequestException('Name the deal.'); }
    if (!partial || b.customerId !== undefined) { const c = await this.prisma.customer.findUnique({ where: { id: str(b.customerId, 'Customer', { required: true }) } }); if (!c) throw new BadRequestException('Pick a customer'); data.customerId = c.id; }
    if (!partial || b.value !== undefined) data.value = Math.round(num(b.value ?? 0, 'Value', { min: 0 }));
    if (b.stage !== undefined) data.stage = Math.round(num(b.stage, 'Stage', { min: 0, max: 4 }));
    if (b.next !== undefined) data.next = str(b.next, 'Next step', { max: 300 }).trim();
    if (b.ownerId !== undefined) data.ownerId = String(b.ownerId);
    return data;
  }

  @Post() @Perm('customer.update')
  async create(@Me() me: AuthUser, @Body() b: any) {
    const data = await this.fields(b, false);
    const o = await this.prisma.opportunity.create({ data: { ...data, stage: data.stage ?? 0, next: data.next ?? '', ownerId: data.ownerId || me.id } });
    return { id: o.id, message: `${o.name} added to the pipeline.` };
  }

  @Patch(':id') @Perm('customer.update')
  async update(@Param('id') id: string, @Body() b: any) {
    const o = await this.prisma.opportunity.update({ where: { id }, data: await this.fields(b, true) });
    return { message: `${o.name} saved.` };
  }

  @Delete(':id') @Perm('customer.update')
  async remove(@Param('id') id: string) {
    const o = await this.prisma.opportunity.delete({ where: { id } });
    return { message: `${o.name} removed from the pipeline.` };
  }

  @Post(':id/advance') @HttpCode(200) @Perm('customer.update')
  async advance(@Param('id') id: string) {
    const o = await this.prisma.opportunity.findUnique({ where: { id } });
    if (!o) throw new NotFoundException();
    if (o.stage >= 4) throw new BadRequestException('Already won');
    const stage = o.stage + 1;
    await this.prisma.opportunity.update({ where: { id }, data: { stage, next: stage === 4 ? 'Won — ready to convert to a project' : o.next } });
    return { message: stage === 4 ? `${o.name} won. Convert it to a project when the contract is signed.` : `${o.name} moved to ${STAGES[stage]}.` };
  }
}

@Controller('catalog')
export class CatalogController {
  constructor(private prisma: PrismaService) {}

  @Get() @Perm('catalog.read')
  async list() { return (await this.prisma.catalogItem.findMany({ orderBy: { sort: 'asc' } })).map(c => ({ id: c.id, d: c.d, sac: c.sac, unit: c.unit, rate: c.rate })); }

  @Post() @Perm('catalog.manage')
  async add() {
    const max = await this.prisma.catalogItem.aggregate({ _max: { sort: true } });
    const c = await this.prisma.catalogItem.create({ data: { d: 'New service', sac: '998314', unit: 'day', rate: 0, sort: (max._max.sort ?? 0) + 1 } });
    return { id: c.id };
  }

  @Patch(':id') @Perm('catalog.manage')
  async update(@Param('id') id: string, @Body() b: any) {
    const data: any = {};
    if (b.d !== undefined) data.d = str(b.d, 'Service', { max: 300 });
    if (b.unit !== undefined) data.unit = str(b.unit, 'Unit', { max: 30 });
    if (b.rate !== undefined) data.rate = Math.round(num(b.rate || 0, 'Rate', { min: 0 }));
    if (b.sac !== undefined) { if (!(await this.prisma.sac.findFirst({ where: { code: String(b.sac) } }))) throw new BadRequestException('Unknown SAC code'); data.sac = String(b.sac); }
    await this.prisma.catalogItem.update({ where: { id }, data });
    return { ok: true };
  }

  @Delete(':id') @Perm('catalog.manage')
  async remove(@Param('id') id: string) { await this.prisma.catalogItem.delete({ where: { id } }); return { ok: true }; }
}

@Controller('quotes')
export class QuotesController {
  constructor(private prisma: PrismaService, private fin: FinanceService, private audit: AuditService, private access: AccessService, private numbering: NumberingService, private docs: DocumentsService, private orgs: OrgService) {}

  @Get(':id/pdf') @Perm('quote.read')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.docs.quotePdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"` }).send(buffer);
  }

  private async one(id: string) { const q = await this.prisma.quote.findUnique({ where: { id }, include: { customer: true } }); if (!q) throw new NotFoundException('Quotation not found'); return q; }

  @Get() @Perm('quote.read')
  async list() {
    const c = await this.fin.ctx();
    return (await this.prisma.quote.findMany({ orderBy: { date: 'desc' } })).map(q => this.fin.mapQuote(q, c));
  }

  /** Create (no id) or edit/revise a quotation. Revising a sent one makes the next version, back in draft. */
  @Post() @Perm('quote.create')
  async save(@Me() me: AuthUser, @Body() b: any) {
    const lines = cleanLines(b.lines);
    const cust = await this.prisma.customer.findUnique({ where: { id: str(b.customerId, 'Customer', { required: true }) } });
    if (!cust) throw new BadRequestException('Pick a customer');
    const days = num(b.days ?? 30, 'Valid for', { min: 1, max: 365 });
    const title = str(b.title, 'Title', { max: 300 }).trim() || lines[0].d || 'Untitled';
    const { today } = await this.fin.ctx();
    let id: string; let no: string;
    if (b.id) {
      AccessService.require(me, 'quote.update');
      const old = await this.one(b.id);
      if (!['DRAFT', 'SENT', 'DECLINED', 'APPROVED'].includes(old.status)) throw new BadRequestException('This quotation can no longer be changed');
      const revise = old.status !== 'DRAFT';
      const e = await this.orgs.entity(b.entityId ? String(b.entityId) : old.entityId);
      await this.prisma.quote.update({ where: { id: old.id }, data: { customerId: cust.id, entityId: e.id, gst: e.gst, title, lines, notes: str(b.notes, 'Notes'), validUntil: new Date(old.date.getTime() + days * 86400000), status: 'DRAFT', ver: revise ? old.ver + 1 : old.ver } });
      id = old.id; no = old.no;
    } else {
      const { id: entityId, gst } = await this.orgs.entity(b.entityId || null);
      const q = await this.prisma.$transaction(async tx => tx.quote.create({ data: { no: await this.numbering.next('QUOTATION', {}, tx), entityId, gst, customerId: cust.id, title, date: toDate(today), validUntil: new Date(toDate(today).getTime() + days * 86400000), status: 'DRAFT', byId: me.id, lines, notes: str(b.notes, 'Notes') } }));
      id = q.id; no = q.no;
      await this.audit.log(me, `${me.name} drafted ${no}`, 'icon-scroll-text', 'quote');
    }
    const message = b.submit ? await this.fin.submitQuote(id, me) : `${no} saved as draft.`;
    return { id, message };
  }

  @Post(':id/:action') @HttpCode(200) @Perm('quote.read')
  async act(@Me() me: AuthUser, @Param('id') id: string, @Param('action') action: string, @Body() b: any) {
    const q = await this.one(id);
    const need = (st: string[]) => { if (!st.includes(q.status)) throw new BadRequestException(`Not possible while the quotation is ${q.status.toLowerCase().replace('_', ' ')}`); };
    switch (action) {
      case 'submit': AccessService.require(me, 'quote.create'); return { message: await this.fin.submitQuote(id, me) };
      case 'send': {
        need(['APPROVED']); const who = await this.access.actor(me, 'quote.send');
        if (!q.customer.email) throw new BadRequestException(`${q.customer.name} has no billing email. Add one on the customer first.`);
        const r = await this.docs.emailQuote(id, me.id);
        if (!r.ok && !r.error?.includes('not configured')) throw new BadRequestException(`Couldn’t email ${q.no}: ${r.error}`);
        await this.prisma.quote.update({ where: { id }, data: { status: 'SENT' } });
        await this.audit.log(who, `${who.name} sent ${q.no} to ${q.customer.name}`, 'icon-mail', 'quote');
        return { message: r.ok ? `${q.no} emailed to ${q.customer.email} with the PDF attached.` : `${q.no} marked as sent.${mailNote(r)}` };
      }
      case 'accept': case 'decline': {
        need(['SENT']); AccessService.require(me, 'quote.update');
        await this.prisma.quote.update({ where: { id }, data: { status: action === 'accept' ? 'ACCEPTED' : 'DECLINED' } });
        await this.audit.log(me, `Marked ${q.no} ${action === 'accept' ? 'accepted' : 'declined'} by ${q.customer.name}`, 'icon-scroll-text', 'quote');
        return { message: action === 'accept' ? `${q.customer.name} accepted ${q.no}.` : `${q.no} marked declined.` };
      }
      case 'to-project': return this.toProject(me, q);
      case 'to-invoice': return this.toInvoice(me, q);
      default: throw new ForbiddenException('Unknown action');
    }
  }

  private async toProject(me: AuthUser, q: Awaited<ReturnType<QuotesController['one']>>) {
    AccessService.require(me, 'quote.convert'); AccessService.require(me, 'project.create');
    if (q.status !== 'ACCEPTED') throw new BadRequestException('Only an accepted quotation can be converted');
    const c = await this.fin.ctx(); const k = this.fin.calcFor(q.lines, q.customerId, c, q.entityId, q.gst);
    const { today } = c; const at = (days: number) => new Date(toDate(today).getTime() + days * 86400000);
    const p = await this.prisma.$transaction(async tx => {
      const code = await this.numbering.next('PROJECT', {}, tx);
      const unit = await tx.businessUnit.findFirst({ where: { entityId: q.entityId, name: k.rows.some(r => r.sac === '998319') ? 'Cybersecurity' : 'Software' } });
      const p = await tx.project.create({ data: { name: q.title, code, customerId: q.customerId, entityId: q.entityId, unitId: unit?.id ?? null, contract: k.taxable,
        endDate: at(14 * k.rows.length), ownerId: me.id, quoteId: q.id,
        milestones: { create: k.rows.map((r, i) => ({ seq: i + 1, name: r.d, pct: Math.round(r.taxable / (k.taxable || 1) * 1000) / 10, value: r.taxable, status: i === 0 ? 'IN_PROGRESS' : 'PENDING', due: at(14 * (i + 1)) })) } } });
      await tx.quote.update({ where: { id: q.id }, data: { status: 'CONVERTED', projectId: p.id } });
      return p;
    });
    await this.audit.log(me, `Created ${p.code} from ${q.no}`, 'icon-folder-plus', 'project');
    return { projectId: p.id, message: `${p.code} created from ${q.no} — ${k.rows.length} milestones, each billable on completion.` };
  }

  private async toInvoice(me: AuthUser, q: Awaited<ReturnType<QuotesController['one']>>) {
    AccessService.require(me, 'quote.convert'); AccessService.require(me, 'invoice.create');
    if (q.status !== 'ACCEPTED') throw new BadRequestException('Only an accepted quotation can be converted');
    const { today } = await this.fin.ctx(); const { gst } = await this.orgs.entity(q.entityId);
    const inv = await this.prisma.$transaction(async tx => {
      const no = draftRef();
      const inv = await tx.invoice.create({ data: { no, entityId: q.entityId, gst, customerId: q.customerId, title: q.title, date: toDate(today), due: new Date(toDate(today).getTime() + q.customer.terms * 86400000), status: 'DRAFT', byId: me.id, lines: q.lines as any, notes: `Against quotation ${q.no}.` } });
      await tx.quote.update({ where: { id: q.id }, data: { status: 'CONVERTED', invoiceId: inv.id } });
      return inv;
    });
    await this.audit.log(me, `Raised ${inv.no} from ${q.no}`, 'icon-file-plus', 'invoice');
    return { invoiceId: inv.id, message: `Draft invoice raised from ${q.no}. Submit it for approval when ready; it takes its number when issued.` };
  }
}
