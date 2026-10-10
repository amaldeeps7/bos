import { BadRequestException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';

/** Profile pictures belong to the account (the same photo in every organisation), stored under STORAGE_DIR/accounts/<id>/. */
const file = (accountId: string) => join(resolve(process.env.STORAGE_DIR || './storage'), 'accounts', accountId, 'avatar');

const TYPES: [string, (b: Buffer) => boolean][] = [
  ['image/png', b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/webp', b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];
export const imageType = (b: Buffer) => TYPES.find(([, is]) => is(b))?.[0] || null;

/** The web app crops and shrinks the photo to 256×256 before sending it as a data URL; anything else is refused. */
export async function saveAvatar(accountId: string, dataUrl: unknown) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new BadRequestException('Choose a PNG, JPEG or WebP image.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 512 * 1024) throw new BadRequestException('That image is too large. Use one under 500 KB.');
  if (!imageType(buf)) throw new BadRequestException('That file isn’t a valid image.');
  await fs.mkdir(join(file(accountId), '..'), { recursive: true });
  await fs.writeFile(file(accountId), buf);
}
export const readAvatar = (accountId: string) => fs.readFile(file(accountId)).catch(() => null);
export const removeAvatar = (accountId: string) => fs.rm(file(accountId), { force: true });

/** URL for an account's photo, or null for initials. `v` changes when the photo does, so browsers can cache it. */
export const avatarUrl = (accountId: string, at: Date | null | undefined) => (at ? `/api/avatars/${accountId}?v=${at.getTime()}` : null);
