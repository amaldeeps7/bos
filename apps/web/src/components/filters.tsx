'use client';
import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { addDays, fyStart } from '@bos/shared';
import { Icon } from './ui';

// ── Filters kept in the URL (shareable, bookmarkable, survive a reload) ─────────────

/**
 * State that lives in the page's query string. `defaults` lists every key the page uses; values equal to the default
 * are left out of the URL. Lists are comma-separated.
 */
export function useUrlState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const params = useSearchParams(); const router = useRouter(); const path = usePathname();
  const state = useMemo(() => {
    const s = { ...defaults };
    for (const k of Object.keys(defaults) as (keyof T)[]) { const v = params.get(k as string); if (v !== null) s[k] = v as T[keyof T]; }
    return s;
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback((patch: Partial<T>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === defaults[k]) q.delete(k); else q.set(k, String(v)); }
    const s = q.toString(); router.replace(s ? `${path}?${s}` : path, { scroll: false });
  }, [params, path, router]); // eslint-disable-line react-hooks/exhaustive-deps
  return [state, set];
}
export const listOf = (v: string) => (v ? v.split(',').filter(Boolean) : []);

// ── Controls ───────────────────────────────────────────────────────────────────────

const ctl: CSSProperties = { height: 36, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 12px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', fontSize: 14, color: '#0f172a', cursor: 'pointer', whiteSpace: 'nowrap' };

export function FilterBar({ children, onClear, active }: { children: ReactNode; onClear?: () => void; active?: boolean }) {
  return (
    <div role="toolbar" aria-label="Filters" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      {children}
      {active && onClear && <button onClick={onClear} className="link" style={{ fontSize: 14, marginLeft: 4 }}>Clear filters</button>}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search', width = 260 }: { value: string; onChange: (v: string) => void; placeholder?: string; width?: number }) {
  // Typing updates locally at once and the URL a moment later, so the list doesn't stutter.
  const [v, setV] = useState(value); useEffect(() => setV(value), [value]);
  useEffect(() => { if (v === value) return; const t = setTimeout(() => onChange(v), 250); return () => clearTimeout(t); }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label style={{ ...ctl, cursor: 'text', width, maxWidth: '100%', flex: '0 1 auto' }}>
      <Icon name="search" size={15} style={{ color: '#94a3b8' }} />
      <input value={v} onChange={e => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder} style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: 14 }} />
      {v && <button onClick={() => { setV(''); onChange(''); }} aria-label="Clear search" style={{ border: 0, background: 'none', padding: 0, color: '#94a3b8', cursor: 'pointer', display: 'flex' }}><Icon name="x" size={14} /></button>}
    </label>
  );
}

