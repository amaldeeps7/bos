import Link from 'next/link';

/** Any address that doesn't exist. */
export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#fafafa' }}>
      <div className="card" style={{ width: 420, maxWidth: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#94a3b8', letterSpacing: '.04em' }}>404</p>
        <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>There’s nothing at this address</p>
        <p style={{ margin: 0, fontSize: 14, color: '#475569' }}>The link may be old, or the record may have been removed.</p>
        <Link href="/" className="btn btn-pri" style={{ alignSelf: 'flex-start', textDecoration: 'none' }}>Go to My Work</Link>
      </div>
    </div>
  );
}
