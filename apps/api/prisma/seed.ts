/* Seeds two organisations from the design prototype: "Demo Consulting" (the sample workspace, two legal
   entities) and "Raman Advisory" (a fresh trial Priya owns, on the Get started checklist).
   Dates are relative to today in the organisation's time zone, so the demo always looks current.
   Runs as the database owner (BYPASSRLS) on one connection, setting app.org_id for each organisation. */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { DEFAULT_ROLES, MODULES, todayISO, addDays, stateOf } from '@bos/shared';
import { DEFAULT_SAC, orgDefaults } from '../src/core/plans';

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL || '';
const prisma = new PrismaClient({ datasourceUrl: url + (url.includes('?') ? '&' : '?') + 'connection_limit=1' });
/** Every following insert belongs to this organisation (column default + RLS check). */
const tenant = (id: string) => prisma.$executeRaw`SELECT set_config('app.org_id', ${id}, false)`;
export const DEMO_ORG = 'org_7f3k2q9xw1';
const TZ = 'Asia/Kolkata';
const T = todayISO(TZ);
const D = (o: number) => new Date(addDays(T, o) + 'T00:00:00.000Z');
const ago = (days: number, hour = 10) => new Date(new Date(addDays(T, -days) + 'T00:00:00.000Z').getTime() + (hour - 5.5) * 3600000);
const ln = (d: string, qty: number, unit: string, rate: number, disc = 0, sac = '998314') => ({ d, qty, unit, rate, disc, sac });

