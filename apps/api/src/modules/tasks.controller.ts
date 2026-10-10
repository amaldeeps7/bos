import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TASK_STATUS, fmtT, nowHours } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { AccessService } from '../core/access.service';
import { NotifyService } from '../core/notify.service';
import { OrgService } from '../core/org.service';
import { MailService, htmlOf } from '../core/mail.service';
import { prefsOf } from './team.controller';
import { Me, Perm } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';
import { d, oneOf, str, toDate } from '../core/util';

const STATUSES = Object.keys(TASK_STATUS);
const PRIORITIES = ['High', 'Medium', 'Low'] as const;
const RECENT_DAYS = 30; // finished tasks stay in the everyday list this long
const include = { events: { orderBy: { createdAt: 'asc' } }, blocks: true } satisfies Prisma.TaskInclude;
type TaskRow = Prisma.TaskGetPayload<{ include: typeof include }>;

export const mapTask = (t: TaskRow, meId: string, today: string) => {
  const block = t.blocks.find(b => b.userId === meId && d(b.date) === today);
  return {
    id: t.id, key: 'TSK-' + t.key, title: t.title, desc: t.desc, projectId: t.projectId, assigneeId: t.assigneeId, reporterId: t.reporterId,
    due: d(t.due), status: t.status, priority: t.priority,
    events: t.events.map(e => ({ id: e.id, userId: e.userId, kind: e.kind, text: e.text, at: e.createdAt.toISOString() })),
    block: block ? { start: block.start, dur: block.dur } : null,
  };
};

@Controller('tasks')
export class TasksController {
  constructor(private prisma: PrismaService, private notify: NotifyService, private orgs: OrgService, private mail: MailService) {}

  private where(me: AuthUser): Prisma.TaskWhereInput {
    // Your own tasks, plus every task on projects you own (so a project's owner sees the whole project).
    return AccessService.has(me, 'task.read_all') ? {} : { OR: [{ assigneeId: me.id }, { reporterId: me.id }, { project: { ownerId: me.id } }] };
  }
  private async get(me: AuthUser, id: string) {
    const t = await this.prisma.task.findFirst({ where: { id, ...this.where(me) }, include });
    if (!t) throw new NotFoundException('Task not found');
    return t;
  }
  private async out(me: AuthUser, id: string) {
    const { today } = await this.orgs.ctx();
    return mapTask(await this.get(me, id), me.id, today);
  }

  /** Open tasks, plus those finished in the last 30 days. Older finished ones page in from /tasks/history. */
  @Get() @Perm('task.read')
  async list(@Me() me: AuthUser) {
    const { today } = await this.orgs.ctx();
    const recent = new Date(Date.now() - RECENT_DAYS * 86400_000);
    const rows = await this.prisma.task.findMany({ where: { AND: [this.where(me), { OR: [{ status: { not: 'done' } }, { doneAt: { gte: recent } }, { doneAt: null }] }] }, include, orderBy: { due: 'asc' } });
    return rows.map(t => mapTask(t, me.id, today));
  }

  /** Tasks finished more than 30 days ago, newest first, 50 at a time (`before` = the last one's id). */
  @Get('history') @Perm('task.read')
  async history(@Me() me: AuthUser, @Query('before') before?: string, @Query('q') q?: string) {
    const { today } = await this.orgs.ctx();
    const recent = new Date(Date.now() - RECENT_DAYS * 86400_000);
    const cursor = before ? await this.prisma.task.findFirst({ where: { id: before, ...this.where(me) }, select: { doneAt: true, id: true } }) : null;
    const search = String(q || '').trim();
    const rows = await this.prisma.task.findMany({
      where: { AND: [this.where(me), { status: 'done', doneAt: { lt: cursor?.doneAt || recent } },
        ...(search ? [{ OR: [{ title: { contains: search, mode: 'insensitive' as const } }, ...(/^\d+$/.test(search.replace(/^TSK-/i, '')) ? [{ key: Number(search.replace(/^TSK-/i, '')) }] : [])] }] : [])] },
      include, orderBy: [{ doneAt: 'desc' }, { id: 'desc' }], take: 51 });
    return { rows: rows.slice(0, 50).map(t => mapTask(t, me.id, today)), more: rows.length > 50 };
  }

