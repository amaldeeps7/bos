import { BadRequestException } from '@nestjs/common';
import { STATE_CODES, isValidGstin, isoDate, stateCode } from '@bos/shared';

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
/** GST details of an entity or customer: a valid GSTIN (which sets the state), or no GSTIN and a state.
    `needGstin` when the party is registered for GST. Returns the GSTIN ('' when none) and the two-digit state code. */
export const gstParty = (b: { gstin?: unknown; state?: unknown }, needGstin: boolean): { gstin: string; state: string } => {
  const gstin = str(b.gstin, 'GSTIN', { max: 15 }).trim().toUpperCase();
  if (gstin) {
    if (!isValidGstin(gstin)) throw new BadRequestException('Enter a valid 15-character GSTIN.');
    return { gstin, state: gstin.slice(0, 2) };
  }
  if (needGstin) throw new BadRequestException('Enter the GSTIN, or switch GST off if the business isn’t registered.');
  const st = str(b.state, 'State', { max: 40 }).trim();
  const code = STATE_CODES[st] ? st : stateCode(st);
  if (!code) throw new BadRequestException('Pick the state. It sets the place of supply.');
  return { gstin: '', state: code };
};
