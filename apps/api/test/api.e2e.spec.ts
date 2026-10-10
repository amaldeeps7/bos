/* End-to-end checks against a real Postgres (DATABASE_URL). Run `pnpm seed` first; the suite re-seeds itself. */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execSync } from 'child_process';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';

let app: INestApplication;
/** Owner connection (bypasses RLS) for checking what the API wrote. The API itself runs as bos_app. */
const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL });
// Sign-in returns you to the organisation you used last; tests name the one they mean.
const login = async (email: string, org = 'democonsulting') => {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'demo1234', org }).expect(200);
  return res.headers['set-cookie'] as unknown as string[];
};

beforeAll(async () => {
  execSync('npx ts-node --transpile-only prisma/seed.ts', { cwd: __dirname + '/..', stdio: 'ignore' });
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication(); app.setGlobalPrefix('api'); app.use(cookieParser());
  await app.init();
}, 60000);
afterAll(async () => { await app?.close(); await db.$disconnect(); });

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
    const inv = (await request(app.getHttpServer()).get('/api/settings').set('Cookie', owner)).body.series.find((x: any) => x.type === 'INVOICE' && x.prefix === 'INV');
    await request(app.getHttpServer()).patch(`/api/settings/series/${inv.id}`).set('Cookie', owner).send({ prefix: 'INV', pattern: '{prefix}-{yyyy}-{seq}', padding: 4, next: 5 }).expect(400);
  });
});

