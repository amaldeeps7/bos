'use client';
import type { CSSProperties, ReactNode } from 'react';
import type { StatusDef, Tone } from '@bos/shared';

export const TONES: Record<Tone, [string, string, string]> = {
  neutral: ['#64748b', '#f1f5f9', '#e2e8f0'], info: ['#0369a1', '#f0f9ff', 'rgba(3,105,161,.18)'],
  success: ['#047857', '#ecfdf5', 'rgba(4,120,87,.18)'], warning: ['#b45309', '#fffbeb', 'rgba(180,83,9,.2)'],
  danger: ['#be123c', '#fff1f2', 'rgba(190,18,60,.18)'], primary: ['#0052ff', '#eef4ff', 'rgba(0,82,255,.18)'],
};
const BADGE: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, border: '1px solid', padding: '1px 8px', fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', lineHeight: '20px' };
export const badgeStyle = (tone: Tone, solid?: boolean): CSSProperties => {
  const [c, bg, b] = TONES[tone];
  return solid ? { ...BADGE, color: '#fff', background: c, borderColor: 'transparent' } : { ...BADGE, color: c, background: bg, borderColor: b };
};
const Dot = () => <span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor' }} />;

export function Badge({ tone = 'neutral', solid, dot, style, children }: { tone?: Tone; solid?: boolean; dot?: boolean; style?: CSSProperties; children: ReactNode }) {
  return <span style={{ ...badgeStyle(tone, solid), ...style }}>{dot && <Dot />}{children}</span>;
}
/** Status badge from a status table: dot-and-word, or solid for terminal states. */
export const Status = ({ def }: { def: StatusDef }) => <Badge tone={def[1]} solid={def[2]} dot={!def[2]}>{def[0]}</Badge>;

export const Icon = ({ name, size = 16, style }: { name: string; size?: number; style?: CSSProperties }) =>
  <i aria-hidden="true" className={name.startsWith("icon-") ? name : "icon-" + name} style={{ fontSize: size, lineHeight: 1, ...style }} />;

