import Anthropic from '@anthropic-ai/sdk';
import { STAGES, addDays, diffDays, fmtD, fmtT, inr, nowHours } from '@bos/shared';
import { PrismaService } from '../../core/prisma.service';
import { AccessService } from '../../core/access.service';
import type { AuthUser } from '../../core/auth.types';
import { d, toDate } from '../../core/util';
import { FinanceService } from '../finance.service';
import { SearchController } from '../search.controller';

/** What a proposal tool hands the browser: the exact API call "Confirm" makes, as the signed-in person. */
export interface Proposal { id: string; label: string; detail: string; method: 'POST' | 'PATCH'; path: string; body: Record<string, unknown> }
export interface ToolOutcome { content: string; isError?: boolean; proposal?: Proposal; status: string }

type Field = { type: 'string' | 'integer' | 'boolean' | 'array'; description: string; enum?: string[]; items?: { type: 'string' } };
type Spec = { name: string; description: string; props: Record<string, Field>; required: string[]; status: (i: any) => string; perm?: string };

/** Tool definitions. Read tools look things up; propose_* tools never change anything - the person confirms in the panel. */
const SPECS: Spec[] = [
  { name: 'search_records', description: 'Search everything the user can see (customers, projects, tasks incl. TSK-123, meetings, quotations, invoices, payments, credit notes, deals, assets, people) by name, number, GSTIN or reference. Use it to find ids.',
    props: { query: { type: 'string', description: 'Words, a document number, TSK-123, a GSTIN or a bank reference' } }, required: ['query'], status: i => `Searching for “${i.query}”` },
  { name: 'my_day', description: "The user's day: today's meetings with times and links, their open tasks due today or overdue, and approvals waiting on them.",
    props: {}, required: [], status: () => 'Looking at your day' },
  { name: 'list_tasks', description: 'Open tasks, optionally for one person or project, by status, or due soon. Includes TSK number, assignee, project, due date and status.', perm: 'task.read',
    props: { person: { type: 'string', description: '"me", a person id, or part of a name' }, project: { type: 'string', description: 'Project id, code or part of its name' },
      status: { type: 'string', enum: ['todo', 'doing', 'review', 'blocked', 'done', 'open'], description: '"open" (default) is everything not done' },
      due_within_days: { type: 'integer', description: 'Only tasks due within this many days (overdue included)' } },
    required: [], status: () => 'Looking at tasks' },
  { name: 'get_project', description: 'One project: customer, health, contract value, milestones (status, due, value, billed or paid), open tasks and the people on it.', perm: 'project.read',
    props: { project: { type: 'string', description: 'Project id, code (PRJ-0024) or part of its name' } }, required: ['project'], status: i => `Opening ${i.project}` },
  { name: 'list_invoices', description: 'Invoices with number, customer, status, total, balance and due date. Filter overdue, unpaid, drafts or a customer.', perm: 'invoice.read',
    props: { filter: { type: 'string', enum: ['overdue', 'unpaid', 'draft', 'all'], description: 'Default "unpaid"' }, customer: { type: 'string', description: 'Part of a customer name' } },
    required: [], status: () => 'Looking at invoices' },
  { name: 'get_customer', description: 'One customer: contact, billing email, payment terms, outstanding balance, invoices, open quotations, projects and deals.', perm: 'customer.read',
    props: { customer: { type: 'string', description: 'Customer id or part of the name' } }, required: ['customer'], status: i => `Opening ${i.customer}` },
  { name: 'list_meetings', description: 'Meetings the user (or another person) attends in a date range, with times, attendees, location/link and project.',
    props: { person: { type: 'string', description: '"me" (default), a person id or part of a name' }, from_day: { type: 'integer', description: 'Days from today, e.g. -7. Default 0' },
      to_day: { type: 'integer', description: 'Days from today, inclusive. Default 7' } }, required: [], status: () => 'Checking calendars' },
  { name: 'team_overview', description: 'Everyone in the organisation: title, team, manager, whether they are in a meeting now or on leave, and their open/overdue task counts.',
    props: {}, required: [], status: () => 'Looking at the team' },
  { name: 'list_deals', description: 'Pipeline deals: name, customer, value, stage and next step.', perm: 'customer.read',
    props: {}, required: [], status: () => 'Looking at the pipeline' },
  { name: 'list_approvals', description: 'Approvals waiting on the user: what, who asked, amount, since when.', perm: 'approval.read',
    props: {}, required: [], status: () => 'Looking at approvals' },
  { name: 'propose_create_task', description: 'Propose a new task. Nothing happens until the user clicks Confirm. Resolve the project and assignee first.', perm: 'task.create',
    props: { title: { type: 'string', description: 'Short imperative title' }, project: { type: 'string', description: 'Project id, code or name' },
      assignee: { type: 'string', description: '"me" (default), person id or name' }, due: { type: 'string', description: 'YYYY-MM-DD' },
      priority: { type: 'string', enum: ['Low', 'Medium', 'High'], description: 'Default Medium' } }, required: ['title', 'project', 'due'], status: () => 'Preparing a task' },
  { name: 'propose_update_task', description: 'Propose reassigning a task, changing its status or moving its due date. Nothing happens until the user confirms.', perm: 'task.update',
    props: { task: { type: 'string', description: 'Task id or TSK-123' }, assignee: { type: 'string', description: 'Person id or name to reassign to' },
      status: { type: 'string', enum: ['todo', 'doing', 'review', 'blocked', 'done'], description: 'New status' }, due: { type: 'string', description: 'New due date, YYYY-MM-DD' } },
    required: ['task'], status: () => 'Preparing a task change' },
  { name: 'propose_meeting', description: 'Propose a meeting with calendar invites. Check calendars with list_meetings first to pick a free slot. Nothing is sent until the user confirms.',
    props: { title: { type: 'string', description: 'Meeting title' }, date: { type: 'string', description: 'YYYY-MM-DD' }, start: { type: 'string', description: '24-hour time HH:MM, organisation time zone' },
      minutes: { type: 'integer', description: 'Length in minutes, 15-480' }, attendees: { type: 'array', items: { type: 'string' }, description: 'Person ids or names (the user is always included)' },
      project: { type: 'string', description: 'Optional project id, code or name' } }, required: ['title', 'date', 'start', 'minutes', 'attendees'], status: () => 'Preparing a meeting' },
  { name: 'propose_payment_reminder', description: "Propose emailing the customer a payment reminder for one invoice (Settings → Reminders wording). Nothing is sent until the user confirms.", perm: 'invoice.read',
    props: { invoice: { type: 'string', description: 'Invoice id or number, e.g. INV-2026-0131' } }, required: ['invoice'], status: () => 'Preparing a reminder' },
  { name: 'propose_task_comment', description: 'Propose posting a comment on a task (it notifies the assignee and reporter). Nothing is posted until the user confirms.', perm: 'task.comment',
    props: { task: { type: 'string', description: 'Task id or TSK-123' }, text: { type: 'string', description: 'The comment' } }, required: ['task', 'text'], status: () => 'Drafting a comment' },
];

