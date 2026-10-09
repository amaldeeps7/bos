'use client';
import { Suspense } from 'react';
import { DocEditor } from '@/components/docs';
export default function NewInvoice() { return <Suspense><DocEditor kind="invoice" /></Suspense>; }