export function Card({ children, style, className = '' }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return <div className={'card ' + className} style={style}>{children}</div>;
}
export function CardHead({ title, sub, right, count }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; count?: ReactNode }) {
  return (
    <div className="card-head" style={right ? { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px 16px' } : undefined}>
      <div><h2 className="h2">{title}{count !== undefined && <span style={{ color: '#94a3b8', fontWeight: 500 }}> {count}</span>}</h2>{sub && <p className="sub">{sub}</p>}</div>
      {right}
    </div>
  );
}

export function PageHead({ title, sub, right, badge, subStyle }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; badge?: ReactNode; subStyle?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px 24px' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>{title}</h1>{badge}
        </div>
        {sub && <p style={{ margin: '4px 0 0', fontSize: 15, color: '#64748b', ...subStyle }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

type BtnKind = 'pri' | 'sec' | 'demo' | 'danger';
export function Btn({ kind = 'sec', icon, children, onClick, style, disabled, title, type = 'button', size }: { kind?: BtnKind; icon?: string; children?: ReactNode; onClick?: () => void; style?: CSSProperties; disabled?: boolean; title?: string; type?: 'button' | 'submit'; size?: 'sm' | 'xs' }) {
  const sz: CSSProperties = size === 'sm' ? { height: 34, padding: '0 12px', fontSize: 13, gap: 6 } : size === 'xs' ? { height: 32, padding: '0 12px', fontSize: 13, gap: 6 } : {};
  return <button type={type} className={'btn btn-' + kind} onClick={onClick} disabled={disabled} title={title} style={{ ...sz, ...style }}>{icon && <Icon name={icon} size={size ? 15 : 16} />}{children}</button>;
}

export const tabStyle = (on: boolean): CSSProperties => ({ height: 34, padding: '0 14px', border: 0, borderRadius: 7, cursor: 'pointer', fontSize: 14, fontWeight: on ? 600 : 500, whiteSpace: 'nowrap', background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.08)' : 'none' });
export function Tabs<T extends string>({ tabs, value, onChange, style }: { tabs: { id: T; label: string; count?: number | string }[]; value: T; onChange: (v: T) => void; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', gap: 4, padding: 4, background: '#f1f5f9', borderRadius: 10, alignSelf: 'flex-start', maxWidth: '100%', overflowX: 'auto', ...style }}>
      {tabs.map(t => <button key={t.id} onClick={() => onChange(t.id)} style={tabStyle(value === t.id)}>{t.label}{t.count !== undefined && <> <span style={{ color: '#94a3b8', fontWeight: 500 }}>{t.count}</span></>}</button>)}
    </div>
  );
}

export function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} role="switch" aria-checked={on} aria-label={label} style={{ width: 38, height: 22, flex: 'none', borderRadius: 999, border: 0, padding: 2, cursor: 'pointer', background: on ? '#0052ff' : '#cbd5e1', display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start', transition: 'background 180ms' }}>
      <span style={{ width: 18, height: 18, borderRadius: 999, background: '#fff', boxShadow: '0 1px 2px rgba(15,23,42,.2)' }} />
    </button>
  );
}
export function ToggleRow({ label, desc, on, onClick, style }: { label: string; desc?: string; on: boolean; onClick: () => void; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '14px 20px', borderBottom: '1px solid #f1f5f9', ...style }}>
      <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{label}</p>{desc && <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>{desc}</p>}</div>
      <Switch on={on} onClick={onClick} label={label} />
    </div>
  );
}

export function Check({ on, onClick, locked, label, style }: { on: boolean; onClick?: () => void; locked?: boolean; label?: string; style?: CSSProperties }) {
  return (
    <button onClick={onClick} aria-label={label} aria-pressed={on} style={{ width: 20, height: 20, flex: 'none', marginTop: 1, borderRadius: 6, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: locked ? 'default' : 'pointer', border: on ? `1px solid ${locked ? '#7aa0ff' : '#0052ff'}` : '1.5px solid #cbd5e1', background: on ? (locked ? '#7aa0ff' : '#0052ff') : '#fff', color: '#fff', ...style }}>
      {on && <Icon name="check" size={13} />}
    </button>
  );
}

export function Avatar({ name, size = 24, style }: { name: string; size?: number; style?: CSSProperties }) {
  const t = name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return <span title={name} style={{ width: size, height: size, flex: 'none', borderRadius: 999, background: '#f1f5f9', color: '#64748b', fontSize: size <= 24 ? 11 : size <= 28 ? 11 : 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', ...style }}>{t}</span>;
}

export const Metric = ({ label, value, danger }: { label: string; value: ReactNode; danger?: boolean }) => (
  <div className="card" style={{ padding: '12px 16px' }}>
    <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{label}</p>
    <p className="num" style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 600, letterSpacing: '-0.012em', color: danger ? '#be123c' : '#0f172a' }}>{value}</p>
  </div>
);
export const Metrics = ({ children }: { children: ReactNode }) => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 16 }}>{children}</div>;

export const Empty = ({ children, pad = '28px 20px' }: { children: ReactNode; pad?: string }) => <p style={{ margin: 0, padding: pad, fontSize: 14, color: '#64748b' }}>{children}</p>;

export function Back({ label, onClick }: { label: string; onClick: () => void }) {
  return <button className="back" onClick={onClick}><Icon name="arrow-left" size={16} />{label}</button>;
}

export function Dialog({ title, sub, width = 480, children, footer, onClose }: { title: string; sub?: ReactNode; width?: number; children: ReactNode; footer: ReactNode; onClose: () => void }) {
  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-label={title} style={{ width, maxWidth: '100%', maxHeight: '100%', overflowY: 'auto', background: '#fff', borderRadius: 12, boxShadow: '0 16px 48px -12px rgba(15,23,42,.3)' }}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid #e2e8f0' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.011em' }}>{title}</h2>
          {sub && <p style={{ margin: '4px 0 0', fontSize: 14, color: '#64748b' }}>{sub}</p>}
        </div>
        {children}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>{footer}</div>
      </div>
    </div>
  );
}

export function Banner({ tone, icon, title, text, actions }: { tone: Tone; icon: string; title: string; text: string; actions?: ReactNode }) {
  const [c, bg, bd] = TONES[tone];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '14px 16px', borderRadius: 12, background: bg, border: `1px solid ${bd}`, color: c }}>
      <Icon name={icon} size={18} />
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{title}</p>
        {text && <p style={{ margin: '2px 0 0', fontSize: 14, color: '#475569' }}>{text}</p>}
      </div>
      {actions && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{actions}</div>}
    </div>
  );
}

export const BarRow = ({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) => (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, marginBottom: 6 }}><span style={{ fontWeight: 500 }}>{label}</span><span className="num" style={{ color: '#334155' }}>{value}</span></div>
    <div style={{ height: 8, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}><div style={{ height: '100%', width: Math.max(1, pct) + '%', borderRadius: 999, background: color }} /></div>
  </div>
);
