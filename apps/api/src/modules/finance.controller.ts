import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DocumentsService, mailNote } from './documents.service';
import { UNISSUED, inr } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { AccessService } from '../core/access.service';
import { AuditService } from '../core/audit.service';
import { NumberingService, draftRef, isDraftRef } from '../core/numbering.service';
import { NotifyService } from '../core/notify.service';
import { OrgService } from '../core/org.service';
import { Me, Perm } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';
import { d, num, oneOf, str, toDate } from '../core/util';
import { cleanLines, FinanceService } from './finance.service';
import { ApprovalsService } from './approvals.service';

const METHODS = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque'] as const;

@Controller('invoices')
export class InvoicesController {
  constructor(private prisma: PrismaService, private fin: FinanceService, private audit: AuditService, private access: AccessService,
    private numbering: NumberingService, private approvals: ApprovalsService, private notify: NotifyService, private docs: DocumentsService, private orgs: OrgService) {}

  /** Only a draft can move to another issuing entity (it has no number yet; it takes one from that entity's series on issue). */
  private async renumber(old: { status: string }, entityId: string) {
    if (old.status !== 'DRAFT') throw new BadRequestException('Only a draft can change its issuing entity.');
    return { entityId: (await this.orgs.entity(entityId)).id };
  }

  @Get(':id/pdf') @Perm('invoice.read')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.docs.invoicePdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"` }).send(buffer);
  }

  private async one(id: string) { const i = await this.prisma.invoice.findUnique({ where: { id }, include: { customer: true } }); if (!i) throw new NotFoundException('Invoice not found'); return i; }

  @Get() @Perm('invoice.read')
  async list() {
    const c = await this.fin.ctx();
    return (await this.prisma.invoice.findMany({ orderBy: [{ date: 'desc' }, { no: 'desc' }] })).map(i => this.fin.mapInvoice(i, c));
  }

  /** Who would carry out each step, so the UI can label demo buttons ("Issue as Meera (demo)"). */
  @Get('actors') @Perm('invoice.read')
  async actors(@Me() me: AuthUser) {
    const out: Record<string, { self: boolean; name: string } | null> = {};
    for (const p of ['invoice.issue', 'invoice.send', 'payment.create', 'credit_note.issue', 'quote.send']) {
      if (AccessService.has(me, p)) out[p] = { self: true, name: me.name };
      else { const w = me.demo ? await this.access.whoCan(p, me.id, me) : null; out[p] = w ? { self: false, name: w.name } : null; }
    }
    return out;
  }

  @Post() @Perm('invoice.create')
  async save(@Me() me: AuthUser, @Body() b: any) {
    const lines = cleanLines(b.lines);
    const cust = await this.prisma.customer.findUnique({ where: { id: str(b.customerId, 'Customer', { required: true }) } });
    if (!cust) throw new BadRequestException('Pick a customer');
    const days = num(b.days ?? cust.terms, 'Payment terms', { min: 0, max: 365 });
    const title = str(b.title, 'Title', { max: 300 }).trim() || lines[0].d || 'Untitled';
    const { today } = await this.fin.ctx();
    let id: string, no: string;
    if (b.id) {
      AccessService.require(me, 'invoice.update_draft');
      const old = await this.one(b.id);
      if (!['DRAFT', 'APPROVED'].includes(old.status)) throw new BadRequestException('Issued invoices are locked. Raise a credit note instead.');
      const moved = b.entityId && b.entityId !== old.entityId ? await this.renumber(old, String(b.entityId)) : {};
      const gst = (await this.orgs.entity((moved as any).entityId || old.entityId)).gst;
      await this.prisma.invoice.update({ where: { id: old.id }, data: { customerId: cust.id, ...moved, gst, title, lines, notes: str(b.notes, 'Notes'), due: new Date(old.date.getTime() + days * 86400000), status: 'DRAFT' } });
      id = old.id; no = old.no;
    } else {
      const { id: entityId, gst } = await this.orgs.entity(b.entityId || null);
      const inv = await this.prisma.$transaction(async tx => tx.invoice.create({ data: {
        no: draftRef(), entityId, gst, customerId: cust.id, title, lines, notes: str(b.notes, 'Notes'), date: toDate(today),
        due: new Date(toDate(today).getTime() + days * 86400000), status: 'DRAFT', byId: me.id, projectId: b.projectId || null, milestoneId: b.milestoneId || null } }));
      id = inv.id; no = inv.no;
      await this.audit.log(me, `${me.name} drafted an invoice for ${cust.name} (${no})`, 'icon-file-plus', 'invoice');
    }
    const message = b.submit ? await this.fin.submitInvoice(id, me) : isDraftRef(no) ? 'Draft saved. It takes its invoice number when it’s issued.' : `${no} saved as draft.`;
    return { id, message };
  }

  @Post(':id/:action') @HttpCode(200) @Perm('invoice.read')
  async act(@Me() me: AuthUser, @Param('id') id: string, @Param('action') action: string, @Body() b: any) {
    const i = await this.one(id);
    const need = (st: string[]) => { if (!st.includes(i.status)) throw new BadRequestException(`Not possible while the invoice is ${i.status.toLowerCase().replace('_', ' ')}`); };
    const c = await this.fin.ctx(); const f = this.fin.invInfo(i, c);
    switch (action) {
      case 'submit': AccessService.require(me, 'invoice.create'); return { message: await this.fin.submitInvoice(id, me) };
      case 'approve': case 'reject': {
        const a = await this.approvals.forDoc('invoice', id);
        const r = await this.approvals.decide(me, a.id, action === 'approve', !!b.demo);
        return { message: action === 'approve' ? `${i.no} approved — ready to issue.` : r.message };
      }
      case 'issue': {
        need(['APPROVED']); const who = await this.access.actor(me, 'invoice.issue');
        // The GST number is taken now, from the issuing entity's series, so drafts never leave gaps.
        const no = await this.prisma.$transaction(async tx => {
          const n = isDraftRef(i.no) ? await this.numbering.next('INVOICE', { entityId: i.entityId }, tx) : i.no;
          await tx.invoice.update({ where: { id }, data: { status: 'ISSUED', no: n, date: toDate((await this.fin.ctx()).today) } });
          if (n !== i.no) await tx.approval.updateMany({ where: { docType: 'invoice', docId: id }, data: { ref: n } });
          return n;
        });
        await this.audit.log(who, `${who.name} issued ${no}${who.demo ? ` (demo, by ${me.name})` : ''}`, 'icon-stamp', 'invoice');
        return { no, message: `${no} issued. Figures are now locked.` };
      }
      case 'send': {
        need(['ISSUED', 'SENT', 'PARTIALLY_PAID']); const who = await this.access.actor(me, 'invoice.send');
        if (!i.customer.email) throw new BadRequestException(`${i.customer.name} has no billing email. Add one on the customer first.`);
        const r = await this.docs.emailInvoice(id, me.id);
        if (!r.ok && !r.error?.includes('not configured')) throw new BadRequestException(`Couldn’t email ${i.no}: ${r.error}`);
        if (i.status === 'ISSUED') await this.prisma.invoice.update({ where: { id }, data: { status: 'SENT' } });
        await this.audit.log(who, `${who.name} ${i.status === 'ISSUED' ? 'sent' : 'resent'} ${i.no} to ${i.customer.name}`, 'icon-mail', 'invoice');
        return { message: r.ok ? `${i.no} emailed to ${i.customer.email} with the PDF attached.` : `${i.no} marked as sent.${mailNote(r)}` };
      }
      case 'cancel': {
        AccessService.require(me, 'invoice.cancel'); need(['DRAFT', 'PENDING_APPROVAL', 'APPROVED']);
        await this.prisma.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
        await this.prisma.approval.updateMany({ where: { docType: 'invoice', docId: id, status: 'PENDING' }, data: { status: 'REJECTED', decidedAt: new Date() } });
        // The milestone it billed can be billed again.
        if (i.milestoneId) await this.prisma.milestone.updateMany({ where: { id: i.milestoneId, status: 'INVOICED' }, data: { status: 'COMPLETED', changedAt: new Date() } });
        await this.audit.log(me, `Cancelled ${i.no}`, 'icon-x', 'invoice');
        return { message: `${i.no} cancelled.` };
      }
      case 'remind': {
        if (f.bal <= 0) throw new BadRequestException('Nothing is outstanding on this invoice');
        if (!i.customer.email) throw new BadRequestException(`${i.customer.name} has no billing email.`);
        const r = await this.docs.emailReminder(id, me.id, f.overdue);
        await this.audit.log(me, `Sent a payment reminder for ${i.no} to ${i.customer.email}`, 'icon-bell-ring', 'invoice');
        return { message: r.ok ? `Reminder sent to ${i.customer.email}.` : `Reminder not sent.${mailNote(r)}` };
      }
      default: throw new BadRequestException('Unknown action');
    }
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(private prisma: PrismaService, private fin: FinanceService, private audit: AuditService, private access: AccessService, private numbering: NumberingService, private notify: NotifyService, private docs: DocumentsService) {}

  @Get() @Perm('payment.read')
  async list() {
    const rows = await this.prisma.payment.findMany({ include: { allocations: { include: { invoice: true } } }, orderBy: [{ date: 'desc' }, { no: 'desc' }] });
    return rows.map(p => ({ id: p.id, no: p.no, customerId: p.customerId, date: d(p.date), method: p.method, ref: p.ref,
      amount: p.allocations.reduce((a, x) => a + x.amount, 0), allocations: p.allocations.map(a => ({ invoiceId: a.invoiceId, invoiceNo: a.invoice.no, amount: a.amount })) }));
  }

  /** Records a receipt against one invoice. A full payment marks the invoice (and its milestone) paid. */
  @Post() @Perm('payment.read')
  async record(@Me() me: AuthUser, @Body() b: any) {
    const who = await this.access.actor(me, 'payment.create');
    const inv = await this.prisma.invoice.findUnique({ where: { id: str(b.invoiceId, 'Invoice', { required: true }) }, include: { customer: true } });
    if (!inv) throw new NotFoundException('Invoice not found');
    const c = await this.fin.ctx(); const f = this.fin.invInfo(inv, c);
    if (f.bal <= 0) throw new BadRequestException('Nothing is outstanding on this invoice');
    const amt = Math.min(Math.round(num(b.amount, 'Amount', { min: 0 })), f.bal);
    if (!amt) throw new BadRequestException('Enter the amount received.');
    const method = oneOf(b.method || 'NEFT', 'Method', METHODS); const full = amt >= f.bal;
    const no = await this.prisma.$transaction(async tx => {
      const no = await this.numbering.next('RECEIPT', { entityId: inv.entityId }, tx);
      await tx.payment.create({ data: { no, entityId: inv.entityId, customerId: inv.customerId, date: toDate(c.today), method, ref: str(b.ref, 'Reference', { max: 100 }).trim() || '—', createdById: who.id, allocations: { create: [{ invoiceId: inv.id, amount: amt }] } } });
      await tx.invoice.update({ where: { id: inv.id }, data: { status: full ? 'PAID' : 'PARTIALLY_PAID' } });
      if (full && inv.milestoneId) await tx.milestone.update({ where: { id: inv.milestoneId }, data: { status: 'PAID', changedAt: new Date() } });
      return no;
    });
    await this.audit.log(who, `Recorded ${no} against ${inv.no}${who.demo ? ` (demo, by ${me.name})` : ''}`, 'icon-wallet', 'payment');
    const project = inv.projectId ? await this.prisma.project.findUnique({ where: { id: inv.projectId } }) : null;
    await this.notify.send([inv.byId, project?.ownerId], 'icon-wallet', `${inv.customer.name} paid ${inr(amt)} against ${inv.no}`, '/payments', who.id);
    return { message: `${no} recorded — ${inr(amt)} against ${inv.no}.${full ? ' Paid in full.' : ''}` };
  }

  @Post('remind-overdue') @HttpCode(200) @Perm('payment.read')
  async remindOverdue(@Me() me: AuthUser) {
    const c = await this.fin.ctx();
    const od = (await this.prisma.invoice.findMany()).filter(i => this.fin.invInfo(i, c).overdue);
    if (!od.length) return { message: 'Nobody is overdue.' };
    const results = [];
    for (const i of od) results.push(await this.docs.emailReminder(i.id, me.id, true));
    const sent = results.filter(r => r.ok).length; const n = new Set(od.map(i => i.customerId)).size;
    await this.audit.log(me, `Sent overdue reminders for ${od.length} invoice${od.length > 1 ? 's' : ''} to ${n} customer${n > 1 ? 's' : ''}`, 'icon-bell-ring', 'payment');
    return { message: sent === od.length ? `Reminders sent to ${n} customer${n > 1 ? 's' : ''} with overdue invoices.` : `${sent} of ${od.length} reminders sent.${mailNote(results.find(r => !r.ok)!)}` };
  }

  /** Corrects a recorded receipt's method, reference or date. Amounts are changed by reversing instead. */
  @Patch(':id') @Perm('payment.update')
  async update(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const p = await this.prisma.payment.findUnique({ where: { id } }); if (!p) throw new NotFoundException();
    const data: any = {};
    if (b.method !== undefined) data.method = oneOf(b.method, 'Method', METHODS);
    if (b.ref !== undefined) data.ref = str(b.ref, 'Reference', { max: 100 }).trim() || '—';
    if (b.date !== undefined) data.date = toDate(b.date);
    await this.prisma.payment.update({ where: { id }, data });
    await this.audit.log(me, `Corrected the details of ${p.no}`, 'icon-wallet', 'payment');
    return { message: `${p.no} updated.` };
  }
}