  /** One task (e.g. an old one opened from history or a link). */
  @Get(':id') @Perm('task.read')
  async one(@Me() me: AuthUser, @Param('id') id: string) { return this.out(me, id); }

  /**
   * Changes several tasks at once: status, priority, due date, assignee, or delete. Each task goes through the same
   * checks as changing it on its own (so someone can't reassign or delete what they couldn't one by one).
   */
  @Post('bulk') @HttpCode(200) @Perm('task.update')
  async bulk(@Me() me: AuthUser, @Body() b: any) {
    const ids: string[] = Array.isArray(b.ids) ? [...new Set(b.ids.map(String))].slice(0, 200) as string[] : [];
    if (!ids.length) throw new BadRequestException('Select some tasks first.');
    const change: Record<string, unknown> = {};
    for (const k of ['status', 'priority', 'due', 'assigneeId'] as const) if (b[k] !== undefined && b[k] !== '') change[k] = b[k];
    if (!b.delete && !Object.keys(change).length) throw new BadRequestException('Choose what to change.');
    if (b.delete) AccessService.require(me, 'task.delete');
    let done = 0; const skipped: string[] = [];
    for (const id of ids) {
      try { if (b.delete) await this.remove(me, id); else await this.update(me, id, change); done++; }
      catch (e) { skipped.push((e as Error).message); }
    }
    const what = b.delete ? 'deleted' : 'updated';
    return { done, skipped: skipped.length, message: skipped.length ? `${done} ${what}; ${skipped.length} skipped (${skipped[0]})` : `${done} task${done === 1 ? '' : 's'} ${what}.` };
  }

  @Post() @Perm('task.create')
  async create(@Me() me: AuthUser, @Body() b: any) {
    const assigneeId = str(b.assigneeId || me.id, 'Assignee');
    if (assigneeId !== me.id) AccessService.require(me, 'task.assign');
    const project = await this.prisma.project.findUnique({ where: { id: str(b.projectId, 'Project', { required: true }) } });
    if (!project) throw new BadRequestException('Pick a project');
    const t = await this.prisma.$transaction(async tx => {
      const max = await tx.task.aggregate({ _max: { key: true } });
      return tx.task.create({ data: {
        key: (max._max.key || 100) + 1, title: str(b.title, 'Title', { max: 300 }).trim() || 'Untitled task', desc: str(b.desc, 'Description').trim(),
        projectId: project.id, assigneeId, reporterId: me.id, due: toDate(b.due), status: 'todo', priority: oneOf(b.priority || 'Medium', 'Priority', PRIORITIES),
        events: { create: [{ userId: me.id, kind: 'sys', text: b.fromMeeting ? 'created this task from a meeting' : 'created this task' }] },
      } });
    });
    await this.notify.send([assigneeId], 'icon-list-checks', `${me.name.split(' ')[0]} assigned you ${t.title}`, `/tasks?task=${t.id}`, me.id);
    return this.out(me, t.id);
  }

  @Patch(':id') @Perm('task.update')
  async update(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const t = await this.get(me, id);
    const data: Prisma.TaskUpdateInput = {}; const log: string[] = [];
    if (b.title !== undefined) data.title = str(b.title, 'Title', { max: 300 }).replace(/\n/g, ' ');
    if (b.desc !== undefined) data.desc = str(b.desc, 'Description');
    if (b.due !== undefined) data.due = toDate(b.due);
    if (b.status !== undefined && b.status !== t.status) {
      data.status = oneOf(b.status, 'Status', STATUSES); data.doneAt = b.status === 'done' ? new Date() : null;
      log.push('changed status to ' + TASK_STATUS[b.status][0]);
    }
    if (b.priority !== undefined && b.priority !== t.priority) { data.priority = oneOf(b.priority, 'Priority', PRIORITIES); log.push('set priority to ' + b.priority); }
    if (b.assigneeId !== undefined && b.assigneeId !== t.assigneeId) {
      AccessService.require(me, 'task.assign');
      const u = await this.prisma.membership.findUnique({ where: { id: String(b.assigneeId) } });
      if (!u || u.status !== 'Active') throw new BadRequestException('Pick an active person');
      data.assignee = { connect: { id: u.id } }; log.push('reassigned to ' + u.name);
      await this.notify.send([u.id], 'icon-list-checks', `${me.name.split(' ')[0]} assigned you ${t.title}`, `/tasks?task=${t.id}`, me.id);
    }
    if (log.length) data.events = { create: log.map(text => ({ userId: me.id, kind: 'sys', text })) };
    await this.prisma.task.update({ where: { id }, data });
    return this.out(me, id);
  }

