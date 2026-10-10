/** CSV for spreadsheets: UTF-8 with a BOM (so Excel shows ₹ and names correctly), CRLF lines, RFC 4180 quoting. */
export type CsvRow = Record<string, string | number | boolean | null | undefined>;

const cell = (v: CsvRow[string]): string => {
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Text starting with = + - @ would run as a formula in a spreadsheet; a leading apostrophe keeps it text.
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: CsvRow[]): string {
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  return '﻿' + [cols.map(cell).join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

export function downloadCsv(filename: string, rows: CsvRow[]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
