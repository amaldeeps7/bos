export interface SeriesLike { prefix: string; pattern: string; padding: number | string; next: number | string }

/** Financial year label for a date, e.g. 2026-10-08 with April start -> "26-27". */
export function fyLabel(iso: string, fyStart: 'April' | 'January' | string = 'April'): string {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
  if (fyStart !== 'April') return String(y % 100).padStart(2, '0');
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function formatNumber(sr: SeriesLike, iso: string, fyStart = 'April'): string {
  const yyyy = iso.slice(0, 4);
  return String(sr.pattern)
    .split('{prefix}').join(sr.prefix)
    .split('{yyyy}').join(yyyy)
    .split('{yy}').join(yyyy.slice(2))
    .split('{fy}').join(fyLabel(iso, fyStart))
    .split('{seq}').join(String(sr.next).padStart(+sr.padding || 0, '0'));
}

export const SERIES_TOKENS: [string, string][] = [
  ['{prefix}', 'The prefix'], ['{yyyy}', 'Year, e.g. 2026'], ['{yy}', 'Two-digit year, e.g. 26'], ['{fy}', 'Financial year, e.g. 26-27'], ['{seq}', 'The counter. Required.'],
];
