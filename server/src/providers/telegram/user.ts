import { Api, TelegramClient } from 'telegram';
import { NewMessage, type NewMessageEvent } from 'telegram/events';
import { StringSession } from 'telegram/sessions';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { TelegramApiError, type MediaKind, type SendOptions, type TgFile } from './api';
import type { TgMessage, TgUser } from './types';

/**
 * Compte Telegram PERSONNEL (protocole MTProto, via GramJS) : le serveur se comporte comme l'application Telegram du modèle.
 * Aucun bot, aucun abonnement Premium ; les fans écrivent au vrai compte du modèle.
 *
 * ⚠ EXPÉRIMENTAL — non vérifié sur le vrai réseau Telegram dans ce projet (voir docs/telegram-comptes.md). La session donne un accès
 * COMPLET au compte : elle est chiffrée en base (AES-256-GCM). Telegram peut restreindre un compte qui se comporte comme un robot :
 * le CRM ne répond qu'aux personnes qui ont écrit en premier et plafonne le débit d'envoi.
 */

const clients = new Map<string, TelegramClient>();
const sends = new Map<string, number[]>();

const need = () => {
  if (!env.TELEGRAM_API_ID || !env.TELEGRAM_API_HASH) throw new TelegramApiError(400, 'TELEGRAM_API_ID / TELEGRAM_API_HASH manquants sur le serveur (créez une application sur my.telegram.org)', 'user');
  return { apiId: env.TELEGRAM_API_ID, apiHash: env.TELEGRAM_API_HASH };
};

/** Traduit les erreurs MTProto vers le même vocabulaire que l'API Bot (le reste du CRM n'a pas à connaître la différence). */
export function mapError(e: unknown, method = 'user'): TelegramApiError {
  if (e instanceof TelegramApiError) return e;
  const msg = String((e as { errorMessage?: string }).errorMessage ?? (e as Error).message ?? e);
  const flood = /FLOOD_WAIT_(\d+)|SLOWMODE_WAIT_(\d+)/.exec(msg);
  if (flood) return new TelegramApiError(429, 'Too Many Requests', method, Number(flood[1] ?? flood[2]));
  if (/PEER_FLOOD/.test(msg)) return new TelegramApiError(429, 'Too Many Requests (PEER_FLOOD)', method, 600);
  if (/AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/.test(msg)) return new TelegramApiError(401, 'Unauthorized', method);
  if (/USER_IS_BLOCKED|USER_PRIVACY|INPUT_USER_DEACTIVATED|PEER_ID_INVALID/.test(msg)) return new TelegramApiError(403, 'Forbidden: ' + msg, method);
  if (/ETIMEDOUT|ECONN|EAI_AGAIN|Not connected|CONNECTION/i.test(msg)) return new TelegramApiError(0, 'réseau indisponible', method);
  return new TelegramApiError(400, msg, method);
}

async function connect(accountId: string, session: string): Promise<TelegramClient> {
  const live = clients.get(accountId);
  if (live) { if (!live.connected) await live.connect(); return live; }
  const { apiId, apiHash } = need();
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5, deviceModel: 'TeleDesk', appVersion: '1.0', useWSS: false });
  await client.connect();
  clients.set(accountId, client);
  // GramJS ne garde les « access hash » des contacts qu'en mémoire : on les recharge pour pouvoir répondre après un redémarrage.
  await client.getDialogs({ limit: 200 }).catch(() => undefined);
  return client;
}
/** Déconnexion : la session est révoquée côté Telegram (elle disparaît de « Appareils » dans l'application), puis oubliée. */
export async function userLogout(accountId: string, session: string): Promise<void> {
  try { const c = await connect(accountId, session); await c.invoke(new Api.auth.LogOut()); } catch { /* session déjà invalide ou réseau coupé : on oublie quand même */ }
  await dropClient(accountId);
}
export const dropClient = async (accountId: string) => {
  const c = clients.get(accountId); clients.delete(accountId);
  if (c) await c.disconnect().catch(() => undefined);
};

// ───────────── Connexion par numéro (code reçu dans Telegram, puis mot de passe 2FA éventuel) ─────────────
interface PendingLogin { client: TelegramClient; phone: string; phoneCodeHash: string; at: number }
const pendingLogins = new Map<string, PendingLogin>();

export async function userSendCode(accountId: string, phone: string): Promise<void> {
  const { apiId, apiHash } = need();
  await dropPending(accountId);
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3, deviceModel: 'TeleDesk', appVersion: '1.0' });
  try {
    await client.connect();
    const r = await client.sendCode({ apiId, apiHash }, phone);
    pendingLogins.set(accountId, { client, phone, phoneCodeHash: r.phoneCodeHash, at: Date.now() });
  } catch (e) { await client.disconnect().catch(() => undefined); throw mapError(e, 'sendCode'); }
}
async function dropPending(id: string) { const p = pendingLogins.get(id); pendingLogins.delete(id); if (p) await p.client.disconnect().catch(() => undefined); }

