'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addDays, dayLabel, diffDays, fmtT, gstText, inr, stateOf, weekday } from '@bos/shared';
import { api, ApiError } from '@/lib/api';
import { useAct, useApp, useQ } from '@/lib/app';
import { dayOpts, findSlot, provider } from '@/lib/domain';
import type { Customer, Invoice, Meeting, Project, Task } from '@/lib/types';
import { Btn, Dialog } from './ui';
import { useQueryClient } from '@tanstack/react-query';

const ms = { padding: '18px 20px', display: 'flex', flexDirection: 'column' as const, gap: 14 };

export function MeetingDialog() {
  const { ui, setUi, today, now, me, people, toast } = useApp(); const act = useAct();
  const projects = useQ<Project[]>('projects').data || [];
  const meetings = useQ<Meeting[]>('meetings').data || [];
  const n = ui.meetDialog; if (!n) return null;
  const set = (patch: object) => setUi(u => ({ meetDialog: { ...u.meetDialog!, ...patch } }));
  const editing = !!n.id;
  const save = async () => {
    const body = { title: n.title, projectId: n.p || null, date: n.date, start: +n.start, dur: +n.dur, loc: n.loc, link: n.link.trim(), attendees: n.who };
    if (editing) {
      const r = await act<Meeting & { moved: boolean }>(`meetings/${n.id}`, body, { method: 'PATCH', quiet: true });
      if (r) { setUi({ meetDialog: null }); toast(r.moved ? `Moved to ${dayLabel(n.date, today)}, ${fmtT(+n.start)}. Attendees notified.` : 'Meeting updated.'); }
    } else {
      const r = await act('meetings', body, { quiet: true });
      if (r) { setUi({ meetDialog: null }); const k = n.who.length - 1; toast(k ? `Invite sent to ${k} ${k === 1 ? 'person' : 'people'} via Google Calendar.` : 'Added to your calendar.'); }
    }
  };
  const ppl = [...people.values()].filter(p => p.status === 'Active');
  void meetings; void now;
  return (
    <Dialog width={520} title={editing ? 'Edit or reschedule' : 'New meeting'} sub={editing ? 'Attendees get the updated invite automatically.' : 'Invites go out through your connected Google Calendar.'} onClose={() => setUi({ meetDialog: null })}
      footer={<><Btn onClick={() => setUi({ meetDialog: null })} style={{ boxShadow: 'none' }}>Cancel</Btn><Btn kind="pri" onClick={save}>{editing ? 'Save and notify' : 'Send invites'}</Btn></>}>
      <div style={ms}>
        <label className="label">Title<input className="input" value={n.title} onChange={e => set({ title: e.target.value })} placeholder="What's it about?" style={{ fontSize: 15 }} /></label>
        <label className="label">Project<select className="select" value={n.p} onChange={e => set({ p: e.target.value })}>
          <option value="">No project (internal)</option>{projects.map(x => <option key={x.id} value={x.id}>{x.name} · {x.customer}</option>)}
        </select></label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 14 }}>
          <label className="label">Day<select className="select" value={n.date} onChange={e => set({ date: e.target.value })}>
            {[...new Set([...dayOpts(today), n.date])].sort().map(d => <option key={d} value={d}>{dayLabel(d, today)}</option>)}
          </select></label>
          <label className="label">Starts<select className="select" value={n.start} onChange={e => set({ start: e.target.value })}>
            {Array.from({ length: 22 }, (_, i) => 8 + i / 2).map(h => <option key={h} value={String(h)}>{fmtT(h)}</option>)}
          </select></label>
          <label className="label">Length<select className="select" value={n.dur} onChange={e => set({ dur: e.target.value })}>
            {[['0.25', '15 min'], ['0.5', '30 min'], ['0.75', '45 min'], ['1', '1 hour'], ['1.5', '1.5 hours'], ['2', '2 hours']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        </div>
        <label className="label">Where<select className="select" value={n.loc} onChange={e => set({ loc: e.target.value })}>
          {[...new Set(['Google Meet', 'Zoom', 'Microsoft Teams', 'Office — Board room', 'Office — Cabin 2', 'Customer site', n.loc])].map(x => <option key={x} value={x}>{x}</option>)}
        </select></label>
        <label className="label">Call link <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: 13, marginTop: -4 }}>Optional. Join opens this link directly.</span>
          <input className="input mono" value={n.link} onChange={e => { const v = e.target.value; set({ link: v, ...(provider(v) ? { loc: provider(v) } : {}) }); }} placeholder="https://meet.google.com/… or https://zoom.us/j/…" />
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>Attendees</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ppl.map(p => { const on = n.who.includes(p.id); const self = p.id === me.user.id;
              return <button key={p.id} onClick={() => !self && set({ who: on ? n.who.filter(x => x !== p.id) : [...n.who, p.id] })} style={{ height: 32, padding: '0 12px', borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: self ? 'default' : 'pointer', border: '1px solid ' + (on ? 'rgba(0,82,255,.3)' : '#e2e8f0'), background: on ? '#eef4ff' : '#fff', color: on ? '#0052ff' : '#64748b' }}>{self ? 'You' : p.name}</button>; })}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** Opens the meeting dialog prefilled with the next free half hour today. */
