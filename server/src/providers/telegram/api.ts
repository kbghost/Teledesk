import { env } from '../../config/env';
import type { TgBusinessConnection, TgMessage, TgUpdate, TgUser } from './types';
import { ALLOWED_UPDATES } from './types';

/** Erreur renvoyée par Telegram (ou par le réseau, code 0). La description ne contient jamais le jeton du bot. */
export class TelegramApiError extends Error {
  constructor(public code: number, public description: string, public method: string, public retryAfter?: number) {
    super(`Telegram ${method} : ${code} ${description}`);
  }
  get isAuth() { return this.code === 401; }
  get isForbidden() { return this.code === 403; }
  get isRateLimit() { return this.code === 429; }
  get isNetwork() { return this.code === 0; }
}

/** Adresse de l'API : officielle par défaut, remplaçable (tests, serveur Bot API local). */
let baseOverride: string | undefined;
let sandboxOverride: string | undefined;
export const setTelegramBase = (url?: string) => { baseOverride = url; };
export const setSandboxBase = (url?: string) => { sandboxOverride = url; };
export const telegramBase = () => (baseOverride ?? env.TELEGRAM_API_BASE).replace(/\/$/, '');
/** Le bac à sable est servi par ce même serveur (bouclage local). */
export const sandboxBase = () => (sandboxOverride ?? `http://127.0.0.1:${env.PORT}/__sandbox/telegram`).replace(/\/$/, '');

export type MediaKind = 'photo' | 'video' | 'audio' | 'document';
const MEDIA_FIELD: Record<MediaKind, string> = { photo: 'photo', video: 'video', audio: 'audio', document: 'document' };
const MEDIA_METHOD: Record<MediaKind, string> = { photo: 'sendPhoto', video: 'sendVideo', audio: 'sendAudio', document: 'sendDocument' };
/** Limites de l'API Bot publique : photos 10 Mo, autres fichiers 50 Mo en envoi, 20 Mo en téléchargement. */
export const LIMITS = { photoBytes: 10 * 1024 * 1024, uploadBytes: 50 * 1024 * 1024, downloadBytes: 20 * 1024 * 1024 };

export interface InlineButton { text: string; url: string }
export interface SendOptions { businessConnectionId?: string; replyToMessageId?: number; /** Boutons sous le message (bouton « lien » : seul type permis dans une conversation Business). */ buttons?: InlineButton[][] }
export interface TgFile { file_id: string; file_unique_id: string; file_size?: number; file_path?: string }

export class TelegramApi {
  private readonly base: string;
  constructor(private readonly token: string, base?: string) { this.base = (base ?? telegramBase()).replace(/\/$/, ''); }

  private scrub(text: string) { return text.split(this.token).join('«jeton»'); }

