import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { UNISSUED, diffDays } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { Perm } from '../core/decorators';
import { d } from '../core/util';
import { FinanceService } from './finance.service';

const AGE = ['Not yet due', '1–30 days overdue', '31–60 days overdue', 'Over 60 days'];

@Controller('reports')
export class ReportsController {
  constructor(private prisma: PrismaService, private fin: FinanceService) {}

  /**
   * Invoiced vs collected by month for a period (`from`/`to` as YYYY-MM, up to 24 months; default the last six),
   * billing by customer in that period, receivables ageing (as of today), and what's left to bill.
   */
  @Get() @Perm('report.read')
  async summary(@Query('from') qFrom?: string, @Query('to') qTo?: string) {
    const c = await this.fin.ctx();
    const ym = (s?: string) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || '')) ? String(s) : null);
    const addM = (mo: string, n: number) => { const [yy, mm] = mo.split('-').map(Number); return new Date(Date.UTC(yy, mm - 1 + n, 1)).toISOString().slice(0, 7); };
    const toM = ym(qTo) || c.today.slice(0, 7);
    let fromM = ym(qFrom) || addM(toM, -5);
    if (fromM > toM) throw new BadRequestException('The start month is after the end month.');
    if (addM(fromM, 23) < toM) fromM = addM(toM, -23); // at most 24 months
    const n = (Number(toM.slice(0, 4)) - Number(fromM.slice(0, 4))) * 12 + Number(toM.slice(5)) - Number(fromM.slice(5)) + 1;
    const start = new Date(fromM + '-01T00:00:00Z'), end = new Date(addM(toM, 1) + '-01T00:00:00Z');
    const [invoices, payments, legacy, customers, projects] = await Promise.all([
      // Every invoice for balances (ageing); payments only for the period.
      this.prisma.invoice.findMany(), this.prisma.payment.findMany({ where: { date: { gte: start, lt: end } }, include: { allocations: true } }), this.prisma.legacyMonth.findMany(),
      this.prisma.customer.findMany(), this.prisma.project.findMany({ include: { milestones: true }, orderBy: { code: 'asc' } }),
    ]);
    const infos = invoices.map(i => ({ i, f: this.fin.invInfo(i, c) }));
    const months = Array.from({ length: n }, (_, k) => addM(fromM, k));
    const inPeriod = (iso: string) => iso >= fromM && iso.slice(0, 7) <= toM;
    const leg = new Map(legacy.map(l => [l.month, l]));
    const series = months.map((mo, k) => {
      const L = leg.get(mo);
      const invd = L ? L.invoiced : infos.filter(x => !UNISSUED.includes(x.i.status) && d(x.i.date).startsWith(mo)).reduce((a, x) => a + x.f.k.grand, 0);
      const coll = L ? L.collected : payments.filter(p => d(p.date).startsWith(mo)).reduce((a, p) => a + p.allocations.reduce((b, x) => b + x.amount, 0), 0);
      const label = new Date(mo + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
      return { month: mo, label: mo === c.today.slice(0, 7) ? `${label} (MTD)` : n > 12 ? `${label} ${mo.slice(2, 4)}` : label, short: label, invoiced: invd, collected: coll };
    });
    const bucket = (due: string) => { const o = diffDays(due, c.today); return o >= 0 ? 0 : -o <= 30 ? 1 : -o <= 60 ? 2 : 3; };
    const ageing = [0, 0, 0, 0]; infos.filter(x => x.f.bal > 0).forEach(x => { ageing[bucket(d(x.i.due))] += x.f.bal; });
    const byCustomer = customers.map(cu => ({ name: cu.name, value: infos.filter(x => x.i.customerId === cu.id && !UNISSUED.includes(x.i.status) && inPeriod(d(x.i.date))).reduce((a, x) => a + x.f.k.grand, 0) }))
      .filter(x => x.value).sort((a, b) => b.value - a.value).slice(0, 5);
    const leftToBill = projects.map(p => { const inv = p.milestones.filter(ms => ['INVOICED', 'PAID'].includes(ms.status)).reduce((a, ms) => a + ms.value, 0); return { name: p.name, contract: p.contract, invoiced: inv }; });
    return {
      months: series, ageing: AGE.map((label, i) => ({ label, value: ageing[i] })), byCustomer, leftToBill,
      totals: { invoiced: series.reduce((a, s) => a + s.invoiced, 0), collected: series.reduce((a, s) => a + s.collected, 0), outstanding: infos.reduce((a, x) => a + x.f.bal, 0) },
      period: `${new Date(fromM + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })} to ${new Date(toM + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`,
      from: fromM, to: toM,
    };
  }
}
