import type { ASSET_KINDS } from '@teledesk/shared';

export interface DetectedType { mime: string; ext: string; kind: (typeof ASSET_KINDS)[number]; inline: boolean }

/**
 * Type réel d'un fichier d'après ses premiers octets (« magic bytes »). On ne se fie ni à l'extension ni au type
 * annoncé par le client ou par Telegram. `inline` : le navigateur peut l'afficher sans risque ; sinon téléchargement forcé.
 */
export function detectFileType(buf: Buffer): DetectedType | null {
  if (buf.length < 12) return null;
  const head = (n: number, off = 0) => buf.subarray(off, off + n).toString('latin1');
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', kind: 'IMAGE', inline: true };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png', kind: 'IMAGE', inline: true };
  if (head(4) === 'GIF8') return { mime: 'image/gif', ext: 'gif', kind: 'IMAGE', inline: true };
  if (head(4) === 'RIFF' && head(4, 8) === 'WEBP') return { mime: 'image/webp', ext: 'webp', kind: 'IMAGE', inline: true };
  if (head(4) === 'RIFF' && head(4, 8) === 'WAVE') return { mime: 'audio/wav', ext: 'wav', kind: 'AUDIO', inline: true };
  if (head(4) === 'OggS') return { mime: 'audio/ogg', ext: 'ogg', kind: 'AUDIO', inline: true };
  if (head(3) === 'ID3' || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', ext: 'mp3', kind: 'AUDIO', inline: true };
  if (head(4) === '%PDF') return { mime: 'application/pdf', ext: 'pdf', kind: 'FILE', inline: false };
  if (head(4, 4) === 'ftyp') {
    const brand = head(4, 8);
    if (brand === 'qt  ') return { mime: 'video/quicktime', ext: 'mov', kind: 'VIDEO', inline: true };
    if (brand.startsWith('M4A') || brand === 'M4B ') return { mime: 'audio/mp4', ext: 'm4a', kind: 'AUDIO', inline: true };
    return { mime: 'video/mp4', ext: 'mp4', kind: 'VIDEO', inline: true };
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { mime: 'video/webm', ext: 'webm', kind: 'VIDEO', inline: true };
  return null;
}
/** Formats acceptés à l'envoi dans la médiathèque. */
export const LIBRARY_EXTS = new Set(['jpg', 'png', 'gif', 'webp', 'mp4', 'mov', 'mp3', 'm4a', 'ogg', 'wav', 'pdf']);
