// Formatting helpers shared by the API and the web app.
// Date-only values travel as ISO strings (YYYY-MM-DD); meeting times are decimal hours (10.5 = 10:30).

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DEFAULT_TZ = 'Asia/Kolkata';

export const inr = (v: number | string): string => '₹' + Math.round(Number(v) || 0).toLocaleString('en-IN');

export const ini = (name: string): string =>
  (name || '?').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();

/** Today's date in the organisation's time zone, as YYYY-MM-DD. */
export function todayISO(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Current time of day in the organisation's time zone, as decimal hours. */
export function nowHours(tz: string = DEFAULT_TZ, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = +parts.find(p => p.type === 'hour')!.value, m = +parts.find(p => p.type === 'minute')!.value;
  return h + m / 60;
}

const toUTC = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (iso: string, n: number): string => fromUTC(toUTC(iso) + n * 86400000);
/** Whole days from `base` to `iso` (negative = in the past). */
export const diffDays = (iso: string, base: string): number => Math.round((toUTC(iso) - toUTC(base)) / 86400000);
export const isoDate = (d: Date | string): string => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);

const asDate = (iso: string) => new Date(toUTC(iso));
/** "8 Oct" */
export const fmtD = (iso: string): string => asDate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** "8 Oct 2026" */
export const fmtDLong = (iso: string): string => asDate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fmtMon = (iso: string): string => asDate(iso).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
export const fmtMonYear = (iso: string): string => asDate(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
export const dayNum = (iso: string): number => asDate(iso).getUTCDate();
export const weekday = (iso: string): string => DAYS[asDate(iso).getUTCDay()];

/** "Today", "Tomorrow", "Yesterday" or "Wed 14 Oct". */
export const dayLabel = (iso: string, today: string): string => {
  const d = diffDays(iso, today);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  return `${weekday(iso).slice(0, 3)} ${fmtD(iso)}`;
};

/** 10.5 -> "10:30 am" */
export const fmtT = (h: number): string => {
  const H = Math.floor(h + 1e-6), M = Math.round((h - H) * 60);
  return `${H > 12 ? H - 12 : H}:${String(M).padStart(2, '0')} ${H >= 12 ? 'pm' : 'am'}`;
};
export const hLabel = (H: number): string => `${H > 12 ? H - 12 : H} ${H >= 12 ? 'pm' : 'am'}`;
/** 1.25 -> "1h 15m" */
export const hm = (h: number): string => {
  const m = Math.round(h * 60); const H = Math.floor(m / 60), M = m % 60;
  return H ? (M ? `${H}h ${M}m` : `${H}h`) : `${M} min`;
};

/** Relative label for activity timestamps. */
export function relTime(ts: string | Date, now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const t = new Date(ts); const s = (now.getTime() - t.getTime()) / 1000;
  if (s < 90) return 'Just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  const dd = diffDays(todayISO(tz, t), todayISO(tz, now));
  if (dd === 0) { const h = Math.round(s / 3600); return `${h} hour${h > 1 ? 's' : ''} ago`; }
  if (dd === -1) return 'Yesterday';
  if (dd > -7) return `${-dd} days ago`;
  return fmtD(todayISO(tz, t));
}

/** Activity stamp used on task threads: "Today, 9:40", "Yesterday", "6 Oct". */
export function stampLabel(ts: string | Date, now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const t = new Date(ts); const s = (now.getTime() - t.getTime()) / 1000;
  if (s < 90) return 'Just now';
  const dd = diffDays(todayISO(tz, t), todayISO(tz, now));
  if (dd === 0) return 'Today, ' + fmtT(nowHours(tz, t)).replace(/ (am|pm)$/, '');
  if (dd === -1) return 'Yesterday';
  return fmtD(todayISO(tz, t));
}