/** Tools for this person (only those their role and modules allow). Strict schemas; inputs stream eagerly and are validated here. */
export function toolsFor(me: AuthUser): Anthropic.Beta.BetaTool[] {
  return SPECS.filter(s => !s.perm || AccessService.has(me, s.perm)).map(s => ({
    name: s.name, description: s.description, strict: true, eager_input_streaming: true,
    input_schema: { type: 'object', properties: s.props as any, required: s.required, additionalProperties: false },
  }) as Anthropic.Beta.BetaTool);
}
export const statusFor = (name: string, input: unknown) => { try { return SPECS.find(s => s.name === name)?.status(input) || 'Working'; } catch { return 'Working'; } };

/** Schema check on a parsed tool input (the SDK's tolerant parser can hand back a truncated object). */
export function validate(name: string, input: unknown): string | null {
  const s = SPECS.find(x => x.name === name); if (!s) return `Unknown tool ${name}`;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Input must be an object';
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!s.props[k]) return `Unknown field ${k}`;
  for (const k of s.required) if (o[k] === undefined || o[k] === '') return `Missing ${k}`;
  for (const [k, f] of Object.entries(s.props)) {
    const v = o[k]; if (v === undefined) continue;
    if (f.type === 'string' && typeof v !== 'string') return `${k} must be a string`;
    if (f.type === 'integer' && !Number.isInteger(v)) return `${k} must be an integer`;
    if (f.type === 'array' && (!Array.isArray(v) || v.some(x => typeof x !== 'string'))) return `${k} must be a list of strings`;
    if (f.enum && !f.enum.includes(v as string)) return `${k} must be one of ${f.enum.join(', ')}`;
  }
  return null;
}

