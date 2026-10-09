// iCalendar invites so meetings land in Google Calendar, Outlook and Apple Calendar.

/** Converts a wall-clock time in `tz` to a UTC Date. */
export function zonedToUtc(dateISO: string, hours: number, tz: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  const H = Math.floor(hours), M = Math.round((hours - H) * 60);
  const guess = Date.UTC(y, m - 1, d, H, M);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess));
  const g = (t: string) => +parts.find(p => p.type === t)!.value;
  const asTz = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return new Date(guess - (asTz - guess));
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s: string) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line: string) => { const out: string[] = []; let s = line; while (s.length > 73) { out.push(s.slice(0, 73)); s = ' ' + s.slice(73); } out.push(s); return out.join('\r\n'); };

export function meetingIcs(m: { id: string; title: string; date: string; start: number; dur: number; loc: string; link: string; agenda: string; sequence: number },
  tz: string, organizer: { name: string; email: string }, attendees: { name?: string; email: string }[], method: 'REQUEST' | 'CANCEL' = 'REQUEST'): string {
  const start = zonedToUtc(m.date, m.start, tz); const end = new Date(start.getTime() + m.dur * 3600_000);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Business OS//Meetings//EN', `METHOD:${method}`, 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${m.id}@business-os`, `SEQUENCE:${m.sequence}`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(m.title)}`, `LOCATION:${esc(m.link || m.loc)}`, `DESCRIPTION:${esc([m.agenda, m.link ? `Join: ${m.link}` : ''].filter(Boolean).join('\n\n'))}`,
    ...(m.link ? [`URL:${m.link}`] : []),
    `ORGANIZER;CN=${esc(organizer.name)}:mailto:${organizer.email}`,
    ...attendees.map(a => `ATTENDEE;CN=${esc(a.name || a.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`),
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
