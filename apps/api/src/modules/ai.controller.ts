import { BadRequestException, Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PERM_GROUPS, addDays, diffDays, fmtD, inr, permLabel } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { AccessService } from '../core/access.service';
import { Me, Perm } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';
import { d, str } from '../core/util';
import { FinanceService } from './finance.service';

type Action = { label: string; kind: 'navigate' | 'reassign' | 'copy' | 'remind'; payload?: Record<string, string> };
type Reply = { text: string; bullets?: string[]; action?: Action };

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';

/** The assistant. Suggested questions are answered from live records; free text goes to Claude when a key is configured. */
@Controller('ai')
export class AiController {
  private log = new Logger('AI');
  private client: Anthropic | null = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

  constructor(private prisma: PrismaService, private fin: FinanceService) {}

  private async data(me: AuthUser) {
    const c = await this.fin.ctx();
    const [projects, tasks, approvals, users, invoices, quotes, opps, assets, catalog, roles, legacy] = await Promise.all([
      this.prisma.project.findMany({ include: { milestones: { orderBy: { seq: 'asc' } }, customer: true } }),
      this.prisma.task.findMany({ where: AccessService.has(me, 'task.read_all') ? {} : { OR: [{ assigneeId: me.id }, { reporterId: me.id }] } }),
      this.prisma.approval.findMany({ where: { approverId: me.id, status: 'PENDING' } }),
      this.prisma.user.findMany(), this.prisma.invoice.findMany({ include: { customer: true } }), this.prisma.quote.findMany({ include: { customer: true } }),
      this.prisma.opportunity.findMany({ include: { customer: true } }), this.prisma.asset.findMany(), this.prisma.catalogItem.findMany(),
      this.prisma.role.findMany(), this.prisma.legacyMonth.findMany({ orderBy: { month: 'desc' }, take: 1 }),
    ]);
    const name = (id: string) => users.find(u => u.id === id)?.name || '';
    return { c, projects, tasks, approvals, users, invoices, quotes, opps, assets, catalog, roles, legacy, name };
  }

