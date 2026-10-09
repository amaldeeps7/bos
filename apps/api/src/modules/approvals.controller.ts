import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { relTime } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { Me, Perm } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';
import { ApprovalsService } from './approvals.service';

@Controller('approvals')
export class ApprovalsController {
  constructor(private prisma: PrismaService, private svc: ApprovalsService) {}

  /** Decisions routed to me, and ones I raised that are waiting on somebody else. */
  @Get() @Perm('approval.read')
  async list(@Me() me: AuthUser) {
    const rows = await this.prisma.approval.findMany({ where: { OR: [{ approverId: me.id }, { requestedById: me.id }] }, orderBy: { createdAt: 'desc' } });
    const names = new Map((await this.prisma.user.findMany({ select: { id: true, name: true } })).map(u => [u.id, u.name]));
    return rows.map(a => ({
      id: a.id, kind: a.kind, docType: a.docType, docId: a.docId, ref: a.ref, title: a.title, detail: a.detail, amount: a.amount,
      by: names.get(a.requestedById) || '', approver: names.get(a.approverId) || '', age: relTime(a.createdAt),
      status: a.status === 'PENDING' ? (a.approverId === me.id ? 'waiting' : 'sent') : a.status === 'APPROVED' ? 'approved' : 'rejected',
    }));
  }

  @Post(':id/decide') @HttpCode(200) @Perm('approval.read')
  decide(@Me() me: AuthUser, @Param('id') id: string, @Body() b: any) { return this.svc.decide(me, id, !!b.approve, !!b.demo); }
}
