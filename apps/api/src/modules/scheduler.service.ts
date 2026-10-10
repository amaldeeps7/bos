import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { addDays, dayLabel, fmtT, nowHours } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { RedisService } from '../core/redis.service';
import { NotifyService } from '../core/notify.service';
import { OrgService } from '../core/org.service';
import { MailService, htmlOf } from '../core/mail.service';
import { d, toDate } from '../core/util';
import { prefsOf } from './team.controller';

const DIGEST_AT = 8.5; // 8:30 am, organisation time
const REMIND_MIN = 10;

/**
 * Once a minute: meeting reminders 10 minutes before the start, and the 8:30 am daily digest,
 * for people who left those switched on in their profile. Redis makes each send happen once
 * even with several API instances. Off in tests, or with SCHEDULER=off.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Scheduler');
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(private prisma: PrismaService, private redis: RedisService, private notify: NotifyService, private orgs: OrgService, private mail: MailService) {}

  onModuleInit() {
    if (process.env.SCHEDULER === 'off' || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick(at = new Date()) {
    if (this.busy) return; this.busy = true;
    try {
      const { org, today } = await this.orgs.ctx();
      const now = nowHours(org.tz, at);
      await this.reminders(today, now);
      if (now >= DIGEST_AT && now < DIGEST_AT + 1) await this.digests(today, org.tz);
    } catch (e) { this.log.warn(`tick failed: ${(e as Error).message}`); }
    finally { this.busy = false; }
  }

  private web() { return (process.env.WEB_ORIGIN || 'http://localhost:3000').split(',')[0]; }

  async reminders(today: string, now: number) {
    const soon = await this.prisma.meeting.findMany({
      where: { date: toDate(today), start: { gt: now, lte: now + REMIND_MIN / 60 } },
      include: { attendees: { include: { user: true } } },
    });
    for (const m of soon) {
      const ids = [...new Set([m.organizerId, ...m.attendees.map(a => a.userId)])];
      const people = await this.prisma.user.findMany({ where: { id: { in: ids }, status: 'Active' } });
      for (const u of people) {
        if (!prefsOf(u.prefs).remind || !(await this.redis.once(`bos:remind:${m.id}:${m.start}:${u.id}`, 86400))) continue;
        const text = `“${m.title}” starts at ${fmtT(m.start)}${m.link ? ` — join: ${m.link}` : ` · ${m.loc}`}`;
        await this.notify.send([u.id], 'icon-calendar', text, '/meetings');
        await this.mail.send({ to: u.email, subject: `In ${Math.round((m.start - now) * 60)} min: ${m.title}`, text: `${text}\n\nWhere: ${m.loc}${m.link ? `\nJoin: ${m.link}` : ''}`, html: htmlOf(`${text}\n\nWhere: ${m.loc}${m.link ? `\nJoin: ${m.link}` : ''}`), kind: 'reminder-meeting', ref: m.id, userId: u.id });
      }
    }
  }

  async digests(today: string, tz: string) {
    const users = await this.prisma.user.findMany({ where: { status: 'Active' } });
    for (const u of users) {
      if (!prefsOf(u.prefs).digest || (u.leaveUntil && d(u.leaveUntil) >= today)) continue;
      if (!(await this.redis.once(`bos:digest:${today}:${u.id}`, 2 * 86400))) continue;
      const [meetings, tasks, approvals] = await Promise.all([
        this.prisma.meeting.findMany({ where: { date: toDate(today), OR: [{ organizerId: u.id }, { attendees: { some: { userId: u.id } } }] }, orderBy: { start: 'asc' } }),
        this.prisma.task.findMany({ where: { assigneeId: u.id, status: { not: 'done' }, due: { lte: toDate(addDays(today, 0)) } }, orderBy: { due: 'asc' } }),
        this.prisma.approval.count({ where: { approverId: u.id, status: 'PENDING' } }),
      ]);
      if (!meetings.length && !tasks.length && !approvals) continue;
      const lines = [`Good morning, ${u.name.split(' ')[0]}. Here’s ${dayLabel(today, today).toLowerCase()} (${tz}).`, ''];
      lines.push(meetings.length ? `Meetings (${meetings.length})` : 'No meetings today.');
      for (const m of meetings) lines.push(`• ${fmtT(m.start)} – ${fmtT(m.start + m.dur)}  ${m.title}${m.link ? `  ${m.link}` : ''}`);
      if (tasks.length) { lines.push('', `Tasks due today or overdue (${tasks.length})`); for (const t of tasks) lines.push(`• TSK-${t.key} ${t.title}${d(t.due) < today ? ` — due ${dayLabel(d(t.due), today)}` : ''}`); }
      if (approvals) lines.push('', `${approvals} approval${approvals > 1 ? 's' : ''} waiting on you: ${this.web()}/approvals`);
      lines.push('', `Open My Work: ${this.web()}/`);
      const text = lines.join('\n');
      await this.mail.send({ to: u.email, subject: `Your day: ${meetings.length} meeting${meetings.length === 1 ? '' : 's'}, ${tasks.length} task${tasks.length === 1 ? '' : 's'} due`, text, html: htmlOf(text, '#0052ff', 'Turn this off under your profile → Daily digest.'), kind: 'digest', userId: u.id });
    }
  }
}
