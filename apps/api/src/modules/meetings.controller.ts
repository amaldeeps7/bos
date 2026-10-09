import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dayLabel, fmtT } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { AccessService } from '../core/access.service';
import { NotifyService } from '../core/notify.service';
import { OrgService } from '../core/org.service';
import { Me } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';
import { d, num, str, toDate } from '../core/util';
import { MailService, htmlOf } from '../core/mail.service';
import { meetingIcs } from '../core/ics';

const include = { attendees: true, actions: { orderBy: { sort: 'asc' } } } satisfies Prisma.MeetingInclude;
type MeetingRow = Prisma.MeetingGetPayload<{ include: typeof include }>;
const map = (m: MeetingRow) => ({
  id: m.id, title: m.title, date: d(m.date), start: m.start, dur: m.dur, projectId: m.projectId, loc: m.loc, link: m.link, ext: m.ext,
  agenda: m.agenda, notes: m.notes, organizerId: m.organizerId, attendees: m.attendees.map(a => a.userId), guests: m.guests,
  actions: m.actions.map(a => ({ id: a.id, text: a.text, assigneeId: a.assigneeId, taskId: a.taskId })),
});
const LINK = /^https?:\/\/\S+$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const cleanGuests = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  const g = [...new Set(v.map(x => String(x).trim().toLowerCase()).filter(Boolean))];
  const bad = g.find(x => !EMAIL.test(x)); if (bad) throw new BadRequestException(`${bad} isn’t a valid email address`);
  if (g.length > 50) throw new BadRequestException('Up to 50 guests');
  return g;
};
const provider = (u: string) => (/meet\.google\./i.test(u) ? 'Google Meet' : /zoom\.us/i.test(u) ? 'Zoom' : /teams\.(microsoft|live)\./i.test(u) ? 'Microsoft Teams' : '');

/** Calendar entries linked to work. Everybody signed in can keep meetings; they see the ones they attend. */
@Controller('meetings')
export class MeetingsController {
  constructor(private prisma: PrismaService, private notify: NotifyService, private orgs: OrgService, private mail: MailService) {}

  /** Emails a calendar invite (or cancellation) to attendees and outside guests, organiser excluded. */
  private async invite(m: MeetingRow, me: AuthUser, method: 'REQUEST' | 'CANCEL', only?: { userIds: string[]; guests: string[] }) {
    const { org, today } = await this.orgs.ctx();
    const users = await this.prisma.user.findMany({ where: { id: { in: m.attendees.map(a => a.userId) } } });
    const organizer = (await this.prisma.user.findUnique({ where: { id: m.organizerId } })) || { name: me.name, email: me.email };
    const everyone = [...users.map(u => ({ name: u.name, email: u.email })), ...m.guests.map(email => ({ email }))];
    const to = only ? [...users.filter(u => only.userIds.includes(u.id)).map(u => u.email), ...only.guests] : everyone.map(a => a.email).filter(e => e !== organizer.email);
    if (!to.length) return { ok: true, count: 0 };
    const ics = meetingIcs({ ...m, date: d(m.date) }, org.tz, organizer, everyone, method);
    const when = `${dayLabel(d(m.date), today)}, ${fmtT(m.start)} – ${fmtT(m.start + m.dur)} (${org.tz})`;
    const text = method === 'CANCEL' ? `${organizer.name} cancelled “${m.title}” (${when}).`
      : `${organizer.name} invited you to “${m.title}”.\n\nWhen: ${when}\nWhere: ${m.loc}${m.link ? `\nJoin: ${m.link}` : ''}${m.agenda ? `\n\nAgenda:\n${m.agenda}` : ''}`;
    const r = await this.mail.send({ to, subject: `${method === 'CANCEL' ? 'Cancelled' : m.sequence ? 'Updated' : 'Invitation'}: ${m.title} — ${when}`, text, html: htmlOf(text), replyTo: organizer.email,
      icalEvent: { method, content: ics }, kind: 'meeting', ref: m.id, userId: me.id });
    return { ...r, count: to.length };
  }

  private async get(me: AuthUser, id: string) {
    const m = await this.prisma.meeting.findFirst({ where: { id, OR: [{ organizerId: me.id }, { attendees: { some: { userId: me.id } } }] }, include });
    if (!m) throw new NotFoundException('Meeting not found');
    return m;
  }
  private fields(b: any, partial: boolean) {
    const data: Record<string, any> = {};
    if (!partial || b.title !== undefined) data.title = str(b.title, 'Title', { max: 300 }).trim();
    if (!partial || b.date !== undefined) data.date = toDate(b.date);
    if (!partial || b.start !== undefined) data.start = num(b.start, 'Start', { min: 0, max: 23.75 });
    if (!partial || b.dur !== undefined) data.dur = num(b.dur, 'Length', { min: 0.25, max: 12 });
    if (!partial || b.loc !== undefined) data.loc = str(b.loc, 'Where', { max: 200 });
    if (b.projectId !== undefined) data.projectId = b.projectId || null;
    for (const f of ['agenda', 'notes', 'ext'] as const) if (b[f] !== undefined) data[f] = str(b[f], f);
    if (b.link !== undefined) {
      const link = str(b.link, 'Call link', { max: 500 }).trim();
      if (link && !LINK.test(link)) throw new BadRequestException('The call link must start with https://');
      data.link = link; if (provider(link)) data.loc = provider(link);
    }
    return data;
  }

  @Get()
  async list(@Me() me: AuthUser) {
    const rows = await this.prisma.meeting.findMany({ where: { OR: [{ organizerId: me.id }, { attendees: { some: { userId: me.id } } }] }, include, orderBy: [{ date: 'asc' }, { start: 'asc' }] });
    return rows.map(map);
  }

