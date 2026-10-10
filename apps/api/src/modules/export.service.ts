import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';
import JSZip from 'jszip';
import { PrismaService } from '../core/prisma.service';
import { MailService, htmlOf } from '../core/mail.service';
import { orgId, runAs } from '../core/tenant';
import type { AuthUser } from '../core/auth.types';
import { QueueService } from '../core/queue.service';
import { DocumentsService } from './documents.service';

const TTL_DAYS = 7;
const root = () => resolve(process.env.STORAGE_DIR || './storage');
/** Files live under orgs/{orgId}/… so one organisation's files never sit with another's (spec §6). */
export const orgDir = (org: string) => join(root(), 'orgs', org);
const secret = () => process.env.JWT_SECRET || 'dev-secret-change-me';
const web = () => (process.env.WEB_ORIGIN || 'http://localhost:3000').split(',')[0].replace(/\/$/, '');

const csv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => { const s = v instanceof Date ? v.toISOString() : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n') + '\n';
};

/** Full data export: CSV + JSON of every record, plus a PDF of every issued document, as a ZIP (spec §7). */
@Injectable()
export class ExportService {
  private log = new Logger('Export');
  constructor(private prisma: PrismaService, private mail: MailService, private docs: DocumentsService, private queue: QueueService) {
    queue.handle('export', (j: { orgId: string; id: string; me: { id: string; email: string; name: string } }) =>
      runAs({ orgId: j.orgId, membershipId: j.me.id, scope: { all: true } }, () => this.build(j.id, j.me)));
  }

  signedUrl(org: string, id: string, expiresAt: Date) {
    const exp = expiresAt.getTime();
    const sig = createHmac('sha256', secret()).update(`${org}.${id}.${exp}`).digest('hex');
    return `${web()}/api/exports/${org}/${id}?exp=${exp}&sig=${sig}`;
  }

  async start(me: AuthUser) {
    const x = await this.prisma.dataExport.create({ data: { requestedById: me.id, expiresAt: new Date(Date.now() + TTL_DAYS * 86400_000) } });
    // Built by a background worker, as this organisation only; retried if the worker restarts mid-way.
    await this.queue.add('export', { orgId: orgId(), id: x.id, me: { id: me.id, email: me.email, name: me.name } }, { jobId: `export-${x.id}` });
    return x;
  }

  async build(id: string, me: { id: string; email: string; name: string }) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId() } });
    try {
      const p = this.prisma;
      const [customers, projects, tasks, quotes, invoices, payments, credits, entities, people, catalog, assets, meetings] = await Promise.all([
        p.customer.findMany(), p.project.findMany({ include: { milestones: true } }), p.task.findMany(), p.quote.findMany(), p.invoice.findMany(),
        p.payment.findMany({ include: { allocations: true } }), p.creditNote.findMany(), p.legalEntity.findMany(),
        p.membership.findMany({ select: { id: true, name: true, email: true, title: true, dept: true, status: true, roleId: true, managerId: true, createdAt: true } }),
        p.catalogItem.findMany(), p.asset.findMany(), p.meeting.findMany({ include: { attendees: true, actions: true } }),
      ]);
      const zip = new JSZip();
      const all = { organisation: { id: org.id, name: org.name, slug: org.slug, exportedAt: new Date().toISOString() }, entities, people, customers, projects, tasks, meetings, quotes, invoices, payments, creditNotes: credits, catalog, assets };
      zip.file('data.json', JSON.stringify(all, null, 2));
      const flat = (rows: any[]) => rows.map(({ lines, milestones, allocations, attendees, actions, ...r }) => r);
      for (const [name, rows] of Object.entries({ customers, projects, tasks, quotes, invoices, payments, 'credit-notes': credits, people, assets })) zip.file(`csv/${name}.csv`, csv(flat(rows as any[])));
      // Issued documents only: drafts have no number yet.
      for (const q of quotes.filter(q => q.status !== 'DRAFT')) zip.file(`pdf/quotations/${q.no}.pdf`, (await this.docs.quotePdf(q.id)).buffer);
      for (const i of invoices.filter(i => !['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(i.status))) zip.file(`pdf/invoices/${i.no}.pdf`, (await this.docs.invoicePdf(i.id)).buffer);
      for (const c of credits) zip.file(`pdf/credit-notes/${c.no}.pdf`, (await this.docs.creditPdf(c.id)).buffer);
      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      const path = join(orgDir(org.id), 'exports', `${id}.zip`);
      await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, buf);
      const x = await this.prisma.dataExport.update({ where: { id }, data: { status: 'Ready', path, size: buf.length } });
      const link = this.signedUrl(org.id, id, x.expiresAt);
      const text = `Hi ${me.name.split(' ')[0]},\n\nYour full export of ${org.name} is ready (${(buf.length / 1048576).toFixed(1)} MB): customers, projects, tasks, documents and payments as CSV and JSON, plus every issued PDF.\n\nDownload it here. The link expires in ${TTL_DAYS} days:\n${link}`;
      await this.mail.send({ to: me.email, subject: `Your ${org.name} export is ready`, text, html: htmlOf(text), kind: 'export', ref: id, userId: me.id });
    } catch (e) {
      this.log.error(`export ${id} failed: ${(e as Error).message}`);
      await this.prisma.dataExport.update({ where: { id }, data: { status: 'Failed', error: (e as Error).message.slice(0, 500) } });
    }
  }

  /** Checks the signature and expiry, then opens the file as that organisation. */
  async open(org: string, id: string, exp: number, sig: string) {
    const want = createHmac('sha256', secret()).update(`${org}.${id}.${exp}`).digest('hex');
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) throw new BadRequestException('This download link isn’t valid.');
    if (!exp || exp < Date.now()) throw new BadRequestException('This download link has expired. Request a new export.');
    const o = await this.prisma.organization.findUnique({ where: { id: org } });
    const x = o && o.status === 'active' ? await runAs({ orgId: org }, () => this.prisma.dataExport.findUnique({ where: { id } })) : null;
    if (!x || x.status !== 'Ready' || !x.path) throw new NotFoundException('Export not found');
    if (!resolve(x.path).startsWith(orgDir(org))) throw new NotFoundException('Export not found');
    return { name: `${o!.slug}-export-${x.createdAt.toISOString().slice(0, 10)}.zip`, stream: createReadStream(x.path) };
  }

  /** Deletes export files past their expiry (called by the scheduler for each organisation). */
  async expire() {
    const old = await this.prisma.dataExport.findMany({ where: { expiresAt: { lt: new Date() }, path: { not: null } } });
    for (const x of old) { await fs.rm(x.path!, { force: true }); await this.prisma.dataExport.update({ where: { id: x.id }, data: { path: null } }); }
  }
}