class Miss extends Error {}
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const j = (x: unknown) => JSON.stringify(x);

/** Runs tools as the signed-in person, inside their organisation (RLS + tenant filter + access scope apply to every query). */
export class AgentTools {
  constructor(private prisma: PrismaService, private fin: FinanceService, private search: SearchController, private me: AuthUser, private today: string, private tz: string) {}

  private has = (p: string) => AccessService.has(this.me, p);

  private async person(q?: string) {
    if (!q || /^(me|myself|i)$/i.test(q.trim())) return { id: this.me.id, name: this.me.name };
    const all = await this.prisma.membership.findMany({ where: { status: 'Active' }, select: { id: true, name: true, email: true } });
    const exact = all.find(u => u.id === q || u.email.toLowerCase() === q.toLowerCase() || u.name.toLowerCase() === q.toLowerCase());
    if (exact) return exact;
    const hits = all.filter(u => u.name.toLowerCase().includes(q.toLowerCase()));
    if (hits.length === 1) return hits[0];
    throw new Miss(hits.length ? `“${q}” matches ${hits.map(h => h.name).join(', ')}. Ask which one.` : `No active person matches “${q}”.`);
  }
  private async project(q: string) {
    const all = await this.prisma.project.findMany({ include: { customer: true } });
    const exact = all.find(p => p.id === q || p.code.toLowerCase() === q.toLowerCase() || p.name.toLowerCase() === q.toLowerCase());
    if (exact) return exact;
    const hits = all.filter(p => p.name.toLowerCase().includes(q.toLowerCase()) || p.customer.name.toLowerCase().includes(q.toLowerCase()));
    if (hits.length === 1) return hits[0];
    throw new Miss(hits.length ? `“${q}” matches ${hits.map(h => `${h.code} ${h.name}`).join(', ')}. Ask which one.` : `No project you can see matches “${q}”.`);
  }
  private async task(q: string) {
    const n = /^TSK-?(\d+)$/i.exec(q.trim());
    const t = await this.prisma.task.findFirst({ where: { AND: [n ? { key: +n[1] } : { id: q }, this.has('task.read_all') ? {} : { OR: [{ assigneeId: this.me.id }, { reporterId: this.me.id }] }] }, include: { assignee: true, project: true } });
    if (!t) throw new Miss(`No task you can see matches “${q}”. Use search_records or list_tasks to find it.`);
    return t;
  }

  async run(name: string, i: any, toolUseId: string): Promise<ToolOutcome> {
    const status = statusFor(name, i);
    try { return { status, ...(await this.exec(name, i, toolUseId)) }; }
    catch (e) {
      if (e instanceof Miss) return { status, content: e.message, isError: true };
      const msg = (e as { message?: string })?.message || 'failed';
      return { status, content: `That didn’t work: ${msg.slice(0, 300)}`, isError: true };
    }
  }