  @Post()
  async create(@Me() me: AuthUser, @Body() b: any) {
    const data = this.fields(b, false);
    const pr = data.projectId ? await this.prisma.project.findUnique({ where: { id: data.projectId }, include: { customer: true } }) : null;
    if (data.projectId && !pr) throw new BadRequestException('Unknown project');
    data.title = data.title || (pr ? `${pr.customer.name} — catch-up` : 'Meeting');
    const who: string[] = [...new Set([me.id, ...(Array.isArray(b.attendees) ? b.attendees.map(String) : [])])];
    const m = await this.prisma.meeting.create({ data: { ...(data as any), guests: cleanGuests(b.guests), organizerId: me.id, attendees: { create: who.map(userId => ({ userId })) } }, include });
    const sent = await this.invite(m, me, 'REQUEST');
    const { today } = await this.orgs.ctx();
    await this.notify.send(who, 'icon-calendar', `${me.name.split(' ')[0]} invited you to ${m.title} · ${dayLabel(d(m.date), today)}, ${fmtT(m.start)}`, '/meetings', me.id);
    return { ...map(m), invited: sent.count, emailed: sent.ok, emailError: sent.ok ? undefined : (sent as any).error };
  }

  @Patch(':id')
  async update(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const old = await this.get(me, id);
    const data = this.fields(b, true);
    if (b.guests !== undefined) data.guests = cleanGuests(b.guests);
    if (Array.isArray(b.attendees)) {
      const who = [...new Set([old.organizerId, ...b.attendees.map(String)])];
      await this.prisma.meetingAttendee.deleteMany({ where: { meetingId: id } });
      await this.prisma.meetingAttendee.createMany({ data: who.map(userId => ({ meetingId: id, userId })) });
    }
    let m = await this.prisma.meeting.update({ where: { id }, data, include });
    const moved = d(old.date) !== d(m.date) || old.start !== m.start;
    // Calendar-relevant changes go out as an updated invite; agenda and notes edits don't.
    const ids = (x: MeetingRow) => x.attendees.map(a => a.userId).sort().join();
    const relevant = moved || old.dur !== m.dur || old.title !== m.title || old.loc !== m.loc || old.link !== m.link || ids(old) !== ids(m) || old.guests.join() !== m.guests.join();
    let emailed: boolean | undefined;
    if (relevant) {
      m = await this.prisma.meeting.update({ where: { id }, data: { sequence: { increment: 1 } }, include });
      const removedUsers = old.attendees.map(a => a.userId).filter(u => !m.attendees.some(a => a.userId === u));
      const removedGuests = old.guests.filter(g => !m.guests.includes(g));
      if (removedUsers.length || removedGuests.length) await this.invite(m, me, 'CANCEL', { userIds: removedUsers, guests: removedGuests });
      emailed = (await this.invite(m, me, 'REQUEST')).ok;
    }
    if (moved) {
      const { today } = await this.orgs.ctx();
      await this.notify.send(m.attendees.map(a => a.userId), 'icon-calendar-clock', `${m.title} moved to ${dayLabel(d(m.date), today)}, ${fmtT(m.start)}`, '/meetings', me.id);
    }
    return { ...map(m), moved, emailed };
  }

  @Delete(':id')
  async cancel(@Me() me: AuthUser, @Param('id') id: string) {
    const m = await this.get(me, id);
    await this.invite({ ...m, sequence: m.sequence + 1 }, me, 'CANCEL');
    await this.prisma.meeting.delete({ where: { id } });
    await this.notify.send(m.attendees.map(a => a.userId), 'icon-calendar-x', `${m.title} was cancelled`, '/meetings', me.id);
    return { ok: true };
  }

  @Post(':id/actions')
  async addAction(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const m = await this.get(me, id);
    await this.prisma.actionItem.create({ data: { meetingId: id, text: str(b.text, 'Action item', { required: true, max: 500 }).trim(), assigneeId: str(b.assigneeId || me.id, 'Owner'), sort: m.actions.length } });
    return map(await this.get(me, id));
  }

  /** Turns an action item into a task on the meeting's project. */
  @Post(':id/actions/:aid/task')
  async actionToTask(@Me() me: AuthUser, @Param('id') id: string, @Param('aid') aid: string) {
    AccessService.require(me, 'task.create');
    const m = await this.get(me, id);
    const a = m.actions.find(x => x.id === aid);
    if (!a) throw new NotFoundException('Action item not found');
    if (a.taskId) throw new BadRequestException('Already a task');
    if (!m.projectId) throw new BadRequestException('Link the meeting to a project first — every task belongs to a project.');
    const { today } = await this.orgs.ctx();
    const due = new Date(toDate(today).getTime() + 2 * 86400000);
    const t = await this.prisma.$transaction(async tx => {
      const max = await tx.task.aggregate({ _max: { key: true } });
      const t = await tx.task.create({ data: { key: (max._max.key || 100) + 1, title: a.text, desc: `From “${m.title}” (${dayLabel(d(m.date), today)}).`, projectId: m.projectId!, assigneeId: a.assigneeId, reporterId: me.id, due, status: 'todo', priority: 'Medium',
        events: { create: [{ userId: me.id, kind: 'sys', text: 'created this task from a meeting' }] } } });
      await tx.actionItem.update({ where: { id: aid }, data: { taskId: t.id } });
      return t;
    });
    await this.notify.send([a.assigneeId], 'icon-list-checks', `${me.name.split(' ')[0]} assigned you ${t.title}`, '/tasks', me.id);
    return { meeting: map(await this.get(me, id)), taskId: t.id, key: 'TSK-' + t.key };
  }
}