/** A popover that closes on outside click and Escape. */
function Popover({ button, children, label }: { button: ReactNode; children: (close: () => void) => ReactNode; label: string }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" aria-label={label} style={{ border: 0, padding: 0, background: 'none' }}>{button}</button>
      {open && <div role="dialog" aria-label={label} style={{ position: 'absolute', top: 40, left: 0, zIndex: 30, minWidth: 220, maxWidth: 320, maxHeight: 360, overflowY: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 16px 48px -12px rgba(15,23,42,.2)', padding: 6 }}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

/** "Status ▾" → tick several options. Shows how many are picked. */
export function MultiFilter({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const on = value.length > 0;
  const picked = on ? (value.length === 1 ? options.find(o => o.value === value[0])?.label || '1' : `${value.length}`) : '';
  return (
    <Popover label={`Filter by ${label.toLowerCase()}`} button={<span style={{ ...ctl, borderColor: on ? '#0052ff' : '#cbd5e1', background: on ? '#eff4ff' : '#fff' }}><span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}{on && <b style={{ fontWeight: 600, color: '#0052ff' }}>: {picked}</b>}</span><Icon name="chevron-down" size={14} style={{ color: '#64748b' }} /></span>}>
      {() => <>
        {options.length > 8 && <p style={{ margin: '4px 8px 6px', fontSize: 12, color: '#94a3b8' }}>{options.length} options</p>}
        {options.map(o => {
          const sel = value.includes(o.value);
          return (
            <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 6, fontSize: 14, cursor: 'pointer', background: sel ? '#f8fafc' : undefined }}>
              <input type="checkbox" checked={sel} onChange={() => onChange(sel ? value.filter(v => v !== o.value) : [...value, o.value])} style={{ width: 16, height: 16, accentColor: '#0052ff' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
            </label>
          );
        })}
        {on && <button onClick={() => onChange([])} className="link" style={{ display: 'block', margin: '6px 8px 4px', fontSize: 13 }}>Clear</button>}
      </>}
    </Popover>
  );
}

/** A labelled single choice, e.g. "Group by: Status". */
export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label style={{ ...ctl, paddingRight: 4 }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value as T)} style={{ border: 0, background: 'transparent', fontSize: 14, fontWeight: 500, color: '#0f172a', cursor: 'pointer', outline: 0 }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/** List / Board / Calendar style switch. */
export function ViewSwitch<T extends string>({ value, options, onChange }: { value: T; options: [T, string, string][]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label="View" style={{ display: 'inline-flex', padding: 3, gap: 2, background: '#f1f5f9', borderRadius: 9 }}>
      {options.map(([v, l, icon]) => (
        <button key={v} onClick={() => onChange(v)} aria-pressed={value === v} title={l} style={{ height: 30, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 10px', border: 0, borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', background: value === v ? '#fff' : 'transparent', color: value === v ? '#0f172a' : '#64748b', boxShadow: value === v ? '0 1px 2px rgba(15,23,42,.08)' : 'none' }}>
          <Icon name={icon} size={14} />{l}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return <label style={{ ...ctl, gap: 8 }}><input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#0052ff' }} />{label}</label>;
}

// ── Date ranges ─────────────────────────────────────────────────────────────────────

export type Range = { from: string; to: string };
const PRESETS: [string, string][] = [['', 'Any time'], ['month', 'This month'], ['lastmonth', 'Last month'], ['quarter', 'This quarter'], ['fy', 'This financial year'], ['lastfy', 'Last financial year'], ['30d', 'Last 30 days'], ['custom', 'Custom…']];

/** The dates a preset covers (inclusive), in the organisation's financial year. */
export function presetRange(p: string, today: string, fy = 'April'): Range | null {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  const iso = (yy: number, mm: number, dd = 1) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  const end = (yy: number, mm: number) => iso(yy, mm + 1, 0);
  if (p === 'month') return { from: iso(y, m), to: end(y, m) };
  if (p === 'lastmonth') return { from: iso(y, m - 1), to: end(y, m - 1) };
  if (p === 'quarter') { const q = Math.floor((m - 1) / 3) * 3 + 1; return { from: iso(y, q), to: end(y, q + 2) }; }
  if (p === 'fy') { const s = fyStart(today, fy); return { from: s, to: addDays(iso(+s.slice(0, 4) + 1, +s.slice(5, 7)), -1) }; }
  if (p === 'lastfy') { const s = fyStart(today, fy); const ps = iso(+s.slice(0, 4) - 1, +s.slice(5, 7)); return { from: ps, to: addDays(s, -1) }; }
  if (p === '30d') return { from: addDays(today, -29), to: today };
  return null;
}
export const inRange = (date: string, r: Range | null) => !r || ((!r.from || date >= r.from) && (!r.to || date <= r.to));

/** "Any time ▾" with presets (this month, this financial year…) or custom dates. URL keys: `period`, `from`, `to`. */
export function DateRange({ label = 'Date', period, from, to, onChange }: { label?: string; period: string; from: string; to: string; onChange: (v: { period: string; from: string; to: string }) => void }) {
  const on = !!period;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <label style={{ ...ctl, paddingRight: 4, borderColor: on ? '#0052ff' : '#cbd5e1', background: on ? '#eff4ff' : '#fff' }}>
        <Icon name="calendar" size={14} style={{ color: '#64748b' }} /><span style={{ color: '#64748b' }}>{label}</span>
        <select value={period} onChange={e => onChange({ period: e.target.value, from: '', to: '' })} style={{ border: 0, background: 'transparent', fontSize: 14, fontWeight: 500, cursor: 'pointer', outline: 0 }}>
          {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      {period === 'custom' && <>
        <input type="date" aria-label="From" value={from} onChange={e => onChange({ period, from: e.target.value, to })} style={{ ...ctl, cursor: 'text' }} />
        <span style={{ color: '#64748b', fontSize: 14 }}>to</span>
        <input type="date" aria-label="To" value={to} onChange={e => onChange({ period, from, to: e.target.value })} style={{ ...ctl, cursor: 'text' }} />
      </>}
    </span>
  );
}
export const rangeOf = (period: string, from: string, to: string, today: string, fy?: string): Range | null =>
  period === 'custom' ? (from || to ? { from, to } : null) : presetRange(period, today, fy);

// ── Sorting ────────────────────────────────────────────────────────────────────────

/** A clickable column header: click to sort by it, again to reverse. `sort` is "key" or "-key". */
export function SortHead({ label, k, sort, onSort, align }: { label: string; k: string; sort: string; onSort: (s: string) => void; align?: 'right' }) {
  const active = sort.replace(/^-/, '') === k; const desc = active && sort.startsWith('-');
  return (
    <button onClick={() => onSort(active && !desc ? `-${k}` : k)} aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: align === 'right' ? 'flex-end' : 'flex-start', border: 0, background: 'none', padding: 0, font: 'inherit', color: active ? '#0f172a' : 'inherit', cursor: 'pointer', textAlign: align || 'left', width: '100%' }}>
      {label}<Icon name={active ? (desc ? 'arrow-down' : 'arrow-up') : 'arrow-up-down'} size={12} style={{ opacity: active ? 1 : 0.4 }} />
    </button>
  );
}
/** Sorts rows by `sort` ("key" or "-key") using `get(row, key)`. Text sorts alphabetically, numbers numerically. */
export function sortRows<T>(rows: T[], sort: string, get: (r: T, k: string) => string | number): T[] {
  if (!sort) return rows;
  const k = sort.replace(/^-/, ''); const dir = sort.startsWith('-') ? -1 : 1;
  return [...rows].sort((a, b) => { const x = get(a, k), y = get(b, k); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true })) * dir; });
}

// ── Selecting several rows ──────────────────────────────────────────────────────────

export function useSelection(ids: string[]) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => { setSel(s => { const keep = new Set([...s].filter(id => ids.includes(id))); return keep.size === s.size ? s : keep; }); }, [ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    sel, count: sel.size, has: (id: string) => sel.has(id),
    toggle: (id: string) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    all: () => setSel(new Set(ids)), clear: () => setSel(new Set()), allOn: ids.length > 0 && ids.every(id => sel.has(id)),
  };
}

/** The bar that appears while rows are selected. */
export function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  if (!count) return null;
  return (
    <div role="region" aria-label="Selected" style={{ position: 'sticky', top: 0, zIndex: 20, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#0f172a', color: '#fff', borderRadius: 10, boxShadow: '0 8px 24px -8px rgba(15,23,42,.4)' }}>
      <b style={{ fontWeight: 600, fontSize: 14, marginRight: 4 }}>{count} selected</b>
      {children}
      <button onClick={onClear} style={{ marginLeft: 'auto', border: 0, background: 'none', color: '#cbd5e1', fontSize: 14, cursor: 'pointer' }}>Clear</button>
    </div>
  );
}
export const bulkCtl: CSSProperties = { height: 32, border: '1px solid rgba(255,255,255,.25)', borderRadius: 7, background: 'rgba(255,255,255,.08)', color: '#fff', fontSize: 13, padding: '0 10px', cursor: 'pointer' };

export function EmptyFiltered({ onClear, text = 'Nothing matches these filters.' }: { onClear?: () => void; text?: string }) {
  return <p style={{ margin: 0, padding: '28px 20px', fontSize: 14, color: '#64748b', textAlign: 'center' }}>{text}{onClear && <> <button className="link" onClick={onClear}>Clear filters</button></>}</p>;
}
