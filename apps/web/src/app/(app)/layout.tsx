'use client';
import { Providers } from '@/lib/app';
import { AppShell } from '@/components/shell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Providers><AppShell>{children}</AppShell></Providers>;
}
