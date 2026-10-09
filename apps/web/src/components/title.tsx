'use client';
import { usePathname } from 'next/navigation';
import { useQ } from '@/lib/app';
import { SCREENS, screenOf } from '@/lib/domain';
import type { Customer, Invoice, Project, Quote } from '@/lib/types';

/** The current screen's title — the record's name or number on detail screens. */
export function useTitle() {
  const { screen, id } = screenOf(usePathname());
  const projects = useQ<Project[]>(screen === 'project' ? 'projects' : null).data;
  const customers = useQ<Customer[]>(screen === 'customer' ? 'customers' : null).data;
  const quotes = useQ<Quote[]>(screen === 'quote' || screen === 'qeditor' ? 'quotes' : null).data;
  const invoices = useQ<Invoice[]>(screen === 'invoice' || screen === 'ieditor' ? 'invoices' : null).data;
  let title = SCREENS[screen]?.title || 'My Work';
  if (screen === 'project') title = projects?.find(p => p.id === id)?.name || title;
  if (screen === 'customer') title = customers?.find(c => c.id === id)?.name || title;
  if (screen === 'quote') title = quotes?.find(q => q.id === id)?.no || title;
  if (screen === 'invoice') title = invoices?.find(i => i.id === id)?.no || title;
  if (screen === 'qeditor') { const q = id && quotes?.find(x => x.id === id); title = q ? `${q.status === 'DRAFT' ? 'Edit' : 'Revise'} ${q.no}` : 'New quotation'; }
  if (screen === 'ieditor') { const i = id && invoices?.find(x => x.id === id); title = i ? `Edit ${i.no}` : 'New invoice'; }
  return { screen, id, title };
}
