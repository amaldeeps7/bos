'use client';
import { useParams } from 'next/navigation';
import { DocEditor } from '@/components/docs';
export default function EditInvoice() { const { id } = useParams<{ id: string }>(); return <DocEditor kind="invoice" id={id} />; }