async function main() {
  if (process.argv.includes('--if-empty') && (await prisma.organization.count())) {
    console.log('Workspace already exists — skipping the demo seed.');
    return;
  }
  // wipe: every tenant row cascades from its organisation
  await prisma.$executeRaw`DELETE FROM "Organization"`;
  await prisma.$executeRaw`DELETE FROM "Account"`;

  await prisma.organization.create({ data: {
    id: DEMO_ORG, slug: 'democonsulting', name: 'Demo Consulting', createdAt: new Date('2019-01-14T05:30:00Z'),
    plan: 'growth', demo: true, setupDone: true, billingEmail: 'accounts@democonsulting.in',
    modules: Object.fromEntries(MODULES.map(m => [m.id, true])),
    security: { mfaAll: false, mfaFin: true, ssoGoogle: true, newDevice: true, timeout: '8 hours', pwd: '12', domains: 'democonsulting.in' },
    policy: { discount: '10', quoteMax: '2500000', assetMax: '50000', invAll: true, noSelf: true, msDates: true },
    taxOpts: { round: true, einv: false, lut: false },
    reminders: { stopPartial: true, subject: 'Reminder: {number} for {amount} is due {due}',
      body: 'Hi {contact},\n\nA quick reminder that invoice {number} for {amount} is due on {due}. It is attached; you can pay by NEFT or UPI using the details on it.\n\nThank you,\nDemo Consulting',
      steps: [{ label: '3 days before the due date', desc: 'A friendly heads-up with the invoice attached.', on: true }, { label: 'On the due date', desc: '', on: true }, { label: '7 days overdue', desc: '', on: true }, { label: '15 days overdue', desc: 'Copies the account owner.', on: true }, { label: '30 days overdue', desc: 'Copies Finance and flags the customer on new quotations.', on: false }] },
    templates: {
      invoice: { layout: 'Classic', accent: '#0052ff', title: 'Tax invoice', show: { logo: true, sac: true, bank: true, upi: true, sign: true, words: true }, terms: 'Payment due within the agreed terms. Interest at 1.5% a month applies to overdue amounts. Subject to Bengaluru jurisdiction.', subject: 'Invoice {number} from Demo Consulting' },
      quote: { layout: 'Modern', accent: '#0052ff', title: 'Quotation', show: { logo: true, sac: false, bank: false, upi: false, sign: true, words: false }, terms: 'Valid until the date shown. GST is charged at the rate in force on the invoice date.', subject: 'Quotation {number} from Demo Consulting' },
    },
  } });

  await tenant(DEMO_ORG);
  const roles: Record<string, string> = {};
  for (const [i, r] of DEFAULT_ROLES.entries()) roles[r.name] = (await prisma.role.create({ data: { name: r.name, desc: r.desc, builtIn: !!r.builtIn, perms: r.perms, sort: i } })).id;

  const hash = await bcrypt.hash('demo1234', 10);
  const U: Record<string, string> = {}; const A: Record<string, string> = {};
  const people: [string, string, string, string, string, string][] = [
    ['anand', 'Anand Iyer', 'Founder & CEO', 'Owner', 'Active', 'today'], ['priya', 'Priya Raman', 'Head of Delivery', 'Project manager', 'Active', 'now'],
    ['meera', 'Meera Nair', 'Finance manager', 'Finance', 'Active', '2h'], ['rohan', 'Rohan Das', 'Sales lead', 'Sales', 'Active', '1d'],
    ['arjun', 'Arjun Mehta', 'Senior engineer', 'Field staff', 'Active', 'today'], ['sara', 'Sara Iqbal', 'Security lead', 'Field staff', 'Active', 'today'],
    ['dev', 'Dev Khanna', 'Product designer', 'Field staff', 'Active', '3d'], ['kavya', 'Kavya Menon', 'Account executive', 'Sales', 'Invited', ''],
  ];
  // reporting line, department, phone, joined
  const org: Record<string, [string, string | null, string, string]> = {
    anand: ['Leadership', null, '+91 98200 11402', '2019-01-07'], priya: ['Delivery', 'anand', '+91 98201 33718', '2021-03-01'],
    sara: ['Cybersecurity', 'anand', '+91 99672 40513', '2022-08-16'], rohan: ['Sales', 'anand', '+91 98923 18044', '2022-06-06'],
    meera: ['Finance', 'anand', '+91 98330 77261', '2021-02-15'], arjun: ['Delivery', 'priya', '+91 97690 52288', '2021-11-08'],
    dev: ['Delivery', 'priya', '+91 98197 61930', '2023-04-03'], kavya: ['Sales', 'rohan', '', ''],
  };
  const last: Record<string, Date | null> = { now: new Date(), today: ago(0, 9), '2h': new Date(Date.now() - 2 * 3600e3), '1d': ago(1, 17), '3d': ago(3, 12), '': null };
  for (const [k, name, title, role, status, la] of people) {
    const [dept, , phone, joined] = org[k];
    const email = `${k}@democonsulting.in`;
    const acc = await prisma.account.create({ data: { email, name, passwordHash: status === 'Active' ? hash : null } });
    A[k] = acc.id;
    U[k] = (await prisma.membership.create({ data: { accountId: acc.id, email, name, title, roleId: roles[role], status, lastActiveAt: last[la],
      dept, phone, location: 'Mumbai', joinedAt: joined ? new Date(joined + 'T00:00:00Z') : null, leaveUntil: k === 'meera' ? D(2) : null,
      inviteToken: status === 'Invited' ? `${DEMO_ORG}.seed-${k}` : null, inviteExpiry: status === 'Invited' ? new Date(Date.now() + 7 * 86400e3) : null } })).id;
  }
  for (const [k, [, mgr]] of Object.entries(org)) if (mgr) await prisma.membership.update({ where: { id: U[k] }, data: { managerId: U[mgr] } });

  const le1 = await prisma.legalEntity.create({ data: { name: 'Demo Consulting Pvt Ltd', gstin: '29AABCD4417E1Z3', state: '29', pan: 'AABCD4417E', cin: 'U72900KA2019PTC124518', address: '2nd floor, 100 Feet Road, Indiranagar, Bengaluru 560038', bank: 'HDFC Bank · A/c 50200012345678 · IFSC HDFC0000123', upi: 'democonsulting@hdfcbank', isDefault: true } });
  const le2 = await prisma.legalEntity.create({ data: { name: 'Demo Consulting Services LLP', gstin: '27AAJFD2210K1ZP', state: '27', pan: 'AAJFD2210K', cin: 'AAT-4471', address: 'Unit 504, Kamala Mills, Lower Parel, Mumbai 400013', bank: 'ICICI Bank · A/c 039905001122 · IFSC ICIC0000399', upi: 'dcsllp@icici', isDefault: false } });
  const BU: Record<string, string> = {};
  for (const [name, code, head] of [['Software', 'SW', 'priya'], ['Cybersecurity', 'CY', 'sara']]) BU[name] = (await prisma.businessUnit.create({ data: { name, code, entityId: le1.id, headId: U[head] } })).id;

  await prisma.sac.createMany({ data: [{ code: '998313', desc: 'IT consulting and support', rate: 18 }, { code: '998314', desc: 'IT design and development', rate: 18 }, { code: '998316', desc: 'IT infrastructure and network management', rate: 18 }, { code: '998319', desc: 'Other IT services, including security testing', rate: 18 }] });
  const catalog = [ln('Senior engineer', 1, 'day', 28000), ln('Product designer', 1, 'day', 22000), ln('Penetration tester', 1, 'day', 45000, 0, '998319'), ln('Compliance consultant', 1, 'day', 35000, 0, '998313'), ln('Retest round', 1, 'fixed', 120000, 0, '998319'), ln('Application support retainer', 1, 'month', 60000, 0, '998316'), ln('Delivery management', 1, 'fixed', 100000)];
  await prisma.catalogItem.createMany({ data: catalog.map((c, i) => ({ d: c.d, sac: c.sac, unit: c.unit, rate: c.rate, sort: i })) });
  // One series per document type and GSTIN; quotations and projects are organisation-wide.
  const yr = { pattern: '{prefix}-{yyyy}-{seq}', padding: 4, reset: 'every financial year' };
  await prisma.series.createMany({ data: [
    { type: 'INVOICE', entityId: le1.id, label: 'Invoices', prefix: 'INV', next: 142, ...yr },
    { type: 'INVOICE', entityId: le2.id, label: 'Invoices', prefix: 'MH-INV', next: 18, ...yr },
    { type: 'QUOTATION', label: 'Quotations', prefix: 'QT', next: 91, ...yr },
    { type: 'CREDIT_NOTE', entityId: le1.id, label: 'Credit notes', prefix: 'CN', next: 9, ...yr },
    { type: 'CREDIT_NOTE', entityId: le2.id, label: 'Credit notes', prefix: 'MH-CN', next: 2, ...yr },
    { type: 'RECEIPT', entityId: le1.id, label: 'Receipts', prefix: 'RCP', next: 65, ...yr },
    { type: 'RECEIPT', entityId: le2.id, label: 'Receipts', prefix: 'MH-RCP', next: 11, ...yr },
    { type: 'PROJECT', label: 'Projects', prefix: 'PRJ', pattern: '{prefix}-{seq}', padding: 4, next: 28, reset: 'never' },
  ] });

  const C: Record<string, string> = {};
  const custs: [string, string, string, string, string, string, string, number, string, number][] = [
    ['Kestrel Bank', '27AAACK4821M1Z5', 'Mumbai', 'Farah Sheikh, CISO', 'ap@kestrelbank.in', '+91 22 4100 2200', '', 30, 'rohan', -900],
    ['Halcyon Logistics', '29AADCH7713P1ZQ', 'Bengaluru', 'Vikram Rao, CTO', 'finance@halcyon.co.in', '+91 80 4611 9800', '', 30, 'priya', -420],
    ['Brightline Health', '29AAFCB2290K1Z8', 'Bengaluru', 'Dr Anita Kulkarni', 'accounts@brightline.health', '+91 80 6720 1144', '', 45, 'rohan', -600],
    ['Northwind Retail', '33AAGCN5502L1ZT', 'Chennai', 'Karthik Subramanian', 'payables@northwind.in', '+91 44 2811 0900', '', 30, 'rohan', -1100],
    ['Asterion Labs', '36AAHCA8810Q1Z2', 'Hyderabad', 'Neha Reddy', 'billing@asterionlabs.com', '+91 40 4455 7010', '', 15, 'priya', -150],
    ['Lumen Schools', '32AAJCL3345R1ZK', 'Kochi', 'Thomas Mathew', 'office@lumenschools.org', '+91 484 290 1180', '', 30, 'priya', -40],
    ['Orbital Freight', '07AAKCO6621S1ZD', 'New Delhi', 'Simran Kaur', 'procurement@orbitalfreight.in', '+91 11 4060 3300', '', 30, 'rohan', -6],
    ['Meridian Clinics', '24AALCM9014T1Z6', 'Ahmedabad', 'Dr Hiren Patel', 'admin@meridianclinics.in', '+91 79 2630 4455', '', 30, 'rohan', -3],
  ];
  for (const [name, gstin, city, contact, email, phone, , terms, owner, since] of custs)
    C[name] = (await prisma.customer.create({ data: { name, gstin, state: gstin.slice(0, 2), city, contact, email, phone, terms, ownerId: U[owner], since: D(since) } })).id;
  if (!stateOf('27AAACK4821M1Z5')) throw new Error('state codes');

  // projects & milestones
  const P: Record<string, string> = {}; const MS: Record<string, string> = {};
  const ms = (k: string, name: string, pct: number, value: number, status: string, due: number) => ({ k, name, pct, value, status, due });
  const projects = [
    { k: 'p1', name: 'SOC 2 Readiness', customer: 'Kestrel Bank', code: 'PRJ-0021', bu: 'Cybersecurity', contract: 1850000, end: 51, health: 'On track', status: 'ACTIVE', ms: [ms('a', 'Gap assessment', 20, 370000, 'PAID', -60), ms('b', 'Policy & control design', 20, 370000, 'INVOICED', -20), ms('c', 'Evidence collection', 30, 555000, 'IN_PROGRESS', 16), ms('d', 'Readiness audit', 30, 555000, 'PENDING', 51)] },
    { k: 'p2', name: 'Fleet Portal Rebuild', customer: 'Halcyon Logistics', code: 'PRJ-0024', bu: 'Software', contract: 3200000, end: 50, health: 'At risk', status: 'ACTIVE', ms: [ms('a', 'Discovery & design', 30, 960000, 'PAID', -45), ms('b', 'Dispatch API', 25, 800000, 'COMPLETED', -3), ms('c', 'Driver app beta', 22.5, 720000, 'IN_PROGRESS', 16), ms('d', 'Launch & handover', 22.5, 720000, 'PENDING', 50)] },
    { k: 'p3', name: 'Patient Intake App', customer: 'Brightline Health', code: 'PRJ-0019', bu: 'Software', contract: 2400000, end: 12, health: 'On track', status: 'ACTIVE', ms: [ms('a', 'Intake MVP', 40, 960000, 'PAID', -70), ms('b', 'Integrations', 40, 960000, 'INVOICED', -6), ms('c', 'UAT & go-live', 20, 480000, 'IN_PROGRESS', 12)] },
    { k: 'p4', name: 'Pen Test — Q4', customer: 'Northwind Retail', code: 'PRJ-0027', bu: 'Cybersecurity', contract: 680000, end: 35, health: 'On track', status: 'ACTIVE', ms: [ms('a', 'Scoping & rules of engagement', 20, 136000, 'IN_PROGRESS', 4), ms('b', 'Test execution', 60, 408000, 'PENDING', 21), ms('c', 'Report & retest', 20, 136000, 'PENDING', 35)] },
    { k: 'p5', name: 'Data Platform Discovery', customer: 'Asterion Labs', code: 'PRJ-0026', bu: 'Software', contract: 950000, end: 30, health: 'On hold', status: 'ON_HOLD', ms: [ms('a', 'Stakeholder interviews', 30, 285000, 'PAID', -25), ms('b', 'Source assessment', 40, 380000, 'IN_PROGRESS', 9), ms('c', 'Roadmap', 30, 285000, 'PENDING', 30)] },
  ];
  for (const p of projects) {
    const pr = await prisma.project.create({ data: { name: p.name, code: p.code, customerId: C[p.customer], entityId: le1.id, unitId: BU[p.bu], contract: p.contract, endDate: D(p.end), health: p.health, status: p.status, ownerId: U.priya, createdAt: ago(90) } });
    P[p.k] = pr.id;
    for (const [i, m] of p.ms.entries()) MS[p.k + m.k] = (await prisma.milestone.create({ data: { projectId: pr.id, seq: i + 1, name: m.name, pct: m.pct, value: m.value, status: m.status, due: D(m.due) } })).id;
  }

  // tasks with descriptions and threads
  type Ev = [string, number, string, boolean?, number?];
  const sy = (who: string, d: number, text: string, h = 10): Ev => [who, d, text, true, h];
  const cm = (who: string, d: number, text: string, h = 11): Ev => [who, d, text, false, h];
  const tasks: [string, string, string, string, string, number, string, string][] = [
    ['t1', 'Review evidence collection for CC6 controls', 'p1', 'priya', 'priya', 0, 'doing', 'High'], ['t2', 'Access review sign-off with Kestrel CISO', 'p1', 'priya', 'sara', -2, 'todo', 'High'],
    ['t3', 'Update risk register after workshop', 'p1', 'sara', 'priya', -1, 'review', 'Medium'], ['t5', 'Scope sign-off call with Northwind', 'p4', 'priya', 'priya', 0, 'todo', 'High'],
    ['t4', 'Prepare kick-off deck for pen test', 'p4', 'priya', 'rohan', 1, 'todo', 'Medium'], ['t16', 'Draft rules of engagement', 'p4', 'sara', 'priya', 2, 'todo', 'Medium'],
    ['t19', 'Code review: trip history', 'p2', 'arjun', 'priya', 0, 'todo', 'Medium'], ['t18', 'Fix GPS drift on Android', 'p2', 'arjun', 'priya', 1, 'todo', 'High'],
    ['t6', 'Offline sync spike for driver app', 'p2', 'arjun', 'priya', 2, 'doing', 'High'], ['t8', 'API rate limiting for dispatch service', 'p2', 'arjun', 'priya', 3, 'blocked', 'Medium'],
    ['t7', 'Push notifications for drivers', 'p2', 'arjun', 'priya', 5, 'todo', 'Medium'], ['t9', 'Fleet dashboard UI review', 'p2', 'dev', 'priya', 4, 'todo', 'Low'],
    ['t10', 'Accessibility pass on intake forms', 'p3', 'dev', 'priya', -1, 'review', 'Medium'], ['t11', 'Triage UAT feedback', 'p3', 'priya', 'priya', 3, 'todo', 'Medium'],
    ['t12', 'Send weekly status to Brightline', 'p3', 'priya', 'priya', 1, 'todo', 'Low'], ['t13', 'Data source inventory', 'p5', 'arjun', 'priya', 9, 'todo', 'Low'],
    ['t14', 'Vendor risk questionnaire', 'p1', 'sara', 'priya', 6, 'todo', 'Low'], ['t17', 'Collect SOC 2 policy documents', 'p1', 'priya', 'priya', -4, 'done', 'Medium'],
    ['t15', 'Wireframes for depot view', 'p2', 'dev', 'priya', -5, 'done', 'Low'],
  ];
  const detail: Record<string, [string, Ev[]]> = {
    t1: ['Walk through every CC6 (logical access) control and check the evidence we have against what the auditor will sample.\n\nDone when: each control has a linked artefact, owner and date, and gaps are logged in the tracker.', [sy('priya', -2, 'created this task'), sy('priya', -1, 'changed status to In progress', 9), cm('sara', -1, 'CC6.1 and CC6.3 are complete. CC6.6 is missing the firewall change log for Q3 — I’ve asked their infra team.', 15), cm('priya', 0, 'Thanks. If the log isn’t in by Friday, we note it as a gap and move on.', 9.67)]],
    t2: ['Get the CISO to sign the quarterly user access review before evidence freeze. Template is in the project documents.', [sy('sara', -5, 'created this task'), cm('sara', -3, 'Their CISO is travelling until Tuesday. EA suggested a 20-minute call Wednesday.'), cm('priya', -1, 'Booked for Thursday 11:00 — will send the pack the night before.', 16)]],
    t3: ['Fold the six new risks from Tuesday’s workshop into the register, with likelihood, impact and an owner each.', [sy('priya', -4, 'created this task'), sy('sara', -1, 'changed status to In review', 14), cm('sara', -1, 'Updated — two of the risks overlap with existing R-14, so I merged them. Please check scoring on R-22.', 14.1)]],
    t5: ['Confirm scope, testing windows and out-of-bounds systems with Northwind’s IT lead.', [sy('priya', -3, 'created this task')]],
    t6: ['Time-boxed spike (3 days): can trips be recorded fully offline and synced without duplicates when the driver reconnects?', [sy('priya', -6, 'created this task'), sy('arjun', -2, 'changed status to In progress'), cm('arjun', -1, 'Local queue works. Conflict handling on edited trips is the hard bit — likely another sprint. Flagged it on the milestone.', 17)]],
    t8: ['Add per-client rate limits to the dispatch API so one integration can’t starve the others.', [sy('priya', -7, 'created this task'), sy('arjun', -2, 'changed status to Blocked'), cm('arjun', -2, 'Waiting on Halcyon to confirm expected peak volume per depot. Can’t size the limits without it.')]],
    t10: ['WCAG 2.1 AA pass on all intake screens: contrast, focus order, labels, and screen-reader announcements on errors.', [sy('priya', -8, 'created this task'), sy('dev', -1, 'changed status to In review'), cm('dev', -1, 'All 14 screens done. Two date pickers still need an aria-live fix from engineering.')]],
    t18: ['Drivers on Android 13 see their position jump up to 40 m in dense areas. Repro steps and logs are in the Halcyon support thread.', [sy('priya', -1, 'created this task'), cm('priya', -1, 'Halcyon flagged this as their top complaint from the pilot drivers.')]],
    t11: ['Sort UAT feedback into must-fix before go-live vs. backlog. Share the list with Brightline for agreement.', [sy('priya', -2, 'created this task')]],
  };
  const TK: Record<string, string> = {};
  for (const [k, title, p, a, by, due, status, priority] of tasks) {
    const [desc, evs] = detail[k] || ['', [sy(by, -7, 'created this task')]];
    const t = await prisma.task.create({ data: { key: 100 + Number(k.slice(1)), title, desc, projectId: P[p], assigneeId: U[a], reporterId: U[by], due: D(due), status, priority, createdAt: ago(-evs[0][1], 9) } });
    TK[k] = t.id;
    for (const [who, d, text, sys, h] of evs) await prisma.taskEvent.create({ data: { taskId: t.id, userId: U[who], kind: sys ? 'sys' : 'comment', text, createdAt: ago(-d, h ?? 10) } });
  }
  await prisma.timeBlock.create({ data: { taskId: TK.t1, userId: U.priya, date: D(0), start: 14.5, dur: 1 } });

  // meetings
  const mt = async (title: string, day: number, start: number, dur: number, p: string | null, who: string[], loc: string, ext: string, agenda: string, notes: string, actions: { text: string; a: string; t?: string }[], link = '') => {
    const m = await prisma.meeting.create({ data: { title, date: D(day), start, dur, projectId: p ? P[p] : null, loc, link, ext, agenda, notes, organizerId: U.priya,
      attendees: { create: who.map(w => ({ userId: U[w] })) }, actions: { create: actions.map((x, i) => ({ text: x.text, assigneeId: U[x.a], taskId: x.t ? TK[x.t] : null, sort: i })) } } });
    return m;
  };
  await mt('Fleet Portal stand-up', 0, 9.5, 0.25, 'p2', ['priya', 'arjun', 'dev'], 'Google Meet', '', '', 'Arjun: offline sync conflicts likely need another sprint.\nDev: depot view wireframes ready for review.', [], 'https://meet.google.com/xqd-fjpr-kta');
  await mt('Scope sign-off — Northwind pen test', 0, 11, 1, 'p4', ['priya', 'sara'], 'Zoom', 'Northwind Retail · 2 guests', '1. Confirm in-scope systems and IP ranges\n2. Agree testing windows (no Friday evenings)\n3. Emergency contacts and stop conditions\n4. Sign rules of engagement', '', [{ text: 'Send final rules of engagement for signature', a: 'sara' }], 'https://zoom.us/j/84120937551');
  await mt('Weekly status — Brightline Health', 0, 14, 0.5, 'p3', ['priya', 'dev'], 'Google Meet', 'Brightline Health · 3 guests', 'UAT progress, go-live date, open accessibility items.', '', [], 'https://meet.google.com/bnh-qzwe-pmc');
  await mt('Pipeline review', 0, 16, 0.75, null, ['priya', 'rohan', 'anand'], 'Office — Board room', '', 'Q4 deals above ₹10L, stalled proposals, Northwind retest add-on.', '', []);
  await mt('1:1 with Arjun', 0, 17.5, 0.5, null, ['priya', 'arjun'], 'Office — Cabin 2', '', 'Workload and the Driver app beta date.', '', []);
  await mt('Risk workshop — Kestrel Bank', -2, 10, 1.5, 'p1', ['priya', 'sara'], 'Kestrel Bank, BKC', 'Kestrel Bank · 4 guests', 'Walk through the draft risk register.', 'Six new risks raised; two overlap with R-14. CISO wants the access review signed before evidence freeze.', [{ text: 'Update risk register after workshop', a: 'sara', t: 't3' }, { text: 'Access review sign-off with Kestrel CISO', a: 'priya', t: 't2' }]);
  await mt('Dispatch API demo — Halcyon', -3, 15, 1, 'p2', ['priya', 'arjun'], 'Google Meet', 'Halcyon Logistics · 3 guests', 'Demo dispatch endpoints, confirm acceptance.', 'Signed off by Halcyon ops lead. Milestone can be invoiced. They asked for rate limiting before go-live.', [{ text: 'API rate limiting for dispatch service', a: 'arjun', t: 't8' }, { text: 'Raise invoice for Dispatch API milestone', a: 'meera' }], 'https://meet.google.com/rta-kmvd-hoe');
  await mt('Driver app beta checkpoint — Halcyon', 1, 15, 1, 'p2', ['priya', 'arjun', 'dev'], 'Google Meet', 'Halcyon Logistics · 2 guests', 'Offline sync plan, revised beta date, GPS drift fix.', '', [], 'https://meet.google.com/rta-kmvd-hoe');
  await mt('Quarterly business review — Kestrel Bank', 2, 12, 1.5, 'p1', ['priya', 'sara', 'anand'], 'Customer site', 'Kestrel Bank · 5 guests', 'SOC 2 progress, renewal scope for FY27.', '', []);
  await mt('Pen test kick-off — Northwind', 4, 10, 1, 'p4', ['priya', 'sara', 'rohan'], 'Zoom', 'Northwind Retail · 3 guests', 'Introductions, comms plan, day-one targets.', '', [], 'https://zoom.us/j/91736420018');
  await mt('Hiring sync', 7, 16.5, 0.5, null, ['priya', 'anand'], 'Office — Cabin 2', '', 'Senior engineer pipeline.', '', []);

  // quotations
  const Q: Record<string, string> = {};
  const quotes = [
    { k: 'q1', no: 'QT-2026-0088', cust: 'Northwind Retail', title: 'Retest add-on', date: -1, valid: 29, status: 'PENDING_APPROVAL', by: 'rohan', ver: 1, lines: [ln('Retest of critical and high findings, two rounds', 1, 'fixed', 272727, 12, '998319')], notes: 'Retest within 30 days of remediation sign-off.' },
    { k: 'q2', no: 'QT-2026-0086', cust: 'Halcyon Logistics', title: 'Fleet Portal phase 2', date: -6, valid: 24, status: 'SENT', by: 'priya', ver: 2, lines: [ln('Senior engineer', 60, 'day', 28000), ln('Product designer', 20, 'day', 22000), ln('Delivery management', 1, 'fixed', 100000)], notes: 'Depot view, driver ratings and offline-first trip history. Billed monthly in arrears.' },
    { k: 'q3', no: 'QT-2026-0081', cust: 'Brightline Health', title: 'Support retainer', date: -14, valid: 16, status: 'SENT', by: 'rohan', ver: 1, lines: [ln('Application support retainer, business hours', 12, 'month', 60000, 0, '998316')], notes: 'P1 response in 2 hours. Billed quarterly in advance.' },
    { k: 'q4', no: 'QT-2026-0079', cust: 'Kestrel Bank', title: 'Cloud configuration review', date: -9, valid: 21, status: 'ACCEPTED', by: 'priya', ver: 1, lines: [ln('Penetration tester', 6, 'day', 45000, 0, '998319'), ln('Findings report and readout', 1, 'fixed', 30000, 0, '998313')], notes: 'AWS production and staging accounts. Accepted by Farah Sheikh on ' + new Date(D(-3)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) + '.' },
    { k: 'q5', no: 'QT-2026-0090', cust: 'Lumen Schools', title: 'Parent app', date: 0, valid: 30, status: 'DRAFT', by: 'priya', ver: 1, lines: [ln('Senior engineer', 50, 'day', 28000), ln('Product designer', 18, 'day', 22000), ln('Delivery management', 1, 'fixed', 44000)], notes: '' },
    { k: 'q6', no: 'QT-2026-0074', cust: 'Asterion Labs', title: 'Data Platform Discovery', date: -40, valid: -10, status: 'CONVERTED', by: 'priya', ver: 1, project: 'p5', lines: [ln('Stakeholder interviews', 1, 'fixed', 285000, 0, '998313'), ln('Source assessment', 1, 'fixed', 380000, 0, '998313'), ln('Roadmap', 1, 'fixed', 285000, 0, '998313')], notes: '' },
  ];
  for (const q of quotes) Q[q.k] = (await prisma.quote.create({ data: { no: q.no, entityId: le1.id, customerId: C[q.cust], title: q.title, date: D(q.date), validUntil: D(q.valid), status: q.status, byId: U[q.by], ver: q.ver, lines: q.lines, notes: q.notes, projectId: q.project ? P[q.project] : null, createdAt: ago(-q.date) } })).id;
  await prisma.project.update({ where: { id: P.p5 }, data: { quoteId: Q.q6 } });

  // invoices
  const I: Record<string, string> = {};
  const invs: [string, string, string, string, string | null, string | null, number, number, string, string, ReturnType<typeof ln>[]][] = [
    ['i5', 'DRAFT-7K2QMB', 'Brightline Health', 'Patient Intake App — Integrations', 'p3', 'b', 0, 45, 'PENDING_APPROVAL', 'meera', [ln('Patient Intake App — Integrations (40%)', 1, 'milestone', 960000)]],
    ['i2', 'INV-2026-0131', 'Kestrel Bank', 'SOC 2 Readiness — Policy & control design', 'p1', 'b', -20, 10, 'SENT', 'meera', [ln('SOC 2 Readiness — Policy & control design (20%)', 1, 'milestone', 370000, 0, '998313')]],
    ['i6', 'INV-2026-0125', 'Asterion Labs', 'Data Platform Discovery — Interviews', 'p5', 'a', -25, -10, 'PAID', 'meera', [ln('Data Platform Discovery — Stakeholder interviews (30%)', 1, 'milestone', 285000, 0, '998313')]],
    ['i1', 'INV-2026-0118', 'Kestrel Bank', 'SOC 2 Readiness — Gap assessment', 'p1', 'a', -32, -2, 'PAID', 'meera', [ln('SOC 2 Readiness — Gap assessment (20%)', 1, 'milestone', 370000, 0, '998313')]],
    ['i3', 'INV-2026-0109', 'Halcyon Logistics', 'Fleet Portal — Discovery & design', 'p2', 'a', -45, -15, 'PAID', 'meera', [ln('Fleet Portal Rebuild — Discovery & design (30%)', 1, 'milestone', 960000)]],
    ['i4', 'INV-2026-0098', 'Brightline Health', 'Patient Intake App — Intake MVP', 'p3', 'a', -70, -25, 'PAID', 'meera', [ln('Patient Intake App — Intake MVP (40%)', 1, 'milestone', 960000)]],
    ['i7', 'INV-2026-0097', 'Northwind Retail', 'Annual external pen test 2026', null, null, -75, -45, 'PARTIALLY_PAID', 'meera', [ln('Annual external penetration test 2026 — final report', 1, 'fixed', 400000, 0, '998319')]],
  ];
  for (const [k, no, cust, title, p, m, date, due, status, by, lines] of invs)
    I[k] = (await prisma.invoice.create({ data: { no, entityId: le1.id, customerId: C[cust], title, projectId: p ? P[p] : null, milestoneId: p && m ? MS[p + m] : null, date: D(date), due: D(due), status, byId: U[by], lines, createdAt: ago(-date) } })).id;

  const pays: [string, string, number, string, string, string, number][] = [
    ['RCP-2026-0064', 'Kestrel Bank', -1, 'NEFT', 'KKBKH26281044', 'i1', 436600], ['RCP-2026-0061', 'Asterion Labs', -10, 'UPI', '628104471932', 'i6', 336300],
    ['RCP-2026-0058', 'Halcyon Logistics', -15, 'RTGS', 'UTIBR52026092311', 'i3', 1132800], ['RCP-2026-0055', 'Northwind Retail', -30, 'Cheque', 'CHQ 004417', 'i7', 200000],
    ['RCP-2026-0049', 'Brightline Health', -40, 'NEFT', 'HDFCN52026082907', 'i4', 1132800],
  ];
  for (const [no, cust, date, method, ref, inv, amt] of pays)
    await prisma.payment.create({ data: { no, entityId: le1.id, customerId: C[cust], date: D(date), method, ref, createdById: U.meera, allocations: { create: [{ invoiceId: I[inv], amount: amt }] } } });
  await prisma.creditNote.create({ data: { no: 'CN-2026-0008', entityId: le1.id, invoiceId: I.i7, date: D(-20), taxable: 40000, total: 47200, reason: 'Two findings were outside the agreed scope and removed from the final report.' } });

  // assets
  const assets: [string, string, string, string | null, string | null, string, number][] = [
    ['AST-0007', 'MacBook Pro 14″ M3', 'Laptop', 'arjun', null, 'IN_USE', 198000], ['AST-0011', 'MacBook Air 13″', 'Laptop', 'dev', null, 'IN_USE', 114900],
    ['AST-0014', 'ThinkPad X1 Carbon', 'Laptop', 'sara', null, 'IN_USE', 162000], ['AST-0019', 'Pixel 8 test device', 'Test device', null, 'p2', 'IN_USE', 52000],
    ['AST-0020', 'Galaxy A54 test device', 'Test device', null, null, 'AVAILABLE', 34000], ['AST-0023', 'Wi-Fi Pineapple Mark VII', 'Security kit', 'sara', 'p4', 'IN_USE', 28500],
    ['AST-0026', 'Dell 27″ monitor', 'Peripheral', null, null, 'IN_REPAIR', 31000], ['AST-0031', 'YubiKey 5 NFC, set of 6', 'Security kit', null, null, 'AVAILABLE', 27600],
  ];
  for (const [code, name, cat, h, p, status, value] of assets) await prisma.asset.create({ data: { code, name, cat, holderId: h ? U[h] : null, projectId: p ? P[p] : null, status, value } });

  // approvals waiting on Priya
  await prisma.approval.createMany({ data: [
    { kind: 'Invoice', docType: 'invoice', docId: I.i5, ref: 'DRAFT-7K2QMB', title: 'Integrations milestone — Brightline Health', detail: 'Draft invoice for Patient Intake App, milestone 2 of 3. GST 18% applied by the legal entity.', amount: 960000, requestedById: U.meera, approverId: U.priya, createdAt: new Date(Date.now() - 2 * 3600e3) },
    { kind: 'Milestone date', ref: 'PRJ-0024', title: `Move “Driver app beta” from ${new Date(D(16)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} to ${new Date(D(37)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`, detail: 'Offline sync needs another sprint. Billing date moves with it; contract value is unchanged.', payload: { milestoneId: MS.p2c, due: addDays(T, 37) }, requestedById: U.arjun, approverId: U.priya, createdAt: ago(1, 16) },
    { kind: 'Quotation', docType: 'quote', docId: Q.q1, ref: 'QT-2026-0088', title: 'Retest add-on for Northwind Retail', detail: '12% discount is above the 10% limit for Sales, so it needs a second approver.', amount: 240000, requestedById: U.rohan, approverId: U.priya, createdAt: ago(1, 12) },
    { kind: 'Asset request', ref: 'AST-REQ-031', title: 'Two Android test devices for Fleet Portal', detail: 'Assigned to the project for its duration, returned to the asset pool at handover.', amount: 68000, payload: { assetCode: 'AST-0020', projectId: P.p2 }, requestedById: U.dev, approverId: U.priya, createdAt: ago(3, 11) },
  ] });

  const opps: [string, string, number, string, number, string][] = [
    ['Route optimisation pilot', 'Orbital Freight', 600000, 'rohan', 0, 'Intro call booked for Monday'], ['HIPAA gap assessment', 'Meridian Clinics', 450000, 'rohan', 0, 'Inbound from website — qualify budget'],
    ['Pen test retainer 2027', 'Kestrel Bank', 1200000, 'rohan', 1, 'Needs scope from Sara'], ['Parent app', 'Lumen Schools', 1800000, 'priya', 1, 'Discovery workshop next week'],
    ['Retest add-on', 'Northwind Retail', 240000, 'rohan', 2, 'Quotation QT-2026-0088 awaiting approval'], ['Fleet Portal phase 2', 'Halcyon Logistics', 2200000, 'priya', 2, 'Proposal sent — follow up'],
    ['Support retainer', 'Brightline Health', 720000, 'rohan', 3, 'Legal reviewing SLA terms'], ['Data Platform Discovery', 'Asterion Labs', 950000, 'priya', 4, 'Converted to PRJ-0026'],
  ];
  for (const [name, cust, value, owner, stage, next] of opps) await prisma.opportunity.create({ data: { name, customerId: C[cust], value, ownerId: U[owner], stage, next } });

  await prisma.auditLog.createMany({ data: [
    { icon: 'icon-file-check', text: 'Meera Nair submitted the Brightline Health integrations invoice for approval', who: 'Meera Nair', userId: U.meera, area: 'invoice', createdAt: new Date(Date.now() - 2 * 3600e3) },
    { icon: 'icon-wallet', text: 'Recorded RCP-2026-0064 against INV-2026-0118', who: 'Meera Nair', userId: U.meera, area: 'payment', createdAt: ago(1, 15) },
    { icon: 'icon-scroll-text', text: 'Rohan Das submitted QT-2026-0088 for approval', who: 'Rohan Das', userId: U.rohan, area: 'quote', createdAt: ago(1, 12) },
    { icon: 'icon-key-round', text: 'Granted invoice.approve to Finance', who: 'Anand Iyer', userId: U.anand, area: 'access', createdAt: ago(3) },
    { icon: 'icon-user-plus', text: 'Invited kavya@democonsulting.in as Sales', who: 'Anand Iyer', userId: U.anand, area: 'access', createdAt: ago(4) },
    { icon: 'icon-receipt', text: 'Issued CN-2026-0008 against INV-2026-0097', who: 'Meera Nair', userId: U.meera, area: 'invoice', createdAt: ago(20) },
    { icon: 'icon-hash', text: 'Changed invoice numbering to {prefix}-{yyyy}-{seq}', who: 'Anand Iyer', userId: U.anand, area: 'settings', createdAt: ago(190) },
  ] });

  await prisma.notification.createMany({ data: [
    { userId: U.priya, icon: 'icon-badge-check', text: 'Meera asked you to approve the Brightline Health integrations invoice', link: '/approvals', createdAt: new Date(Date.now() - 2 * 3600e3) },
    { userId: U.priya, icon: 'icon-circle-alert', text: 'Access review sign-off is 2 days overdue', link: '/tasks', createdAt: ago(0, 8) },
    { userId: U.priya, icon: 'icon-wallet', text: 'Kestrel Bank paid ₹4,36,600 against INV-2026-0118', link: '/payments', createdAt: ago(1, 15) },
    { userId: U.priya, icon: 'icon-message-square', text: 'Arjun commented on Offline sync spike', link: '/tasks', createdAt: ago(1, 17) },
  ] });

  // monthly totals carried over from before go-live (5 months back)
  const hist = [[1420000, 1310000], [1880000, 1540000], [1260000, 1490000], [2150000, 1720000], [1730000, 1980000]];
  const [y, m] = T.split('-').map(Number);
  for (let i = 0; i < 5; i++) { const d = new Date(Date.UTC(y, m - 1 - (5 - i), 1)); await prisma.legacyMonth.create({ data: { month: d.toISOString().slice(0, 7), invoiced: hist[i][0], collected: hist[i][1] } }); }

  // Raman Advisory: Priya's own new organisation, on a trial, not set up yet (the design's second tenant).
  const RA = 'org_ra4821m1z6';
  await prisma.organization.create({ data: { id: RA, slug: 'ramanadvisory', name: 'Raman Advisory', plan: 'trial', trialEndsAt: new Date(Date.now() + 9 * 86400e3 - 3600e3), setupDone: false,
    currency: 'INR', fyStart: 'April', ...orgDefaults('Raman Advisory'),
    // Sample data: the demo people can switch in without enrolling two-factor (new organisations require it for the Owner).
    security: { ...orgDefaults('Raman Advisory').security, mfaFin: false } } });
  await tenant(RA);
  const raRoles: Record<string, string> = {};
  for (const [i, r] of DEFAULT_ROLES.entries()) raRoles[r.name] = (await prisma.role.create({ data: { name: r.name, desc: r.desc, builtIn: !!r.builtIn, perms: r.perms, sort: i } })).id;
  await prisma.membership.create({ data: { accountId: A.priya, email: 'priya@democonsulting.in', name: 'Priya Raman', title: 'Founder', roleId: raRoles.Owner, status: 'Active', calendar: false, joinedAt: new Date() } });
  const ra = await prisma.legalEntity.create({ data: { name: 'Raman Advisory LLP', gstin: '33AAKFR4821M1Z6', state: '33', pan: 'AAKFR4821M', cin: '', address: 'Old No. 12, Cathedral Road, Chennai 600086', bank: '', upi: '', isDefault: true } });
  const fy = { pattern: '{prefix}-{fy}-{seq}', padding: 4, next: 1, reset: 'every financial year' };
  await prisma.series.createMany({ data: [
    { type: 'INVOICE', entityId: ra.id, label: 'Invoices', prefix: 'INV', ...fy }, { type: 'CREDIT_NOTE', entityId: ra.id, label: 'Credit notes', prefix: 'CN', ...fy },
    { type: 'RECEIPT', entityId: ra.id, label: 'Receipts', prefix: 'RCP', ...fy }, { type: 'QUOTATION', label: 'Quotations', prefix: 'QT', ...fy },
    { type: 'PROJECT', label: 'Projects', prefix: 'PRJ', pattern: '{prefix}-{seq}', padding: 4, next: 1, reset: 'never' },
  ] });
  await prisma.sac.createMany({ data: DEFAULT_SAC });
  await prisma.$executeRaw`SELECT set_config('app.org_id', '', false)`;

  console.log(`Seeded Demo Consulting and Raman Advisory for ${T}. Sign in as priya@democonsulting.in / demo1234`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