describe('documents, email, people and search', () => {
  it('renders invoice and quotation PDFs', async () => {
    const pm = await login('priya@democonsulting.in');
    const inv = (await request(app.getHttpServer()).get('/api/invoices').set('Cookie', pm)).body[0];
    const pdf = await request(app.getHttpServer()).get(`/api/invoices/${inv.id}/pdf`).set('Cookie', pm).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const q = (await request(app.getHttpServer()).get('/api/quotes').set('Cookie', pm)).body[0];
    await request(app.getHttpServer()).get(`/api/quotes/${q.id}/pdf`).set('Cookie', pm).expect(200).expect('content-type', 'application/pdf');
  });

  it('logs every email it sends or fails to send', async () => {
    const owner = await login('anand@democonsulting.in');
    await request(app.getHttpServer()).post('/api/settings/reminders/test').set('Cookie', owner).expect(200);
    const log = await request(app.getHttpServer()).get('/api/settings/email').set('Cookie', owner).expect(200);
    expect(log.body.rows[0]).toMatchObject({ kind: 'test', to: 'anand@democonsulting.in' });
  });

  it('adds a person who can sign in, and enforces the password policy', async () => {
    const pm = await login('priya@democonsulting.in');
    await request(app.getHttpServer()).post('/api/settings/users').set('Cookie', pm).send({ name: 'Test Person', email: 'test.person@democonsulting.in', role: 'Field staff', password: 'short' }).expect(400);
    await request(app.getHttpServer()).post('/api/settings/users').set('Cookie', pm).send({ name: 'Test Person', email: 'test.person@other.com', role: 'Field staff', password: 'long-enough-password' }).expect(400);
    await request(app.getHttpServer()).post('/api/settings/users').set('Cookie', pm).send({ name: 'Test Person', email: 'test.person@democonsulting.in', role: 'Field staff', password: 'long-enough-password' }).expect(201);
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'test.person@democonsulting.in', password: 'long-enough-password' }).expect(200);
  });

  it('invites by email with a one-time link', async () => {
    const pm = await login('priya@democonsulting.in');
    await request(app.getHttpServer()).post('/api/settings/users/invite').set('Cookie', pm).send({ email: 'invitee@democonsulting.in', role: 'Sales' }).expect(201);
    const u = await db.membership.findFirstOrThrow({ where: { email: 'invitee@democonsulting.in' } });
    await request(app.getHttpServer()).get(`/api/auth/invite/${u.inviteToken}`).expect(200);
    await request(app.getHttpServer()).post('/api/auth/accept-invite').send({ token: u.inviteToken, name: 'Invitee', password: 'invitee-password' }).expect(200);
    await request(app.getHttpServer()).get(`/api/auth/invite/${u.inviteToken}`).expect(400);
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'invitee@democonsulting.in', password: 'invitee-password' }).expect(200);
  });

  it('meetings keep outside guests and reject bad addresses', async () => {
    const pm = await login('priya@democonsulting.in');
    await request(app.getHttpServer()).post('/api/meetings').set('Cookie', pm).send({ title: 'x', date: '2030-01-01', start: 10, dur: 1, loc: 'Zoom', guests: ['not-an-email'] }).expect(400);
    const m = await request(app.getHttpServer()).post('/api/meetings').set('Cookie', pm).send({ title: 'Guest call', date: '2030-01-01', start: 10, dur: 1, loc: 'Zoom', guests: ['Client@Example.com'] }).expect(201);
    expect(m.body.guests).toEqual(['client@example.com']);
  });

  it('search respects permissions and finds documents by number', async () => {
    const pm = await login('priya@democonsulting.in');
    const r = await request(app.getHttpServer()).get('/api/search?q=INV-2026-0131').set('Cookie', pm).expect(200);
    expect(r.body.groups.find((g: any) => g.type === 'invoice').hits[0].title).toMatch(/^INV-2026-0131/);
    const field = await login('arjun@democonsulting.in');
    const f = await request(app.getHttpServer()).get('/api/search?q=kestrel').set('Cookie', field).expect(200);
    expect(f.body.groups.map((g: any) => g.type)).not.toContain('invoice');
    expect(f.body.groups.map((g: any) => g.type)).not.toContain('customer');
  });

  it('edits projects, milestones and deals', async () => {
    const pm = await login('priya@democonsulting.in');
    const cust = (await request(app.getHttpServer()).get('/api/customers').set('Cookie', pm)).body[0];
    const p = await request(app.getHttpServer()).post('/api/projects').set('Cookie', pm).send({ name: 'New engagement', customerId: cust.id, contract: 1000000, endDate: '2030-06-30', milestones: [{ name: 'One', pct: 50, due: '2030-03-01' }, { name: 'Two', pct: 50 }] }).expect(201);
    const proj = (await request(app.getHttpServer()).get('/api/projects').set('Cookie', pm)).body.find((x: any) => x.id === p.body.id);
    expect(proj.milestones.map((m: any) => m.value)).toEqual([500000, 500000]);
    await request(app.getHttpServer()).patch(`/api/projects/${proj.id}/milestones/${proj.milestones[1].id}`).set('Cookie', pm).send({ name: 'Two (renamed)', value: 400000 }).expect(200);
    await request(app.getHttpServer()).delete(`/api/projects/${proj.id}/milestones/${proj.milestones[0].id}`).set('Cookie', pm).expect(200);
    const deal = await request(app.getHttpServer()).post('/api/opportunities').set('Cookie', pm).send({ name: 'Deal', customerId: cust.id, value: 100 }).expect(201);
    await request(app.getHttpServer()).patch(`/api/opportunities/${deal.body.id}`).set('Cookie', pm).send({ stage: 2 }).expect(200);
    await request(app.getHttpServer()).delete(`/api/opportunities/${deal.body.id}`).set('Cookie', pm).expect(200);
  });
});

