'use client';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useApp } from '@/lib/app';
import { Icon } from './ui';

/** Crops the middle square of an image and shrinks it to 256×256, so uploads stay small (a few tens of KB). */
async function square(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('unreadable')); i.src = url; });
    const s = Math.min(img.naturalWidth, img.naturalHeight); const c = document.createElement('canvas'); c.width = c.height = 256;
    c.getContext('2d')!.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 256, 256);
    const webp = c.toDataURL('image/webp', 0.85);
    return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

/** Your photo on your profile: click to add or change it; remove it to go back to initials. */
export function PhotoPicker({ name, src, size = 64, editable }: { name: string; src?: string | null; size?: number; editable: boolean }) {
  const { toast } = useApp(); const qc = useQueryClient(); const input = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false);
  const ini = name.split(' ').map(w => w[0]).join('').slice(0, 2);
  const face = src
    ? <img src={src} alt={name} width={size} height={size} style={{ width: size, height: size, borderRadius: 999, objectFit: 'cover', display: 'block' }} />
    : <span style={{ width: size, height: size, borderRadius: 999, background: '#eef4ff', color: '#0052ff', fontSize: size / 2.9, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{ini}</span>;
  if (!editable) return <span style={{ flex: 'none' }}>{face}</span>;
  const done = async (message: string) => { await qc.invalidateQueries(); toast(message); setBusy(false); };
  const pick = async (f?: File) => {
    if (!f) return;
    if (!/^image\//.test(f.type)) return toast('Choose an image file.');
    setBusy(true);
    try { const image = await square(f); const r = await api<{ message: string }>('me/avatar', { body: { image } }); await done(r.message); }
    catch (x) { toast(x instanceof ApiError ? x.message : 'Couldn’t use that image. Try a JPEG or PNG.'); setBusy(false); }
  };
  return (
    <span style={{ position: 'relative', flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <button type="button" onClick={() => input.current?.click()} disabled={busy} title={src ? 'Change photo' : 'Add a photo'} aria-label={src ? 'Change photo' : 'Add a photo'}
        style={{ position: 'relative', padding: 0, border: 0, borderRadius: 999, background: 'none', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
        {face}
        <span aria-hidden style={{ position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 999, background: '#fff', border: '1px solid #e2e8f0', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="camera" size={13} /></span>
      </button>
      {src && <button type="button" className="link" disabled={busy} onClick={async () => { setBusy(true); try { const r = await api<{ message: string }>('me/avatar', { method: 'DELETE' }); await done(r.message); } catch { setBusy(false); } }} style={{ fontSize: 12 }}>Remove</button>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
    </span>
  );
}
