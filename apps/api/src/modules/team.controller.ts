import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch } from '@nestjs/common';
import { dayLabel, fmtT, nowHours } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { AccessService } from '../core/access.service';
import { AuditService } from '../core/audit.service';
import { OrgService } from '../core/org.service';
import { Me } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';
import { d, str, toDate } from '../core/util';

const PREF_KEYS = ['remind', 'mention', 'digest'] as const;
type Prefs = Record<(typeof PREF_KEYS)[number], boolean>;
export const prefsOf = (v: unknown): Prefs => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(PREF_KEYS.map(k => [k, o[k] !== false])) as Prefs;
};

/** Org chart, directory and profiles. Everyone can see their colleagues; only people with user.manage change someone else. */
@Controller()
export class TeamController {
  constructor(private prisma: PrismaService, private orgs: OrgService, private audit: AuditService) {}

  /** available | meeting | leave, with the line the design shows under each name. */
  private async statuses() {
    const { org, today } = await this.orgs.ctx();
    const now = nowHours(org.tz);
    const meetings = await this.prisma.meeting.findMany({ where: { cancelledAt: null, date: toDate(today), start: { lte: now } }, include: { attendees: true } });
    const live = meetings.filter(m => now < m.start + m.dur);
    return (u: { id: string; leaveUntil: Date | null }) => {
      if (u.leaveUntil && d(u.leaveUntil) >= today) return { status: 'leave', statusLabel: 'On leave', statusText: `On leave until ${dayLabel(d(u.leaveUntil), today)}` };
      const m = live.find(x => x.organizerId === u.id || x.attendees.some(a => a.userId === u.id));
      return m ? { status: 'meeting', statusLabel: 'In a meeting', statusText: `In a meeting until ${fmtT(m.start + m.dur)}` } : { status: 'available', statusLabel: 'Available', statusText: 'Available' };
    };
  }

  private card(u: any, st: ReturnType<Awaited<ReturnType<TeamController['statuses']>>>) {
    return { id: u.id, name: u.name, title: u.title, dept: u.dept, email: u.email, managerId: u.managerId, ...st };
  }

  @Get('team')
  async team() {
    const [users, st] = await Promise.all([this.prisma.membership.findMany({ where: { status: 'Active' }, orderBy: { createdAt: 'asc' } }), this.statuses()]);
    return users.map(u => this.card(u, st(u)));
  }

  @Get('team/:id')
  async person(@Me() me: AuthUser, @Param('id') id: string) {
    const u = await this.prisma.membership.findFirst({ where: { id, status: { not: 'Invited' } }, include: { manager: true, reports: { where: { status: 'Active' }, orderBy: { createdAt: 'asc' } } } });
    if (!u) throw new NotFoundException('Person not found');
    const st = await this.statuses();
    let projects: { id: string; name: string; customer: string; open: number }[] = [];
    if (AccessService.has(me, 'project.read')) {
      const [tasks, meets, owned] = await Promise.all([
        this.prisma.task.findMany({ where: { assigneeId: id }, select: { projectId: true, status: true } }),
        this.prisma.meeting.findMany({ where: { cancelledAt: null, projectId: { not: null }, OR: [{ organizerId: id }, { attendees: { some: { userId: id } } }] }, select: { projectId: true } }),
        this.prisma.project.findMany({ where: { ownerId: id }, select: { id: true } }),
      ]);
      const ids = [...new Set([...tasks.map(t => t.projectId), ...meets.map(m => m.projectId!), ...owned.map(p => p.id)])];
      const rows = await this.prisma.project.findMany({ where: { id: { in: ids } }, include: { customer: true } });
      projects = ids.map(pid => rows.find(r => r.id === pid)).filter(Boolean).map(p => ({
        id: p!.id, name: p!.name, customer: p!.customer.name, open: tasks.filter(t => t.projectId === p!.id && t.status !== 'done').length,
      }));
    }
    const isMe = me.id === id;
    return {
      ...this.card(u, st(u)), phone: u.phone, location: u.location, hours: u.hours, joined: u.joinedAt ? d(u.joinedAt) : d(u.createdAt), leaveUntil: u.leaveUntil ? d(u.leaveUntil) : '',
      manager: u.manager && u.manager.status !== 'Deactivated' ? { id: u.manager.id, name: u.manager.name } : null,
      reports: u.reports.map(r => ({ id: r.id, name: r.name })),
      projects, isMe, canEdit: isMe || AccessService.has(me, 'user.manage'), canManage: AccessService.has(me, 'user.manage'),
      ...(isMe ? { calendar: u.calendar, prefs: prefsOf(u.prefs) } : {}),
    };
  }

