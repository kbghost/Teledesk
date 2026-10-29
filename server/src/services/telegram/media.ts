import crypto from 'node:crypto';
import sharp from 'sharp';
import { Message } from '../../models';
import { logger } from '../../config/logger';
import { LIMITS, TelegramApiError } from '../../providers/telegram/api';
import { getStorage } from '../../providers/storage';
import { detectFileType } from '../../utils/filetype';
import { publishMessage } from './audience';
import { apiFor, loadAccountSecret } from './runtime';

const newKey = (ext: string) => `${crypto.randomBytes(16).toString('hex')}.${ext}`;

/** Miniature WebP (480 px max) : sert aussi de contrôle de décodage — un faux « .png » qui n'est pas une image est refusé. */
export async function makeThumb(buf: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const img = sharp(buf, { limitInputPixels: 80_000_000 }).rotate();
  const meta = await sharp(buf, { limitInputPixels: 80_000_000 }).metadata();
  const data = await img.resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  return { data, width: meta.width ?? 0, height: meta.height ?? 0 };
}

/**
 * Télécharge dans le stockage PRIVÉ le fichier joint à un message reçu (Telegram limite le téléchargement à 20 Mo pour les bots).
 * Le type réel est déterminé par les octets du fichier ; un fichier non reconnu reste consultable seulement en téléchargement.
 * Aucune erreur n'est propagée : un échec marque simplement la pièce jointe comme indisponible.
 */
export async function fetchIncomingAttachment(accountId: string, messageId: string): Promise<void> {
  const m = await Message.findById(messageId);
  const att = m?.attachment;
  if (!m || !att?.tgFileId || att.key) return;
  const mark = async (unavailable: string) => {
    m.attachment!.unavailable = unavailable;
    await m.save();
    await publishMessage('message:updated', { _id: m.conversationId, accountId: m.accountId, agencyId: m.agencyId }, m.toObject());
  };
  try {
    const account = await loadAccountSecret(accountId);
    if (!account) return;
    const api = apiFor(account);
    const file = await api.getFile(att.tgFileId);
    if (file.file_size && file.file_size > LIMITS.downloadBytes) return await mark('TOO_LARGE');
    if (!file.file_path) return await mark('DOWNLOAD_FAILED');
    const buf = await api.download(file.file_path);
    const type = detectFileType(buf);
    const storage = getStorage();
    const ext = type?.ext ?? 'bin';
    const key = newKey(ext);
    await storage.put('private', key, buf);
    m.attachment!.key = key;
    m.attachment!.size = buf.length;
    if (type) { m.attachment!.mime = type.mime; m.attachment!.kind = type.kind; } else { m.attachment!.mime = 'application/octet-stream'; m.attachment!.kind = 'FILE'; }
    if (type?.kind === 'IMAGE') {
      try {
        const t = await makeThumb(buf);
        const thumbKey = newKey('webp');
        await storage.put('private', thumbKey, t.data);
        m.attachment!.thumbKey = thumbKey; m.attachment!.width = t.width; m.attachment!.height = t.height;
      } catch { /* image illisible : on garde l'original, sans miniature */ }
    }
    await m.save();
    await publishMessage('message:updated', { _id: m.conversationId, accountId: m.accountId, agencyId: m.agencyId }, m.toObject());
  } catch (e) {
    logger.warn({ err: e instanceof TelegramApiError ? e.description : (e as Error).message }, 'incoming attachment failed');
    try { await mark(e instanceof TelegramApiError && e.code === 413 ? 'TOO_LARGE' : 'DOWNLOAD_FAILED'); } catch { /* ignoré */ }
  }
}
