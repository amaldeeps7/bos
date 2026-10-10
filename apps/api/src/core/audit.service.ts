import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export type AuditArea = 'invoice' | 'quote' | 'payment' | 'access' | 'settings' | 'project' | 'task';

/** Append-only audit log. Nothing in the API updates or deletes these rows. */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}
  async log(who: { id: string; name: string }, text: string, icon = 'icon-settings-2', area: AuditArea = 'settings') {
    await this.prisma.auditLog.create({ data: { userId: who.id || null, who: who.name, text, icon, area } });
  }
}
