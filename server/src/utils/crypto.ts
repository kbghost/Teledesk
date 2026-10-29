import crypto from 'node:crypto';
import { env } from '../config/env';

export interface EncryptedBlob { iv: string; tag: string; data: string }

const key = () => crypto.createHash('sha256').update(env.TELEGRAM_SECRET_KEY).digest(); // 32 octets

/**
 * Chiffrement AES-256-GCM (authentifié) des secrets Telegram. `aad` lie le secret à son compte : un blob copié vers
 * un autre compte (ou altéré) échoue au déchiffrement.
 */
export function encryptSecret(plain: string, aad: string): EncryptedBlob {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
export function decryptSecret(blob: EncryptedBlob, aad: string): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(blob.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64')), decipher.final()]).toString('utf8');
}