export function useOpenNewMeeting() {
  const { setUi, today, now, me } = useApp();
  const meetings = useQ<Meeting[]>('meetings').data || []; const tasks = useQ<Task[]>('tasks').data || [];
  return (projectId = '') => {
    const busy = [...meetings.filter(m => diffDays(m.date, today) === 0), ...tasks.filter(t => t.block).map(t => t.block!)];
    const slot = findSlot(0.5, now, busy);
    // Once today is full (or over), propose the first free slot tomorrow.
    const tomorrow = addDays(today, 1);
    const date = slot === null ? tomorrow : today;
    const start = slot ?? findSlot(0.5, 0, meetings.filter(m => m.date === tomorrow)) ?? 9;
    setUi({ meetDialog: { title: '', p: projectId, date, start: String(start), dur: '0.5', who: [me.user.id], loc: 'Google Meet', link: '' } });
  };
}

export function NewTaskDialog() {
  const { ui, setUi, me, today, people, toast, has, person } = useApp(); const act = useAct();
  const projects = useQ<Project[]>('projects').data || [];
  const [nt, setNt] = useState({ title: '', desc: '', projectId: '', assigneeId: me.user.id, due: addDays(today, 1), priority: 'Medium' });
  useEffect(() => { if (ui.newTask) setNt({ title: '', desc: '', projectId: ui.newTask.projectId || projects[0]?.id || '', assigneeId: me.user.id, due: addDays(today, 1), priority: 'Medium' }); }, [ui.newTask]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ui.newTask) return null;
  const close = () => setUi({ newTask: null });
  const ppl = [...people.values()].filter(p => p.status === 'Active' && (has('task.assign') || p.id === me.user.id));
  const satDiff = (6 - new Date(today + 'T00:00:00Z').getUTCDay() + 7) % 7 || 7;
  const dueOpts: [string, string][] = [[today, 'Today'], [addDays(today, 1), 'Tomorrow'], [addDays(today, satDiff), weekday(addDays(today, satDiff))], [addDays(today, 7), 'Next week']];
  const create = async () => {
    const r = await act('tasks', { ...nt, title: nt.title.trim() || 'Untitled task' }, { quiet: true });
    if (r) { close(); toast(nt.assigneeId === me.user.id ? 'Task added to your list.' : `Assigned to ${person(nt.assigneeId).name} — they've been notified.`); }
  };
  return (
    <Dialog title="New task" sub="It lands on the assignee's own list, attached to the project." onClose={close}
      footer={<><Btn onClick={close} style={{ boxShadow: 'none' }}>Cancel</Btn><Btn kind="pri" onClick={create}>Create task</Btn></>}>
      <div style={ms}>
        <label className="label">Title<input className="input" autoFocus value={nt.title} onChange={e => setNt({ ...nt, title: e.target.value })} placeholder="What needs doing?" style={{ fontSize: 15 }} /></label>
        <label className="label">Description <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: 13, marginTop: -4 }}>Optional — context, acceptance criteria, links.</span>
          <textarea className="textarea" rows={3} value={nt.desc} onChange={e => setNt({ ...nt, desc: e.target.value })} placeholder="What does done look like?" />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14 }}>
          <label className="label">Project<select className="select" value={nt.projectId} onChange={e => setNt({ ...nt, projectId: e.target.value })}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="label">Assign to<select className="select" value={nt.assigneeId} onChange={e => setNt({ ...nt, assigneeId: e.target.value })}>{ppl.map(p => <option key={p.id} value={p.id}>{p.id === me.user.id ? `Me (${p.name.split(' ')[0]})` : p.name}</option>)}</select></label>
          <label className="label">Due<select className="select" value={nt.due} onChange={e => setNt({ ...nt, due: e.target.value })}>{dueOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="label">Priority<select className="select" value={nt.priority} onChange={e => setNt({ ...nt, priority: e.target.value })}><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option></select></label>
        </div>
      </div>
    </Dialog>
  );
}