  /** Contact details and leave: the person themselves. Title, department, manager and joining date: user.manage. */
  @Patch('team/:id')
  async update(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) {
    const manage = AccessService.has(me, 'user.manage');
    if (me.id !== id && !manage) throw new ForbiddenException('You can only change your own profile');
    const u = await this.prisma.membership.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('Person not found');
    const data: Record<string, any> = {};
    if (b.phone !== undefined) data.phone = str(b.phone, 'Phone', { max: 40 }).trim();
    if (b.location !== undefined) data.location = str(b.location, 'Location', { max: 120 }).trim();
    if (b.hours !== undefined) data.hours = str(b.hours, 'Working hours', { max: 80 }).trim();
    if (b.leaveUntil !== undefined) data.leaveUntil = b.leaveUntil ? toDate(b.leaveUntil) : null;
    const adminOnly = ['title', 'dept', 'managerId', 'joined'].filter(k => b[k] !== undefined);
    if (adminOnly.length && !manage) throw new ForbiddenException('Ask an admin to change your title, team or manager');
    if (b.title !== undefined) data.title = str(b.title, 'Job title', { max: 120 }).trim();
    if (b.dept !== undefined) data.dept = str(b.dept, 'Team', { max: 80 }).trim();
    if (b.joined !== undefined) data.joinedAt = b.joined ? toDate(b.joined) : null;
    if (b.managerId !== undefined) {
      const mgr = b.managerId || null;
      if (mgr) {
        if (mgr === id) throw new BadRequestException('Someone can’t report to themselves');
        // walk up from the new manager; reaching this person would make a loop
        for (let cur: string | null = mgr, n = 0; cur; n++) {
          if (cur === id || n > 50) throw new BadRequestException('That would make a reporting loop');
          const up: { managerId: string | null } | null = await this.prisma.membership.findUnique({ where: { id: cur }, select: { managerId: true } });
          if (!up) throw new BadRequestException('Manager not found');
          cur = up.managerId;
        }
      }
      data.managerId = mgr;
    }
    await this.prisma.membership.update({ where: { id }, data });
    if (me.id !== id) await this.audit.log(me, `Updated ${u.name}’s profile`, 'icon-user-cog', 'access');
    return { ok: true, message: me.id === id ? 'Profile updated.' : `${u.name.split(' ')[0]}’s profile updated.` };
  }

  /** Your own calendar and notification switches. */
  @Patch('me/prefs')
  async prefs(@Me() me: AuthUser, @Body() b: any) {
    const u = await this.prisma.membership.findUniqueOrThrow({ where: { id: me.id } });
    const prefs = prefsOf(u.prefs); let message = 'Preferences saved.';
    for (const k of PREF_KEYS) if (typeof b[k] === 'boolean') prefs[k] = b[k];
    const data: Record<string, any> = { prefs };
    if (typeof b.calendar === 'boolean') { data.calendar = b.calendar; message = b.calendar ? 'Calendar connected. Meeting invites will arrive as calendar events.' : 'Calendar disconnected. Meetings won’t be sent to your calendar.'; }
    await this.prisma.membership.update({ where: { id: me.id }, data });
    return { ok: true, message, prefs, calendar: data.calendar ?? u.calendar };
  }
}