@Controller('credit-notes')
export class CreditNotesController {
  constructor(private prisma: PrismaService, private fin: FinanceService, private audit: AuditService, private access: AccessService, private numbering: NumberingService, private docs: DocumentsService) {}

  @Get(':id/pdf') @Perm('credit_note.read')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.docs.creditPdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"` }).send(buffer);
  }

  @Get() @Perm('credit_note.read')
  async list() {
    const rows = await this.prisma.creditNote.findMany({ include: { invoice: true }, orderBy: [{ date: 'desc' }, { no: 'desc' }] });
    return rows.map(c => ({ id: c.id, no: c.no, invoiceId: c.invoiceId, invoiceNo: c.invoice.no, customerId: c.invoice.customerId, date: d(c.date), taxable: c.taxable, total: c.total, reason: c.reason }));
  }

  /** Issues a credit note: GST reversed at 18%, capped at the balance. The invoice keeps its own figures. */
  @Post() @Perm('credit_note.create')
  async issue(@Me() me: AuthUser, @Body() b: any) {
    const who = await this.access.actor(me, 'credit_note.issue');
    const inv = await this.prisma.invoice.findUnique({ where: { id: str(b.invoiceId, 'Invoice', { required: true }) } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (UNISSUED.includes(inv.status)) throw new BadRequestException('Only issued invoices can be credited');
    const c = await this.fin.ctx(); const f = this.fin.invInfo(inv, c);
    const taxable = Math.round(num(b.amount, 'Value to credit', { min: 0 }));
    if (!taxable) throw new BadRequestException('Enter the value to credit.');
    const reason = str(b.reason, 'Reason', { max: 1000 }).trim();
    if (!reason) throw new BadRequestException('Give a reason. It prints on the credit note.');
    // GST is reversed at the invoice's own effective rate (none on a non-GST invoice).
    const rate = f.k.taxable ? (f.k.grand - f.k.taxable) / f.k.taxable : 0;
    const total = Math.min(taxable + Math.round(taxable * rate), f.bal);
    const cn = await this.prisma.$transaction(async tx => {
      const no = await this.numbering.next('CREDIT_NOTE', { entityId: inv.entityId }, tx);
      const cn = await tx.creditNote.create({ data: { no, entityId: inv.entityId, invoiceId: inv.id, date: toDate(c.today), taxable, total, reason } });
      if (total >= f.bal) {
        await tx.invoice.update({ where: { id: inv.id }, data: { status: 'PAID' } });
        if (inv.milestoneId) await tx.milestone.updateMany({ where: { id: inv.milestoneId, status: 'INVOICED' }, data: { status: 'PAID', changedAt: new Date() } });
      }
      return cn;
    });
    await this.audit.log(who, `Issued ${cn.no} against ${inv.no}${who.demo ? ` (demo, by ${me.name})` : ''}`, 'icon-receipt', 'invoice');
    const r = await this.docs.emailCredit(cn.id, me.id);
    return { message: `${cn.no} issued. ${inr(total)} off ${inv.no}.${r.ok ? ' Emailed to the customer.' : mailNote(r)}` };
  }
}
