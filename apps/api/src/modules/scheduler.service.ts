import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { addDays, dayLabel, fmtT, nowHours } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { RedisService } from '../core/redis.service';
import { NotifyService } from '../core/notify.service';
import { OrgService } from '../core/org.service';
import { MailService, htmlOf } from '../core/mail.service';
import { d, toDate } from '../core/util';
import { prefsOf } from './team.controller';
import { ExportService, orgDir } from './export.service';
import { runAs } from '../core/tenant';
import { promises as fs } from 'fs';
import { QueueService } from '../core/queue.service';

const DIGEST_AT = 8.5; // 8:30 am, organisation time
const REMIND_MIN = 10;

/**
 * Once a minute: meeting reminders 10 minutes before the start, and the 8:30 am daily digest,
 * for people who left those switched on in their profile; expired exports; closed organisations.
 * Runs as a repeating BullMQ job, so it runs once a minute however many API instances there are,
 * and Redis keys still make each send happen once. Off in tests, or with SCHEDULER=off.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private log = new Logger('Scheduler');
  constructor(private prisma: PrismaService, private redis: RedisService, private notify: NotifyService, private orgs: OrgService, private mail: MailService, private exports: ExportService, private queue: QueueService) {}

  onModuleInit() {
    this.queue.handle('tick', () => this.tick());
    if (process.env.SCHEDULER === 'off' || process.env.NODE_ENV === 'test') return;
    this.queue.every('tick', 60_000);
  }

  async tick(at = new Date()) {
    try {
      // Each organisation runs in its own tenant context; one failing doesn't stop the rest (spec §6).
      const orgs = await this.prisma.organization.findMany({ where: { status: 'active' }, select: { id: true } });
      for (const o of orgs) {
        await runAs({ orgId: o.id, scope: { all: true } }, async () => {
          const { org, today } = await this.orgs.ctx();
          const now = nowHours(org.tz, at);
          await this.reminders(today, now);
          if (now >= DIGEST_AT && now < DIGEST_AT + 1) await this.digests(today, org.tz);
          await this.exports.expire();
        }).catch(e => this.log.warn(`${o.id}: ${(e as Error).message}`));
      }
      await this.purge();
    } catch (e) { this.log.warn(`tick failed: ${(e as Error).message}`); }
  }

  /** Closed organisations are deleted for good 30 days after closing (rows cascade from Organization; files removed). */
  async purge() {
    const gone = await this.prisma.organization.findMany({ where: { status: 'closed', closedAt: { lt: new Date(Date.now() - 30 * 86400_000) } } });
    for (const o of gone) {
      await this.prisma.$base.$transaction(async tx => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${o.id}, true)`;
        await tx.organization.delete({ where: { id: o.id } });
      });
      await fs.rm(orgDir(o.id), { recursive: true, force: true });
      this.log.log(`purged ${o.slug}`);
    }
  }

  private web() { return (process.env.WEB_ORIGIN || 'http://localhost:3000').split(',')[0]; }

  async reminders(today: string, now: number) {
    const soon = await this.prisma.meeting.findMany({
      where: { date: toDate(today), start: { gt: now, lte: now + REMIND_MIN / 60 } },
      include: { attendees: { include: { user: true } } },
    });
    for (const m of soon) {
      const ids = [...new Set([m.organizerId, ...m.attendees.map(a => a.userId)])];
      const people = await this.prisma.membership.findMany({ where: { id: { in: ids }, status: 'Active' } });
      for (const u of people) {
        if (!prefsOf(u.prefs).remind || !(await this.redis.once(`bos:remind:${m.id}:${m.start}:${u.id}`, 86400))) continue;
        const text = `“${m.title}” starts at ${fmtT(m.start)}${m.link ? ` — join: ${m.link}` : ` · ${m.loc}`}`;
        await this.notify.send([u.id], 'icon-calendar', text, '/meetings');
        await this.mail.send({ to: u.email, subject: `In ${Math.round((m.start - now) * 60)} min: ${m.title}`, text: `${text}\n\nWhere: ${m.loc}${m.link ? `\nJoin: ${m.link}` : ''}`, html: htmlOf(`${text}\n\nWhere: ${m.loc}${m.link ? `\nJoin: ${m.link}` : ''}`), kind: 'reminder-meeting', ref: m.id, userId: u.id });
      }
    }
  }

  async digests(today: string, tz: string) {
    const users = await this.prisma.membership.findMany({ where: { status: 'Active' } });
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
