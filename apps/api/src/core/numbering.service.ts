import { BadRequestException, Injectable } from '@nestjs/common';
import { formatNumber, todayISO } from '@bos/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { orgId } from './tenant';

/** Invoices, credit notes and receipts are numbered per issuing entity (one series per GSTIN). */
export const PER_ENTITY = new Set(['INVOICE', 'CREDIT_NOTE', 'RECEIPT']);
const LABELS: Record<string, string> = { INVOICE: 'Invoices', CREDIT_NOTE: 'Credit notes', RECEIPT: 'Receipts', QUOTATION: 'Quotations', PROJECT: 'Projects' };

type Row = { id: string; prefix: string; pattern: string; padding: number; next: number };

/**
 * Allocates document numbers. The counter row is locked (SELECT … FOR UPDATE), so two people issuing
 * at once never get the same number, and separate entities never share a counter.
 */
@Injectable()
export class NumberingService {
  constructor(private prisma: PrismaService) {}

  async next(type: string, opts: { entityId?: string | null } = {}, tx?: Prisma.TransactionClient): Promise<string> {
    const entityId = PER_ENTITY.has(type) ? opts.entityId : null;
    if (PER_ENTITY.has(type) && !entityId) throw new BadRequestException(`A ${type.toLowerCase().replace('_', ' ')} needs an issuing entity`);
    const org = orgId();
    const run = async (t: Prisma.TransactionClient) => {
      const lock = () => t.$queryRaw<Row[]>`SELECT id, prefix, pattern, padding, next FROM "Series"
        WHERE "orgId" = ${org} AND "entityId" IS NOT DISTINCT FROM ${entityId} AND type = ${type} FOR UPDATE`;
      let rows = await lock();
      if (!rows.length) {
        // First document of this type for a new entity: start a series like the organisation's existing one, from 1.
        const like = await t.series.findFirst({ where: { type }, orderBy: { next: 'desc' } });
        await t.$executeRaw`INSERT INTO "Series" (id, "orgId", "entityId", type, label, prefix, pattern, padding, next, reset)
          VALUES (${'sr_' + Math.random().toString(36).slice(2, 12)}, ${org}, ${entityId}, ${type}, ${LABELS[type] || type}, ${like?.prefix || type.slice(0, 3)},
            ${like?.pattern || '{prefix}-{yyyy}-{seq}'}, ${like?.padding ?? 4}, 1, ${like?.reset || 'every financial year'})
          ON CONFLICT DO NOTHING`;
        rows = await lock();
        if (!rows.length) throw new Error(`No numbering series for ${type}`);
      }
      const o = await t.organization.findUniqueOrThrow({ where: { id: org } });
      const no = formatNumber(rows[0], todayISO(o.tz), o.fyStart);
      await t.series.update({ where: { id: rows[0].id }, data: { next: { increment: 1 } } });
      return no;
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }
}
