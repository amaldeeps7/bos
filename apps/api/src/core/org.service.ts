import { Injectable } from '@nestjs/common';
import { placeOf, todayISO } from '@bos/shared';
import { PrismaService } from './prisma.service';
import { orgId } from './tenant';

/** The current organisation's context: today's date, default issuing entity, GST rates, policy. */
@Injectable()
export class OrgService {
  constructor(private prisma: PrismaService) {}
  async ctx() {
    const [org, entity, sac] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: orgId() } }),
      this.prisma.legalEntity.findFirst({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
      this.prisma.sac.findMany(),
    ]);
    const policy = org.policy as Record<string, any>;
    return {
      org, entity, today: todayISO(org.tz), ourState: placeOf(entity), ourGst: entity?.gst ?? true,
      sacRates: Object.fromEntries(sac.map(s => [s.code, s.rate])) as Record<string, number>,
      policy, discLimit: Number(policy.discount) || 0,
    };
  }

  /** The legal entity a document is issued by: the one asked for, else the default. */
  async entity(id?: string | null) {
    const e = id ? await this.prisma.legalEntity.findUnique({ where: { id } }) : await this.prisma.legalEntity.findFirst({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
    if (!e) throw new Error(id ? 'Unknown legal entity' : 'Add a legal entity first');
    return { ...e, stateCode: e.state, state: placeOf(e) };
  }
}
