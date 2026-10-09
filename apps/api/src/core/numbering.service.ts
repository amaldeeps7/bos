import { Injectable } from '@nestjs/common';
import { formatNumber, todayISO } from '@bos/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

/** Allocates document numbers. The counter row is locked, so two people can never get the same number. */
@Injectable()
export class NumberingService {
  constructor(private prisma: PrismaService) {}
  async next(type: string, tx?: Prisma.TransactionClient): Promise<string> {
    const run = async (t: Prisma.TransactionClient) => {
      const rows = await t.$queryRaw<{ prefix: string; pattern: string; padding: number; next: number }[]>`SELECT prefix, pattern, padding, next FROM "Series" WHERE type = ${type} FOR UPDATE`;
      if (!rows.length) throw new Error(`No numbering series for ${type}`);
      const org = await t.organization.findUniqueOrThrow({ where: { id: 'org' } });
      const no = formatNumber(rows[0], todayISO(org.tz), org.fyStart);
      await t.series.update({ where: { type }, data: { next: { increment: 1 } } });
      return no;
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }
}
