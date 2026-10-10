'use client';
import { ReactNode } from 'react';

/** The centred card used by the signed-out pages (forgot / reset password, email verification). */
export function AuthFrame({ sub, children }: { sub: string; children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#fafafa' }}>
      <div style={{ width: 400, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <a href="/login" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit', textDecoration: 'none' }}>
          <span style={{ width: 36, height: 36, borderRadius: 9, backgroundImage: 'linear-gradient(135deg,#0052ff,#4d7cff)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600 }}>BO</span>
          <div><p style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Business OS</p><p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{sub}</p></div>
        </a>
        {children}
      </div>
    </div>
  );
}
