import { BadRequestException, Injectable } from '@nestjs/common';
import { Invoice, Prisma, Quote } from '@prisma/client';
import { calc, Line, stateOf, UNISSUED, diffDays, inr } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { OrgService } from '../core/org.service';
import { NotifyService } from '../core/notify.service';
import { AuditService } from '../core/audit.service';
import { d, num, str } from '../core/util';

export type Ctx = Awaited<ReturnType<OrgService['ctx']>> & {
  custState: Map<string, string | undefined>; paid: Map<string, number>; credited: Map<string, number>;
  approvals: Map<string, { id: string; approverId: string; approverName: string }>;
};

export function cleanLines(raw: unknown): (Line & Record<string, string | number>)[] {
  if (!Array.isArray(raw)) throw new BadRequestException('Lines are required');
  const lines = raw.map((l: any, i) => ({
    d: str(l?.d, `Line ${i + 1} description`, { max: 500 }).trim(), sac: str(l?.sac || '998314', 'SAC', { max: 10 }).trim(),
    qty: num(l?.qty ?? 0, `Line ${i + 1} quantity`, { min: 0 }), unit: str(l?.unit || 'day', 'Unit', { max: 30 }).trim(),
    rate: num(l?.rate ?? 0, `Line ${i + 1} rate`, { min: 0 }), disc: num(l?.disc ?? 0, `Line ${i + 1} discount`, { min: 0, max: 100 }),
  })).filter(l => l.d || l.rate);
  if (!lines.length) throw new BadRequestException('Add at least one line first.');
  return lines;
}

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService, private orgs: OrgService, private notify: NotifyService, private audit: AuditService) {}

  async ctx(): Promise<Ctx> {
    const base = await this.orgs.ctx();
    const [custs, allocs, credits, pend] = await Promise.all([
      this.prisma.customer.findMany({ select: { id: true, gstin: true } }),
      this.prisma.paymentAllocation.groupBy({ by: ['invoiceId'], _sum: { amount: true } }),
      this.prisma.creditNote.groupBy({ by: ['invoiceId'], _sum: { total: true } }),
      this.prisma.approval.findMany({ where: { status: 'PENDING', docId: { not: null } } }),
    ]);
    const names = new Map((await this.prisma.user.findMany({ select: { id: true, name: true } })).map(u => [u.id, u.name]));
    return {
      ...base,
      custState: new Map(custs.map(c => [c.id, stateOf(c.gstin)])),
      paid: new Map(allocs.map(a => [a.invoiceId, a._sum.amount || 0])),
      credited: new Map(credits.map(c => [c.invoiceId, c._sum.total || 0])),
      approvals: new Map(pend.map(a => [`${a.docType}:${a.docId}`, { id: a.id, approverId: a.approverId, approverName: names.get(a.approverId) || '' }])),
    };
  }

  calcFor(lines: unknown, customerId: string, c: Ctx) { return calc(lines as Line[], c.custState.get(customerId), c.ourState, c.sacRates); }

  invInfo(i: Invoice, c: Ctx) {
    const k = this.calcFor(i.lines, i.customerId, c);
    const paid = c.paid.get(i.id) || 0, credited = c.credited.get(i.id) || 0;
    const bal = UNISSUED.includes(i.status) ? 0 : Math.max(0, k.grand - paid - credited);
    const overdue = bal > 0 && diffDays(d(i.due), c.today) < 0 && ['ISSUED', 'SENT', 'PARTIALLY_PAID'].includes(i.status);
    return { k, paid, credited, bal, overdue, st: overdue ? 'OVERDUE' : i.status };
  }

  mapInvoice(i: Invoice, c: Ctx) {
    const f = this.invInfo(i, c);
    return {
      id: i.id, no: i.no, customerId: i.customerId, title: i.title, projectId: i.projectId, milestoneId: i.milestoneId, date: d(i.date), due: d(i.due),
      status: i.status, displayStatus: f.st, byId: i.byId, lines: i.lines as unknown as Line[], notes: i.notes, rejected: i.rejected,
      calc: f.k, paid: f.paid, credited: f.credited, bal: f.bal, overdue: f.overdue, approval: c.approvals.get(`invoice:${i.id}`) || null,
    };
  }

  mapQuote(q: Quote, c: Ctx) {
    return {
      id: q.id, no: q.no, customerId: q.customerId, title: q.title, date: d(q.date), validUntil: d(q.validUntil), status: q.status, byId: q.byId, ver: q.ver,
      lines: q.lines as unknown as Line[], notes: q.notes, rejected: q.rejected, projectId: q.projectId, invoiceId: q.invoiceId,
      calc: this.calcFor(q.lines, q.customerId, c), approval: c.approvals.get(`quote:${q.id}`) || null,
    };
  }

  /** First active colleague who holds `perm`, preferring a non-Owner role (Finance before the Owner). */
  async approverFor(perm: string, excludeId: string, ownerOnly = false) {
    const users = await this.prisma.user.findMany({ where: { status: 'Active', id: { not: excludeId }, role: ownerOnly ? { builtIn: true } : { perms: { has: perm } } }, include: { role: true }, orderBy: { createdAt: 'asc' } });
    return users.find(u => !u.role.builtIn) || users[0] || null;
  }

  async requestApproval(tx: Prisma.TransactionClient, a: { kind: string; docType?: string; docId?: string; ref: string; title: string; detail: string; amount?: number; payload?: any; requestedBy: { id: string; name: string }; approverId: string }) {
    await tx.approval.updateMany({ where: { docType: a.docType, docId: a.docId, status: 'PENDING' }, data: { status: 'REJECTED', decidedAt: new Date() } });
    const ap = await tx.approval.create({ data: { kind: a.kind, docType: a.docType, docId: a.docId, ref: a.ref, title: a.title, detail: a.detail, amount: a.amount, payload: a.payload, requestedById: a.requestedBy.id, approverId: a.approverId } });
    await tx.notification.create({ data: { userId: a.approverId, icon: 'icon-badge-check', text: `${a.requestedBy.name.split(' ')[0]} asked you to approve ${a.ref}`, link: '/approvals' } });
    return ap;
  }

  /** Submits a draft invoice. Finance approves before it is issued, unless policy says otherwise. */
  async submitInvoice(id: string, me: { id: string; name: string }) {
    const c = await this.ctx(); const i = await this.prisma.invoice.findUniqueOrThrow({ where: { id }, include: { customer: true } });
    if (i.status !== 'DRAFT') throw new BadRequestException('Only drafts can be submitted');
    const k = this.calcFor(i.lines, i.customerId, c);
    if (c.policy.invAll === false) {
      await this.prisma.invoice.update({ where: { id }, data: { status: 'APPROVED', rejected: null } });
      await this.audit.log(me, `Submitted ${i.no} — approved by policy`, 'icon-file-check', 'invoice');
      return `${i.no} is approved by policy — it can be issued.`;
    }
    const approver = await this.approverFor('invoice.approve', me.id);
    if (!approver) throw new BadRequestException('Nobody else can approve invoices. Grant invoice.approve to a role first.');
    await this.prisma.$transaction(async tx => {
      await tx.invoice.update({ where: { id }, data: { status: 'PENDING_APPROVAL', rejected: null } });
      await this.requestApproval(tx, { kind: 'Invoice', docType: 'invoice', docId: id, ref: i.no, title: `${i.title} — ${i.customer.name}`, detail: `Raised by ${me.name.split(' ')[0]}. Finance approves before it is issued.`, amount: k.grand, requestedBy: me, approverId: approver.id });
    });
    await this.audit.log(me, `${me.name} submitted ${i.no} for approval`, 'icon-file-check', 'invoice');
    return `${i.no} sent to ${approver.name} (${approver.role.name}) for approval.`;
  }

  /** Submits a quotation. Within the discount and size limits it is approved straight away; otherwise the Owner signs off. */
  async submitQuote(id: string, me: { id: string; name: string }) {
    const c = await this.ctx(); const q = await this.prisma.quote.findUniqueOrThrow({ where: { id }, include: { customer: true } });
    if (q.status !== 'DRAFT') throw new BadRequestException('Only drafts can be submitted');
    const k = this.calcFor(q.lines, q.customerId, c);
    const big = k.grand > (Number(c.policy.quoteMax) || Infinity);
    if (k.maxDisc <= c.discLimit && !big) {
      await this.prisma.quote.update({ where: { id }, data: { status: 'APPROVED', rejected: null } });
      await this.audit.log(me, `${q.no} approved automatically — within pricing policy`, 'icon-scroll-text', 'quote');
      return `${q.no} is within discount policy — approved automatically.`;
    }
    const approver = await this.approverFor('quote.approve', me.id, true);
    if (!approver) throw new BadRequestException('No Owner is available to approve this quotation.');
    const why = k.maxDisc > c.discLimit ? `${k.maxDisc}% discount is above the ${c.discLimit}% limit.` : `Total ${inr(k.grand)} is above the ${inr(Number(c.policy.quoteMax))} large-quotation limit.`;
    await this.prisma.$transaction(async tx => {
      await tx.quote.update({ where: { id }, data: { status: 'PENDING_APPROVAL', rejected: null } });
      await this.requestApproval(tx, { kind: 'Quotation', docType: 'quote', docId: id, ref: q.no, title: `${q.title} for ${q.customer.name}`, detail: why, amount: k.taxable, requestedBy: me, approverId: approver.id });
    });
    await this.audit.log(me, `${me.name} submitted ${q.no} for approval`, 'icon-scroll-text', 'quote');
    return `${q.no} sent to ${approver.name} for approval.`;
  }
}
