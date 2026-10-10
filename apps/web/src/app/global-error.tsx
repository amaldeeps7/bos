'use client';

/** The whole app failed to start (even the layout): a plain page with a reload. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en"><body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#fafafa' }}>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ width: 420, maxWidth: '100%', padding: 24, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Business OS couldn’t start</p>
          <p style={{ margin: '8px 0 16px', fontSize: 14, color: '#475569' }}>Check your connection and try again.</p>
          <button onClick={() => { reset(); location.reload(); }} style={{ height: 40, padding: '0 16px', border: 0, borderRadius: 8, background: '#0052ff', color: '#fff', fontSize: 14, cursor: 'pointer' }}>Reload</button>
        </div>
      </div>
    </body></html>
  );
}
