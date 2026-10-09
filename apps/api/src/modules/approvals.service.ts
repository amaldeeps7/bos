import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { AccessService } from '../core/access.service';
import { AuditService } from '../core/audit.service';
import type { AuthUser } from '../core/auth.types';
import { toDate } from '../core/util';

@Injectable()
export class ApprovalsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /**
   * Approves or rejects. Normally only the routed approver decides; in demo mode `demo: true` lets the
   * signed-in person decide on the approver's behalf (the dashed "Approve as … (demo)" buttons).
   */
  async decide(me: AuthUser, id: string, ok: boolean, demo = false) {
    const a = await this.prisma.approval.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Approval not found');
    if (a.status !== 'PENDING') throw new BadRequestException('This has already been decided');
    const approver = await this.prisma.user.findUniqueOrThrow({ where: { id: a.approverId }, include: { role: true } });
    let actor = { id: me.id, name: me.name };
    if (a.approverId !== me.id) {
      if (!(demo && process.env.DEMO_MODE === 'true')) throw new ForbiddenException(`Waiting on ${approver.name}, not you`);
      actor = { id: approver.id, name: approver.name };
    } else {
      AccessService.require(me, 'approval.decide');
      const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: 'org' } });
      const ownPerm = a.docType === 'invoice' ? 'invoice.approve_own' : a.docType === 'quote' ? 'quote.approve_own' : '';
      if ((org.policy as any).noSelf !== false && a.requestedById === me.id && !(ownPerm && AccessService.has(me, ownPerm))) throw new ForbiddenException('Nobody approves a document they raised');
    }
    const by = actor.name;
    await this.prisma.$transaction(async tx => {
      await tx.approval.update({ where: { id }, data: { status: ok ? 'APPROVED' : 'REJECTED', decidedAt: new Date() } });
      if (a.docType === 'invoice' && a.docId) await tx.invoice.update({ where: { id: a.docId }, data: ok ? { status: 'APPROVED', rejected: null } : { status: 'DRAFT', rejected: `Sent back by ${by}.` } });
      if (a.docType === 'quote' && a.docId) await tx.quote.update({ where: { id: a.docId }, data: ok ? { status: 'APPROVED', rejected: null } : { status: 'DRAFT', rejected: `Sent back by ${by}.` } });
      const p = (a.payload || {}) as any;
      if (ok && a.kind === 'Milestone date' && p.milestoneId) await tx.milestone.update({ where: { id: p.milestoneId }, data: { due: toDate(p.due), changedAt: new Date() } });
      if (ok && a.kind === 'Asset request' && p.assetCode) await tx.asset.update({ where: { code: p.assetCode }, data: { status: 'IN_USE', projectId: p.projectId || null, holderId: null } });
      await tx.notification.create({ data: { userId: a.requestedById, icon: ok ? 'icon-badge-check' : 'icon-undo-2', text: `${by} ${ok ? 'approved' : 'sent back'} ${a.ref}`, link: '/approvals' } });
    });
    const area = a.docType === 'quote' ? 'quote' : a.docType === 'invoice' ? 'invoice' : 'project';
    await this.audit.log(actor, `${by} ${ok ? 'approved' : 'sent back'} ${a.ref}${actor.id !== me.id ? ` (demo, by ${me.name})` : ''}`, ok ? 'icon-badge-check' : 'icon-undo-2', area);
    const requester = await this.prisma.user.findUnique({ where: { id: a.requestedById } });
    const first = (requester?.name || '').split(' ')[0];
    return { message: ok ? `${a.ref} approved — ${first} has been notified.` : `${a.ref} sent back to ${first}.` };
  }

  async forDoc(docType: string, docId: string) {
    const a = await this.prisma.approval.findFirst({ where: { docType, docId, status: 'PENDING' } });
    if (!a) throw new BadRequestException('Nothing is waiting for approval on this document');
    return a;
  }
}
