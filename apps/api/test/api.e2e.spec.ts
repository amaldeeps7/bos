/* End-to-end checks against a real Postgres (DATABASE_URL). Run `pnpm seed` first; the suite re-seeds itself. */
import { Test } from '@nestjs/testing';
import { execSync } from 'child_process';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { authenticator } from 'otplib';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { RedisService } from '../src/core/redis.service';

let app: NestExpressApplication;
/** Owner connection (bypasses RLS) for checking what the API wrote. The API itself runs as bos_app. */
const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL });
// Sign-in returns you to the organisation you used last; tests name the one they mean.
const login = async (email: string, org = 'democonsulting') => {
  // Each sign-in from its own address, as real people would be: sign-in is rate-limited per IP.
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const res = await request(app.getHttpServer()).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email, password: 'demo1234', org }).expect(200);
  return res.headers['set-cookie'] as unknown as string[];
};

beforeAll(async () => {
  execSync('npx ts-node --transpile-only prisma/seed.ts', { cwd: __dirname + '/..', stdio: 'ignore' });
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  // The same middleware as the server (security headers, cross-site check, rate limits), with the per-IP default raised:
  // the whole suite comes from one address.
  process.env.RATE_LIMIT_PER_MIN = '100000';
  app = configureApp(mod.createNestApplication<NestExpressApplication>());
  // Counters from earlier runs (rate limits, password-reset requests) would otherwise carry over.
  for (const k of ['bos:rl:*', 'bos:forgot:*', 'bos:mfa:*']) await app.get(RedisService).delPattern(k);
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
    const intra = inv.find((i: any) => i.title === 'Patient Intake App — Integrations'); // Brightline, Karnataka
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
    // Priya raised it, so she can't approve it. Finance (Meera) is on leave, so it waits on the Owner.
    await request(app.getHttpServer()).post(`/api/invoices/${id}/approve`).set('Cookie', pm).send({}).expect(403);
    const owner = await login('anand@democonsulting.in');
    await request(app.getHttpServer()).post(`/api/invoices/${id}/approve`).set('Cookie', owner).send({}).expect(200);
    const fin = await login('meera@democonsulting.in');
    // The draft had no number; issuing takes the next one in the entity's series.
    const issued = await request(app.getHttpServer()).post(`/api/invoices/${id}/issue`).set('Cookie', fin).expect(200);
    expect(issued.body.no).toBe(`INV-${new Date().getFullYear()}-0142`);
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
  let b: { cookie: string[]; id: string; secret: string };

  /** A second organisation, created through public sign-up by a new account. */
  beforeAll(async () => {
    const res = await http().post('/api/signup').send({
      name: 'Kestrel Advisory', slug: 'kestrel-advisory', currency: 'INR', fy: 'April',
      entity: { name: 'Kestrel Advisory LLP', gstin: '29AAKFK1234M1Z5', address: 'Bengaluru' },
      numbering: { inv: 'INV', qt: 'QT', pattern: '{prefix}-{yyyy}-{seq}' },
      account: { name: 'Kiran Rao', email: 'kiran@kestrel-advisory.in', password: 'kestrel-password-1' },
    }).expect(201);
    // New organisations require two-factor for the Owner, so sign-up hands back a setup ticket instead of a session.
    expect(res.body.mfa).toBe('setup'); expect(res.headers['set-cookie']).toBeUndefined();
    const setup = await http().post('/api/auth/mfa/setup').send({ ticket: res.body.ticket }).expect(200);
    const on = await http().post('/api/auth/mfa/enable').send({ ticket: res.body.ticket, code: authenticator.generate(setup.body.secret) }).expect(200);
    expect(on.body.codes).toHaveLength(10);
    b = { cookie: on.headers['set-cookie'] as unknown as string[], id: res.body.id, secret: setup.body.secret };
  }, 30000);

  it('signs up a new organisation with its own Owner, entity and numbering; slugs are unique', async () => {
    const me = (await http().get('/api/auth/me').set('Cookie', b.cookie).expect(200)).body;
    expect(me.user.roleName).toBe('Owner'); expect(me.org.plan).toBe('trial'); expect(me.org.setupDone).toBe(false);
    expect(me.entities).toHaveLength(1); expect(me.orgs).toHaveLength(1);
    await http().post('/api/signup').send({ name: 'X', slug: 'kestrel-advisory', entity: { name: 'X', gstin: '29AAKFK1234M1Z5' }, account: { name: 'Y', email: 'y@y.in', password: 'yyyyyyyyyyyy' } }).expect(400);
    expect((await http().post('/api/auth/login').send({ email: 'kiran@kestrel-advisory.in', password: 'kestrel-password-1' }).expect(200)).body.mfa).toBe('code');
  });

  it('allows the same customer GSTIN and invoice number in two organisations', async () => {
    const owner = await login('anand@democonsulting.in');
    const demoInv = (await http().get('/api/invoices').set('Cookie', owner)).body.find((i: any) => i.no === 'INV-2026-0131');
    // Org B: same GSTIN as Demo's Kestrel Bank, and a series lined up to issue INV-2026-0131 too.
    const cust = await http().post('/api/customers').set('Cookie', b.cookie).send({ name: 'Kestrel Bank', gstin: '27AAACK4821M1Z5', city: 'Mumbai', email: 'ap@kestrelbank.in' }).expect(201);
    const s = (await http().get('/api/settings').set('Cookie', b.cookie)).body.series.find((x: any) => x.type === 'INVOICE');
    await http().patch(`/api/settings/series/${s.id}`).set('Cookie', b.cookie).send({ prefix: 'INV', pattern: '{prefix}-{yyyy}-{seq}', padding: 4, next: 131 }).expect(200);
    await http().patch('/api/settings/policy').set('Cookie', b.cookie).send({ invAll: false }).expect(200); // a one-person organisation
    const inv = await http().post('/api/invoices').set('Cookie', b.cookie).send({ customerId: cust.body.id, submit: true, lines: [{ d: 'Advisory', qty: 1, unit: 'fixed', rate: 100000 }] }).expect(201);
    const issued = await http().post(`/api/invoices/${inv.body.id}/issue`).set('Cookie', b.cookie).expect(200);
    expect(issued.body.no).toBe(demoInv.no);
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
    const owner = await login('anand@democonsulting.in');
    await http().patch('/api/settings/policy').set('Cookie', owner).send({ invAll: false }).expect(200);
    const make = (entityId: string) => http().post('/api/invoices').set('Cookie', fin).send({ customerId: cust.id, entityId, submit: true, lines: [{ d: 'x', qty: 1, unit: 'fixed', rate: 1000 }] }).expect(201);
    const drafts = await Promise.all([le1, le2, le1, le2, le1, le2].map(e => make(e.id)));
    // Issue all six at once: numbers come from each entity's locked counter.
    const rs = await Promise.all(drafts.map(r => http().post(`/api/invoices/${r.body.id}/issue`).set('Cookie', fin).expect(200)));
    await http().patch('/api/settings/policy').set('Cookie', owner).send({ invAll: true }).expect(200);
    const nos = rs.map(r => r.body.no);
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
    // Every issued PDF is rendered, so give it time.
    for (let i = 0; i < 120 && x?.status !== 'Ready'; i++) { await new Promise(r => setTimeout(r, 500)); x = (await http().get('/api/orgs/current/data').set('Cookie', owner)).body.exports[0]; }
    expect(x.status).toBe('Ready');
    const path = new URL(x.url).pathname + new URL(x.url).search;
    const zip = await http().get(path).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect((zip.body as Buffer).slice(0, 2).toString()).toBe('PK');
    // Change the signature's first character (to a different one) and the link stops working.
    await http().get(path.replace(/sig=([0-9a-f])/, (_m, c) => `sig=${c === '0' ? '1' : '0'}`)).expect(400);
    // Another organisation's members can't list it.
    expect((await http().get('/api/orgs/current/data').set('Cookie', b.cookie)).body.exports).toHaveLength(0);
  }, 90000);

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

describe('assistant: built-in answers without a key, agent with one', () => {
  const http = () => request(app.getHttpServer());

  it('matches typed questions to the built-in answers when Claude isn’t connected', async () => {
    const { AgentService } = await import('../src/modules/agent/agent.service');
    const agent = app.get(AgentService); const saved = agent.client; agent.client = null;
    try {
      const pm = await login('priya@democonsulting.in');
      expect((await http().get('/api/ai/status').set('Cookie', pm)).body.agent).toBe(false);
      const r = (await http().post('/api/ai/ask').set('Cookie', pm).send({ question: 'what is on my plate today?' }).expect(200)).body;
      expect(r.text).not.toMatch(/ANTHROPIC_API_KEY/);
      const none = (await http().post('/api/ai/ask').set('Cookie', pm).send({ question: 'tell me a joke' }).expect(200)).body;
      expect(none.text).toMatch(/Settings → AI assistant/);
    } finally { agent.client = saved; }
  });

  it('runs tools as the user, streams the answer, and only proposes changes', async () => {
    const { AgentService } = await import('../src/modules/agent/agent.service');
    const agent = app.get(AgentService); const saved = agent.client;
    const calls: any[] = [];
    // A scripted stand-in for the Claude client: look up overdue invoices, propose a reminder, then answer.
    const script = [
      (p: any) => ({ content: [{ type: 'tool_use', id: 'tu_1', name: 'list_invoices', input: { filter: 'overdue' } }], stop_reason: 'tool_use' }),
      (p: any) => {
        const res = JSON.parse(p.messages.at(-1).content[0].content);
        return { content: [{ type: 'tool_use', id: 'tu_2', name: 'propose_payment_reminder', input: { invoice: res[0].no } }], stop_reason: 'tool_use' };
      },
      () => ({ content: [{ type: 'text', text: 'One invoice is overdue. The reminder is ready to confirm.' }], stop_reason: 'end_turn' }),
      () => ({ content: [{ type: 'text', text: 'Still here.' }], stop_reason: 'end_turn' }),
    ];
    agent.client = { beta: { messages: { stream: (p: any) => {
      calls.push(JSON.parse(JSON.stringify(p))); const m = script[calls.length - 1](p); const handlers: ((t: string) => void)[] = [];
      return { on: (_: string, f: (t: string) => void) => handlers.push(f), finalMessage: async () => { m.content.filter((b: any) => b.type === 'text').forEach((b: any) => handlers.forEach(h => h(b.text))); return m; } };
    } } } } as any;
    try {
      const fin = await login('meera@democonsulting.in');
      expect((await http().get('/api/ai/status').set('Cookie', fin)).body.agent).toBe(true);
      const sse = (await http().post('/api/ai/agent').set('Cookie', fin).send({ question: 'Chase overdue invoices', conversationId: 'test-conversation-1' }).expect(200)).text;
      const ev = sse.split('\n\n').filter(Boolean).map(l => JSON.parse(l.replace(/^data: /, '')));
      expect(ev.map(e => e.type)).toEqual(['status', 'status', 'proposal', 'text', 'done']);
      const prop = ev.find(e => e.type === 'proposal').proposal;
      expect(prop).toMatchObject({ method: 'POST', path: expect.stringMatching(/^invoices\/.+\/remind$/), body: {} });
      // The model only ever sees the tools this role may use, and the request opts into the refusal fallback.
      expect(calls[0].tools.map((t: any) => t.name)).toContain('list_invoices');
      expect(calls[0].fallbacks).toBe('default');
      // Nothing changed: a reminder is only sent when the person confirms (the panel makes this exact call).
      await http().post(`/api/${prop.path}`).set('Cookie', fin).send(prop.body).expect(200);

      // Same conversation: history is replayed unchanged and appended to.
      await http().post('/api/ai/agent').set('Cookie', fin).send({ question: 'Thanks', conversationId: 'test-conversation-1' }).expect(200);
      const before = calls[2].messages; const after = calls[3].messages;
      expect(after.slice(0, before.length + 1)).toEqual([...before, { role: 'assistant', content: [{ type: 'text', text: 'One invoice is overdue. The reminder is ready to confirm.' }] }]);

      // Field staff never get finance tools.
      const field = await login('arjun@democonsulting.in');
      calls.length = 0; script.splice(0, script.length, () => ({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
      await http().post('/api/ai/agent').set('Cookie', field).send({ question: 'hi' }).expect(200);
      expect(calls[0].tools.map((t: any) => t.name)).not.toContain('list_invoices');
    } finally { agent.client = saved; }
  });
});

describe('workflows and approvals', () => {
  const http = () => request(app.getHttpServer());

  it('numbers invoices when issued, so cancelled drafts leave no gaps; a cancelled milestone invoice can be billed again', async () => {
    const pm = await login('priya@democonsulting.in'); const owner = await login('anand@democonsulting.in'); const fin = await login('meera@democonsulting.in');
    const p = (await http().get('/api/projects').set('Cookie', pm)).body.find((x: any) => x.code === 'PRJ-0027');
    const m = p.milestones[0];
    await http().post(`/api/projects/${p.id}/milestones/${m.id}/complete`).set('Cookie', pm).expect(200);
    const first = (await http().post(`/api/projects/${p.id}/milestones/${m.id}/bill`).set('Cookie', pm).expect(200)).body.invoiceId;
    const draft = (await http().get('/api/invoices').set('Cookie', fin)).body.find((i: any) => i.id === first);
    expect(draft.no).toMatch(/^DRAFT-/);
    await http().post(`/api/invoices/${first}/cancel`).set('Cookie', fin).expect(200);
    const back = (await http().get('/api/projects').set('Cookie', pm)).body.find((x: any) => x.id === p.id).milestones[0];
    expect(back.status).toBe('COMPLETED');
    const second = (await http().post(`/api/projects/${p.id}/milestones/${m.id}/bill`).set('Cookie', pm).expect(200)).body.invoiceId;
    await http().post(`/api/invoices/${second}/approve`).set('Cookie', owner).send({}).expect(200);
    const before = (await http().get('/api/settings').set('Cookie', owner)).body.series.find((s: any) => s.type === 'INVOICE' && s.prefix === 'INV').next;
    const issued = (await http().post(`/api/invoices/${second}/issue`).set('Cookie', fin).expect(200)).body.no;
    expect(+issued.slice(-4)).toBe(before); // the cancelled draft didn't use a number
  });

  it('lets someone approve their own document only when nobody else can and policy allows it', async () => {
    const owner = await login('anand@democonsulting.in');
    const cust = (await http().get('/api/customers').set('Cookie', owner)).body[0];
    const big = { customerId: cust.id, submit: true, lines: [{ d: 'Big', qty: 1, unit: 'fixed', rate: 100000, disc: 30 }] };
    await http().post('/api/quotes').set('Cookie', owner).send(big).expect(400); // Owner raised it, only the Owner approves, self-approval off
    await http().patch('/api/settings/policy').set('Cookie', owner).send({ noSelf: false }).expect(200);
    const r = await http().post('/api/quotes').set('Cookie', owner).send(big).expect(201);
    expect(r.body.message).toMatch(/approved \(you’re the only Owner\)/);
    await http().patch('/api/settings/policy').set('Cookie', owner).send({ noSelf: true }).expect(200);
  });

  it('moves approvals waiting on someone who is deactivated', async () => {
    const owner = await login('anand@democonsulting.in'); const pm = await login('priya@democonsulting.in');
    const waiting = (await http().get('/api/approvals').set('Cookie', pm)).body.filter((a: any) => a.status === 'waiting').length;
    expect(waiting).toBeGreaterThan(0);
    const priya = (await http().get('/api/settings').set('Cookie', owner)).body.users.find((u: any) => u.email === 'priya@democonsulting.in');
    const r = await http().post(`/api/settings/users/${priya.id}/toggle`).set('Cookie', owner).expect(200);
    expect(r.body.message).toMatch(/moved to someone else/);
    await http().post(`/api/settings/users/${priya.id}/toggle`).set('Cookie', owner).expect(200); // reactivate
    const pm2 = await login('priya@democonsulting.in');
    expect((await http().get('/api/approvals').set('Cookie', pm2)).body.filter((a: any) => a.status === 'waiting').length).toBe(0);
  });

  it('routes equipment requests for approval, and assignments above the limit to a second person', async () => {
    const field = await login('arjun@democonsulting.in'); const pm = await login('priya@democonsulting.in'); const owner = await login('anand@democonsulting.in');
    const assets = (await http().get('/api/assets').set('Cookie', owner)).body;
    const phone = assets.find((a: any) => a.code === 'AST-0020'); const keys = assets.find((a: any) => a.code === 'AST-0031');
    const req = await http().post(`/api/assets/${phone.id}/request`).set('Cookie', field).send({}).expect(200);
    expect(req.body.message).toMatch(/for approval/);
    await http().post(`/api/assets/${phone.id}/request`).set('Cookie', pm).send({}).expect(400); // already asked for
    const ap = (await http().get('/api/approvals').set('Cookie', pm)).body.find((a: any) => a.ref === 'AST-0020' && a.status === 'waiting');
    await http().post(`/api/approvals/${ap.id}/decide`).set('Cookie', pm).send({ approve: true }).expect(200);
    const after = (await http().get('/api/assets').set('Cookie', owner)).body.find((a: any) => a.code === 'AST-0020');
    expect([after.status, after.holderId]).toEqual(['IN_USE', (await http().get('/api/auth/me').set('Cookie', field)).body.user.id]);
    // Above the limit, a Project manager (assign, not manage) can't hand it out alone.
    await http().patch('/api/settings/policy').set('Cookie', owner).send({ assetMax: 20000 }).expect(200);
    const r = await http().post(`/api/assets/${keys.id}/assign`).set('Cookie', pm).send({}).expect(200);
    expect(r.body.message).toMatch(/for approval/);
    expect((await http().get('/api/assets').set('Cookie', owner)).body.find((a: any) => a.code === 'AST-0031').status).toBe('AVAILABLE');
    await http().patch('/api/settings/policy').set('Cookie', owner).send({ assetMax: 50000 }).expect(200);
  });
});

/** The PDF's document title (pdfkit writes it as an indirect, often UTF-16 hex, string). */
function pdfTitle(pdf: string) {
  const ref = pdf.match(/\/Title (\d+) 0 R/)?.[1]; const raw = (ref ? pdf.match(new RegExp(`\\n${ref} 0 obj\\n([^\\n]*)`))?.[1] : pdf.match(/\/Title ([^\n]*)/)?.[1]) || '';
  if (raw.startsWith('<')) { const b = Buffer.from(raw.slice(1, -1), 'hex'); return (b.subarray(0, 2).toString('hex') === 'feff' ? b.subarray(2).swap16().toString('utf16le') : b.toString('latin1')); }
  return raw.replace(/^\(|\)$/g, '').replace(/\\([()\\])/g, '$1');
}

describe('GST on and off', () => {
  const http = () => request(app.getHttpServer());
  const pdfOf = (path: string, cookie: string[]) => http().get(path).set('Cookie', cookie).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);

  it('lets an entity issue plain, untaxed documents; issued ones keep their GST', async () => {
    const owner = await login('anand@democonsulting.in');
    const le2 = (await http().get('/api/auth/me').set('Cookie', owner)).body.entities.find((e: any) => e.name.endsWith('LLP'));
    const issuedBefore = (await http().get('/api/invoices').set('Cookie', owner)).body.filter((i: any) => i.entityId === le2.id && !['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED'].includes(i.status));
    // A GST entity needs its GSTIN; switching off needs a state instead.
    await http().patch(`/api/settings/entities/${le2.id}`).set('Cookie', owner).send({ gstin: '' }).expect(400);
    const off = await http().patch(`/api/settings/entities/${le2.id}`).set('Cookie', owner).send({ gst: false, state: '27' }).expect(200);
    expect(off.body.message).toMatch(/GST is off/);

    // A customer with no GSTIN, just a state.
    await http().post('/api/customers').set('Cookie', owner).send({ name: 'Corner Bakery' }).expect(400);
    const cust = await http().post('/api/customers').set('Cookie', owner).send({ name: 'Corner Bakery', state: 'Maharashtra', city: 'Pune' }).expect(201);
    const listed = (await http().get('/api/customers').set('Cookie', owner)).body.find((c: any) => c.id === cust.body.id);
    expect([listed.gstin, listed.state]).toEqual(['', 'Maharashtra']);

    const inv = await http().post('/api/invoices').set('Cookie', owner).send({ customerId: cust.body.id, entityId: le2.id, lines: [{ d: 'Website', qty: 2, unit: 'day', rate: 10000, disc: 0, sac: '998314' }] }).expect(201);
    const got = (await http().get('/api/invoices').set('Cookie', owner)).body.find((i: any) => i.id === inv.body.id);
    expect([got.calc.gst, got.calc.tax, got.calc.grand, got.calc.taxRows.length]).toEqual([false, 0, 20000, 0]);
    const pdf = (await pdfOf(`/api/invoices/${inv.body.id}/pdf`, owner)).body.toString('latin1');
    expect(pdfTitle(pdf)).toMatch(/^Invoice \(draft\) DRAFT-/);
    expect(pdf).not.toMatch(/Tax invoice/);

    // Issued invoices of the entity are unchanged.
    const after = (await http().get('/api/invoices').set('Cookie', owner)).body;
    for (const b of issuedBefore) expect(after.find((i: any) => i.id === b.id).calc.tax).toBe(b.calc.tax);

    // Registering again: drafts follow, and are taxed (Maharashtra → Maharashtra, so CGST + SGST).
    await http().patch(`/api/settings/entities/${le2.id}`).set('Cookie', owner).send({ gst: true }).expect(400); // GSTIN needed
    await http().patch(`/api/settings/entities/${le2.id}`).set('Cookie', owner).send({ gst: true, gstin: '27AAJFD2210K1ZP' }).expect(200);
    const back = (await http().get('/api/invoices').set('Cookie', owner)).body.find((i: any) => i.id === inv.body.id);
    expect([back.calc.gst, back.calc.tax, back.calc.intra]).toEqual([true, 3600, true]);
  });
});

describe('two-factor sign-in', () => {
  const http = () => request(app.getHttpServer());
  const cookieOf = (r: any) => r.headers['set-cookie'] as unknown as string[];
  // Each 30-second step works once per account; the API also accepts the next step (clock drift), so use that if this one is spent.
  const freshCode = async (secret: string, email: string) => {
    for (;;) {
      const used = (await db.account.findUniqueOrThrow({ where: { email } })).mfaStep; const now = Date.now(); const step = Math.floor(now / 30_000);
      for (const d of [0, 1]) if (step + d > used) return authenticator.clone({ epoch: now + d * 30_000 }).generate(secret);
      await new Promise(r => setTimeout(r, 1000));
    }
  };

  it('turns on from the profile, then asks for a code at sign-in; a backup code works once', async () => {
    const pm = await login('priya@democonsulting.in');
    const st = await http().post('/api/auth/mfa/setup').set('Cookie', pm).send({}).expect(200);
    expect(st.body.qr).toMatch(/^data:image\/png;base64,/);
    await http().post('/api/auth/mfa/enable').set('Cookie', pm).send({ code: '000000' }).expect(400);
    const c1 = authenticator.generate(st.body.secret);
    const on = await http().post('/api/auth/mfa/enable').set('Cookie', pm).send({ code: c1 }).expect(200);
    const backup = on.body.codes as string[];
    expect((await http().get('/api/auth/mfa').set('Cookie', cookieOf(on)).expect(200)).body).toMatchObject({ on: true, backupLeft: 10, required: false });
    // The secret is stored encrypted, not as typed.
    const acc = await db.account.findUniqueOrThrow({ where: { email: 'priya@democonsulting.in' } });
    expect(acc.mfaSecret).toMatch(/^v1\./); expect(acc.mfaSecret).not.toContain(st.body.secret);

    // Sign-in now stops at the second step: no session until the code checks out.
    const first = await http().post('/api/auth/login').send({ email: 'priya@democonsulting.in', password: 'demo1234', org: 'democonsulting' }).expect(200);
    expect(first.body.mfa).toBe('code'); expect(cookieOf(first)).toBeUndefined();
    await http().get('/api/auth/me').set('Authorization', `Bearer ${first.body.ticket}`).expect(401); // a ticket isn't a session
    await http().post('/api/auth/mfa/verify').send({ ticket: first.body.ticket, code: c1 }).expect(400); // already used
    const ok = await http().post('/api/auth/mfa/verify').send({ ticket: first.body.ticket, code: backup[0] }).expect(200);
    expect(ok.body.message).toMatch(/backup code. 9 left/);
    await http().get('/api/auth/me').set('Cookie', cookieOf(ok)).expect(200);
    const again = await http().post('/api/auth/login').send({ email: 'priya@democonsulting.in', password: 'demo1234', org: 'democonsulting' }).expect(200);
    await http().post('/api/auth/mfa/verify').send({ ticket: again.body.ticket, code: backup[0] }).expect(400); // used up

    // Turning it off needs the password and a code.
    await http().post('/api/auth/mfa/disable').set('Cookie', cookieOf(ok)).send({ password: 'wrong', code: backup[1] }).expect(400);
    await http().post('/api/auth/mfa/disable').set('Cookie', cookieOf(ok)).send({ password: 'demo1234', code: backup[1] }).expect(200);
    expect((await http().post('/api/auth/login').send({ email: 'priya@democonsulting.in', password: 'demo1234', org: 'democonsulting' }).expect(200)).body.ok).toBe(true);
  }, 60000);

  it('enforces the organisation policy: sessions without a second factor are sent back to sign in, and it can’t be turned off', async () => {
    // A new organisation requires two-factor for its Owner: sign-up enrols, and every later sign-in asks for a code.
    const email = 'lata@lotus-studio.in', password = 'lotus-password-1';
    const up = await http().post('/api/signup').send({ name: 'Lotus Studio', slug: 'lotus-studio', entity: { name: 'Lotus Studio', gst: false, state: '29' }, account: { name: 'Lata Iyer', email, password } }).expect(201);
    const secret = (await http().post('/api/auth/mfa/setup').send({ ticket: up.body.ticket }).expect(200)).body.secret;
    await http().post('/api/auth/mfa/enable').send({ ticket: up.body.ticket, code: authenticator.generate(secret) }).expect(200);
    const t = await http().post('/api/auth/login').send({ email, password }).expect(200);
    expect(t.body.mfa).toBe('code');
    const s = await http().post('/api/auth/mfa/verify').send({ ticket: t.body.ticket, code: await freshCode(secret, email) }).expect(200);
    expect((await http().get('/api/auth/mfa').set('Cookie', cookieOf(s))).body).toMatchObject({ on: true, required: true });
    const off = await http().post('/api/auth/mfa/disable').set('Cookie', cookieOf(s)).send({ password, code: await freshCode(secret, email) }).expect(400);
    expect(off.body.message).toMatch(/Lotus Studio requires two-factor/);

    // In a normal organisation (the sample one is exempt), an Owner without two-factor is sent back to set it up.
    const owner = await login('anand@democonsulting.in');
    await db.organization.update({ where: { id: 'org_7f3k2q9xw1' }, data: { demo: false } });
    try {
      expect((await http().get('/api/projects').set('Cookie', owner).expect(401)).body.code).toBe('mfa_required');
      expect((await http().post('/api/auth/login').send({ email: 'anand@democonsulting.in', password: 'demo1234', org: 'democonsulting' }).expect(200)).body.mfa).toBe('setup');
      // A Project manager isn't covered by the Owner/Finance rule.
      expect((await http().post('/api/auth/login').send({ email: 'priya@democonsulting.in', password: 'demo1234', org: 'democonsulting' }).expect(200)).body.ok).toBe(true);
    } finally { await db.organization.update({ where: { id: 'org_7f3k2q9xw1' }, data: { demo: true } }); }
  }, 90000);

  it('lets an admin reset two-factor for someone who lost their phone, only if that account is theirs alone', async () => {
    const owner = await login('anand@democonsulting.in');
    const pm = await login('priya@democonsulting.in');
    const st = await http().post('/api/auth/mfa/setup').set('Cookie', pm).send({}).expect(200);
    await http().post('/api/auth/mfa/enable').set('Cookie', pm).send({ code: authenticator.generate(st.body.secret) }).expect(200);
    const priya = (await http().get('/api/settings').set('Cookie', owner)).body.users.find((u: any) => u.email === 'priya@democonsulting.in');
    expect(priya.mfa).toBe(true);
    // Priya also belongs to Raman Advisory, so Demo's Owner can't weaken her sign-in.
    expect((await http().post(`/api/settings/users/${priya.id}/reset-mfa`).set('Cookie', owner).expect(400)).body.message).toMatch(/another organisation/);
    await http().post(`/api/settings/users/${priya.id}/reset-mfa`).set('Cookie', await login('arjun@democonsulting.in')).expect(403);
    const meera = (await http().get('/api/settings').set('Cookie', owner)).body.users.find((u: any) => u.email === 'meera@democonsulting.in');
    const fin = await login('meera@democonsulting.in');
    const ms = await http().post('/api/auth/mfa/setup').set('Cookie', fin).send({}).expect(200);
    await http().post('/api/auth/mfa/enable').set('Cookie', fin).send({ code: authenticator.generate(ms.body.secret) }).expect(200);
    await http().post(`/api/settings/users/${meera.id}/reset-mfa`).set('Cookie', owner).expect(200);
    expect((await db.account.findUniqueOrThrow({ where: { email: 'meera@democonsulting.in' } })).mfaSecret).toBeNull();
    await db.account.update({ where: { email: 'priya@democonsulting.in' }, data: { mfaSecret: null, mfaBackup: [], mfaStep: 0 } });
  }, 90000);
});

describe('security basics', () => {
  const http = () => request(app.getHttpServer());

  it('sends security headers and hides the framework', async () => {
    const r = await http().get('/api/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(r.headers['strict-transport-security']).toMatch(/max-age/);
    expect(r.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(r.headers['x-powered-by']).toBeUndefined();
    // PDFs open in the browser's viewer, so they don't carry the deny-all policy.
    const owner = await login('anand@democonsulting.in');
    const inv = (await http().get('/api/invoices').set('Cookie', owner)).body[0];
    const pdf = await http().get(`/api/invoices/${inv.id}/pdf`).set('Cookie', owner).expect(200);
    expect(pdf.headers['content-security-policy']).toBeUndefined(); expect(pdf.headers['x-content-type-options']).toBe('nosniff');
  });

  it('refuses state-changing requests from another website', async () => {
    const owner = await login('anand@democonsulting.in');
    const evil = await http().post('/api/notifications/read-all').set('Cookie', owner).set('Origin', 'https://evil.example').expect(403);
    expect(evil.body.message).toMatch(/another website/);
    await http().post('/api/auth/login').set('Origin', 'https://evil.example').send({ email: 'x@y.z', password: 'x' }).expect(403);
    // The app's own origin, and non-browser clients (no Origin), are fine.
    await http().post('/api/auth/login').set('Origin', 'http://localhost:3000').send({ email: 'priya@democonsulting.in', password: 'demo1234', org: 'democonsulting' }).expect(200);
    await http().get('/api/auth/me').set('Cookie', owner).set('Origin', 'https://evil.example').expect(200); // reads are covered by CORS
  });

  it('rate-limits sensitive routes per IP, user or organisation', async () => {
    const ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < 60; i++) await http().get('/api/signup/slug/some-name').set('X-Forwarded-For', ip).expect(200);
    const r = await http().get('/api/signup/slug/some-name').set('X-Forwarded-For', ip).expect(429);
    expect(r.headers['retry-after']).toBe('60');
    await http().get('/api/signup/slug/some-name').set('X-Forwarded-For', '10.250.0.1').expect(200); // another address isn't affected
    // The per-IP default applies to every route.
    process.env.RATE_LIMIT_PER_MIN = '3';
    try {
      const other = `10.8.${Math.floor(Math.random() * 250)}.1`;
      for (let i = 0; i < 3; i++) await http().get('/api/health').set('X-Forwarded-For', other).expect(200);
      await http().get('/api/health').set('X-Forwarded-For', other).expect(429);
    } finally { process.env.RATE_LIMIT_PER_MIN = '100000'; }
  });

  it('marks cookies Secure in production unless told otherwise', () => {
    const { secureCookies } = require('../src/core/session.service');
    const env = { ...process.env };
    try {
      process.env.NODE_ENV = 'production'; delete process.env.COOKIE_SECURE; expect(secureCookies()).toBe(true);
      process.env.COOKIE_SECURE = 'false'; expect(secureCookies()).toBe(false);
      process.env.NODE_ENV = 'development'; delete process.env.COOKIE_SECURE; expect(secureCookies()).toBe(false);
    } finally { process.env = env; }
  });
});

describe('everyday fixes', () => {
  const http = () => request(app.getHttpServer());
  const DEMO = 'org_7f3k2q9xw1';

  it('sends the payment reminder schedule automatically, once per step', async () => {
    const { SchedulerService } = await import('../src/modules/scheduler.service');
    const { runAs } = await import('../src/core/tenant');
    const { todayISO } = await import('@bos/shared');
    const sched = app.get(SchedulerService); const today = todayISO('Asia/Kolkata');
    await db.emailLog.deleteMany({ where: { kind: 'reminder' } }); await app.get(RedisService).delPattern('bos:payrem:*');
    // INV-2026-0131 is due in 10 days: nothing yet. Make it due in 3 days, the first step.
    await runAs({ orgId: DEMO, scope: { all: true } }, () => sched.paymentReminders(today));
    expect(await db.emailLog.count({ where: { kind: 'reminder', orgId: DEMO } })).toBe(0);
    const inv = await db.invoice.findFirstOrThrow({ where: { orgId: DEMO, no: 'INV-2026-0131' } });
    await db.invoice.update({ where: { id: inv.id }, data: { due: new Date(Date.parse(today) + 3 * 86400_000) } });
    await runAs({ orgId: DEMO, scope: { all: true } }, () => sched.paymentReminders(today));
    const sent = await db.emailLog.findMany({ where: { kind: 'reminder', orgId: DEMO } });
    expect(sent.map(m => m.ref)).toEqual(['INV-2026-0131']);
    const audit = await db.auditLog.findMany({ where: { orgId: DEMO, text: { contains: 'automatic payment reminder' } } });
    expect(audit.length).toBe(sent.length); expect(audit[0].userId).toBeNull();
    // Running again (the next minute, or on another instance) sends nothing new.
    await runAs({ orgId: DEMO, scope: { all: true } }, () => sched.paymentReminders(today));
    expect(await db.emailLog.count({ where: { kind: 'reminder', orgId: DEMO } })).toBe(sent.length);
    await db.invoice.update({ where: { id: inv.id }, data: { due: inv.due } });
  });

  it('keeps cancelled meetings as history instead of deleting them', async () => {
    const pm = await login('priya@democonsulting.in');
    const m = (await http().post('/api/meetings').set('Cookie', pm).send({ title: 'To be cancelled', date: '2026-12-01', start: 11, dur: 0.5, loc: 'Google Meet', attendees: [] }).expect(201)).body;
    await http().delete(`/api/meetings/${m.id}`).set('Cookie', pm).expect(200);
    expect((await http().get('/api/meetings').set('Cookie', pm)).body.find((x: any) => x.id === m.id)).toBeUndefined();
    const c = (await http().get('/api/meetings/cancelled').set('Cookie', pm).expect(200)).body.find((x: any) => x.id === m.id);
    expect(c.title).toBe('To be cancelled'); expect(c.cancelledAt).toBeTruthy();
    await http().patch(`/api/meetings/${m.id}`).set('Cookie', pm).send({ title: 'x' }).expect(404); // can't edit a cancelled meeting
  });
});

describe('sessions and passwords', () => {
  const http = () => request(app.getHttpServer());
  const cookieOf = (r: any) => r.headers['set-cookie'] as unknown as string[];
  const signIn = (email: string, password = 'demo1234', extra: Record<string, string> = {}) =>
    http().post('/api/auth/login').set('X-Forwarded-For', `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`).set(extra).send({ email, password, org: 'democonsulting' });

  it('signs out on the server: a signed-out cookie stops working, and other devices can be signed out', async () => {
    const a = cookieOf(await signIn('rohan@democonsulting.in').expect(200));
    const b = cookieOf(await signIn('rohan@democonsulting.in').expect(200));
    const list = (await http().get('/api/auth/sessions').set('Cookie', a).expect(200)).body;
    expect(list.filter((s: any) => s.current)).toHaveLength(1); expect(list.length).toBeGreaterThanOrEqual(2);
    await http().post('/api/auth/logout').set('Cookie', b).expect(200);
    await http().get('/api/auth/me').set('Cookie', b).expect(401); // the copied cookie is dead
    const c = cookieOf(await signIn('rohan@democonsulting.in').expect(200));
    const cId = (await http().get('/api/auth/sessions').set('Cookie', c)).body.find((s: any) => s.current).id;
    await http().post(`/api/auth/sessions/${cId}/revoke`).set('Cookie', a).expect(200);
    await http().get('/api/auth/me').set('Cookie', c).expect(401);
    const d = cookieOf(await signIn('rohan@democonsulting.in').expect(200));
    const keep = await http().post('/api/auth/sessions/revoke-others').set('Cookie', a).expect(200);
    await http().get('/api/auth/me').set('Cookie', d).expect(401);
    await http().get('/api/auth/me').set('Cookie', cookieOf(keep)).expect(200); // this device stays signed in
  });

  it('keeps an active session alive: the cookie is renewed as you use the app', async () => {
    const { JwtService } = await import('@nestjs/jwt');
    const jwt = app.get(JwtService);
    const a = cookieOf(await signIn('rohan@democonsulting.in').expect(200));
    const token = a[0].split(';')[0].split('=')[1];
    const p: any = jwt.decode(token);
    const { exp: _e, ...rest } = p; const old = await jwt.signAsync({ ...rest, iat: Math.floor(Date.now() / 1000) - 600 }, { expiresIn: 1800 });
    const r = await http().get('/api/auth/me').set('Cookie', `bos_token=${old}`).expect(200);
    expect(cookieOf(r)?.[0]).toMatch(/^bos_token=/); // renewed
    const fresh = await http().get('/api/auth/me').set('Cookie', a).expect(200);
    expect(cookieOf(fresh)).toBeUndefined(); // not on every request
  });

  it('changes and resets passwords, signing other devices out', async () => {
    const { MailService } = await import('../src/core/mail.service');
    const mail = app.get(MailService); const sent: any[] = [];
    const spy = jest.spyOn(mail, 'send').mockImplementation(async (m: any) => { sent.push(m); return { ok: true }; });
    try {
      const a = cookieOf(await signIn('dev@democonsulting.in').expect(200));
      const other = cookieOf(await signIn('dev@democonsulting.in').expect(200));
      await http().post('/api/auth/password').set('Cookie', a).send({ current: 'wrong', password: 'a-new-password-1' }).expect(400);
      await http().post('/api/auth/password').set('Cookie', a).send({ current: 'demo1234', password: 'short' }).expect(400);
      const ch = await http().post('/api/auth/password').set('Cookie', a).send({ current: 'demo1234', password: 'a-new-password-1' }).expect(200);
      await http().get('/api/auth/me').set('Cookie', other).expect(401);
      await http().get('/api/auth/me').set('Cookie', cookieOf(ch)).expect(200);
      await signIn('dev@democonsulting.in').expect(401);
      expect(sent.at(-1).subject).toBe('Your Business OS password was changed');

      // Forgot: same answer whether or not the account exists; the link works once.
      const none = await http().post('/api/auth/forgot').send({ email: 'nobody@nowhere.in' }).expect(200);
      const yes = await http().post('/api/auth/forgot').send({ email: 'dev@democonsulting.in' }).expect(200);
      expect(yes.body.message).toBe(none.body.message);
      const link = sent.find(m => m.subject === 'Reset your Business OS password').text.match(/token=(\S+)/)[1];
      await http().post('/api/auth/reset').send({ token: link, password: 'short' }).expect(400);
      await http().post('/api/auth/reset').send({ token: link, password: 'demo1234-reset-ok' }).expect(200);
      await http().post('/api/auth/reset').send({ token: link, password: 'demo1234-reset-2' }).expect(400); // used
      await http().get('/api/auth/me').set('Cookie', cookieOf(ch)).expect(401); // every device signed out
      await signIn('dev@democonsulting.in', 'demo1234-reset-ok').expect(200);
    } finally {
      spy.mockRestore();
      await db.account.update({ where: { email: 'dev@democonsulting.in' }, data: { passwordHash: require('bcryptjs').hashSync('demo1234', 10) } });
    }
  });

  it('emails people when they sign in from a new device (when the organisation asks for it)', async () => {
    const { MailService } = await import('../src/core/mail.service');
    const mail = app.get(MailService); const sent: any[] = [];
    const spy = jest.spyOn(mail, 'send').mockImplementation(async (m: any) => { sent.push(m); return { ok: true }; });
    try {
      await app.get(RedisService).delPattern('bos:devices:*');
      const first = await signIn('rohan@democonsulting.in').expect(200); // first device ever: no email
      const device = cookieOf(first).find(c => c.startsWith('bos_device='))!.split(';')[0];
      await signIn('rohan@democonsulting.in', 'demo1234', { Cookie: device }).expect(200); // same device: no email
      expect(sent.filter(m => m.subject === 'New sign-in to Business OS')).toHaveLength(0);
      await signIn('rohan@democonsulting.in', 'demo1234', { 'User-Agent': 'Mozilla/5.0 (iPhone) Safari/604.1' }).expect(200);
      const n = sent.filter(m => m.subject === 'New sign-in to Business OS');
      expect(n).toHaveLength(1); expect(n[0].text).toMatch(/Safari on iOS/);
    } finally { spy.mockRestore(); }
  });
});

describe('account: email, photo, membership', () => {
  const http = () => request(app.getHttpServer());
  const cookieOf = (r: any) => r.headers['set-cookie'] as unknown as string[];
  const capture = async () => {
    const { MailService } = await import('../src/core/mail.service');
    const sent: any[] = []; const spy = jest.spyOn(app.get(MailService), 'send').mockImplementation(async (m: any) => { sent.push(m); return { ok: true }; });
    return { sent, spy, link: (subject: string) => sent.filter(m => m.subject === subject).at(-1)?.text.match(/token=(\S+)/)?.[1] as string };
  };

  it('lets only the Owner require confirmed emails; unconfirmed people confirm by link before signing in', async () => {
    const { sent, spy, link } = await capture();
    try {
      const owner = await login('anand@democonsulting.in'); const pm = await login('priya@democonsulting.in');
      await http().patch('/api/settings/security').set('Cookie', pm).send({ verifyEmail: true }).expect(403);
      // Rohan hasn't confirmed his address (cleared here); the Owner turns the rule on.
      await db.account.update({ where: { email: 'rohan@democonsulting.in' }, data: { emailVerifiedAt: null } });
      await http().patch('/api/settings/security').set('Cookie', owner).send({ verifyEmail: true }).expect(200);
      const r = await http().post('/api/auth/login').send({ email: 'rohan@democonsulting.in', password: 'demo1234', org: 'democonsulting' }).expect(200);
      expect(r.body.verify).toBe('email'); expect(cookieOf(r)?.find(c => c.startsWith('bos_token='))).toBeUndefined();
      await http().post('/api/auth/verify-email/send').send({ ticket: r.body.ticket }).expect(200);
      const token = link('Confirm your email address');
      expect((await http().post('/api/auth/verify-email').send({ token }).expect(200)).body.message).toMatch(/confirmed/);
      await http().post('/api/auth/verify-email').send({ token }).expect(400); // once
      expect((await http().post('/api/auth/login').send({ email: 'rohan@democonsulting.in', password: 'demo1234', org: 'democonsulting' }).expect(200)).body.ok).toBe(true);
      await http().patch('/api/settings/security').set('Cookie', owner).send({ verifyEmail: false }).expect(200);
    } finally { spy.mockRestore(); }
  });

  it('refuses a sign-up that would take over an invited address', async () => {
    const owner = await login('anand@democonsulting.in');
    await http().post('/api/settings/users/invite').set('Cookie', owner).send({ email: 'pending@democonsulting.in', role: 'Sales' }).expect(201);
    const r = await http().post('/api/signup').send({ name: 'Grab', slug: 'grab-co', entity: { name: 'Grab', gst: false, state: '29' }, account: { name: 'X', email: 'pending@democonsulting.in', password: 'grab-password-12' } }).expect(400);
    expect(r.body.message).toMatch(/invitation waiting/);
    // The invitation can be withdrawn.
    const inv = (await http().get('/api/settings').set('Cookie', owner)).body.users.find((u: any) => u.email === 'pending@democonsulting.in');
    await http().delete(`/api/settings/users/${inv.id}`).set('Cookie', owner).expect(200);
    expect((await http().get('/api/settings').set('Cookie', owner)).body.users.find((u: any) => u.email === 'pending@democonsulting.in')).toBeUndefined();
  });

  it('sets your own name and photo; photos are only served to your organisation', async () => {
    const pm = await login('priya@democonsulting.in');
    await http().patch('/api/me/profile').set('Cookie', pm).send({ name: 'Priya R.' }).expect(200);
    expect((await http().get('/api/auth/me').set('Cookie', pm)).body.user.name).toBe('Priya R.');
    await http().patch('/api/me/profile').set('Cookie', pm).send({ name: 'Priya Raman' }).expect(200);
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    await http().post('/api/me/avatar').set('Cookie', pm).send({ image: 'data:image/png;base64,' + Buffer.from('not an image').toString('base64') }).expect(400);
    await http().post('/api/me/avatar').set('Cookie', pm).send({ image: `data:image/png;base64,${png}` }).expect(200);
    const me = (await http().get('/api/auth/me').set('Cookie', pm)).body.user;
    expect(me.avatar).toMatch(new RegExp(`^/api/avatars/${me.accountId}\\?v=\\d+$`));
    const people = (await http().get('/api/people').set('Cookie', pm)).body;
    expect(people.find((p: any) => p.id === me.id).avatar).toBe(me.avatar);
    const img = await http().get(me.avatar).set('Cookie', await login('arjun@democonsulting.in')).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    await http().get('/api/avatars/not-a-member').set('Cookie', pm).expect(404);
    await http().delete('/api/me/avatar').set('Cookie', pm).expect(200);
    expect((await http().get('/api/auth/me').set('Cookie', pm)).body.user.avatar).toBeNull();
  });

  it('changes your email once the new address confirms it', async () => {
    const { spy, link } = await capture();
    try {
      const dev = await login('dev@democonsulting.in');
      await http().post('/api/me/email').set('Cookie', dev).send({ email: 'anand@democonsulting.in', password: 'demo1234' }).expect(400); // taken
      await http().post('/api/me/email').set('Cookie', dev).send({ email: 'dev.new@democonsulting.in', password: 'wrong' }).expect(400);
      await http().post('/api/me/email').set('Cookie', dev).send({ email: 'dev.new@democonsulting.in', password: 'demo1234' }).expect(200);
      await http().post('/api/auth/login').send({ email: 'dev@democonsulting.in', password: 'demo1234', org: 'democonsulting' }).expect(200); // unchanged until confirmed
      await http().post('/api/auth/verify-email').send({ token: link('Confirm your new email address') }).expect(200);
      await http().post('/api/auth/login').send({ email: 'dev.new@democonsulting.in', password: 'demo1234', org: 'democonsulting' }).expect(200);
      expect((await db.membership.findFirstOrThrow({ where: { email: 'dev.new@democonsulting.in' } })).name).toBeTruthy();
    } finally {
      spy.mockRestore();
      const acc = await db.account.findUniqueOrThrow({ where: { email: 'dev.new@democonsulting.in' } });
      await db.account.update({ where: { id: acc.id }, data: { email: 'dev@democonsulting.in' } });
      await db.membership.updateMany({ where: { accountId: acc.id }, data: { email: 'dev@democonsulting.in' } });
    }
  });

  it('hands ownership over, lets non-owners leave, and deletes an account', async () => {
    const owner = await login('anand@democonsulting.in');
    const s = (await http().get('/api/settings').set('Cookie', owner)).body;
    const rohan = s.users.find((u: any) => u.email === 'rohan@democonsulting.in');
    const pmRole = s.roles.find((r: any) => r.name === 'Project manager');
    await http().post('/api/settings/owner').set('Cookie', await login('priya@democonsulting.in')).send({ memberId: rohan.id, roleId: pmRole.id, password: 'demo1234' }).expect(403);
    await http().post('/api/settings/owner').set('Cookie', owner).send({ memberId: rohan.id, roleId: pmRole.id, password: 'wrong' }).expect(400);
    await http().post('/api/settings/owner').set('Cookie', owner).send({ memberId: rohan.id, roleId: pmRole.id, password: 'demo1234' }).expect(200);
    expect((await http().get('/api/auth/me').set('Cookie', owner)).body.user.roleName).toBe('Project manager');
    // An Owner can't leave without handing over; Rohan (now Owner) hands it back.
    const rc = await login('rohan@democonsulting.in');
    await http().post('/api/me/leave').set('Cookie', rc).send({ password: 'demo1234' }).expect(400);
    const anand = s.users.find((u: any) => u.email === 'anand@democonsulting.in');
    const sales = s.roles.find((r: any) => r.name === 'Sales');
    await http().post('/api/settings/owner').set('Cookie', rc).send({ memberId: anand.id, roleId: sales.id, password: 'demo1234' }).expect(200);

    // Arjun leaves; then deletes his account.
    const ar = await login('arjun@democonsulting.in');
    const left = await http().post('/api/me/leave').set('Cookie', ar).send({ password: 'demo1234' }).expect(200);
    expect(left.body.next).toBeNull();
    await http().post('/api/auth/login').send({ email: 'arjun@democonsulting.in', password: 'demo1234', org: 'democonsulting' }).expect(401);
    await db.membership.updateMany({ where: { email: 'arjun@democonsulting.in' }, data: { status: 'Active' } });
    const ar2 = await login('arjun@democonsulting.in');
    await http().post('/api/me/delete').set('Cookie', ar2).send({ password: 'demo1234', confirm: 'nope' }).expect(400);
    await http().post('/api/me/delete').set('Cookie', ar2).send({ password: 'demo1234', confirm: 'arjun@democonsulting.in' }).expect(200);
    await http().get('/api/auth/me').set('Cookie', ar2).expect(401);
    await http().post('/api/auth/login').send({ email: 'arjun@democonsulting.in', password: 'demo1234', org: 'democonsulting' }).expect(401);
    expect(await db.account.findUnique({ where: { email: 'arjun@democonsulting.in' } })).toBeNull();
  });
});

describe('notifications', () => {
  const http = () => request(app.getHttpServer());
  it('links to the item, marks one read, and pages through older ones', async () => {
    const pm = await login('priya@democonsulting.in'); const rohan = await login('rohan@democonsulting.in');
    const project = (await http().get('/api/projects').set('Cookie', pm)).body[0];
    const rid = (await http().get('/api/auth/me').set('Cookie', rohan)).body.user.id;
    const t = (await http().post('/api/tasks').set('Cookie', pm).send({ title: 'Check the deck', projectId: project.id, assigneeId: rid, due: '2026-12-01' }).expect(201)).body;
    const bell = (await http().get('/api/notifications').set('Cookie', rohan).expect(200)).body;
    const n = bell.find((x: any) => x.text.includes('Check the deck'));
    expect(n.link).toBe(`/tasks?task=${t.id}`); expect(n.read).toBe(false);
    await http().post(`/api/notifications/${n.id}/read`).set('Cookie', rohan).expect(200);
    expect((await http().get('/api/notifications').set('Cookie', rohan)).body.find((x: any) => x.id === n.id).read).toBe(true);
    await http().post(`/api/notifications/${n.id}/read`).set('Cookie', pm).expect(200); // someone else's: no effect, no error
    const rid2 = await db.membership.findUniqueOrThrow({ where: { id: rid } });
    await db.notification.createMany({ data: Array.from({ length: 35 }, (_, i) => ({ orgId: rid2.orgId, userId: rid, icon: 'icon-bell', text: `Old ${i}`, createdAt: new Date(Date.now() - (i + 1) * 3600_000) })) });
    const p1 = (await http().get('/api/notifications/all').set('Cookie', rohan).expect(200)).body;
    expect(p1.rows).toHaveLength(30); expect(p1.more).toBe(true); expect(p1.unread).toBeGreaterThanOrEqual(35);
    const p2 = (await http().get(`/api/notifications/all?before=${p1.rows.at(-1).id}`).set('Cookie', rohan).expect(200)).body;
    expect(p2.rows.length).toBeGreaterThan(0); expect(p2.rows.some((r: any) => p1.rows.some((x: any) => x.id === r.id))).toBe(false);
    const unread = (await http().get('/api/notifications/all?unread=1').set('Cookie', rohan)).body;
    expect(unread.rows.every((r: any) => !r.read)).toBe(true);
  });
});

describe('lists: bulk changes, history, report periods', () => {
  const http = () => request(app.getHttpServer());

  it('changes several tasks at once, with the same checks as one at a time', async () => {
    // Sara (Field staff): Arjun's account is deleted by an earlier test.
    const pm = await login('priya@democonsulting.in'); const field = await login('sara@democonsulting.in');
    const project = (await http().get('/api/projects').set('Cookie', pm)).body[0];
    const mk = async (title: string) => (await http().post('/api/tasks').set('Cookie', pm).send({ title, projectId: project.id, due: '2026-12-01' }).expect(201)).body.id;
    const ids = [await mk('Bulk A'), await mk('Bulk B'), await mk('Bulk C')];
    await http().post('/api/tasks/bulk').set('Cookie', pm).send({ ids: [] }).expect(400);
    await http().post('/api/tasks/bulk').set('Cookie', pm).send({ ids }).expect(400); // nothing to change
    const r = await http().post('/api/tasks/bulk').set('Cookie', pm).send({ ids, status: 'doing', priority: 'High', due: '2026-12-15' }).expect(200);
    expect(r.body).toMatchObject({ done: 3, skipped: 0 });
    const after = (await http().get('/api/tasks').set('Cookie', pm)).body.filter((t: any) => ids.includes(t.id));
    expect(after.every((t: any) => t.status === 'doing' && t.priority === 'High' && t.due === '2026-12-15')).toBe(true);
    // Field staff can't see Priya's tasks, so nothing of theirs changes.
    const f = await http().post('/api/tasks/bulk').set('Cookie', field).send({ ids, status: 'done' }).expect(200);
    expect(f.body).toMatchObject({ done: 0, skipped: 3 });
    const del = await http().post('/api/tasks/bulk').set('Cookie', pm).send({ ids, delete: true }).expect(200);
    expect(del.body.done).toBe(3);
  });

  it('keeps long-finished tasks out of the everyday list but pages them in, and opens one on its own', async () => {
    const pm = await login('priya@democonsulting.in');
    const project = (await http().get('/api/projects').set('Cookie', pm)).body[0];
    const t = (await http().post('/api/tasks').set('Cookie', pm).send({ title: 'Old finished thing', projectId: project.id, due: '2026-01-10' }).expect(201)).body;
    await http().patch(`/api/tasks/${t.id}`).set('Cookie', pm).send({ status: 'done' }).expect(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).doneAt).toBeTruthy();
    await db.task.update({ where: { id: t.id }, data: { doneAt: new Date(Date.now() - 45 * 86400_000) } });
    expect((await http().get('/api/tasks').set('Cookie', pm)).body.some((x: any) => x.id === t.id)).toBe(false);
    const h = (await http().get('/api/tasks/history?q=old finished').set('Cookie', pm).expect(200)).body;
    expect(h.rows.map((x: any) => x.id)).toContain(t.id);
    expect((await http().get(`/api/tasks/${t.id}`).set('Cookie', pm).expect(200)).body.title).toBe('Old finished thing');
    await http().patch(`/api/tasks/${t.id}`).set('Cookie', pm).send({ status: 'todo' }).expect(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).doneAt).toBeNull(); // reopened
  });

  it('approves several at once', async () => {
    // Whoever the seeded approvals are waiting on.
    const pending = await db.approval.findFirstOrThrow({ where: { orgId: 'org_7f3k2q9xw1', status: 'PENDING' } });
    const owner = await login((await db.membership.findUniqueOrThrow({ where: { id: pending.approverId } })).email);
    const waiting = (await http().get('/api/approvals').set('Cookie', owner)).body.filter((a: any) => a.status === 'waiting');
    expect(waiting.length).toBeGreaterThan(0);
    const r = await http().post('/api/approvals/bulk').set('Cookie', owner).send({ ids: waiting.map((a: any) => a.id), approve: true }).expect(200);
    expect(r.body.done + r.body.skipped).toBe(waiting.length);
    expect((await http().get('/api/approvals').set('Cookie', owner)).body.filter((a: any) => a.status === 'waiting').length).toBe(r.body.skipped);
  });

  it('reports on a chosen period', async () => {
    const owner = await login('anand@democonsulting.in');
    const def = (await http().get('/api/reports').set('Cookie', owner).expect(200)).body;
    expect(def.months).toHaveLength(6);
    const fy = (await http().get('/api/reports?from=2026-04&to=2026-10').set('Cookie', owner).expect(200)).body;
    expect(fy.months.map((m: any) => m.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(fy.period).toBe('April 2026 to October 2026');
    const long = (await http().get('/api/reports?from=2020-01&to=2026-10').set('Cookie', owner).expect(200)).body;
    expect(long.months).toHaveLength(24); // capped
    await http().get('/api/reports?from=2026-10&to=2026-04').set('Cookie', owner).expect(400);
  });

  it('keeps old meetings out of the everyday list but pages them in', async () => {
    const pm = await login('priya@democonsulting.in');
    const m = (await http().post('/api/meetings').set('Cookie', pm).send({ title: 'Ancient sync', date: '2025-01-15', start: 10, dur: 0.5, loc: 'Google Meet', attendees: [] }).expect(201)).body;
    expect((await http().get('/api/meetings').set('Cookie', pm)).body.some((x: any) => x.id === m.id)).toBe(false);
    const past = (await http().get('/api/meetings/past').set('Cookie', pm).expect(200)).body;
    expect(past.rows.some((x: any) => x.id === m.id)).toBe(true);
  });
});

describe('AI assistant key in settings', () => {
  const http = () => request(app.getHttpServer());
  it('lets the Owner connect the organisation’s own key, stored encrypted and never shown', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const { AgentService } = await import('../src/modules/agent/agent.service');
    const agent = app.get(AgentService); const saved = agent.client; agent.client = null; // no server key
    const ok = jest.spyOn((Anthropic as any).Models.prototype, 'list').mockResolvedValue({ data: [] } as any);
    try {
      const owner = await login('anand@democonsulting.in'); const pm = await login('priya@democonsulting.in');
      expect((await http().get('/api/ai/key').set('Cookie', owner).expect(200)).body).toMatchObject({ source: 'none', hint: null });
      expect((await http().get('/api/ai/status').set('Cookie', pm)).body.agent).toBe(false);
      const key = 'sk-ant-api03-' + 'x'.repeat(40) + 'WXYZ';
      await http().put('/api/ai/key').set('Cookie', pm).send({ key }).expect(403); // Owner only
      await http().put('/api/ai/key').set('Cookie', owner).send({ key: 'not-a-key' }).expect(400);
      await http().put('/api/ai/key').set('Cookie', owner).send({ key }).expect(200);
      const st = (await http().get('/api/ai/key').set('Cookie', owner)).body;
      expect(st).toMatchObject({ source: 'organisation', hint: 'WXYZ' }); expect(JSON.stringify(st)).not.toContain(key);
      const row = await db.organization.findUniqueOrThrow({ where: { id: 'org_7f3k2q9xw1' } });
      expect(row.aiKey).toMatch(/^v1\./); expect(row.aiKey).not.toContain('xxxx');
      expect((await http().get('/api/ai/status').set('Cookie', pm)).body.agent).toBe(true);
      // Another organisation isn't affected.
      expect((await db.organization.findUniqueOrThrow({ where: { id: 'org_ra4821m1z6' } })).aiKey).toBeNull();
      // A rejected key isn't saved.
      ok.mockRejectedValueOnce(new (Anthropic as any).AuthenticationError(401, { error: { message: 'invalid x-api-key' } }, 'invalid x-api-key', new Headers()));
      expect((await http().put('/api/ai/key').set('Cookie', owner).send({ key: 'sk-ant-api03-' + 'y'.repeat(40) }).expect(400)).body.message).toMatch(/rejected/);
      expect((await http().get('/api/ai/key').set('Cookie', owner)).body.hint).toBe('WXYZ');
      await http().delete('/api/ai/key').set('Cookie', owner).expect(200);
      expect((await http().get('/api/ai/key').set('Cookie', owner)).body.source).toBe('none');
    } finally { ok.mockRestore(); agent.client = saved; }
  });
});
