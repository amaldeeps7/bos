'use client';
import { useApp } from '@/lib/app';
import { CsvRow, downloadCsv } from '@/lib/csv';
import { Btn } from './ui';

/** Downloads the rows on screen (what this person can see, with the current tab or search applied) as a CSV. */
export function ExportBtn({ name, rows, label = 'Export' }: { name: string; rows: () => CsvRow[]; label?: string }) {
  const { me, today, toast } = useApp();
  return <Btn icon="download" title="Download as CSV, for Excel or Google Sheets" onClick={() => {
    const r = rows(); if (!r.length) return toast('Nothing to export in this view.');
    downloadCsv(`${me.org.slug}-${name}-${today}.csv`, r);
  }}>{label}</Btn>;
}