  @Post(':id/comments') @Perm('task.comment')
  async comment(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const t = await this.get(me, id);
    const text = str(b.text, 'Comment', { required: true, max: 5000 }).trim();
    await this.prisma.taskEvent.create({ data: { taskId: id, userId: me.id, kind: 'comment', text } });
    await this.notify.send([t.assigneeId, t.reporterId], 'icon-message-square', `${me.name.split(' ')[0]} commented on ${t.title}`, `/tasks?task=${t.id}`, me.id);
    // email people who have "Comments and mentions" switched on
    const to = await this.prisma.membership.findMany({ where: { id: { in: [t.assigneeId, t.reporterId].filter(x => x && x !== me.id) as string[] }, status: 'Active' } });
    const emails = to.filter(u => prefsOf(u.prefs).mention).map(u => u.email);
    if (emails.length) {
      const body = `${me.name} commented on “${t.title}” (TSK-${t.key}):\n\n${text}\n\nOpen it: ${(process.env.WEB_ORIGIN || 'http://localhost:3000').split(',')[0]}/tasks`;
      await this.mail.send({ to: emails, subject: `${me.name.split(' ')[0]} commented on ${t.title}`, text: body, html: htmlOf(body), replyTo: me.email, kind: 'comment', ref: id, userId: me.id });
    }
    return this.out(me, id);
  }

  /** Books the next free hour today (between meetings and other focus blocks) for this task. */
  @Post(':id/plan') @HttpCode(200) @Perm('task.read')
  async plan(@Me() me: AuthUser, @Param('id') id: string) {
    const t = await this.get(me, id);
    const { today, org } = await this.orgs.ctx();
    const busy = [
      ...(await this.prisma.meeting.findMany({ where: { cancelledAt: null, date: toDate(today), attendees: { some: { userId: me.id } } } })),
      ...(await this.prisma.timeBlock.findMany({ where: { userId: me.id, date: toDate(today) } })),
    ];
    const now = nowHours(org.tz); let start = -1;
    for (let h = Math.max(9, Math.ceil(now * 2) / 2); h + 1 <= 19; h += 0.5) if (!busy.some(x => h < x.start + x.dur && x.start < h + 1)) { start = h; break; }
    if (start < 0) throw new BadRequestException('There’s no free hour left today between meetings. Plan it first thing tomorrow.');
    await this.prisma.timeBlock.deleteMany({ where: { taskId: id, userId: me.id } });
    await this.prisma.timeBlock.create({ data: { taskId: id, userId: me.id, date: toDate(today), start, dur: 1 } });
    return { ...(await this.out(me, id)), message: `Blocked ${fmtT(start)} – ${fmtT(start + 1)} for “${t.title}”.` };
  }

  @Delete(':id') @Perm('task.delete')
  async remove(@Me() me: AuthUser, @Param('id') id: string) {
    const t = await this.get(me, id);
    if (t.reporterId !== me.id && !AccessService.has(me, 'task.read_all')) throw new ForbiddenException('Only the reporter can delete this task');
    await this.prisma.actionItem.updateMany({ where: { taskId: id }, data: { taskId: null } });
    await this.prisma.task.delete({ where: { id } });
    return { ok: true };
  }
}