export type UserLoginResult = { state: 'PASSWORD_NEEDED' } | { state: 'OK'; session: string; me: TgUser };
export async function userVerify(accountId: string, code: string, password?: string): Promise<UserLoginResult> {
  const p = pendingLogins.get(accountId);
  if (!p || Date.now() - p.at > 15 * 60_000) { await dropPending(accountId); throw new TelegramApiError(400, 'Code expiré : redemandez un code', 'signIn'); }
  const { apiId, apiHash } = need();
  try {
    if (!password) {
      try {
        await p.client.invoke(new Api.auth.SignIn({ phoneNumber: p.phone, phoneCodeHash: p.phoneCodeHash, phoneCode: code }));
      } catch (e) {
        if (/SESSION_PASSWORD_NEEDED/.test(String((e as { errorMessage?: string }).errorMessage ?? e))) return { state: 'PASSWORD_NEEDED' };
        throw e;
      }
    } else {
      await p.client.signInWithPassword({ apiId, apiHash }, { password: async () => password, onError: async (err) => { throw err; } });
    }
    const me = (await p.client.getMe()) as Api.User;
    const session = (p.client.session as StringSession).save();
    clients.set(accountId, p.client);
    pendingLogins.delete(accountId);
    return { state: 'OK', session, me: toTgUser(me) };
  } catch (e) {
    const msg = String((e as { errorMessage?: string }).errorMessage ?? e);
    if (/PHONE_CODE_INVALID|PHONE_CODE_EXPIRED|PASSWORD_HASH_INVALID/.test(msg)) throw new TelegramApiError(400, /PASSWORD/.test(msg) ? 'Mot de passe incorrect' : 'Code incorrect ou expiré', 'signIn');
    throw mapError(e, 'signIn');
  }
}

// ───────────── Conversion MTProto → format « API Bot » (le reste du CRM ne voit pas la différence) ─────────────
export function toTgUser(u: Pick<Api.User, 'id' | 'firstName' | 'lastName' | 'username' | 'bot'>): TgUser {
  return { id: Number(u.id), is_bot: !!u.bot, first_name: u.firstName ?? undefined, last_name: u.lastName ?? undefined, username: u.username ?? undefined };
}
/** Identifiant de fichier « maison » : l'identité du message suffit à retélécharger le média. */
const fileRef = (chatId: number, msgId: number) => `u:${chatId}:${msgId}`;

interface MiniMsg { id: number; date: number; message?: string; media?: unknown; out?: boolean }
export function toTgMessage(m: MiniMsg, sender: Pick<Api.User, 'id' | 'firstName' | 'lastName' | 'username' | 'bot'>): TgMessage {
  const chatId = Number(sender.id);
  const base: TgMessage = {
    message_id: m.id, date: m.date, chat: { id: chatId, type: 'private', first_name: sender.firstName ?? undefined, last_name: sender.lastName ?? undefined, username: sender.username ?? undefined },
    from: toTgUser(sender),
  };
  const text = m.message ?? '';
  const media = m.media as { className?: string; photo?: { id?: unknown; sizes?: Array<{ w?: number; h?: number; size?: number }> }; document?: { id?: unknown; size?: unknown; mimeType?: string; attributes?: Array<{ className: string; fileName?: string; duration?: number; w?: number; h?: number; voice?: boolean; alt?: string }> } } | undefined;
  const id = fileRef(chatId, m.id);
  if (media?.className === 'MessageMediaPhoto' && media.photo) {
    const biggest = (media.photo.sizes ?? []).reduce((a, s) => ((s.w ?? 0) > (a.w ?? 0) ? s : a), {} as { w?: number; h?: number; size?: number });
    base.photo = [{ file_id: id, file_unique_id: `p${String(media.photo.id)}`, width: biggest.w ?? 0, height: biggest.h ?? 0, file_size: biggest.size }];
    if (text) base.caption = text;
    return base;
  }
  if (media?.className === 'MessageMediaDocument' && media.document) {
    const d = media.document; const attrs = d.attributes ?? [];
    const info = { file_id: id, file_unique_id: `d${String(d.id)}`, file_size: d.size !== undefined ? Number(d.size) : undefined, mime_type: d.mimeType, file_name: attrs.find((a) => a.className === 'DocumentAttributeFilename')?.fileName, duration: attrs.find((a) => a.className === 'DocumentAttributeAudio' || a.className === 'DocumentAttributeVideo')?.duration, width: attrs.find((a) => a.className === 'DocumentAttributeVideo')?.w, height: attrs.find((a) => a.className === 'DocumentAttributeVideo')?.h };
    if (attrs.some((a) => a.className === 'DocumentAttributeSticker')) base.sticker = { ...info, emoji: attrs.find((a) => a.className === 'DocumentAttributeSticker')?.alt };
    else if (attrs.some((a) => a.className === 'DocumentAttributeAudio' && a.voice)) base.voice = info;
    else if (attrs.some((a) => a.className === 'DocumentAttributeAudio')) base.audio = info;
    else if (attrs.some((a) => a.className === 'DocumentAttributeVideo')) base.video = info;
    else base.document = info;
    if (text) base.caption = text;
    return base;
  }
  if (text) base.text = text;
  return base;
}

