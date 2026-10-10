/** Shown while a page's code loads. */
export default function Loading() {
  return <div role="status" aria-label="Loading" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    {[220, 120, 320].map((h, i) => <div key={i} style={{ height: i === 0 ? 32 : h, width: i === 0 ? 240 : '100%', borderRadius: 12, background: '#f1f5f9' }} />)}
  </div>;
}
