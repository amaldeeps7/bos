'use client';
import { useParams } from 'next/navigation';
import { DocView } from '@/components/docs';
export default function QuotePage() { const { id } = useParams<{ id: string }>(); return <DocView kind="quote" id={id} />; }
