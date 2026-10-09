// Status vocabularies and their badge tones, exactly as the design shows them.
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary';
export type StatusDef = [label: string, tone: Tone, solid?: boolean];

export const QUOTE_STATUS: Record<string, StatusDef> = {
  DRAFT: ['Draft', 'neutral'], PENDING_APPROVAL: ['Pending approval', 'warning'], APPROVED: ['Approved', 'info'],
  SENT: ['With customer', 'primary'], ACCEPTED: ['Accepted', 'success'], DECLINED: ['Declined', 'danger'], CONVERTED: ['Converted', 'success', true],
};
export const INVOICE_STATUS: Record<string, StatusDef> = {
  DRAFT: ['Draft', 'neutral'], PENDING_APPROVAL: ['Pending approval', 'warning'], APPROVED: ['Approved', 'info'], ISSUED: ['Issued', 'info'],
  SENT: ['Sent', 'primary'], PARTIALLY_PAID: ['Part paid', 'warning'], OVERDUE: ['Overdue', 'danger'], PAID: ['Paid', 'success', true], CANCELLED: ['Cancelled', 'neutral'],
};
export const UNISSUED = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED'];
export const MILESTONE_STATUS: Record<string, StatusDef> = {
  PENDING: ['Pending', 'neutral'], IN_PROGRESS: ['In progress', 'info'], COMPLETED: ['Ready to bill', 'success'],
  INVOICED: ['Invoiced', 'info', true], PAID: ['Paid', 'success', true],
};
export const TASK_STATUS: Record<string, StatusDef> = {
  todo: ['To do', 'neutral'], doing: ['In progress', 'info'], review: ['In review', 'primary'], blocked: ['Blocked', 'danger'], done: ['Done', 'success'],
};
export const ASSET_STATUS: Record<string, StatusDef> = { IN_USE: ['In use', 'info'], AVAILABLE: ['Available', 'success'], IN_REPAIR: ['In repair', 'warning'] };
export const STAGES = ['New lead', 'Qualified', 'Proposal', 'Negotiation', 'Won'];
export const STAGE_PROB = [0.1, 0.3, 0.5, 0.7, 1];
export const healthTone = (h: string): Tone => (h === 'At risk' ? 'danger' : h === 'On hold' ? 'warning' : 'success');
