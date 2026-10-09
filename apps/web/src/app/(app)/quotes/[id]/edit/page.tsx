'use client';
import { useParams } from 'next/navigation';
import { DocEditor } from '@/components/docs';
export default function EditQuote() { const { id } = useParams<{ id: string }>(); return <DocEditor kind="quote" id={id} />; }