  @Post('suggest') @HttpCode(200) @Perm('ai.use')
  async suggest(@Me() me: AuthUser, @Body() b: any): Promise<Reply> {
    const key = str(b.key, 'key', { required: true });
    const D = await this.data(me); const { c, name } = D; const today = c.today;
    const open = D.tasks.filter(t => t.status !== 'done');
    const mine = open.filter(t => t.assigneeId === me.id);
    const due = (t: { due: Date }) => diffDays(d(t.due), today);
    const stats = (p: typeof D.projects[number]) => {
      const inv = p.milestones.filter(m => ['INVOICED', 'PAID'].includes(m.status)).reduce((a, m) => a + m.value, 0);
      const paid = p.milestones.filter(m => m.status === 'PAID').reduce((a, m) => a + m.value, 0);
      const done = p.milestones.reduce((a, m) => a + (['COMPLETED', 'INVOICED', 'PAID'].includes(m.status) ? m.value : m.status === 'IN_PROGRESS' ? m.value * 0.5 : 0), 0);
      return { inv, paid, pct: Math.round(done / (p.contract || 1) * 100), next: p.milestones.find(m => ['IN_PROGRESS', 'PENDING'].includes(m.status)) };
    };
    const load = (uid: string) => open.filter(t => t.assigneeId === uid);

    switch (key) {
      case 'plan': {
        const bullets = [
          ...D.approvals.map(a => `Approve ${a.ref} — ${name(a.requestedById).split(' ')[0]} is waiting on you${a.amount ? ` (${inr(a.amount)})` : ''}.`),
          ...mine.filter(t => due(t) < 0).map(t => `${t.title} — ${-due(t)} day${due(t) < -1 ? 's' : ''} overdue.`),
          ...mine.filter(t => due(t) === 0).map(t => `${t.title} — due today${t.status === 'doing' ? ' (in progress)' : ''}.`),
        ].slice(0, 6);
        return bullets.length ? { text: "Here's today, ordered by who's waiting on you first:", bullets } : { text: 'Nothing is overdue or waiting on you. A good day to get ahead on next week.' };
      }
      case 'risk': {
        const risky = D.projects.filter(p => p.health === 'At risk');
        const unbilled = D.projects.flatMap(p => p.milestones.filter(m => m.status === 'COMPLETED').map(m => `${m.name} finished ${Math.max(0, -diffDays(d(m.due), today))} days ago and hasn’t been invoiced: ${inr(m.value)} sitting unbilled.`));
        const overdueBy = D.projects.map(p => ({ p, n: open.filter(t => t.projectId === p.id && due(t) < 0).length })).filter(x => x.n);
        const bullets = [
          ...risky.map(p => { const n = stats(p).next; const owners = new Set(open.filter(t => t.projectId === p.id).map(t => t.assigneeId)); return `${p.name} — ${n ? `${n.name} is due ${fmtD(d(n.due))} with ${open.filter(t => t.projectId === p.id).length} tasks open` : 'health is At risk'}${owners.size === 1 ? `, and ${name([...owners][0]).split(' ')[0]} owns all of them` : ''}.`; }),
          ...unbilled, ...overdueBy.filter(x => x.p.health !== 'At risk').map(x => `${x.p.name} has ${x.n} overdue task${x.n > 1 ? 's' : ''}.`),
        ];
        return bullets.length ? { text: `${risky.length || 'No'} project${risky.length === 1 ? ' looks' : 's look'} at risk this week:`, bullets, action: risky[0] ? { label: `Open ${risky[0].name.split(' ').slice(0, 2).join(' ')}`, kind: 'navigate', payload: { href: `/projects/${risky[0].id}` } } : undefined } : { text: 'Nothing looks at risk this week.' };
      }
      case 'status': {
        const p = D.projects.find(x => x.id === b.projectId) || D.projects.find(x => x.health === 'On track') || D.projects[0];
        const s = stats(p); const done = p.milestones.filter(m => ['COMPLETED', 'INVOICED', 'PAID'].includes(m.status)).map(m => m.name);
        const last = p.milestones[p.milestones.length - 1];
        return { text: `Draft for ${p.customer.name}:\n\nHi team — ${p.name} is ${s.pct}% through. ${done.length ? `${done.join(' and ')} ${done.length > 1 ? 'are' : 'is'} complete; ` : ''}${s.next ? `${s.next.name.toLowerCase()} is under way and due ${fmtD(d(s.next.due))}.` : 'all milestones are delivered.'} ${last && last !== s.next ? `${last.name} remains planned for ${fmtD(d(last.due))}.` : ''}\n\n— ${me.name.split(' ')[0]}`, action: { label: 'Copy to clipboard', kind: 'copy' } };
      }
      case 'summary': {
        const p = D.projects.find(x => x.id === b.projectId); if (!p) return { text: 'Open a project to summarise it.' };
        const s = stats(p); const po = open.filter(t => t.projectId === p.id); const over = po.filter(t => due(t) < 0).length;
        return { text: `${p.name} for ${p.customer.name} is ${s.pct}% through.`, bullets: [`${inr(s.inv)} invoiced of ${inr(p.contract)}; ${inr(s.paid)} collected.`, s.next ? `Next milestone: ${s.next.name}, due ${fmtD(d(s.next.due))}.` : 'All milestones are complete.', `${po.length} open tasks${over ? `, ${over} overdue` : ''}.`, p.health === 'At risk' ? 'Health is At risk — workload on the next milestone sits with one person.' : `Health: ${p.health}.`] };
      }
      case 'bill': {
        const ready = D.projects.flatMap(p => p.milestones.filter(m => m.status === 'COMPLETED').map(m => `${m.name} (${p.name}) — ${inr(m.value)}`));
        return ready.length ? { text: 'These milestones are complete and not yet invoiced:', bullets: ready } : { text: 'Nothing is waiting to be billed. Every completed milestone has an invoice.' };
      }
      case 'load': {
        const team = D.users.filter(u => u.status === 'Active' && u.id !== me.id && open.some(t => t.assigneeId === u.id)).map(u => ({ u, n: load(u.id).length, week: load(u.id).filter(t => due(t) <= 7).length })).sort((a, z) => z.n - a.n);
        if (team.length < 2) return { text: 'Workload looks balanced.' };
        const [top, ...rest] = team; const light = rest[rest.length - 1];
        if (top.n - light.n < 3) return { text: `Workload looks balanced now: ${team.map(x => `${x.u.name.split(' ')[0]} has ${x.n} open`).join(', ')}.` };
        const move = load(top.u.id).filter(t => t.status !== 'doing').sort((a, z) => due(z) - due(a))[0];
        return { text: `${top.u.name.split(' ')[0]} has ${top.n} open tasks, ${top.week} of them due this week — the heaviest load on the team. ${light.u.name.split(' ')[0]} has ${light.n}.`,
          bullets: move ? [`Suggest moving “${move.title}” to ${light.u.name.split(' ')[0]} — it isn’t on the critical path.`] : [],
          action: move && AccessService.has(me, 'task.assign') ? { label: `Reassign to ${light.u.name.split(' ')[0]}`, kind: 'reassign', payload: { taskId: move.id, assigneeId: light.u.id } } : undefined };
      }
      case 'approvals': return D.approvals.length ? { text: `${D.approvals.length} decision${D.approvals.length > 1 ? 's are' : ' is'} waiting on you:`, bullets: D.approvals.map(a => `${a.kind}: ${a.title}${a.amount ? ` (${inr(a.amount)})` : ''}`) } : { text: 'Nothing is waiting on you.' };
      case 'deals': {
        const stale = D.opps.filter(o => o.stage >= 1 && o.stage < 4).sort((a, z) => z.value - a.value).slice(0, 3);
        return stale.length ? { text: `${stale.length} deal${stale.length > 1 ? 's need' : ' needs'} a follow-up:`, bullets: stale.map(o => `${o.name} (${o.customer.name}, ${inr(o.value)}) — ${o.next}.`) } : { text: 'No open deals need a follow-up.' };
      }
      case 'role': {
        const r = D.roles.find(x => x.name === 'Field staff'); const pm = new Set(r?.perms || []);
        const list = PERM_GROUPS.filter(g => (!g.mod || me.modules[g.mod] !== false) && g.perms.some(([k]) => pm.has(k))).map(g => `${g.name}: ${g.perms.filter(([k]) => pm.has(k)).map(([k]) => permLabel(k).toLowerCase()).join(', ')}`);
        return { text: 'Field staff can:', bullets: list.length ? list : ['Nothing beyond My Work.'], action: { label: 'Open their permissions', kind: 'navigate', payload: { href: '/settings/roles?role=Field%20staff' } } };
      }
      case 'perm': {
        const who = D.roles.filter(r => r.builtIn || r.perms.includes('invoice.approve')).map(r => r.name);
        const own = D.roles.filter(r => r.builtIn || r.perms.includes('invoice.approve_own')).map(r => r.name);
        return { text: `Invoices can be approved by: ${who.join(', ') || 'nobody'}.`, bullets: [own.length ? `${own.join(' and ')} can also approve invoices they raised themselves.` : 'Nobody can approve an invoice they raised.', 'Change it under Roles & permissions → All roles side by side.'] };
      }
      case 'owed': {
        const m = new Map<string, number>(); D.invoices.forEach(i => { const bal = this.fin.invInfo(i, c).bal; if (bal) m.set(i.customer.name, (m.get(i.customer.name) || 0) + bal); });
        const top = [...m.entries()].sort((a, z) => z[1] - a[1]);
        return top.length ? { text: 'Outstanding by customer:', bullets: top.map(([n, v]) => `${n} — ${inr(v)}`) } : { text: 'Nobody owes you anything right now.' };
      }
      case 'quotes': {
        const sent = D.quotes.filter(q => q.status === 'SENT');
        return sent.length ? { text: 'These are with the customer and waiting on a reply:', bullets: sent.map(q => `${q.no} ${q.title} (${q.customer.name}) — sent ${-diffDays(d(q.date), today)} days ago, valid until ${fmtD(d(q.validUntil))}.`) } : { text: 'No quotations are waiting on a customer.' };
      }
      case 'overdue': {
        const od = D.invoices.filter(i => this.fin.invInfo(i, c).overdue);
        return od.length ? { text: `${od.length} invoice${od.length > 1 ? 's are' : ' is'} overdue:`, bullets: od.map(i => `${i.no} — ${i.customer.name}, ${inr(this.fin.invInfo(i, c).bal)} outstanding, ${-diffDays(d(i.due), today)} days late.`), action: { label: 'Send reminders', kind: 'remind' } } : { text: 'Nothing is overdue.' };
      }
      case 'month': {
        const L = D.legacy[0];
        if (!L) return { text: 'There isn’t a full month of history yet.' };
        const mon = new Date(L.month + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
        const late = D.invoices.map(i => ({ i, f: this.fin.invInfo(i, c) })).filter(x => x.f.overdue).sort((a, z) => diffDays(d(a.i.due), today) - diffDays(d(z.i.due), today))[0];
        return { text: `${mon}: invoiced ${inr(L.invoiced)}, collected ${inr(L.collected)}${L.collected > L.invoiced ? ' — collections beat billing.' : '.'}`, bullets: late ? [`${late.i.customer.name}’s remaining balance is ${-diffDays(d(late.i.due), today)} days late — the biggest drag on receivables.`] : [] };
      }
      case 'assets': { const free = D.assets.filter(a => a.status === 'AVAILABLE'); return free.length ? { text: 'Available to assign:', bullets: free.map(a => `${a.name} (${a.code})`) } : { text: 'Everything is assigned.' }; }
      case 'policy': {
        const lines: any[] = Array.isArray(b.lines) ? b.lines : [];
        if (!lines.length) return { text: 'Open a quotation to check it.' };
        const over = lines.filter(l => (+l.disc || 0) > c.discLimit);
        const off = lines.filter(l => { const x = D.catalog.find(k => k.d === l.d); return x && +l.rate !== x.rate; });
        return { text: over.length || off.length ? 'A couple of things to check:' : `This is within policy. Rates match the catalogue and no discount is over ${c.discLimit}%.`,
          bullets: [...over.map(l => `“${l.d}” has a ${l.disc}% discount — above the ${c.discLimit}% limit, so the Owner will need to approve.`), ...off.map(l => `“${l.d}” is priced at ${inr(l.rate)}, catalogue rate is ${inr(D.catalog.find(k => k.d === l.d)!.rate)}.`)] };
      }
      default: return { text: 'I can help with the suggestions below.' };
    }
  }

  /** Free-text question, answered by Claude from the records this person can see. */
  @Post('ask') @HttpCode(200) @Perm('ai.use')
  async ask(@Me() me: AuthUser, @Body() b: any): Promise<Reply> {
    const q = str(b.question, 'Question', { max: 1000 }).trim();
    if (!q) throw new BadRequestException('Ask a question');
    const fallback = { text: 'I can answer the suggested questions below. Free-text questions need an Anthropic API key — set ANTHROPIC_API_KEY on the API server.' };
    if (!this.client) return fallback;
    const D = await this.data(me); const today = D.c.today;
    const ctx = {
      me: `${me.name}, ${me.roleName}`, today: fmtD(today),
      projects: D.projects.map(p => ({ name: p.name, customer: p.customer.name, health: p.health, milestones: p.milestones.map(m => `${m.name} ${m.status} due ${fmtD(d(m.due))} ${inr(m.value)}`) })),
      tasks: D.tasks.filter(t => t.status !== 'done').map(t => `${t.title} — ${D.name(t.assigneeId)}, ${t.status}, due ${fmtD(d(t.due))}`),
      approvals: D.approvals.map(a => a.title),
      ...(AccessService.has(me, 'invoice.read') ? { invoices: D.invoices.map(i => { const f = this.fin.invInfo(i, D.c); return `${i.no} ${i.customer.name} ${f.st} total ${inr(f.k.grand)} balance ${inr(f.bal)} due ${fmtD(d(i.due))}`; }) } : {}),
      next7days: addDays(today, 7),
    };
    try {
      const params: any = {
        model: MODEL, max_tokens: 2000,
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        system: 'You are the assistant inside a business operating system for a services company. Answer briefly — under 90 words, plain text, no markdown — using only the JSON records provided. If the records don’t answer the question, say so.',
        messages: [{ role: 'user', content: `Records:\n${JSON.stringify(ctx)}\n\nQuestion: ${q}` }],
      };
      const res = await this.client.beta.messages.create(params) as any;
      if (res.stop_reason === 'refusal') return { text: 'I can’t help with that one. Try one of the suggestions below.' };
      const text = (res.content as any[]).filter(x => x.type === 'text').map(x => x.text).join('').trim();
      return { text: text || fallback.text };
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return { text: 'The assistant is busy right now. Try again in a moment.' };
      if (e instanceof Anthropic.APIError) { this.log.warn(`Claude API error ${e.status}: ${e.message}`); return { text: 'The assistant couldn’t answer just now. Try one of the suggestions below.' }; }
      throw e;
    }
  }
}
