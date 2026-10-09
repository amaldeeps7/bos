import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class NotifyService {
  constructor(private prisma: PrismaService) {}
  async send(userIds: (string | null | undefined)[], icon: string, text: string, link?: string, exceptId?: string) {
    const ids = [...new Set(userIds.filter((x): x is string => !!x && x !== exceptId))];
    if (ids.length) await this.prisma.notification.createMany({ data: ids.map(userId => ({ userId, icon, text, link })) });
  }
}