export function CustomerDialog() {
  const { ui, setUi, toast } = useApp(); const router = useRouter(); const qc = useQueryClient();
  const ourState = useOurState();
  const blank = { name: '', gstin: '', contact: '', email: '', city: '', terms: '30' };
  const [nc, setNc] = useState(blank); const [err, setErr] = useState('');
  useEffect(() => { if (ui.newCustomer) { setNc(blank); setErr(''); } }, [ui.newCustomer]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ui.newCustomer) return null;
  const close = () => setUi({ newCustomer: false });
  const g = nc.gstin.trim().toUpperCase(); const st = stateOf(g);
  const hint = !g ? 'The first two digits set the state, which decides CGST + SGST or IGST.' : g.length < 15 ? `${g.length} of 15 characters${st ? ` · ${st}` : ''}` : st ? `${st} — ${gstText(st === ourState)} on every invoice` : 'Unrecognised state code in the first two digits.';
  const set = (k: string) => (e: { target: { value: string } }) => { setNc({ ...nc, [k]: e.target.value }); setErr(''); };
  const create = async () => {
    if (!nc.name.trim()) return setErr('Enter the business name.');
    try {
      const r = await api<{ id: string }>('customers', { body: { ...nc, gstin: g, terms: +nc.terms } });
      await qc.invalidateQueries(); close(); router.push(`/customers/${r.id}`); toast(`${nc.name.trim()} added. You can quote them now.`);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not add the customer.'); }
  };
  return (
    <Dialog width={540} title="Add customer" sub="The GSTIN decides how tax is charged on every quotation and invoice." onClose={close}
      footer={<><Btn onClick={close} style={{ boxShadow: 'none' }}>Cancel</Btn><Btn kind="pri" onClick={create}>Add customer</Btn></>}>
      <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
        <label className="label" style={{ gridColumn: '1/-1' }}>Business name<input className="input" autoFocus value={nc.name} onChange={set('name')} placeholder="Registered name" style={{ fontSize: 15 }} /></label>
        <label className="label" style={{ gridColumn: '1/-1' }}>GSTIN
          <input className="input mono" value={nc.gstin} onChange={set('gstin')} placeholder="29ABCDE1234F1Z5" maxLength={15} style={{ fontSize: 15, textTransform: 'uppercase' }} />
          <span style={{ fontSize: 13, fontWeight: 400, color: g.length === 15 ? (st ? '#047857' : '#be123c') : '#64748b' }}>{hint}</span>
        </label>
        <label className="label">Billing contact<input className="input" value={nc.contact} onChange={set('contact')} placeholder="Name, role" /></label>
        <label className="label">Billing email<input className="input" value={nc.email} onChange={set('email')} placeholder="accounts@company.in" /></label>
        <label className="label">City<input className="input" value={nc.city} onChange={set('city')} /></label>
        <label className="label">Payment terms<select className="select" value={nc.terms} onChange={set('terms')}><option value="15">Net 15</option><option value="30">Net 30</option><option value="45">Net 45</option><option value="60">Net 60</option></select></label>
        {err && <p style={{ gridColumn: '1/-1', margin: 0, fontSize: 14, color: '#be123c' }}>{err}</p>}
      </div>
    </Dialog>
  );
}

/** The state of the organisation's default issuing entity, which decides intra- vs inter-state GST. */
export function useOurState() { return useApp().me.org.ourState; }

export function PaymentDialog() {
  const { ui, setUi } = useApp(); const act = useAct();
  const inv = useQ<Invoice[]>('invoices').data?.find(i => i.id === ui.pay);
  const customers = useQ<Customer[]>('customers').data || [];
  const [p, setP] = useState({ amount: '', method: 'NEFT', ref: '' });
  useEffect(() => { if (inv) setP({ amount: String(inv.bal), method: 'NEFT', ref: '' }); }, [ui.pay]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ui.pay || !inv) return null;
  const close = () => setUi({ pay: null });
  const cust = customers.find(c => c.id === inv.customerId);
  const save = async () => { const r = await act('payments', { invoiceId: inv.id, ...p }); if (r) close(); };
  return (
    <Dialog width={460} title="Record payment" sub={`${inv.no} · ${cust?.name} · ${inr(inv.bal)} outstanding`} onClose={close}
      footer={<><Btn onClick={close} style={{ boxShadow: 'none' }}>Cancel</Btn><Btn kind="pri" onClick={save}>Record receipt</Btn></>}>
      <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14 }}>
        <label className="label">Amount received (₹)<input className="input num" inputMode="decimal" value={p.amount} onChange={e => setP({ ...p, amount: e.target.value })} style={{ fontSize: 15 }} /></label>
        <label className="label">Method<select className="select" value={p.method} onChange={e => setP({ ...p, method: e.target.value })}>{['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque'].map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="label" style={{ gridColumn: '1/-1' }}>Bank reference / UTR<input className="input mono" value={p.ref} onChange={e => setP({ ...p, ref: e.target.value })} placeholder="e.g. HDFCN52026100812" /></label>
      </div>
    </Dialog>
  );
}