  private async exec(name: string, i: any, id: string): Promise<Omit<ToolOutcome, 'status'>> {
    const p = this.prisma; const me = this.me; const today = this.today;
    const due = (x: Date) => { const n = diffDays(d(x), today); return n < 0 ? `${-n}d overdue` : n === 0 ? 'due today' : `due ${fmtD(d(x))}`; };
    switch (name) {
      case 'search_records': {
        const r = await this.search.search(me, String(i.query));
        return { content: j(r.groups.map(g => ({ type: g.label, hits: g.hits.map(h => ({ id: h.id, title: h.title, detail: h.sub })) }))) || '[]' };
      }
      case 'my_day': {
        const [meetings, tasks, approvals] = await Promise.all([
          p.meeting.findMany({ where: { date: toDate(today), OR: [{ organizerId: me.id }, { attendees: { some: { userId: me.id } } }] }, orderBy: { start: 'asc' }, include: { project: true } }),
          p.task.findMany({ where: { assigneeId: me.id, status: { not: 'done' }, due: { lte: toDate(today) } }, include: { project: true }, orderBy: { due: 'asc' } }),
          p.approval.findMany({ where: { approverId: me.id, status: 'PENDING' } }),
        ]);
        const now = nowHours(this.tz);
        return { content: j({ today, now: fmtT(now),
          meetings: meetings.map(m => ({ title: m.title, time: `${fmtT(m.start)}–${fmtT(m.start + m.dur)}`, past: m.start + m.dur <= now, where: m.loc, link: m.link || undefined, project: m.project?.name })),
          tasksDueOrOverdue: tasks.map(t => ({ id: t.id, key: `TSK-${t.key}`, title: t.title, project: t.project.name, due: due(t.due), status: t.status, priority: t.priority })),
          approvalsWaiting: approvals.map(a => ({ kind: a.kind, title: a.title, amount: a.amount ? inr(a.amount) : undefined })) }) };
      }
      case 'list_tasks': {
        const who = i.person ? await this.person(i.person) : null; const pr = i.project ? await this.project(i.project) : null;
        const st = !i.status || i.status === 'open' ? { not: 'done' } : i.status;
        const rows = await p.task.findMany({ where: { AND: [this.has('task.read_all') ? {} : { OR: [{ assigneeId: me.id }, { reporterId: me.id }] },
          { status: st }, who ? { assigneeId: who.id } : {}, pr ? { projectId: pr.id } : {}, i.due_within_days !== undefined ? { due: { lte: toDate(addDays(today, i.due_within_days)) } } : {}] },
          include: { assignee: true, project: true }, orderBy: { due: 'asc' }, take: 40 });
        return { content: j(rows.map(t => ({ id: t.id, key: `TSK-${t.key}`, title: t.title, assignee: t.assignee.name, project: t.project.name, status: t.status, priority: t.priority, due: due(t.due) }))) };
      }
      case 'get_project': {
        const pr = await this.project(i.project);
        const [ms, tasks] = await Promise.all([p.milestone.findMany({ where: { projectId: pr.id }, orderBy: { seq: 'asc' } }), p.task.findMany({ where: { projectId: pr.id, status: { not: 'done' } }, include: { assignee: true } })]);
        return { content: j({ id: pr.id, code: pr.code, name: pr.name, customer: pr.customer.name, health: pr.health, status: pr.status, contract: inr(pr.contract), ends: fmtD(d(pr.endDate)),
          milestones: ms.map(m => ({ name: m.name, status: m.status, value: inr(m.value), due: fmtD(d(m.due)) })),
          openTasks: tasks.map(t => ({ key: `TSK-${t.key}`, title: t.title, assignee: t.assignee.name, status: t.status, due: due(t.due) })) }) };
      }
      case 'list_invoices': {
        const c = await this.fin.ctx(); const f = i.filter || 'unpaid';
        const rows = await p.invoice.findMany({ where: i.customer ? { customer: { name: { contains: String(i.customer), mode: 'insensitive' } } } : {}, include: { customer: true }, orderBy: { due: 'asc' } });
        const out = rows.map(x => ({ x, info: this.fin.invInfo(x, c) })).filter(({ x, info }) => f === 'all' || (f === 'draft' ? x.status === 'DRAFT' : f === 'overdue' ? info.overdue : info.bal > 0));
        return { content: j(out.slice(0, 40).map(({ x, info }) => ({ id: x.id, no: x.no, customer: x.customer.name, title: x.title, status: info.st, total: inr(info.k.grand), balance: inr(info.bal), due: fmtD(d(x.due)) }))) };
      }
      case 'get_customer': {
        const all = await p.customer.findMany({ where: { archived: false } });
        const q = String(i.customer).toLowerCase();
        const hits = all.filter(c => c.id === i.customer || c.name.toLowerCase().includes(q));
        if (hits.length !== 1) throw new Miss(hits.length ? `“${i.customer}” matches ${hits.map(h => h.name).join(', ')}.` : `No customer matches “${i.customer}”.`);
        const cu = hits[0]; const c = await this.fin.ctx();
        const [invs, quotes, projects, deals] = await Promise.all([
          this.has('invoice.read') ? p.invoice.findMany({ where: { customerId: cu.id }, orderBy: { date: 'desc' }, take: 20 }) : Promise.resolve([]),
          this.has('quote.read') ? p.quote.findMany({ where: { customerId: cu.id, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT'] } } }) : Promise.resolve([]),
          this.has('project.read') ? p.project.findMany({ where: { customerId: cu.id } }) : Promise.resolve([]), p.opportunity.findMany({ where: { customerId: cu.id } }),
        ]);
        const info = invs.map(x => ({ x, f: this.fin.invInfo(x, c) }));
        return { content: j({ id: cu.id, name: cu.name, gstin: cu.gstin || '(not registered for GST)', city: cu.city, contact: cu.contact, email: cu.email || '(none)', terms: `${cu.terms} days`,
          outstanding: inr(info.reduce((a, r) => a + r.f.bal, 0)), invoices: info.map(({ x, f }) => ({ no: x.no, status: f.st, balance: inr(f.bal), due: fmtD(d(x.due)) })),
          openQuotations: quotes.map(q2 => ({ no: q2.no, title: q2.title, status: q2.status })), projects: projects.map(pr => ({ code: pr.code, name: pr.name, health: pr.health })),
          deals: deals.map(o => ({ name: o.name, value: inr(o.value), stage: o.stage, next: o.next })) }) };
      }
      case 'list_meetings': {
        const who = await this.person(i.person); const from = i.from_day ?? 0, to = i.to_day ?? 7;
        const rows = await p.meeting.findMany({ where: { date: { gte: toDate(addDays(today, from)), lte: toDate(addDays(today, to)) }, OR: [{ organizerId: who.id }, { attendees: { some: { userId: who.id } } }] },
          include: { attendees: { include: { user: true } }, project: true }, orderBy: [{ date: 'asc' }, { start: 'asc' }] });
        return { content: j({ person: who.name, meetings: rows.map(m => ({ id: m.id, title: m.title, date: d(m.date), time: `${fmtT(m.start)}–${fmtT(m.start + m.dur)}`, where: m.loc, project: m.project?.name, attendees: m.attendees.map(a => a.user.name) })) }) };
      }
      case 'team_overview': {
        const now = nowHours(this.tz);
        const [people, live, tasks] = await Promise.all([
          p.membership.findMany({ where: { status: 'Active' }, include: { manager: true } }),
          p.meeting.findMany({ where: { date: toDate(today), start: { lte: now } }, include: { attendees: true } }),
          this.has('task.read_all') ? p.task.findMany({ where: { status: { not: 'done' } }, select: { assigneeId: true, due: true } }) : Promise.resolve([]),
        ]);
        const busy = live.filter(m => now < m.start + m.dur);
        return { content: j(people.map(u => ({ id: u.id, name: u.name, title: u.title, team: u.dept, manager: u.manager?.name,
          now: u.leaveUntil && d(u.leaveUntil) >= today ? `on leave until ${fmtD(d(u.leaveUntil))}` : busy.some(m => m.organizerId === u.id || m.attendees.some(a => a.userId === u.id)) ? 'in a meeting' : 'available',
          ...(this.has('task.read_all') ? { openTasks: tasks.filter(t => t.assigneeId === u.id).length, overdue: tasks.filter(t => t.assigneeId === u.id && d(t.due) < today).length } : {}) }))) };
      }
      case 'list_deals': {
        const rows = await p.opportunity.findMany({ include: { customer: true }, orderBy: { value: 'desc' } });
        return { content: j(rows.map(o => ({ name: o.name, customer: o.customer.name, value: inr(o.value), stage: STAGES[o.stage] || o.stage, next: o.next }))) };
      }
      case 'list_approvals': {
        const rows = await p.approval.findMany({ where: { approverId: me.id, status: 'PENDING' }, orderBy: { createdAt: 'asc' } });
        const names = new Map((await p.membership.findMany({ select: { id: true, name: true } })).map(u => [u.id, u.name]));
        return { content: j(rows.map(a => ({ kind: a.kind, ref: a.ref, title: a.title, detail: a.detail, amount: a.amount ? inr(a.amount) : undefined, from: names.get(a.requestedById), since: d(a.createdAt) }))) };
      }

      // Proposals: check everything now, so Confirm won't fail on something we could have caught.
      case 'propose_create_task': {
        if (!ISO.test(i.due)) throw new Miss('due must be YYYY-MM-DD');
        const pr = await this.project(i.project); const who = await this.person(i.assignee);
        if (who.id !== me.id && !this.has('task.assign')) throw new Miss('You can only create tasks for yourself (your role can’t assign to others).');
        const label = `Create task “${i.title}”`;
        const detail = `${pr.name} · ${who.id === me.id ? 'you' : who.name} · due ${fmtD(i.due)}${i.priority && i.priority !== 'Medium' ? ` · ${i.priority}` : ''}`;
        return this.proposal(id, label, detail, 'POST', 'tasks', { title: i.title, projectId: pr.id, assigneeId: who.id, due: i.due, priority: i.priority || 'Medium' });
      }
      case 'propose_update_task': {
        const t = await this.task(i.task); const body: Record<string, unknown> = {}; const parts: string[] = [];
        if (i.assignee) { const who = await this.person(i.assignee); if (!this.has('task.assign')) throw new Miss('Your role can’t reassign tasks.'); body.assigneeId = who.id; parts.push(`reassign to ${who.name}`); }
        if (i.status) { body.status = i.status; parts.push(`status → ${i.status}`); }
        if (i.due) { if (!ISO.test(i.due)) throw new Miss('due must be YYYY-MM-DD'); body.due = i.due; parts.push(`due ${fmtD(i.due)}`); }
        if (!parts.length) throw new Miss('Say what to change: assignee, status or due.');
        return this.proposal(id, `Update TSK-${t.key}: ${parts.join(', ')}`, `${t.title} · ${t.project.name}`, 'PATCH', `tasks/${t.id}`, body);
      }
      case 'propose_meeting': {
        if (!ISO.test(i.date) || !/^\d{1,2}:\d{2}$/.test(i.start)) throw new Miss('date must be YYYY-MM-DD and start HH:MM');
        const [h, m] = i.start.split(':').map(Number); const start = h + Math.round(m / 15) / 4;
        const dur = Math.min(8, Math.max(0.25, Math.round(i.minutes / 15) / 4));
        const people = await Promise.all((i.attendees as string[]).filter(a => !/^(me|myself)$/i.test(a)).map(a => this.person(a)));
        const pr = i.project ? await this.project(i.project) : null;
        const label = `Schedule “${i.title}”`;
        const detail = `${fmtD(i.date)}, ${fmtT(start)}–${fmtT(start + dur)} · ${['you', ...people.map(x => x.name)].join(', ')}${pr ? ` · ${pr.name}` : ''} · invites go out on confirm`;
        return this.proposal(id, label, detail, 'POST', 'meetings', { title: i.title, date: i.date, start, dur, loc: 'Google Meet', attendees: people.map(x => x.id), projectId: pr?.id ?? null });
      }
      case 'propose_payment_reminder': {
        const q = String(i.invoice);
        const inv = await p.invoice.findFirst({ where: { OR: [{ id: q }, { no: q }] }, include: { customer: true } });
        if (!inv) throw new Miss(`No invoice you can see matches “${q}”.`);
        const info = this.fin.invInfo(inv, await this.fin.ctx());
        if (info.bal <= 0) throw new Miss(`${inv.no} has nothing outstanding.`);
        if (!inv.customer.email) throw new Miss(`${inv.customer.name} has no billing email on file.`);
        return this.proposal(id, `Email a payment reminder for ${inv.no}`, `${inv.customer.name} · ${inv.customer.email} · ${inr(info.bal)} ${info.overdue ? 'overdue' : `due ${fmtD(d(inv.due))}`}`, 'POST', `invoices/${inv.id}/remind`, {});
      }
      case 'propose_task_comment': {
        const t = await this.task(i.task);
        return this.proposal(id, `Comment on TSK-${t.key}`, `“${String(i.text).slice(0, 280)}”`, 'POST', `tasks/${t.id}/comments`, { text: i.text });
      }
    }
    throw new Miss(`Unknown tool ${name}`);
  }

  private proposal(id: string, label: string, detail: string, method: Proposal['method'], path: string, body: Record<string, unknown>) {
    return { proposal: { id, label, detail, method, path, body },
      content: `Shown to the user as a proposal with Confirm and Dismiss buttons: ${label} (${detail}). It has NOT happened. Don't say it's done; tell them to confirm it if they want it.` };
  }
}