describe('team and profiles', () => {
  const http = () => request(app.getHttpServer());
  const idOf = async (cookie: string[]) => (await http().get('/api/auth/me').set('Cookie', cookie)).body.user.id as string;

  it('lists the org chart with reporting lines and availability', async () => {
    const field = await login('arjun@democonsulting.in');
    const team = (await http().get('/api/team').set('Cookie', field).expect(200)).body;
    expect(team.map((t: any) => t.name)).not.toContain('Kavya Menon'); // invited, not signed in yet: not on the chart
    const by = (n: string) => team.find((t: any) => t.name === n);
    expect(by('Anand Iyer').managerId).toBeNull();
    expect(by('Arjun Mehta').managerId).toBe(by('Priya Raman').id);
    expect(by('Meera Nair').status).toBe('leave');
    expect(by('Meera Nair').statusText).toMatch(/^On leave until /);
  });

  it('shows a profile; only you see your settings', async () => {
    const pm = await login('priya@democonsulting.in'); const me = await idOf(pm);
    const mine = (await http().get(`/api/team/${me}`).set('Cookie', pm).expect(200)).body;
    expect(mine.isMe).toBe(true); expect(mine.prefs).toEqual({ remind: true, mention: true, digest: true });
    expect(mine.reports.map((r: any) => r.name)).toEqual(['Arjun Mehta', 'Dev Khanna']);
    expect(mine.projects.length).toBeGreaterThan(0);
    const field = await login('arjun@democonsulting.in');
    const seen = (await http().get(`/api/team/${me}`).set('Cookie', field).expect(200)).body;
    expect(seen.prefs).toBeUndefined(); expect(seen.canEdit).toBe(false);
  });

  it('lets people edit their own contact details, and only admins the reporting line', async () => {
    const field = await login('arjun@democonsulting.in'); const arjun = await idOf(field);
    await http().patch(`/api/team/${arjun}`).set('Cookie', field).send({ phone: '+91 90000 00001', leaveUntil: '2030-01-05' }).expect(200);
    await http().patch(`/api/team/${arjun}`).set('Cookie', field).send({ title: 'CTO' }).expect(403);
    const pm = await login('priya@democonsulting.in'); const priya = await idOf(pm);
    await http().patch(`/api/team/${priya}`).set('Cookie', field).send({ phone: 'x' }).expect(403);
    const owner = await login('anand@democonsulting.in');
    await http().patch(`/api/team/${priya}`).set('Cookie', owner).send({ managerId: arjun }).expect(400); // Arjun reports to Priya: a loop
    await http().patch(`/api/team/${arjun}`).set('Cookie', owner).send({ dept: 'Platform', title: 'Staff engineer' }).expect(200);
    const p = (await http().get(`/api/team/${arjun}`).set('Cookie', owner)).body;
    expect([p.phone, p.dept, p.title, p.status]).toEqual(['+91 90000 00001', 'Platform', 'Staff engineer', 'leave']);
    await http().patch(`/api/team/${arjun}`).set('Cookie', field).send({ leaveUntil: '' }).expect(200);
  });

  it('honours notification and calendar switches', async () => {
    const prisma = db;
    const dev = await login('dev@democonsulting.in'); const devId = await idOf(dev);
    await http().patch('/api/me/prefs').set('Cookie', dev).send({ mention: false, calendar: false }).expect(200);
    // comment on a task Dev reported? use one assigned to Dev, by Priya
    const pm = await login('priya@democonsulting.in');
    const task = (await http().get('/api/tasks').set('Cookie', pm)).body.find((t: any) => t.assigneeId === devId);
    const before = await prisma.emailLog.count({ where: { kind: 'comment' } });
    await http().post(`/api/tasks/${task.id}/comments`).set('Cookie', pm).send({ text: 'Looks good' }).expect(201);
    expect(await prisma.emailLog.count({ where: { kind: 'comment' } })).toBe(before); // Dev switched mentions off
    const m = await http().post('/api/meetings').set('Cookie', pm).send({ title: 'Design review', date: '2030-02-01', start: 11, dur: 0.5, loc: 'Google Meet', attendees: [devId] }).expect(201);
    expect(m.body.invited).toBe(0); // Dev disconnected their calendar
    await http().patch('/api/me/prefs').set('Cookie', dev).send({ mention: true, calendar: true }).expect(200);
  });

  it('sends meeting reminders and the daily digest once, to people who want them', async () => {
    const { SchedulerService } = await import('../src/modules/scheduler.service');
    const { todayISO } = await import('@bos/shared');
    const prisma = db; const sched = app.get(SchedulerService);
    const dev = await login('dev@democonsulting.in'); const devId = await idOf(dev);
    await http().patch('/api/me/prefs').set('Cookie', dev).send({ remind: false }).expect(200);
    const today = todayISO('Asia/Kolkata');
    const ist = (h: number, min: number) => new Date(Date.parse(today + 'T00:00:00Z') + ((h - 5.5) * 60 + min) * 60000);
    // "Weekly status — Brightline Health" is today at 2:00 pm with Priya and Dev
    await sched.tick(ist(13, 52)); await sched.tick(ist(13, 53));
    const rem = await prisma.emailLog.findMany({ where: { kind: 'reminder-meeting', subject: { contains: 'Weekly status' } } });
    expect(rem.map(r => r.to)).toEqual(['priya@democonsulting.in']);
    expect(await prisma.notification.count({ where: { userId: devId, text: { contains: 'Weekly status' } } })).toBe(0);
    await sched.tick(ist(8, 40)); await sched.tick(ist(8, 41));
    const dig = await prisma.emailLog.findMany({ where: { kind: 'digest' } });
    const to = dig.map(r => r.to);
    expect(to.filter(t => t === 'priya@democonsulting.in')).toHaveLength(1);
    expect(to).not.toContain('meera@democonsulting.in'); // on leave
    await http().patch('/api/me/prefs').set('Cookie', dev).send({ remind: true }).expect(200);
  });
});

