import { Controller, Get, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { fmtD, inr } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { AccessService } from '../core/access.service';
import { Me } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';
import { d } from '../core/util';

export interface Hit { type: string; id: string; title: string; sub: string; href?: string; open?: 'task' | 'meeting' }

const I = (q: string) => ({ contains: q, mode: 'insensitive' as const });

/** One search box across the records this person can see. Each group returns its best few matches. */
@Controller('search')
export class SearchController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async search(@Me() me: AuthUser, @Query('q') raw = ''): Promise<{ q: string; groups: { type: string; label: string; hits: Hit[] }[] }> {
    const q = String(raw).trim().slice(0, 100);
    if (q.length < 2) return { q, groups: [] };
    const has = (p: string) => AccessService.has(me, p); const take = 6;
    const taskNo = /^(tsk-?)?(\d{2,6})$/i.exec(q)?.[2];
    const jobs: Promise<{ type: string; label: string; hits: Hit[] }>[] = [];
    const add = (type: string, label: string, fn: () => Promise<Hit[]>) => jobs.push(fn().then(hits => ({ type, label, hits })));

    if (has('customer.read')) add('customer', 'Customers', async () => (await this.prisma.customer.findMany({ where: { archived: false, OR: [{ name: I(q) }, { gstin: I(q) }, { city: I(q) }, { contact: I(q) }, { email: I(q) }] }, take }))
      .map(c => ({ type: 'customer', id: c.id, title: c.name, sub: `${c.gstin} · ${c.city}`, href: `/customers/${c.id}` })));
    if (has('project.read')) add('project', 'Projects', async () => (await this.prisma.project.findMany({ where: { OR: [{ name: I(q) }, { code: I(q) }, { bu: I(q) }, { customer: { name: I(q) } }] }, include: { customer: true }, take }))
      .map(p => ({ type: 'project', id: p.id, title: p.name, sub: `${p.code} · ${p.customer.name} · ${p.health}`, href: `/projects/${p.id}` })));
    if (has('task.read')) add('task', 'Tasks', async () => {
      const scope: Prisma.TaskWhereInput = has('task.read_all') ? {} : { OR: [{ assigneeId: me.id }, { reporterId: me.id }] };
      const rows = await this.prisma.task.findMany({ where: { AND: [scope, { OR: [{ title: I(q) }, { desc: I(q) }, ...(taskNo ? [{ key: +taskNo }] : [])] }] }, include: { project: true, assignee: true }, orderBy: [{ status: 'asc' }, { due: 'asc' }], take });
      return rows.map(t => ({ type: 'task', id: t.id, title: t.title, sub: `TSK-${t.key} · ${t.project.name} · ${t.assignee.name}${t.status === 'done' ? ' · Done' : ` · due ${fmtD(d(t.due))}`}`, open: 'task' as const }));
    });
    add('meeting', 'Meetings', async () => (await this.prisma.meeting.findMany({ where: { AND: [{ OR: [{ organizerId: me.id }, { attendees: { some: { userId: me.id } } }] }, { OR: [{ title: I(q) }, { agenda: I(q) }, { notes: I(q) }, { ext: I(q) }] }] }, orderBy: { date: 'desc' }, take }))
      .map(m => ({ type: 'meeting', id: m.id, title: m.title, sub: `${fmtD(d(m.date))} · ${m.loc}`, open: 'meeting' as const })));
    if (has('quote.read')) add('quote', 'Quotations', async () => (await this.prisma.quote.findMany({ where: { OR: [{ no: I(q) }, { title: I(q) }, { customer: { name: I(q) } }] }, include: { customer: true }, orderBy: { date: 'desc' }, take }))
      .map(x => ({ type: 'quote', id: x.id, title: `${x.no} · ${x.title}`, sub: `${x.customer.name} · ${x.status.replace('_', ' ').toLowerCase()}`, href: `/quotes/${x.id}` })));
    if (has('invoice.read')) add('invoice', 'Invoices', async () => (await this.prisma.invoice.findMany({ where: { OR: [{ no: I(q) }, { title: I(q) }, { customer: { name: I(q) } }] }, include: { customer: true }, orderBy: { date: 'desc' }, take }))
      .map(x => ({ type: 'invoice', id: x.id, title: `${x.no} · ${x.title}`, sub: `${x.customer.name} · due ${fmtD(d(x.due))} · ${x.status.replace('_', ' ').toLowerCase()}`, href: `/invoices/${x.id}` })));
    if (has('payment.read')) add('payment', 'Payments', async () => (await this.prisma.payment.findMany({ where: { OR: [{ no: I(q) }, { ref: I(q) }, { customer: { name: I(q) } }] }, include: { customer: true, allocations: { include: { invoice: true } } }, orderBy: { date: 'desc' }, take }))
      .map(p => ({ type: 'payment', id: p.id, title: `${p.no} · ${inr(p.allocations.reduce((a, x) => a + x.amount, 0))}`, sub: `${p.customer.name} · ${p.method} ${p.ref} · ${fmtD(d(p.date))}`, href: p.allocations[0] ? `/invoices/${p.allocations[0].invoiceId}` : '/payments' })));
    if (has('credit_note.read')) add('credit', 'Credit notes', async () => (await this.prisma.creditNote.findMany({ where: { OR: [{ no: I(q) }, { reason: I(q) }, { invoice: { no: I(q) } }] }, include: { invoice: true }, take }))
      .map(c => ({ type: 'credit', id: c.id, title: `${c.no} · ${inr(c.total)}`, sub: `Against ${c.invoice.no} · ${c.reason}`, href: `/invoices/${c.invoiceId}` })));
    if (has('customer.read')) add('deal', 'Pipeline', async () => (await this.prisma.opportunity.findMany({ where: { OR: [{ name: I(q) }, { next: I(q) }, { customer: { name: I(q) } }] }, include: { customer: true }, take }))
      .map(o => ({ type: 'deal', id: o.id, title: o.name, sub: `${o.customer.name} · ${inr(o.value)}`, href: '/pipeline' })));
    if (has('asset.read')) add('asset', 'Assets', async () => (await this.prisma.asset.findMany({ where: { OR: [{ name: I(q) }, { code: I(q) }, { cat: I(q) }] }, take }))
      .map(a => ({ type: 'asset', id: a.id, title: a.name, sub: `${a.code} · ${a.cat}`, href: '/assets' })));
    add('person', 'People', async () => (await this.prisma.user.findMany({ where: { status: { not: 'Deactivated' }, OR: [{ name: I(q) }, { email: I(q) }, { title: I(q) }, { dept: I(q) }] }, include: { role: true }, take }))
      .map(u => ({ type: 'person', id: u.id, title: u.name, sub: `${u.title || u.role.name}${u.dept ? ` · ${u.dept}` : ''} · ${u.status === 'Invited' ? 'invited' : u.email}`, href: u.status === 'Active' ? `/team/${u.id}` : has('user.read') ? '/settings/users' : undefined })));

    // Best matches first: a hit whose title starts with the query (or a word in it does) beats one found only in a note.
    const ql = q.toLowerCase();
    const score = (h: Hit) => { const t = h.title.toLowerCase(); return t.startsWith(ql) ? 3 : t.split(/[\s·—\-/,(]+/).some(w => w.startsWith(ql)) ? 2 : t.includes(ql) ? 1 : 0; };
    const groups = (await Promise.all(jobs)).filter(g => g.hits.length)
      .map((g, i) => { const hits = [...g.hits].sort((a, b) => score(b) - score(a)); return { g: { ...g, hits }, i, best: score(hits[0]) }; })
      .sort((a, b) => b.best - a.best || a.i - b.i).map(x => x.g);
    return { q, groups };
  }
}
