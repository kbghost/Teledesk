import crypto from 'node:crypto';

/** TOTP (RFC 6238, HMAC-SHA1, 6 chiffres, pas de 30 s) implémenté avec le module crypto de Node : aucune dépendance. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Base32 invalide');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(buf).digest();
  const off = h[h.length - 1]! & 0xf;
  const code = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(code % 10 ** digits).padStart(digits, '0');
}
export const totpStep = (nowMs: number, period = 30) => Math.floor(nowMs / 1000 / period);
export const totpAt = (secretB32: string, nowMs: number) => hotp(base32Decode(secretB32), totpStep(nowMs));

/** Vérifie un code avec une tolérance de ±1 pas ; retourne le pas validé (pour interdire le rejeu) ou null. */
export function verifyTotp(secretB32: string, code: string, nowMs = Date.now(), lastStep = 0): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const cur = totpStep(nowMs);
  for (const delta of [0, -1, 1]) {
    const step = cur + delta;
    if (step <= lastStep) continue;
    const expected = hotp(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step;
  }
  return null;
}
export const otpauthUrl = (secretB32: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
