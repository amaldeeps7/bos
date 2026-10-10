import type { Calc, Line } from '@bos/shared';

export interface Me {
  user: { id: string; name: string; email: string; title: string; roleId: string; roleName: string; builtIn: boolean; perms: string[]; modules: Record<string, boolean> };
  org: { name: string; slug: string; tz: string; currency: string; ourState: string; discLimit: number; sacRates: Record<string, number>; templates: any; entity: { name: string; gstin: string; address: string; bank: string; upi: string } | null };
  demo: boolean; serverTime: string;
}
export interface TeamMember { id: string; name: string; title: string; dept: string; email: string; managerId: string | null; status: 'available' | 'meeting' | 'leave'; statusLabel: string; statusText: string }
export interface Profile extends TeamMember {
  phone: string; location: string; hours: string; joined: string; leaveUntil: string;
  manager: { id: string; name: string } | null; reports: { id: string; name: string }[];
  projects: { id: string; name: string; customer: string; open: number }[];
  isMe: boolean; canEdit: boolean; canManage: boolean; calendar?: boolean; prefs?: { remind: boolean; mention: boolean; digest: boolean };
}
export interface Person { id: string; name: string; title: string; role: string; email: string; status: string }
export interface TaskEvent { id: string; userId: string; kind: 'comment' | 'sys'; text: string; at: string }
export interface Task { id: string; key: string; title: string; desc: string; projectId: string; assigneeId: string; reporterId: string; due: string; status: string; priority: string; events: TaskEvent[]; block: { start: number; dur: number } | null }
export interface ActionItem { id: string; text: string; assigneeId: string; taskId: string | null }
export interface Meeting { id: string; title: string; date: string; start: number; dur: number; projectId: string | null; loc: string; link: string; ext: string; agenda: string; notes: string; organizerId: string; attendees: string[]; guests: string[]; actions: ActionItem[] }
export interface Approval { id: string; kind: string; docType: string | null; docId: string | null; ref: string; title: string; detail: string; amount: number | null; by: string; approver: string; age: string; status: 'waiting' | 'sent' | 'approved' | 'rejected' }
export interface Milestone { id: string; seq: number; name: string; pct: number; value: number; status: string; due: string; changedAt: string | null }
export interface Project { id: string; name: string; code: string; customerId: string; customer: string; bu: string; contract: number; endDate: string; health: string; status: string; ownerId: string; quoteId: string | null; createdAt: string; milestones: Milestone[] }
export interface Customer { id: string; name: string; gstin: string; state: string; city: string; contact: string; email: string; phone: string; terms: number; ownerId: string; since: string; outstanding: number; billed: number; projects: number; intra: boolean }
export interface Opportunity { id: string; name: string; customerId: string; customer: string; value: number; ownerId: string; stage: number; next: string }
export interface CatalogItem { id: string; d: string; sac: string; unit: string; rate: number }
interface DocApproval { id: string; approverId: string; approverName: string }
export interface Quote { id: string; no: string; customerId: string; title: string; date: string; validUntil: string; status: string; byId: string; ver: number; lines: Line[]; notes: string; rejected: string | null; projectId: string | null; invoiceId: string | null; calc: Calc; approval: DocApproval | null }
export interface Invoice { id: string; no: string; customerId: string; title: string; projectId: string | null; milestoneId: string | null; date: string; due: string; status: string; displayStatus: string; byId: string; lines: Line[]; notes: string; rejected: string | null; calc: Calc; paid: number; credited: number; bal: number; overdue: boolean; approval: DocApproval | null }
export interface Payment { id: string; no: string; customerId: string; date: string; method: string; ref: string; amount: number; allocations: { invoiceId: string; invoiceNo: string; amount: number }[] }
export interface CreditNote { id: string; no: string; invoiceId: string; invoiceNo: string; customerId: string; date: string; taxable: number; total: number; reason: string }
export interface Asset { id: string; code: string; name: string; cat: string; holderId: string | null; projectId: string | null; status: string; value: number }
export interface Notification { id: string; icon: string; text: string; link: string | null; read: boolean; when: string }
export interface Reports { months: { month: string; label: string; short: string; invoiced: number; collected: number }[]; ageing: { label: string; value: number }[]; byCustomer: { name: string; value: number }[]; leftToBill: { name: string; contract: number; invoiced: number }[]; totals: { invoiced: number; collected: number; outstanding: number }; period: string }
export interface Role { id: string; name: string; desc: string; builtIn: boolean; perms: string[] }
export interface Settings {
  org: { name: string; slug: string; currency: string; tz: string; country: string; fy: string; dateFmt: string; createdAt: string; status: string };
  modules: { id: string; name: string; desc: string; icon: string; on: boolean }[];
  security: any; policy: any; taxOpts: any; reminders: any; templates: any;
  entities: { id: string; name: string; gstin: string; pan: string; cin: string; address: string; bank: string; upi: string; isDefault: boolean; state: string }[];
  units: { id: string; name: string; code: string; entity: string; entityId: string; headId: string | null; head: string; projects: number }[];
  users: { id: string; name: string; email: string; title: string; role: string; status: string; last: string }[];
  roles: Role[];
  series: { type: string; label: string; prefix: string; pattern: string; padding: number; next: number; reset: string; sample: string }[];
  sac: { code: string; desc: string; rate: number; used: number }[];
}
export interface AiReply { text: string; bullets?: string[]; action?: { label: string; kind: 'navigate' | 'reassign' | 'copy' | 'remind'; payload?: Record<string, string> } }
export interface SearchHit { type: string; id: string; title: string; sub: string; href?: string; open?: 'task' | 'meeting' }
export interface SearchResult { q: string; groups: { type: string; label: string; hits: SearchHit[] }[] }
