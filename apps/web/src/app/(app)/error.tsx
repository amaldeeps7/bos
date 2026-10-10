'use client';
import { useEffect } from 'react';
import { Btn, Card } from '@/components/ui';

/** Something on this page broke: keep the sidebar, explain, and offer a retry. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <Card style={{ padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12, maxWidth: 560 }}>
      <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>This page didn’t load properly</p>
      <p style={{ margin: 0, fontSize: 14, color: '#475569' }}>Something went wrong on our side. Try again; if it keeps happening, reload the page.{error.digest ? ` (Reference ${error.digest})` : ''}</p>
      <div style={{ display: 'flex', gap: 8 }}><Btn kind="pri" onClick={reset}>Try again</Btn><Btn onClick={() => location.reload()}>Reload</Btn></div>
    </Card>
  );
}