/** Écoute des messages reçus : seuls les messages privés ENTRANTS d'une personne (ni groupes, ni canaux, ni robots) sont transmis. */
export async function userListen(accountId: string, session: string, onMessage: (m: TgMessage) => Promise<void>): Promise<() => Promise<void>> {
  const client = await connect(accountId, session);
  const handler = async (ev: NewMessageEvent) => {
    try {
      const msg = ev.message;
      if (!ev.isPrivate || msg.out) return;
      const sender = (await msg.getSender()) as Api.User | undefined;
      if (!sender || sender.className !== 'User' || sender.bot || sender.self) return;
      await onMessage(toTgMessage({ id: msg.id, date: msg.date, message: msg.message, media: msg.media, out: msg.out }, sender));
    } catch (e) { logger.warn({ err: (e as Error).message, accountId }, 'user message handling failed'); }
  };
  client.addEventHandler(handler, new NewMessage({ incoming: true }));
  return async () => { client.removeEventHandler(handler, new NewMessage({ incoming: true })); await dropClient(accountId); };
}

/** Même interface que `TelegramApi` pour ce que l'envoi et le téléchargement utilisent. */
export class UserApi {
  constructor(private readonly accountId: string, private readonly session: string) {}
  private async client() { try { return await connect(this.accountId, this.session); } catch (e) { throw mapError(e); } }

  /** Plafond d'envois par heure : au-delà, l'envoi est repoussé (réponse « 429 » comprise par la file d'envoi). */
  private throttle() {
    const now = Date.now(); const arr = (sends.get(this.accountId) ?? []).filter((t) => now - t < 3600_000);
    if (arr.length >= env.USER_MAX_SENDS_PER_HOUR) throw new TelegramApiError(429, 'Plafond horaire atteint', 'send', Math.ceil((arr[0]! + 3600_000 - now) / 1000));
    arr.push(now); sends.set(this.accountId, arr);
  }

  async getMe(): Promise<TgUser> { const me = (await (await this.client()).getMe()) as Api.User; return toTgUser(me); }
  deleteWebhook() { return Promise.resolve(true); }
  sendChatAction() { return Promise.resolve(true); }
  readBusinessMessage() { return Promise.resolve(true); }

  private async send(chatId: string, fn: (c: TelegramClient, peer: Api.TypeEntityLike) => Promise<Api.Message>): Promise<TgMessage> {
    this.throttle();
    const c = await this.client();
    try {
      const peer = await c.getInputEntity(Number(chatId));
      const sent = await fn(c, peer);
      return { message_id: sent.id, date: sent.date, chat: { id: Number(chatId), type: 'private' } };
    } catch (e) { throw mapError(e, 'send'); }
  }
  sendMessage(chatId: string, text: string, opts: SendOptions = {}) {
    return this.send(chatId, (c, peer) => c.sendMessage(peer, { message: text, replyTo: opts.replyToMessageId, linkPreview: false }));
  }
  async sendMedia(kind: MediaKind, chatId: string, source: { fileId: string } | { data: Buffer; filename: string; mime: string }, caption: string, opts: SendOptions = {}) {
    if ('fileId' in source) throw new TelegramApiError(400, 'file_id non pris en charge pour un compte personnel', 'send');
    const file = Object.assign(source.data, { name: source.filename });
    return this.send(chatId, (c, peer) => c.sendFile(peer, { file: file as never, caption, replyTo: opts.replyToMessageId, forceDocument: kind === 'document', supportsStreaming: kind === 'video', voiceNote: false }));
  }
  async getFile(fileId: string): Promise<TgFile> { return { file_id: fileId, file_unique_id: fileId, file_path: fileId }; }
  async download(ref: string): Promise<Buffer> {
    const m = /^u:(-?\d+):(\d+)$/.exec(ref);
    if (!m) throw new TelegramApiError(400, 'référence de fichier invalide', 'download');
    const c = await this.client();
    try {
      const peer = await c.getInputEntity(Number(m[1]));
      const [msg] = await c.getMessages(peer, { ids: [Number(m[2])] });
      if (!msg?.media) throw new TelegramApiError(404, 'média introuvable', 'download');
      const buf = (await c.downloadMedia(msg, {})) as Buffer | undefined;
      if (!buf) throw new TelegramApiError(404, 'média introuvable', 'download');
      return buf;
    } catch (e) { throw mapError(e, 'download'); }
  }
}
