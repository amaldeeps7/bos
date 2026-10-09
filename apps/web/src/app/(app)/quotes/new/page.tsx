'use client';
import { Suspense } from 'react';
import { DocEditor } from '@/components/docs';
export default function NewQuote() { return <Suspense><DocEditor kind="quote" /></Suspense>; }
