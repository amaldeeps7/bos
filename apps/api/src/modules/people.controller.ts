import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { relTime } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { Me } from '../core/decorators';
import { avatarUrl } from '../core/avatars';
import type { AuthUser } from '../core/auth.types';

@Controller()
export class PeopleController {
  constructor(private prisma: PrismaService) {}

  /** Everyone in the workspace, for pickers and avatars. */
  @Get('people')
  async people() {
    const users = await this.prisma.membership.findMany({ where: { status: { not: 'Invited' } }, include: { role: true, account: { select: { avatarAt: true } } }, orderBy: { createdAt: 'asc' } });
    return users.map(u => ({ id: u.id, name: u.name, title: u.title, role: u.role.name, email: u.email, status: u.status, avatar: avatarUrl(u.accountId, u.account.avatarAt) }));
  }

  /** The bell: the latest 20 (newest first). */
  @Get('notifications')
  async list(@Me() me: AuthUser) {
    const rows = await this.prisma.notification.findMany({ where: { userId: me.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 });
    return rows.map(out);
  }

  /** The full notifications page: pages of 30, optionally unread only, plus the unread count. */
  @Get('notifications/all')
  async all(@Me() me: AuthUser, @Query('before') before?: string, @Query('unread') unread?: string) {
    const cursor = before ? await this.prisma.notification.findFirst({ where: { id: before, userId: me.id } }) : null;
    const where = { userId: me.id, ...(unread === '1' ? { read: false } : {}), ...(cursor ? { createdAt: { lt: cursor.createdAt } } : {}) };
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 31 }),
      this.prisma.notification.count({ where: { userId: me.id, read: false } }),
    ]);
    return { rows: rows.slice(0, 30).map(out), more: rows.length > 30, unread: unreadCount };
  }

  /** Opening a notification marks it read. */
  @Post('notifications/:id/read') @HttpCode(200)
  async readOne(@Me() me: AuthUser, @Param('id') id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: me.id }, data: { read: true } });
    return { ok: true };
  }

  @Post('notifications/read-all') @HttpCode(200)
  async readAll(@Me() me: AuthUser) {
    await this.prisma.notification.updateMany({ where: { userId: me.id, read: false }, data: { read: true } });
    return { ok: true };
  }
}

const out = (n: { id: string; icon: string; text: string; link: string | null; read: boolean; createdAt: Date }) => ({ id: n.id, icon: n.icon, text: n.text, link: n.link, read: n.read, when: relTime(n.createdAt), at: n.createdAt.toISOString() });
