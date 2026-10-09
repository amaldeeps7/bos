import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Line, calc, diffDays, fmtD, fmtDLong, inr, stateOf, UNISSUED } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { OrgService } from '../core/org.service';
import { PdfService, Template } from '../core/pdf.service';
import { MailService, fill, htmlOf } from '../core/mail.service';
import { d } from '../core/util';

const initials = (n: string) => n.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

/** Builds PDFs for quotations, invoices and credit notes, and emails them to customers. */
@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService, private orgs: OrgService, private pdf: PdfService, private mail: MailService) {}

  private async base() {
    const c = await this.orgs.ctx();
    if (!c.entity) throw new BadRequestException('Set up a legal entity first (Settings → Legal entities)');
    const e = c.entity;
    const entity = { name: e.name, gstin: e.gstin, lines: [e.address], bank: e.bank, upi: e.upi, initials: initials(c.org.name) };
    return { c, entity, templates: c.org.templates as unknown as Record<'invoice' | 'quote', Template & { subject: string }> };
  }
  private party(cu: { name: string; gstin: string; city: string; contact: string }) {
    return { name: cu.name, gstin: cu.gstin, lines: [`${cu.city}, ${stateOf(cu.gstin) || ''}`, cu.contact ? `Attn: ${cu.contact}` : ''].filter(Boolean) };
  }
  private supply(intra: boolean, state?: string) { return intra ? 'Intra-state supply · CGST + SGST' : `Inter-state supply to ${state} · IGST`; }

  async quotePdf(id: string) {
    const q = await this.prisma.quote.findUnique({ where: { id }, include: { customer: true } }); if (!q) throw new NotFoundException();
    const { c, entity, templates } = await this.base(); const st = stateOf(q.customer.gstin);
    const k = calc(q.lines as unknown as Line[], st, c.ourState, c.sacRates);
    const by = await this.prisma.user.findUnique({ where: { id: q.byId } });
    const buffer = await this.pdf.render({ template: templates.quote, no: q.no, entity, to: this.party(q.customer), toLabel: 'Prepared for', calc: k, notes: q.notes, supplyNote: this.supply(k.intra, st),
      meta: [['Date', fmtDLong(d(q.date))], ['Valid until', fmtDLong(d(q.validUntil))], ...(q.ver > 1 ? [['Version', String(q.ver)] as [string, string]] : []), ['Prepared by', by?.name || '']] });
    return { buffer, filename: `${q.no}.pdf`, q, k };
  }

  async invoicePdf(id: string) {
    const i = await this.prisma.invoice.findUnique({ where: { id }, include: { customer: true, allocations: true, credits: true } }); if (!i) throw new NotFoundException();
    const { c, entity, templates } = await this.base(); const st = stateOf(i.customer.gstin);
    const k = calc(i.lines as unknown as Line[], st, c.ourState, c.sacRates);
    const paid = i.allocations.reduce((a, x) => a + x.amount, 0), credited = i.credits.reduce((a, x) => a + x.total, 0);
    const issued = !UNISSUED.includes(i.status);
    const tpl = issued ? templates.invoice : { ...templates.invoice, title: `${templates.invoice.title} (draft)` };
    const buffer = await this.pdf.render({ template: tpl, no: i.no, entity, to: this.party(i.customer), toLabel: 'Bill to', calc: k, notes: i.notes, supplyNote: this.supply(k.intra, st),
      meta: [['Invoice date', fmtDLong(d(i.date))], ['Due date', fmtDLong(d(i.due))], ['Terms', `Net ${diffDays(d(i.due), d(i.date))}`], ['Place of supply', st || '']],
      extraTotals: [...(paid ? [['Received', '−' + inr(paid)] as [string, string]] : []), ...(credited ? [['Credited', '−' + inr(credited)] as [string, string]] : [])],
      balance: paid || credited ? Math.max(0, k.grand - paid - credited) : undefined });
    return { buffer, filename: `${i.no}.pdf`, i, k, bal: Math.max(0, k.grand - paid - credited) };
  }

  async creditPdf(id: string) {
    const cn = await this.prisma.creditNote.findUnique({ where: { id }, include: { invoice: { include: { customer: true } } } }); if (!cn) throw new NotFoundException();
    const { c, entity, templates } = await this.base(); const st = stateOf(cn.invoice.customer.gstin);
    const k = calc([{ d: `Credit against ${cn.invoice.no}: ${cn.reason}`, qty: 1, unit: 'credit', rate: cn.taxable, disc: 0, sac: (cn.invoice.lines as any)[0]?.sac || '998314' }], st, c.ourState, c.sacRates);
    const buffer = await this.pdf.render({ template: { ...templates.invoice, title: 'Credit note', show: { ...templates.invoice.show, upi: false, bank: false } }, no: cn.no, entity, to: this.party(cn.invoice.customer), toLabel: 'Issued to',
      calc: k, supplyNote: this.supply(k.intra, st), reference: `Against invoice ${cn.invoice.no} dated ${fmtD(d(cn.invoice.date))}`,
      meta: [['Date', fmtDLong(d(cn.date))], ['Original invoice', cn.invoice.no]] });
    return { buffer, filename: `${cn.no}.pdf`, cn };
  }

  private async sender(userId: string) { return this.prisma.user.findUnique({ where: { id: userId } }); }

  async emailQuote(id: string, userId: string) {
    const { buffer, filename, q, k } = await this.quotePdf(id); const { c, templates, entity } = await this.base(); const u = await this.sender(userId);
    const vars = { number: q.no, customer: q.customer.name, amount: inr(k.grand), due: fmtD(d(q.validUntil)), contact: q.customer.contact.split(',')[0] || 'there' };
    const text = `Hi ${vars.contact},\n\nPlease find attached our quotation ${q.no} for ${q.title}, totalling ${vars.amount} including GST. It is valid until ${fmtDLong(d(q.validUntil))}.${q.notes ? `\n\n${q.notes}` : ''}\n\nReply to this email with any questions, or to accept.\n\nThank you,\n${u?.name || ''}\n${entity.name}`;
    const r = await this.mail.send({ to: q.customer.email, subject: fill(templates.quote.subject, vars), text, html: htmlOf(text, templates.quote.accent, templates.quote.terms), replyTo: u?.email, attachments: [{ filename, content: buffer, contentType: 'application/pdf' }], kind: 'quote', ref: q.no, userId });
    void c; return r;
  }

  async emailInvoice(id: string, userId: string) {
    const { buffer, filename, i, k, bal } = await this.invoicePdf(id); const { templates, entity } = await this.base(); const u = await this.sender(userId);
    const vars = { number: i.no, customer: i.customer.name, amount: inr(bal || k.grand), due: fmtD(d(i.due)), contact: i.customer.contact.split(',')[0] || 'there' };
    const text = `Hi ${vars.contact},\n\nPlease find attached invoice ${i.no} for ${inr(k.grand)} including GST, due on ${fmtDLong(d(i.due))}.\n\nYou can pay by bank transfer to ${entity.bank}${entity.upi ? ` or UPI to ${entity.upi}` : ''}, quoting ${i.no}.\n\nThank you,\n${u?.name || ''}\n${entity.name}`;
    return this.mail.send({ to: i.customer.email, subject: fill(templates.invoice.subject, vars), text, html: htmlOf(text, templates.invoice.accent, templates.invoice.terms), replyTo: u?.email, attachments: [{ filename, content: buffer, contentType: 'application/pdf' }], kind: 'invoice', ref: i.no, userId });
  }

  /** Payment reminder using Settings → Reminders wording, with the invoice attached. */
  async emailReminder(id: string, userId: string | undefined, ccOwner = false) {
    const { buffer, filename, i, bal } = await this.invoicePdf(id); const { c, templates } = await this.base();
    const rem = c.org.reminders as any;
    const vars = { number: i.no, customer: i.customer.name, amount: inr(bal), due: fmtD(d(i.due)), contact: i.customer.contact.split(',')[0] || 'there' };
    const text = fill(rem.body, vars);
    const owner = ccOwner ? await this.prisma.user.findUnique({ where: { id: i.customer.ownerId } }) : null;
    return this.mail.send({ to: i.customer.email, cc: owner ? [owner.email] : undefined, subject: fill(rem.subject, vars), text, html: htmlOf(text, templates.invoice.accent), attachments: [{ filename, content: buffer, contentType: 'application/pdf' }], kind: 'reminder', ref: i.no, userId });
  }

  async emailCredit(id: string, userId: string) {
    const { buffer, filename, cn } = await this.creditPdf(id); const { templates, entity } = await this.base();
    const text = `Hi ${cn.invoice.customer.contact.split(',')[0] || 'there'},\n\nPlease find attached credit note ${cn.no} for ${inr(cn.total)} against invoice ${cn.invoice.no}.\n\nReason: ${cn.reason}\n\nThank you,\n${entity.name}`;
    return this.mail.send({ to: cn.invoice.customer.email, subject: `Credit note ${cn.no} from ${entity.name}`, text, html: htmlOf(text, templates.invoice.accent), attachments: [{ filename, content: buffer, contentType: 'application/pdf' }], kind: 'invoice', ref: cn.no, userId });
  }
}

/** A short suffix for toast messages when email isn't set up or failed. */
export const mailNote = (r: { ok: boolean; error?: string }) => (r.ok ? '' : r.error?.includes('not configured') ? ' (Email isn’t set up yet — nothing was sent.)' : ` (Email failed: ${r.error})`);
