import { Injectable } from '@nestjs/common';
import { stateOf, todayISO } from '@bos/shared';
import { PrismaService } from './prisma.service';

/** Organisation-wide context used by most services: today's date, issuing entity, GST rates, policy. */
@Injectable()
export class OrgService {
  constructor(private prisma: PrismaService) {}
  async ctx() {
    const [org, entity, sac] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: 'org' } }),
      this.prisma.legalEntity.findFirst({ where: { isDefault: true } }),
      this.prisma.sac.findMany(),
    ]);
    const policy = org.policy as Record<string, any>;
    return {
      org, entity, today: todayISO(org.tz), ourState: entity ? stateOf(entity.gstin) : undefined,
      sacRates: Object.fromEntries(sac.map(s => [s.code, s.rate])) as Record<string, number>,
      policy, discLimit: Number(policy.discount) || 0,
    };
  }
}
