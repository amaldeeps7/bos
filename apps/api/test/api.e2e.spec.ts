/* End-to-end checks against a real Postgres (DATABASE_URL). Run `pnpm seed` first; the suite re-seeds itself. */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execSync } from 'child_process';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

let app: INestApplication;
const login = async (email: string) => {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'demo1234' }).expect(200);
  return res.headers['set-cookie'] as unknown as string[];
};

beforeAll(async () => {
  execSync('npx ts-node --transpile-only prisma/seed.ts', { cwd: __dirname + '/..', stdio: 'ignore' });
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication(); app.setGlobalPrefix('api'); app.use(cookieParser());
  await app.init();
}, 60000);
afterAll(async () => { await app?.close(); });

describe('auth and access', () => {
  it('rejects a wrong password and anonymous requests', async () => {
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'priya@democonsulting.in', password: 'nope' }).expect(401);
    await request(app.getHttpServer()).get('/api/tasks').expect(401);
  });

  it('enforces role permissions on the API, not just the UI', async () => {
    const field = await login('arjun@democonsulting.in');
    await request(app.getHttpServer()).get('/api/invoices').set('Cookie', field).expect(403);
    await request(app.getHttpServer()).get('/api/settings').set('Cookie', field).expect(403);
    const tasks = await request(app.getHttpServer()).get('/api/tasks').set('Cookie', field).expect(200);
    const me = (await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', field)).body.user.id;
    expect(tasks.body.every((t: any) => t.assigneeId === me || t.reporterId === me)).toBe(true);
  });

  it('switching a module off hides it for everyone', async () => {
    const owner = await login('anand@democonsulting.in');
    await request(app.getHttpServer()).patch('/api/settings/modules/assets').set('Cookie', owner).send({ on: false }).expect(200);
    await request(app.getHttpServer()).get('/api/assets').set('Cookie', owner).expect(403);
    await request(app.getHttpServer()).patch('/api/settings/modules/assets').set('Cookie', owner).send({ on: true }).expect(200);
    await request(app.getHttpServer()).get('/api/assets').set('Cookie', owner).expect(200);
  });
});

describe('billing', () => {
  it('computes GST by place of supply', async () => {
    const pm = await login('priya@democonsulting.in');
    const inv = (await request(app.getHttpServer()).get('/api/invoices').set('Cookie', pm)).body;
    const intra = inv.find((i: any) => i.no === 'INV-2026-0142'); // Brightline, Karnataka
    const inter = inv.find((i: any) => i.no === 'INV-2026-0131'); // Kestrel, Maharashtra
    expect(intra.calc.taxRows.map((r: any) => r[0])).toEqual(['CGST 9%', 'SGST 9%']);
    expect(intra.calc.grand).toBe(1132800);
    expect(inter.calc.taxRows).toEqual([['IGST 18%', 66600]]);
  });

  it('runs a milestone from invoice to payment, numbering on the way', async () => {
    const pm = await login('priya@democonsulting.in');
    const projects = (await request(app.getHttpServer()).get('/api/projects').set('Cookie', pm)).body;
    const p = projects.find((x: any) => x.code === 'PRJ-0024');
    const m = p.milestones.find((x: any) => x.status === 'COMPLETED');
    const bill = await request(app.getHttpServer()).post(`/api/projects/${p.id}/milestones/${m.id}/bill`).set('Cookie', pm).expect(200);
    const id = bill.body.invoiceId;
    // Priya raised it, so she can't approve it — it waits on Finance.
    await request(app.getHttpServer()).post(`/api/invoices/${id}/approve`).set('Cookie', pm).send({}).expect(403);
    const fin = await login('meera@democonsulting.in');
    await request(app.getHttpServer()).post(`/api/invoices/${id}/approve`).set('Cookie', fin).send({}).expect(200);
    await request(app.getHttpServer()).post(`/api/invoices/${id}/issue`).set('Cookie', fin).expect(200);
    await request(app.getHttpServer()).post(`/api/invoices/${id}/send`).set('Cookie', fin).expect(200);
    const pay = await request(app.getHttpServer()).post('/api/payments').set('Cookie', fin).send({ invoiceId: id, amount: 944000, method: 'NEFT', ref: 'T1' }).expect(201);
    expect(pay.body.message).toMatch(/^RCP-\d{4}-0065 recorded/);
    const after = (await request(app.getHttpServer()).get('/api/projects').set('Cookie', pm)).body.find((x: any) => x.id === p.id);
    expect(after.milestones.find((x: any) => x.id === m.id).status).toBe('PAID');
  });

  it('routes an over-limit discount to the Owner and auto-approves one within policy', async () => {
    const pm = await login('priya@democonsulting.in');
    const cust = (await request(app.getHttpServer()).get('/api/customers').set('Cookie', pm)).body[0];
    const line = (disc: number) => [{ d: 'Senior engineer', qty: 2, unit: 'day', rate: 28000, disc, sac: '998314' }];
    const over = await request(app.getHttpServer()).post('/api/quotes').set('Cookie', pm).send({ customerId: cust.id, title: 'Over', lines: line(15), submit: true }).expect(201);
    expect(over.body.message).toMatch(/sent to Anand Iyer/);
    const ok = await request(app.getHttpServer()).post('/api/quotes').set('Cookie', pm).send({ customerId: cust.id, title: 'Within', lines: line(5), submit: true }).expect(201);
    expect(ok.body.message).toMatch(/approved automatically/);
  });

  it('rejects an invalid GSTIN', async () => {
    const pm = await login('priya@democonsulting.in');
    await request(app.getHttpServer()).post('/api/customers').set('Cookie', pm).send({ name: 'Bad', gstin: '99ABCDE1234F1Z5' }).expect(400);
  });

  it('keeps numbering forward-only', async () => {
    const owner = await login('anand@democonsulting.in');
    await request(app.getHttpServer()).patch('/api/settings/series/INVOICE').set('Cookie', owner).send({ prefix: 'INV', pattern: '{prefix}-{yyyy}-{seq}', padding: 4, next: 5 }).expect(400);
  });
});