export function CreditDialog() {
  const { ui, setUi, toast } = useApp(); const act = useAct();
  const inv = useQ<Invoice[]>('invoices').data?.find(i => i.id === ui.credit);
  const customers = useQ<Customer[]>('customers').data || [];
  const [cn, setCn] = useState({ amount: '', reason: '' });
  useEffect(() => { setCn({ amount: '', reason: '' }); }, [ui.credit]);
  if (!ui.credit || !inv) return null;
  const close = () => setUi({ credit: null });
  const amt = Math.round(+cn.amount.replace(/[^\d.]/g, '') || 0); const tax = Math.round(amt * 0.18);
  const issue = async () => {
    if (!amt) return toast('Enter the value to credit.');
    if (!cn.reason.trim()) return toast('Give a reason. It prints on the credit note.');
    const r = await act('credit-notes', { invoiceId: inv.id, amount: amt, reason: cn.reason }); if (r) close();
  };
  return (
    <Dialog title="Credit note" sub={`${inv.no} · ${customers.find(c => c.id === inv.customerId)?.name} · ${inr(inv.bal)} outstanding. The invoice itself stays as issued.`} onClose={close}
      footer={<><Btn onClick={close} style={{ boxShadow: 'none' }}>Cancel</Btn><Btn kind="pri" onClick={issue}>Issue credit note</Btn></>}>
      <div style={ms}>
        <label className="label">Value to credit, before GST (₹)<input className="input num" inputMode="decimal" value={cn.amount} onChange={e => setCn({ ...cn, amount: e.target.value })} style={{ fontSize: 15 }} />
          <span className="hint">{amt ? `${inr(amt)} + GST ${inr(tax)} = ${inr(amt + tax)} off the balance` : 'GST is reversed at the invoice’s rate.'}</span></label>
        <label className="label">Reason<textarea className="textarea" rows={3} value={cn.reason} onChange={e => setCn({ ...cn, reason: e.target.value })} placeholder="Printed on the credit note and kept on the audit log." /></label>
      </div>
    </Dialog>
  );
}