  private async request<T>(method: string, init: RequestInit, timeoutMs: number): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/bot${this.token}/${method}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const reason = (e as Error).name === 'TimeoutError' ? 'délai dépassé' : this.scrub((e as Error).message || 'réseau indisponible');
      throw new TelegramApiError(0, reason, method);
    }
    let body: { ok?: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } };
    try { body = (await res.json()) as typeof body; } catch { throw new TelegramApiError(res.status, 'réponse illisible', method); }
    if (!body.ok) throw new TelegramApiError(body.error_code ?? res.status, this.scrub(body.description ?? 'erreur inconnue'), method, body.parameters?.retry_after);
    return body.result as T;
  }

  call<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> {
    return this.request<T>(method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) }, timeoutMs);
  }

  getMe() { return this.call<TgUser>('getMe'); }
  getBusinessConnection(id: string) { return this.call<TgBusinessConnection>('getBusinessConnection', { business_connection_id: id }); }
  deleteWebhook() { return this.call<boolean>('deleteWebhook', { drop_pending_updates: false }); }
  setWebhook(url: string, secretToken: string) {
    return this.call<boolean>('setWebhook', { url, secret_token: secretToken, allowed_updates: ALLOWED_UPDATES, max_connections: 20 });
  }
  /** Long polling : `timeoutS` doit rester inférieur au délai réseau de la requête. */
  getUpdates(offset: number, timeoutS: number) {
    return this.call<TgUpdate[]>('getUpdates', { offset, timeout: timeoutS, limit: 100, allowed_updates: ALLOWED_UPDATES }, (timeoutS + 10) * 1000);
  }
  getFile(fileId: string) { return this.call<TgFile>('getFile', { file_id: fileId }); }

  async download(filePath: string): Promise<Buffer> {
    let res: Response;
    try { res = await fetch(`${this.base}/file/bot${this.token}/${filePath}`, { signal: AbortSignal.timeout(60_000) }); }
    catch (e) { throw new TelegramApiError(0, this.scrub((e as Error).message), 'download'); }
    if (!res.ok) throw new TelegramApiError(res.status, 'téléchargement refusé', 'download');
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > LIMITS.downloadBytes) throw new TelegramApiError(413, 'fichier trop volumineux', 'download');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > LIMITS.downloadBytes) throw new TelegramApiError(413, 'fichier trop volumineux', 'download');
    return buf;
  }

  sendChatAction(chatId: string, action: 'typing' | 'upload_photo' | 'upload_video', opts: SendOptions = {}) {
    return this.call<boolean>('sendChatAction', { chat_id: Number(chatId), action, ...(opts.businessConnectionId ? { business_connection_id: opts.businessConnectionId } : {}) });
  }
  readBusinessMessage(connectionId: string, chatId: string, messageId: number) {
    return this.call<boolean>('readBusinessMessage', { business_connection_id: connectionId, chat_id: Number(chatId), message_id: messageId });
  }

  sendMessage(chatId: string, text: string, opts: SendOptions = {}) {
    return this.call<TgMessage>('sendMessage', {
      chat_id: Number(chatId), text,
      ...(opts.businessConnectionId ? { business_connection_id: opts.businessConnectionId } : {}),
      ...(opts.replyToMessageId ? { reply_parameters: { message_id: opts.replyToMessageId, allow_sending_without_reply: true } } : {}),
      ...(opts.buttons ? { reply_markup: { inline_keyboard: opts.buttons } } : {}),
    });
  }

  /** Envoie un média : `source` = file_id déjà connu de Telegram (renvoi rapide) ou contenu binaire (téléversement). */
  sendMedia(kind: MediaKind, chatId: string, source: { fileId: string } | { data: Buffer; filename: string; mime: string }, caption: string, opts: SendOptions = {}) {
    const fields: Record<string, string> = { chat_id: String(Number(chatId)) };
    if (caption) fields.caption = caption;
    if (opts.businessConnectionId) fields.business_connection_id = opts.businessConnectionId;
    if (opts.replyToMessageId) fields.reply_parameters = JSON.stringify({ message_id: opts.replyToMessageId, allow_sending_without_reply: true });
    if (opts.buttons) fields.reply_markup = JSON.stringify({ inline_keyboard: opts.buttons });
    const method = MEDIA_METHOD[kind];
    if ('fileId' in source) return this.call<TgMessage>(method, { ...fields, chat_id: Number(chatId), [MEDIA_FIELD[kind]]: source.fileId, ...(fields.reply_parameters ? { reply_parameters: JSON.parse(fields.reply_parameters) } : {}), ...(opts.buttons ? { reply_markup: { inline_keyboard: opts.buttons } } : {}) }, 60_000);
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append(MEDIA_FIELD[kind], new Blob([new Uint8Array(source.data)], { type: source.mime }), source.filename);
    return this.request<TgMessage>(method, { method: 'POST', body: form }, 120_000);
  }
}

/** Identifiant de fichier Telegram du média contenu dans un message envoyé (réutilisable pour de futurs envois). */
export function fileIdOf(msg: TgMessage): string | undefined {
  return msg.photo?.[msg.photo.length - 1]?.file_id ?? msg.video?.file_id ?? msg.audio?.file_id ?? msg.voice?.file_id ?? msg.document?.file_id;
}
