import { BadRequestException } from '@nestjs/common';
import { isoDate } from '@bos/shared';

/** Prisma @db.Date -> "YYYY-MM-DD" */
export const d = (x: Date | null | undefined): string => (x ? isoDate(x) : '');
/** "YYYY-MM-DD" -> Date for a @db.Date column */
export const toDate = (iso: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) throw new BadRequestException(`Invalid date: ${iso}`);
  return new Date(iso + 'T00:00:00.000Z');
};
export const str = (v: unknown, field: string, { required = false, max = 5000 } = {}): string => {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v);
  if (required && !s.trim()) throw new BadRequestException(`${field} is required`);
  if (s.length > max) throw new BadRequestException(`${field} is too long`);
  return s;
};
export const num = (v: unknown, field: string, { min = -Infinity, max = Infinity } = {}): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n) || n < min || n > max) throw new BadRequestException(`${field} must be a number`);
  return n;
};
export const oneOf = <T extends string>(v: unknown, field: string, allowed: readonly T[]): T => {
  if (!allowed.includes(v as T)) throw new BadRequestException(`${field} must be one of ${allowed.join(', ')}`);
  return v as T;
};