describe('multitenancy (spec §9)', () => {
  const http = () => request(app.getHttpServer());
  const DEMO = 'org_7f3k2q9xw1';
  let b: { cookie: string[]; id: string };

  /** A second organisation, created through public sign-up by a new account. */
  beforeAll(async () => {
    const res = await http().post('/api/signup').send({
      name: 'Kestrel Advisory', slug: 'kestrel-advisory', currency: 'INR', fy: 'April',
      entity: { name: 'Kestrel Advisory LLP', gstin: '29AAKFK1234M1Z5', address: 'Bengaluru' },
      numbering: { inv: 'INV', qt: 'QT', pattern: '{prefix}-{yyyy}-{seq}' },
      account: { name: 'Kiran Rao', email: 'kiran@kestrel-advisory.in', password: 'kestrel-password-1' },
    }).expect(201);
    b = { cookie: res.headers['set-cookie'] as unknown as string[], id: res.body.id };
  }, 30000);

  it('signs up a new organisation with its own Owner, entity and numbering; slugs are unique', async () => {
    const me = (await http().get('/api/auth/me').set('Cookie', b.cookie).expect(200)).body;
    expect(me.user.roleName).toBe('Owner'); expect(me.org.plan).toBe('trial'); expect(me.org.setupDone).toBe(false);
    expect(me.entities).toHaveLength(1); expect(me.orgs).toHaveLength(1);
    await http().post('/api/signup').send({ name: 'X', slug: 'kestrel-advisory', entity: { name: 'X', gstin: '29AAKFK1234M1Z5' }, account: { name: 'Y', email: 'y@y.in', password: 'yyyyyyyyyyyy' } }).expect(400);
    await http().post('/api/auth/login').send({ email: 'kiran@kestrel-advisory.in', password: 'kestrel-password-1' }).expect(200);
  });

  it('allows the same customer GSTIN and invoice number in two organisations', async () => {
    const owner = await login('anand@democonsulting.in');
    const demoInv = (await http().get('/api/invoices').set('Cookie', owner)).body.find((i: any) => i.no === 'INV-2026-0142');
    // Org B: same GSTIN as Demo's Kestrel Bank, and a series lined up to issue INV-2026-0142 too.
    const cust = await http().post('/api/customers').set('Cookie', b.cookie).send({ name: 'Kestrel Bank', gstin: '27AAACK4821M1Z5', city: 'Mumbai', email: 'ap@kestrelbank.in' }).expect(201);
    const s = (await http().get('/api/settings').set('Cookie', b.cookie)).body.series.find((x: any) => x.type === 'INVOICE');
    await http().patch(`/api/settings/series/${s.id}`).set('Cookie', b.cookie).send({ prefix: 'INV', pattern: '{prefix}-{yyyy}-{seq}', padding: 4, next: 142 }).expect(200);
    const inv = await http().post('/api/invoices').set('Cookie', b.cookie).send({ customerId: cust.body.id, lines: [{ d: 'Advisory', qty: 1, unit: 'fixed', rate: 100000 }] }).expect(201);
    expect(inv.body.message).toMatch(new RegExp(`^${demoInv.no.slice(0, 9)}`));
    const mine = (await http().get('/api/invoices').set('Cookie', b.cookie)).body;
    expect(mine.map((i: any) => i.no)).toEqual([demoInv.no]);
  });

  it('never shows or changes another organisation’s records: 404, not 403', async () => {
    const owner = await login('anand@democonsulting.in');
    const theirs = (await http().get('/api/invoices').set('Cookie', b.cookie)).body[0];
    const theirCust = (await http().get('/api/customers').set('Cookie', b.cookie)).body[0];
    expect((await http().get('/api/invoices').set('Cookie', owner)).body.some((i: any) => i.id === theirs.id)).toBe(false);
    expect((await http().get('/api/customers').set('Cookie', owner)).body.some((c: any) => c.id === theirCust.id)).toBe(false);
    await http().get(`/api/invoices/${theirs.id}/pdf`).set('Cookie', owner).expect(404);
    await http().post(`/api/invoices/${theirs.id}/submit`).set('Cookie', owner).expect(404);
    await http().patch(`/api/customers/${theirCust.id}`).set('Cookie', owner).send({ name: 'Hijacked' }).expect(404);
    const search = (await http().get('/api/search?q=Kestrel').set('Cookie', owner)).body;
    expect(JSON.stringify(search)).not.toContain(theirCust.id);
    // The other way round too.
    const demoCust = (await http().get('/api/customers').set('Cookie', owner)).body[0];
    await http().patch(`/api/customers/${demoCust.id}`).set('Cookie', b.cookie).send({ name: 'Hijacked' }).expect(404);
    // A token for org B can't be pointed at org A.
    await http().post('/api/auth/switch').set('Cookie', b.cookie).send({ orgId: DEMO }).expect(403);
  });

  it('returns no rows to raw SQL when app.org_id is unset (database-level isolation)', async () => {
    const appDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    try {
      const [{ n }] = await appDb.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Invoice"`;
      expect(Number(n)).toBe(0);
      const [{ m }] = await appDb.$queryRaw<{ m: bigint }[]>`SELECT count(*) AS m FROM "Customer"`;
      expect(Number(m)).toBe(0);
    } finally { await appDb.$disconnect(); }
  });

  it('numbers concurrent invoices per entity without gaps or clashes', async () => {
    const fin = await login('meera@democonsulting.in');
    const me = (await http().get('/api/auth/me').set('Cookie', fin)).body;
    const [le1, le2] = me.entities; const cust = (await http().get('/api/customers').set('Cookie', fin)).body[0];
    const make = (entityId: string) => http().post('/api/invoices').set('Cookie', fin).send({ customerId: cust.id, entityId, lines: [{ d: 'x', qty: 1, unit: 'fixed', rate: 1000 }] }).expect(201);
    const rs = await Promise.all([le1, le2, le1, le2, le1, le2].map(e => make(e.id)));
    const nos = rs.map(r => r.body.message.split(' ')[0]);
    const seqs = (p: string) => nos.filter(n => n.startsWith(p)).map(n => +n.slice(-4)).sort((a, z) => a - z);
    const a = seqs('INV-'), m = seqs('MH-INV-');
    expect(a).toHaveLength(3); expect(m).toHaveLength(3);
    expect(a[2] - a[0]).toBe(2); expect(m[2] - m[0]).toBe(2); // contiguous within each entity
    expect(new Set(nos).size).toBe(6);
  });

  it('keeps caches per organisation: switching modules in one leaves the other alone', async () => {
    const r = await http().post('/api/auth/login').send({ email: 'priya@democonsulting.in', password: 'demo1234', org: 'ramanadvisory' }).expect(200);
    const ra = r.headers['set-cookie'] as unknown as string[];
    expect((await http().get('/api/auth/me').set('Cookie', ra)).body.org.name).toBe('Raman Advisory');
    await http().patch('/api/settings/modules/crm').set('Cookie', ra).send({ on: false }).expect(200);
    await http().get('/api/customers').set('Cookie', ra).expect(403);
    const pm = await login('priya@democonsulting.in');
    await http().get('/api/customers').set('Cookie', pm).expect(200);
    await http().patch('/api/settings/modules/crm').set('Cookie', ra).send({ on: true }).expect(200);
    // Switching re-issues the session for the other organisation.
    const sw = await http().post('/api/auth/switch').set('Cookie', ra).send({ orgId: DEMO }).expect(200);
    const back = sw.headers['set-cookie'] as unknown as string[];
    expect((await http().get('/api/auth/me').set('Cookie', back)).body.org.name).toBe('Demo Consulting');
  });

  it('limits a member scoped to one entity to that entity’s documents', async () => {
    const owner = await login('anand@democonsulting.in');
    const me = (await http().get('/api/auth/me').set('Cookie', owner)).body; const le2 = me.entities[1];
    const meera = (await http().get('/api/settings').set('Cookie', owner)).body.users.find((u: any) => u.email === 'meera@democonsulting.in');
    await http().patch(`/api/settings/users/${meera.id}`).set('Cookie', owner).send({ scope: `le:${le2.id}` }).expect(200);
    const fin = await login('meera@democonsulting.in');
    const invs = (await http().get('/api/invoices').set('Cookie', fin)).body;
    expect(invs.length).toBeGreaterThan(0);
    expect(invs.every((i: any) => i.entityId === le2.id)).toBe(true);
    const le1Inv = (await http().get('/api/invoices').set('Cookie', owner)).body.find((i: any) => i.entityId !== le2.id);
    await http().get(`/api/invoices/${le1Inv.id}/pdf`).set('Cookie', fin).expect(404);
    await http().patch(`/api/settings/users/${meera.id}`).set('Cookie', owner).send({ scope: 'all' }).expect(200);
  });

  it('refuses the "as … (demo)" fallback outside a demo organisation', async () => {
    const pm = await login('priya@democonsulting.in'); // Project manager: no payment.create
    const inv = (await http().get('/api/invoices').set('Cookie', pm)).body.find((i: any) => i.bal > 0);
    await db.organization.update({ where: { id: DEMO }, data: { demo: false } });
    try {
      await http().post('/api/payments').set('Cookie', pm).send({ invoiceId: inv.id, amount: 1, method: 'NEFT', ref: 'X' }).expect(403);
    } finally { await db.organization.update({ where: { id: DEMO }, data: { demo: true } }); }
  });

  it('exports everything as a ZIP behind a signed, expiring link', async () => {
    const owner = await login('anand@democonsulting.in');
    await http().post('/api/orgs/current/export').set('Cookie', owner).expect(201);
    let x: any;
    for (let i = 0; i < 60 && x?.status !== 'Ready'; i++) { await new Promise(r => setTimeout(r, 250)); x = (await http().get('/api/orgs/current/data').set('Cookie', owner)).body.exports[0]; }
    expect(x.status).toBe('Ready');
    const path = new URL(x.url).pathname + new URL(x.url).search;
    const zip = await http().get(path).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect((zip.body as Buffer).slice(0, 2).toString()).toBe('PK');
    await http().get(path.replace(/sig=[0-9a-f]/, 'sig=0')).expect(400);
    // Another organisation's members can't list it.
    expect((await http().get('/api/orgs/current/data').set('Cookie', b.cookie)).body.exports).toHaveLength(0);
  }, 30000);

  it('enforces plan limits and lets only the Owner close the organisation', async () => {
    const owner = await login('anand@democonsulting.in');
    await http().patch('/api/orgs/current/plan').set('Cookie', owner).send({ plan: 'starter' }).expect(400); // 8 people, 2 entities
    const pm = await login('priya@democonsulting.in');
    await http().delete('/api/orgs/current').set('Cookie', pm).send({ confirm: 'Demo Consulting' }).expect(403);
    await http().delete('/api/orgs/current').set('Cookie', b.cookie).send({ confirm: 'wrong' }).expect(400);
    await http().delete('/api/orgs/current').set('Cookie', b.cookie).send({ confirm: 'Kestrel Advisory' }).expect(200);
    await http().get('/api/auth/me').set('Cookie', b.cookie).expect(401);
    await http().post('/api/auth/login').send({ email: 'kiran@kestrel-advisory.in', password: 'kestrel-password-1' }).expect(401);
  });
});
