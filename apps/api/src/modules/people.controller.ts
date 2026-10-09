import { Controller, Get, Post, HttpCode } from '@nestjs/common';
import { relTime } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { Me } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';

@Controller()
export class PeopleController {
  constructor(private prisma: PrismaService) {}

  /** Everyone in the workspace, for pickers and avatars. */
  @Get('people')
  async people() {
    const users = await this.prisma.user.findMany({ where: { status: { not: 'Invited' } }, include: { role: true }, orderBy: { createdAt: 'asc' } });
    return users.map(u => ({ id: u.id, name: u.name, title: u.title, role: u.role.name, email: u.email, status: u.status }));
  }

  @Get('notifications')
  async list(@Me() me: AuthUser) {
    const rows = await this.prisma.notification.findMany({ where: { userId: me.id }, orderBy: { createdAt: 'desc' }, take: 20 });
    return rows.map(n => ({ id: n.id, icon: n.icon, text: n.text, link: n.link, read: n.read, when: relTime(n.createdAt) }));
  }

  @Post('notifications/read-all') @HttpCode(200)
  async readAll(@Me() me: AuthUser) {
    await this.prisma.notification.updateMany({ where: { userId: me.id, read: false }, data: { read: true } });
    return { ok: true };
  }
}
