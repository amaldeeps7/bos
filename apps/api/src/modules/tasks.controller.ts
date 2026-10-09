import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TASK_STATUS, fmtT, nowHours } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { AccessService } from '../core/access.service';
import { NotifyService } from '../core/notify.service';
import { OrgService } from '../core/org.service';
import { Me, Perm } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';
import { d, oneOf, str, toDate } from '../core/util';

const STATUSES = Object.keys(TASK_STATUS);
const PRIORITIES = ['High', 'Medium', 'Low'] as const;
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
  constructor(private prisma: PrismaService, private notify: NotifyService, private orgs: OrgService) {}

  private where(me: AuthUser): Prisma.TaskWhereInput {
    return AccessService.has(me, 'task.read_all') ? {} : { OR: [{ assigneeId: me.id }, { reporterId: me.id }] };
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

  @Get() @Perm('task.read')
  async list(@Me() me: AuthUser) {
    const { today } = await this.orgs.ctx();
    const rows = await this.prisma.task.findMany({ where: this.where(me), include, orderBy: { due: 'asc' } });
    return rows.map(t => mapTask(t, me.id, today));
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
    await this.notify.send([assigneeId], 'icon-list-checks', `${me.name.split(' ')[0]} assigned you ${t.title}`, '/tasks', me.id);
    return this.out(me, t.id);
  }

  @Patch(':id') @Perm('task.update')
  async update(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const t = await this.get(me, id);
    const data: Prisma.TaskUpdateInput = {}; const log: string[] = [];
    if (b.title !== undefined) data.title = str(b.title, 'Title', { max: 300 }).replace(/\n/g, ' ');
    if (b.desc !== undefined) data.desc = str(b.desc, 'Description');
    if (b.due !== undefined) data.due = toDate(b.due);
    if (b.status !== undefined && b.status !== t.status) { data.status = oneOf(b.status, 'Status', STATUSES); log.push('changed status to ' + TASK_STATUS[b.status][0]); }
    if (b.priority !== undefined && b.priority !== t.priority) { data.priority = oneOf(b.priority, 'Priority', PRIORITIES); log.push('set priority to ' + b.priority); }
    if (b.assigneeId !== undefined && b.assigneeId !== t.assigneeId) {
      AccessService.require(me, 'task.assign');
      const u = await this.prisma.user.findUnique({ where: { id: String(b.assigneeId) } });
      if (!u || u.status !== 'Active') throw new BadRequestException('Pick an active person');
      data.assignee = { connect: { id: u.id } }; log.push('reassigned to ' + u.name);
      await this.notify.send([u.id], 'icon-list-checks', `${me.name.split(' ')[0]} assigned you ${t.title}`, '/tasks', me.id);
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
    await this.notify.send([t.assigneeId, t.reporterId], 'icon-message-square', `${me.name.split(' ')[0]} commented on ${t.title}`, '/tasks', me.id);
    return this.out(me, id);
  }

  /** Books the next free hour today (between meetings and other focus blocks) for this task. */
  @Post(':id/plan') @HttpCode(200) @Perm('task.read')
  async plan(@Me() me: AuthUser, @Param('id') id: string) {
    const t = await this.get(me, id);
    const { today, org } = await this.orgs.ctx();
    const busy = [
      ...(await this.prisma.meeting.findMany({ where: { date: toDate(today), attendees: { some: { userId: me.id } } } })),
      ...(await this.prisma.timeBlock.findMany({ where: { userId: me.id, date: toDate(today) } })),
    ];
    const now = nowHours(org.tz); let start = 18;
    for (let h = Math.max(9, Math.ceil(now * 2) / 2); h + 1 <= 19; h += 0.5) if (!busy.some(x => h < x.start + x.dur && x.start < h + 1)) { start = h; break; }
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
