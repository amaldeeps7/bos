'use client';
import { useParams } from 'next/navigation';
import { DocView } from '@/components/docs';
export default function InvoicePage() { const { id } = useParams<{ id: string }>(); return <DocView kind="invoice" id={id} />; }
