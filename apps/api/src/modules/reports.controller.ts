import { Controller, Get } from '@nestjs/common';
import { UNISSUED, diffDays } from '@bos/shared';
import { PrismaService } from '../core/prisma.service';
import { Perm } from '../core/decorators';
import { d } from '../core/util';
import { FinanceService } from './finance.service';

const AGE = ['Not yet due', '1–30 days overdue', '31–60 days overdue', 'Over 60 days'];

@Controller('reports')
export class ReportsController {
  constructor(private prisma: PrismaService, private fin: FinanceService) {}

  /** Six months of invoiced vs collected, billing by customer, receivables ageing, and what's left to bill. */
  @Get() @Perm('report.read')
  async summary() {
    const c = await this.fin.ctx();
    const [invoices, payments, legacy, customers, projects] = await Promise.all([
      this.prisma.invoice.findMany(), this.prisma.payment.findMany({ include: { allocations: true } }), this.prisma.legacyMonth.findMany(),
      this.prisma.customer.findMany(), this.prisma.project.findMany({ include: { milestones: true }, orderBy: { code: 'asc' } }),
    ]);
    const infos = invoices.map(i => ({ i, f: this.fin.invInfo(i, c) }));
    const [y, m] = c.today.split('-').map(Number);
    const months = Array.from({ length: 6 }, (_, k) => new Date(Date.UTC(y, m - 1 - (5 - k), 1)).toISOString().slice(0, 7));
    const leg = new Map(legacy.map(l => [l.month, l]));
    const series = months.map((mo, k) => {
      const L = leg.get(mo);
      const invd = L ? L.invoiced : infos.filter(x => !UNISSUED.includes(x.i.status) && d(x.i.date).startsWith(mo)).reduce((a, x) => a + x.f.k.grand, 0);
      const coll = L ? L.collected : payments.filter(p => d(p.date).startsWith(mo)).reduce((a, p) => a + p.allocations.reduce((b, x) => b + x.amount, 0), 0);
      const label = new Date(mo + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
      return { month: mo, label: k === 5 ? `${label} (MTD)` : label, short: label, invoiced: invd, collected: coll };
    });
    const bucket = (due: string) => { const o = diffDays(due, c.today); return o >= 0 ? 0 : -o <= 30 ? 1 : -o <= 60 ? 2 : 3; };
    const ageing = [0, 0, 0, 0]; infos.filter(x => x.f.bal > 0).forEach(x => { ageing[bucket(d(x.i.due))] += x.f.bal; });
    const byCustomer = customers.map(cu => ({ name: cu.name, value: infos.filter(x => x.i.customerId === cu.id && !UNISSUED.includes(x.i.status)).reduce((a, x) => a + x.f.k.grand, 0) }))
      .filter(x => x.value).sort((a, b) => b.value - a.value).slice(0, 5);
    const leftToBill = projects.map(p => { const inv = p.milestones.filter(ms => ['INVOICED', 'PAID'].includes(ms.status)).reduce((a, ms) => a + ms.value, 0); return { name: p.name, contract: p.contract, invoiced: inv }; });
    return {
      months: series, ageing: AGE.map((label, i) => ({ label, value: ageing[i] })), byCustomer, leftToBill,
      totals: { invoiced: series.reduce((a, s) => a + s.invoiced, 0), collected: series.reduce((a, s) => a + s.collected, 0), outstanding: infos.reduce((a, x) => a + x.f.bal, 0) },
      period: `${series[0].short} to ${new Date(c.today + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`,
    };
  }
}
