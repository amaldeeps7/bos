import { BadRequestException, Injectable } from '@nestjs/common';
import { Invoice, Prisma, Quote } from '@prisma/client';
import { calc, Line, placeOf, UNISSUED, diffDays, inr } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { OrgService } from '../core/org.service';
import { NotifyService } from '../core/notify.service';
import { AuditService } from '../core/audit.service';
import { d, docLink, num, str } from '../core/util';

export type Ctx = Awaited<ReturnType<OrgService['ctx']>> & {
  custState: Map<string, string | undefined>; entityState: Map<string, string | undefined>; entityName: Map<string, string>; paid: Map<string, number>; credited: Map<string, number>;
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
    const [custs, allocs, credits, pend, ents] = await Promise.all([
      this.prisma.customer.findMany({ select: { id: true, gstin: true, state: true } }),
      this.prisma.paymentAllocation.groupBy({ by: ['invoiceId'], _sum: { amount: true } }),
      this.prisma.creditNote.groupBy({ by: ['invoiceId'], _sum: { total: true } }),
      this.prisma.approval.findMany({ where: { status: 'PENDING', docId: { not: null } } }),
      this.prisma.legalEntity.findMany({ select: { id: true, gstin: true, state: true, name: true } }),
    ]);
    const names = new Map((await this.prisma.membership.findMany({ select: { id: true, name: true } })).map(u => [u.id, u.name]));
    return {
      ...base,
      custState: new Map(custs.map(c => [c.id, placeOf(c)])),
      entityState: new Map(ents.map(e => [e.id, placeOf(e)])), entityName: new Map(ents.map(e => [e.id, e.name])),
      paid: new Map(allocs.map(a => [a.invoiceId, a._sum.amount || 0])),
      credited: new Map(credits.map(c => [c.invoiceId, c._sum.total || 0])),
      approvals: new Map(pend.map(a => [`${a.docType}:${a.docId}`, { id: a.id, approverId: a.approverId, approverName: names.get(a.approverId) || '' }])),
    };
  }

  /** GST for a document: CGST + SGST when the customer is in the issuing entity's state, IGST otherwise; none when the document is non-GST. */
  calcFor(lines: unknown, customerId: string, c: Ctx, entityId?: string | null, gst = true) {
    return calc(lines as Line[], c.custState.get(customerId), (entityId && c.entityState.get(entityId)) || c.ourState, c.sacRates, gst);
  }

  invInfo(i: Invoice, c: Ctx) {
    const k = this.calcFor(i.lines, i.customerId, c, i.entityId, i.gst);
    const paid = c.paid.get(i.id) || 0, credited = c.credited.get(i.id) || 0;
    const bal = UNISSUED.includes(i.status) ? 0 : Math.max(0, k.grand - paid - credited);
    const overdue = bal > 0 && diffDays(d(i.due), c.today) < 0 && ['ISSUED', 'SENT', 'PARTIALLY_PAID'].includes(i.status);
    return { k, paid, credited, bal, overdue, st: overdue ? 'OVERDUE' : i.status };
  }

  mapInvoice(i: Invoice, c: Ctx) {
    const f = this.invInfo(i, c);
    return {
      id: i.id, no: i.no, entityId: i.entityId, entity: c.entityName.get(i.entityId) || '', customerId: i.customerId, title: i.title, projectId: i.projectId, milestoneId: i.milestoneId, date: d(i.date), due: d(i.due),
      status: i.status, displayStatus: f.st, byId: i.byId, lines: i.lines as unknown as Line[], notes: i.notes, rejected: i.rejected,
      calc: f.k, paid: f.paid, credited: f.credited, bal: f.bal, overdue: f.overdue, approval: c.approvals.get(`invoice:${i.id}`) || null,
    };
  }

  mapQuote(q: Quote, c: Ctx) {
    return {
      id: q.id, no: q.no, entityId: q.entityId, entity: c.entityName.get(q.entityId) || '', customerId: q.customerId, title: q.title, date: d(q.date), validUntil: d(q.validUntil), status: q.status, byId: q.byId, ver: q.ver,
      lines: q.lines as unknown as Line[], notes: q.notes, rejected: q.rejected, projectId: q.projectId, invoiceId: q.invoiceId,
      calc: this.calcFor(q.lines, q.customerId, c, q.entityId, q.gst), approval: c.approvals.get(`quote:${q.id}`) || null,
    };
  }

  /**
   * Who approves: an active colleague (not `excludeId`) holding `perm`, preferring someone not on leave today,
   * then a non-Owner role (Finance before the Owner).
   */
  async approverFor(perm: string, excludeId: string, ownerOnly = false) {
    const { today } = await this.orgs.ctx();
    const users = await this.prisma.membership.findMany({ where: { status: 'Active', id: { not: excludeId }, role: ownerOnly ? { builtIn: true } : { perms: { has: perm } } }, include: { role: true }, orderBy: { createdAt: 'asc' } });
    const away = (u: { leaveUntil: Date | null }) => !!u.leaveUntil && d(u.leaveUntil) >= today;
    const rank = (u: (typeof users)[number]) => (away(u) ? 2 : 0) + (u.role.builtIn ? 1 : 0);
    return [...users].sort((a, b) => rank(a) - rank(b))[0] || null;
  }

  /** Pending approvals of someone who left are routed to the next person who can decide them. Returns how many moved. */
  async reassignApprovals(fromId: string, fromName: string) {
    const pending = await this.prisma.approval.findMany({ where: { approverId: fromId, status: 'PENDING' } });
    let moved = 0;
    for (const a of pending) {
      const next = a.kind === 'Invoice' ? await this.approverFor('invoice.approve', a.requestedById)
        : a.kind === 'Quotation' ? await this.approverFor('quote.approve', a.requestedById, true)
        : a.kind === 'Asset request' ? await this.approverFor('asset.manage', a.requestedById)
        : await this.approverFor('project.change_owner', a.requestedById); // milestone dates: someone who can take over projects
      if (!next) continue;
      await this.prisma.approval.update({ where: { id: a.id }, data: { approverId: next.id } });
      await this.notify.send([next.id], 'icon-badge-check', `${a.ref} needs your approval (it was waiting on ${fromName})`, docLink(a.docType, a.docId));
      moved++;
    }
    return moved;
  }

  /** When nobody else can approve: allowed only if policy lets people approve their own documents and they hold the permission. */
  private selfApproves(c: Ctx, me: { perms?: string[] }, perm: string) {
    return c.policy.noSelf === false && !!me.perms?.includes(perm);
  }

  async requestApproval(tx: Prisma.TransactionClient, a: { kind: string; docType?: string; docId?: string; ref: string; title: string; detail: string; amount?: number; payload?: any; requestedBy: { id: string; name: string }; approverId: string }) {
    await tx.approval.updateMany({ where: { docType: a.docType, docId: a.docId, status: 'PENDING' }, data: { status: 'REJECTED', decidedAt: new Date() } });
    const ap = await tx.approval.create({ data: { kind: a.kind, docType: a.docType, docId: a.docId, ref: a.ref, title: a.title, detail: a.detail, amount: a.amount, payload: a.payload, requestedById: a.requestedBy.id, approverId: a.approverId } });
    await tx.notification.create({ data: { userId: a.approverId, icon: 'icon-badge-check', text: `${a.requestedBy.name.split(' ')[0]} asked you to approve ${a.ref}`, link: docLink(a.docType, a.docId) } });
    return ap;
  }

  /** Submits a draft invoice. Finance approves before it is issued, unless policy says otherwise. */
  async submitInvoice(id: string, me: { id: string; name: string; perms?: string[] }) {
    const c = await this.ctx(); const i = await this.prisma.invoice.findUniqueOrThrow({ where: { id }, include: { customer: true } });
    if (i.status !== 'DRAFT') throw new BadRequestException('Only drafts can be submitted');
    const k = this.calcFor(i.lines, i.customerId, c, i.entityId, i.gst);
    if (c.policy.invAll === false) {
      await this.prisma.invoice.update({ where: { id }, data: { status: 'APPROVED', rejected: null } });
      await this.audit.log(me, `Submitted ${i.no} — approved by policy`, 'icon-file-check', 'invoice');
      return `${i.no} is approved by policy — it can be issued.`;
    }
    const approver = await this.approverFor('invoice.approve', me.id);
    if (!approver) {
      if (!this.selfApproves(c, me, 'invoice.approve')) throw new BadRequestException('Nobody else can approve invoices. Grant invoice.approve to another role, or allow self-approval in Settings → Approval rules.');
      await this.prisma.invoice.update({ where: { id }, data: { status: 'APPROVED', rejected: null } });
      await this.audit.log(me, `${me.name} approved their own ${i.no} — nobody else can approve, and policy allows it`, 'icon-file-check', 'invoice');
      return `${i.no} approved (you’re the only approver) — it can be issued.`;
    }
    await this.prisma.$transaction(async tx => {
      await tx.invoice.update({ where: { id }, data: { status: 'PENDING_APPROVAL', rejected: null } });
      await this.requestApproval(tx, { kind: 'Invoice', docType: 'invoice', docId: id, ref: i.no, title: `${i.title} — ${i.customer.name}`, detail: `Raised by ${me.name.split(' ')[0]}. Finance approves before it is issued.`, amount: k.grand, requestedBy: me, approverId: approver.id });
    });
    await this.audit.log(me, `${me.name} submitted ${i.no} for approval`, 'icon-file-check', 'invoice');
    return `${i.no} sent to ${approver.name} (${approver.role.name}) for approval.`;
  }

  /** Submits a quotation. Within the discount and size limits it is approved straight away; otherwise the Owner signs off. */
  async submitQuote(id: string, me: { id: string; name: string; perms?: string[] }) {
    const c = await this.ctx(); const q = await this.prisma.quote.findUniqueOrThrow({ where: { id }, include: { customer: true } });
    if (q.status !== 'DRAFT') throw new BadRequestException('Only drafts can be submitted');
    const k = this.calcFor(q.lines, q.customerId, c, q.entityId, q.gst);
    const big = k.grand > (Number(c.policy.quoteMax) || Infinity);
    if (k.maxDisc <= c.discLimit && !big) {
      await this.prisma.quote.update({ where: { id }, data: { status: 'APPROVED', rejected: null } });
      await this.audit.log(me, `${q.no} approved automatically — within pricing policy`, 'icon-scroll-text', 'quote');
      return `${q.no} is within discount policy — approved automatically.`;
    }
    const approver = await this.approverFor('quote.approve', me.id, true);
    if (!approver) {
      if (!this.selfApproves(c, me, 'quote.approve')) throw new BadRequestException('Only the Owner approves this quotation, and you raised it. Allow self-approval in Settings → Approval rules, or have someone else submit it.');
      await this.prisma.quote.update({ where: { id }, data: { status: 'APPROVED', rejected: null } });
      await this.audit.log(me, `${me.name} approved their own ${q.no} — no other Owner, and policy allows it`, 'icon-scroll-text', 'quote');
      return `${q.no} approved (you’re the only Owner) — it can go to the customer.`;
    }
    const why = k.maxDisc > c.discLimit ? `${k.maxDisc}% discount is above the ${c.discLimit}% limit.` : `Total ${inr(k.grand)} is above the ${inr(Number(c.policy.quoteMax))} large-quotation limit.`;
    await this.prisma.$transaction(async tx => {
      await tx.quote.update({ where: { id }, data: { status: 'PENDING_APPROVAL', rejected: null } });
      await this.requestApproval(tx, { kind: 'Quotation', docType: 'quote', docId: id, ref: q.no, title: `${q.title} for ${q.customer.name}`, detail: why, amount: k.taxable, requestedBy: me, approverId: approver.id });
    });
    await this.audit.log(me, `${me.name} submitted ${q.no} for approval`, 'icon-scroll-text', 'quote');
    return `${q.no} sent to ${approver.name} for approval.`;
  }
}
