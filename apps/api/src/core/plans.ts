import { DEFAULT_ROLES, MODULES } from '@bos/shared';

/** Plans and what they include. 0 = unlimited. Trial gets Growth's limits for 14 days. */
export const PLANS: Record<string, { name: string; price: string; seats: number; entities: number; modules: string[] | 'all'; feats: string[] }> = {
  starter: { name: 'Starter', price: '₹2,499', seats: 5, entities: 1, modules: ['crm', 'sales', 'projects', 'tasks', 'billing', 'payments'], feats: ['5 people', '1 legal entity', 'Tasks, meetings, quotations and invoices'] },
  growth: { name: 'Growth', price: '₹7,999', seats: 15, entities: 3, modules: 'all', feats: ['15 people', 'Up to 3 legal entities', 'Every module, including the assistant', 'Approval rules and audit log'] },
  enterprise: { name: 'Enterprise', price: 'Talk to us', seats: 0, entities: 0, modules: 'all', feats: ['Unlimited people and entities', 'Single sign-on and IP allow-list', 'Dedicated database in your region'] },
};
export const planOf = (plan: string) => PLANS[plan === 'trial' ? 'growth' : plan] || PLANS.growth;
export const planAllows = (plan: string, mod: string) => { const m = planOf(plan).modules; return m === 'all' || m.includes(mod); };
export const TRIAL_DAYS = 14;

export const DEFAULT_SAC = [
  { code: '998313', desc: 'IT consulting and support', rate: 18 }, { code: '998314', desc: 'IT design and development', rate: 18 },
  { code: '998316', desc: 'IT infrastructure and network management', rate: 18 }, { code: '998319', desc: 'Other IT services, including security testing', rate: 18 },
  { code: '998311', desc: 'Management consulting', rate: 18 }, { code: '998222', desc: 'Accounting and bookkeeping', rate: 18 },
];

/** Settings a new organisation starts with (the same shapes the demo workspace uses). */
export function orgDefaults(name: string, domain = '') {
  return {
    // Core modules on; the rest are switched on in Settings when needed.
    modules: Object.fromEntries(MODULES.map(m => [m.id, !['assets', 'documents', 'ai'].includes(m.id)])),
    security: { mfaAll: false, mfaFin: true, ssoGoogle: false, newDevice: true, timeout: '8 hours', pwd: '12', domains: domain },
    policy: { discount: '10', quoteMax: '2500000', assetMax: '50000', invAll: true, noSelf: true, msDates: true },
    taxOpts: { round: true, einv: false, lut: false },
    reminders: { stopPartial: true, subject: 'Reminder: {number} for {amount} is due {due}',
      body: `Hi {contact},\n\nA quick reminder that invoice {number} for {amount} is due on {due}. It is attached; you can pay by NEFT or UPI using the details on it.\n\nThank you,\n${name}`,
      steps: [{ label: '3 days before the due date', desc: 'A friendly heads-up with the invoice attached.', on: true }, { label: 'On the due date', desc: '', on: true }, { label: '7 days overdue', desc: '', on: true }, { label: '15 days overdue', desc: 'Copies the account owner.', on: true }, { label: '30 days overdue', desc: 'Copies Finance and flags the customer on new quotations.', on: false }] },
    templates: {
      invoice: { layout: 'Classic', accent: '#0052ff', title: 'Tax invoice', show: { logo: true, sac: true, bank: true, upi: true, sign: true, words: true }, terms: 'Payment due within the agreed terms.', subject: `Invoice {number} from ${name}` },
      quote: { layout: 'Modern', accent: '#0052ff', title: 'Quotation', show: { logo: true, sac: false, bank: false, upi: false, sign: true, words: false }, terms: 'Valid until the date shown. GST is charged at the rate in force on the invoice date.', subject: `Quotation {number} from ${name}` },
    },
  };
}
export { DEFAULT_ROLES };
