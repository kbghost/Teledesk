import crypto from 'node:crypto';
import express, { type Request, type Response, type Router } from 'express';
import multer from 'multer';
import type { TgBusinessRights, TgChat, TgMessage, TgUpdate, TgUser } from './types';

/**
 * Faux serveur de l'API Bot Telegram : même protocole HTTP, mêmes règles documentées par Telegram, sans réseau.
 * Sert (1) aux tests automatiques, (2) au « bac à sable » de la démo. Il ne remplace pas un essai avec un vrai bot.
 *
 * Règles reproduites : jeton invalide → 401 ; getUpdates impossible tant qu'un webhook est actif (409) ; un bot connecté à
 * un compte Business ne peut répondre que si la connexion est active, que le droit can_reply est accordé et que le chat
 * a reçu un message entrant dans les 24 dernières heures ; un bot classique ne peut pas écrire le premier ni à un
 * utilisateur qui l'a bloqué ; limites de taille (photo 10 Mo, fichiers 50 Mo, texte 4096, légende 1024).
 * Les TEXTES d'erreur exacts de Telegram sont approximés : le CRM se fie au code HTTP et à ses propres contrôles.
 */
export interface FakeUser { id: number; first_name: string; last_name?: string; username?: string; language_code?: string }
export interface FakeContent {
  text?: string;
  caption?: string;
  media?: { kind: 'photo' | 'video' | 'voice' | 'audio' | 'document'; data?: Buffer; mime?: string; name?: string; width?: number; height?: number };
}
export interface SentRecord {
  token: string; method: string; chatId: number; businessConnectionId?: string;
  text?: string; caption?: string; file?: { name: string; mime: string; size: number; viaFileId: boolean }; replyTo?: number; messageId: number; at: number; buttons?: Array<Array<{ text: string; url?: string }>>;
}
interface FakeConn { id: string; owner: FakeUser; enabled: boolean; rights: TgBusinessRights; userChatId: number }
interface FakeBot {
  token: string; id: number; username: string; name: string; businessMode: boolean;
  updates: TgUpdate[]; nextUpdateId: number; waiters: Array<() => void>;
  webhook?: { url: string; secret: string };
  connections: Map<string, FakeConn>;
  /** Dernier message entrant par chat (clé « connexion:fan » ou « direct:fan »). */
  lastIncoming: Map<string, number>;
  started: Set<number>; blocked: Set<number>;
}
type Failure = { code: number; description: string; retry_after?: number };

export const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const KIND_BY_METHOD: Record<string, 'photo' | 'video' | 'audio' | 'document' | 'voice'> = { sendPhoto: 'photo', sendVideo: 'video', sendAudio: 'audio', sendDocument: 'document', sendVoice: 'voice' };

export class FakeTelegram {
  bots = new Map<string, FakeBot>();
  sent: SentRecord[] = [];
  reads: Array<{ token: string; connectionId: string; chatId: number; messageId: number }> = [];
  actions: Array<{ token: string; chatId: number; action: string; businessConnectionId?: string }> = [];
  files = new Map<string, { data: Buffer; mime: string; name: string }>();
  private failures: Array<{ token: string; method: string; failure: Failure; times: number }> = [];
  private nextBotId = 7_000_000_001;
  private msgId = 1000;
  private clock: () => number = () => Date.now();

  setClock(fn: () => number) { this.clock = fn; }
  now() { return this.clock(); }
  reset() { this.bots.clear(); this.sent = []; this.reads = []; this.actions = []; this.files.clear(); this.failures = []; this.clock = () => Date.now(); }

  registerBot(token?: string, opts: { username?: string; name?: string; businessMode?: boolean } = {}) {
    const id = this.nextBotId++;
    const tok = token ?? `${id}:${crypto.randomBytes(24).toString('base64url')}`;
    const bot: FakeBot = {
      token: tok, id, username: opts.username ?? `fake_${id}_bot`, name: opts.name ?? 'Bot de test', businessMode: opts.businessMode ?? true,
      updates: [], nextUpdateId: 1, waiters: [], connections: new Map(), lastIncoming: new Map(), started: new Set(), blocked: new Set(),
    };
    this.bots.set(tok, bot);
    return { token: tok, id, username: bot.username };
  }
  /**
   * Après un redémarrage du serveur, le bac à sable (en mémoire) est reconstruit depuis la base : le bot, sa connexion Business et
   * les fenêtres de 24 h. `nextUpdateId` repart du décalage déjà acquitté : sinon les nouveaux évènements seraient pris pour d'anciens.
   */
  restoreBot(token: string, opts: { id?: number; username: string; name: string; nextUpdateId: number }) {
    if (this.bots.has(token)) return;
    const id = opts.id ?? this.nextBotId++;
    this.bots.set(token, {
      token, id, username: opts.username, name: opts.name, businessMode: true, updates: [], nextUpdateId: Math.max(1, opts.nextUpdateId),
      waiters: [], connections: new Map(), lastIncoming: new Map(), started: new Set(), blocked: new Set(),
    });
  }
  restoreBusiness(token: string, c: { connectionId: string; owner: FakeUser; enabled: boolean; rights: TgBusinessRights }) {
    this.bot(token).connections.set(c.connectionId, { id: c.connectionId, owner: c.owner, enabled: c.enabled, rights: c.rights, userChatId: c.owner.id });
  }
  restoreIncoming(token: string, connectionId: string, fanId: number, at: number) {
    this.bot(token).lastIncoming.set(`${connectionId}:${fanId}`, at);
  }
  hasBot(token: string) { return this.bots.has(token); }
  failNext(token: string, method: string, failure: Failure, times = 1) { this.failures.push({ token, method, failure, times }); }
  sentTo(token: string, chatId?: number) { return this.sent.filter((s) => s.token === token && (chatId === undefined || s.chatId === chatId)); }

  // ─── Pilotage côté « Telegram » (ce que feraient le titulaire et ses contacts) ───
  async connectBusiness(token: string, owner: FakeUser, opts: { rights?: TgBusinessRights; enabled?: boolean; connectionId?: string } = {}) {
    const bot = this.bot(token);
    const id = opts.connectionId ?? crypto.randomBytes(9).toString('base64url');
    const conn: FakeConn = { id, owner, enabled: opts.enabled ?? true, rights: opts.rights ?? { can_reply: true, can_read_messages: true }, userChatId: owner.id };
    bot.connections.set(id, conn);
    await this.push(bot, { business_connection: this.connPayload(conn) } as Partial<TgUpdate>);
    return id;
  }
  async updateBusiness(token: string, connectionId: string, patch: { enabled?: boolean; rights?: TgBusinessRights }) {
    const bot = this.bot(token); const conn = bot.connections.get(connectionId)!;
    if (patch.enabled !== undefined) conn.enabled = patch.enabled;
    if (patch.rights) conn.rights = patch.rights;
    await this.push(bot, { business_connection: this.connPayload(conn) } as Partial<TgUpdate>);
  }
  /** Un contact écrit au compte Business. `at` permet de simuler un message ancien. */
  async fanSends(token: string, connectionId: string, fan: FakeUser, content: FakeContent, at = this.now()) {
    const bot = this.bot(token); const conn = bot.connections.get(connectionId)!;
    bot.lastIncoming.set(`${connectionId}:${fan.id}`, at);
    const msg = this.buildMessage(fan, this.chatOf(fan), content, at, connectionId);
    await this.push(bot, { business_message: msg } as Partial<TgUpdate>);
    void conn;
    return msg;
  }
  /** Le titulaire écrit lui-même depuis son appli : le bot reçoit aussi ce message (from = titulaire). */
  async ownerSends(token: string, connectionId: string, fan: FakeUser, text: string, at = this.now()) {
    const bot = this.bot(token); const conn = bot.connections.get(connectionId)!;
    const msg = this.buildMessage(conn.owner, this.chatOf(fan), { text }, at, connectionId);
    await this.push(bot, { business_message: msg } as Partial<TgUpdate>);
    return msg;
  }
  async fanEdits(token: string, connectionId: string, fan: FakeUser, messageId: number, text: string) {
    const bot = this.bot(token);
    const msg = this.buildMessage(fan, this.chatOf(fan), { text }, this.now(), connectionId);
    msg.message_id = messageId; msg.edit_date = Math.floor(this.now() / 1000);
    await this.push(bot, { edited_business_message: msg } as Partial<TgUpdate>);
  }
  async fanDeletes(token: string, connectionId: string, fan: FakeUser, messageIds: number[]) {
    await this.push(this.bot(token), { deleted_business_messages: { business_connection_id: connectionId, chat: this.chatOf(fan), message_ids: messageIds } } as Partial<TgUpdate>);
  }
  /** Message direct adressé au bot (mode « Bot classique »). */
  async fanMessagesBot(token: string, fan: FakeUser, content: FakeContent, at = this.now()) {
    const bot = this.bot(token);
    bot.started.add(fan.id); bot.blocked.delete(fan.id);
    bot.lastIncoming.set(`direct:${fan.id}`, at);
    const msg = this.buildMessage(fan, this.chatOf(fan), content, at);
    await this.push(bot, { message: msg } as Partial<TgUpdate>);
    return msg;
  }
  async fanBlocksBot(token: string, fan: FakeUser) {
    const bot = this.bot(token); bot.blocked.add(fan.id);
    await this.push(bot, { my_chat_member: { chat: this.chatOf(fan), from: fan, date: Math.floor(this.now() / 1000), new_chat_member: { status: 'kicked', user: this.botUser(bot) } } } as Partial<TgUpdate>);
  }

  // ─── Interne ───
  private bot(token: string) { const b = this.bots.get(token); if (!b) throw new Error('bot inconnu'); return b; }
  private botUser(b: FakeBot): TgUser { return { id: b.id, is_bot: true, first_name: b.name, username: b.username, can_connect_to_business: b.businessMode }; }
  private chatOf(fan: FakeUser): TgChat { return { id: fan.id, type: 'private', first_name: fan.first_name, last_name: fan.last_name, username: fan.username }; }
  private connPayload(c: FakeConn) {
    return { id: c.id, user: { id: c.owner.id, first_name: c.owner.first_name, last_name: c.owner.last_name, username: c.owner.username }, user_chat_id: c.userChatId, date: Math.floor(this.now() / 1000), is_enabled: c.enabled, rights: c.rights };
  }
  private storeFile(data: Buffer, mime: string, name: string) {
    const fileId = `FILE${crypto.randomBytes(12).toString('hex')}`;
    this.files.set(fileId, { data, mime, name });
    return fileId;
  }
  private buildMessage(from: FakeUser, chat: TgChat, content: FakeContent, at: number, connectionId?: string): TgMessage {
    const msg: TgMessage = { message_id: this.msgId++, date: Math.floor(at / 1000), chat, from: { ...from, is_bot: false } };
    if (connectionId) msg.business_connection_id = connectionId;
    if (content.text) msg.text = content.text;
    if (content.caption) msg.caption = content.caption;
    const m = content.media;
    if (m) {
      const data = m.data ?? TINY_PNG; const mime = m.mime ?? (m.kind === 'photo' ? 'image/png' : 'application/octet-stream'); const name = m.name ?? `${m.kind}.bin`;
      const file_id = this.storeFile(data, mime, name); const base = { file_id, file_unique_id: `U${file_id.slice(4, 14)}`, file_size: data.length };
      if (m.kind === 'photo') msg.photo = [{ ...base, width: m.width ?? 1, height: m.height ?? 1 }];
      else if (m.kind === 'video') msg.video = { ...base, mime_type: mime, file_name: name, width: m.width, height: m.height };
      else if (m.kind === 'voice') msg.voice = { ...base, mime_type: mime };
      else if (m.kind === 'audio') msg.audio = { ...base, mime_type: mime, file_name: name };
      else msg.document = { ...base, mime_type: mime, file_name: name };
    }
    return msg;
  }
  private async push(bot: FakeBot, partial: Partial<TgUpdate>) {
    const update = { update_id: bot.nextUpdateId++, ...partial } as TgUpdate;
    if (bot.webhook) {
      try {
        await fetch(bot.webhook.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': bot.webhook.secret }, body: JSON.stringify(update) });
      } catch { /* Telegram réessaie plus tard ; le test le verra */ }
      return;
    }
    bot.updates.push(update);
    const w = bot.waiters.splice(0); w.forEach((f) => f());
  }

  // ─── Serveur HTTP ───
  router(): Router {
    const r = express.Router();
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });
    r.get('/file/bot:token/*', (req, res) => {
      const bot = this.bots.get(req.params.token!);
      const id = String((req.params as Record<string, string>)['0'] ?? '').replace(/^files\//, '');
      const f = bot && this.files.get(id);
      if (!f) return res.status(404).json({ ok: false, error_code: 404, description: 'Not Found' });
      res.type(f.mime).send(f.data);
    });
    r.post('/bot:token/:method', express.json({ limit: '5mb' }), upload.any(), async (req, res) => {
      try { await this.handle(req, res); } catch (e) { res.status(500).json({ ok: false, error_code: 500, description: String((e as Error).message) }); }
    });
    return r;
  }
  private fail(res: Response, code: number, description: string, retry_after?: number) {
    return res.status(code).json({ ok: false, error_code: code, description, ...(retry_after ? { parameters: { retry_after } } : {}) });
  }
  private async handle(req: Request, res: Response) {
    const token = req.params.token!; const method = req.params.method!;
    const bot = this.bots.get(token);
    if (!bot) return this.fail(res, 401, 'Unauthorized');
    const hook = this.failures.find((f) => f.token === token && f.method === method && f.times > 0);
    if (hook) { hook.times--; return this.fail(res, hook.failure.code, hook.failure.description, hook.failure.retry_after); }
    const body: Record<string, any> = { ...(req.body ?? {}) };
    const ok = (result: unknown) => res.json({ ok: true, result });

    switch (method) {
      case 'getMe': return ok(this.botUser(bot));
      case 'deleteWebhook': bot.webhook = undefined; return ok(true);
      case 'setWebhook':
        if (!/^https?:\/\//.test(String(body.url ?? ''))) return this.fail(res, 400, 'Bad Request: bad webhook: HTTPS URL must be provided for webhook');
        bot.webhook = { url: String(body.url), secret: String(body.secret_token ?? '') };
        return ok(true);
      case 'getWebhookInfo': return ok({ url: bot.webhook?.url ?? '', pending_update_count: bot.updates.length });
      case 'getUpdates': {
        if (bot.webhook) return this.fail(res, 409, "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first");
        const offset = Number(body.offset ?? 0); const timeout = Math.min(Number(body.timeout ?? 0), 50);
        if (offset > 0) bot.updates = bot.updates.filter((u) => u.update_id >= offset); // accusé de réception
        const take = () => bot.updates.slice(0, Math.min(Number(body.limit ?? 100), 100));
        if (take().length || timeout <= 0) return ok(take());
        await new Promise<void>((resolve) => { const t = setTimeout(resolve, timeout * 1000); bot.waiters.push(() => { clearTimeout(t); resolve(); }); });
        return ok(take());
      }
      case 'getBusinessConnection': {
        const c = bot.connections.get(String(body.business_connection_id));
        return c ? ok(this.connPayload(c)) : this.fail(res, 400, 'Bad Request: business connection not found');
      }
      case 'getFile': {
        const f = this.files.get(String(body.file_id));
        if (!f) return this.fail(res, 400, 'Bad Request: wrong file_id or the file is temporarily unavailable');
        return ok({ file_id: body.file_id, file_unique_id: `U${String(body.file_id).slice(4, 14)}`, file_size: f.data.length, file_path: `files/${body.file_id}` });
      }
      case 'sendChatAction':
        this.actions.push({ token, chatId: Number(body.chat_id), action: String(body.action), businessConnectionId: body.business_connection_id });
        return ok(true);
      case 'readBusinessMessage': {
        const c = bot.connections.get(String(body.business_connection_id));
        if (!c || !c.enabled || !c.rights.can_read_messages) return this.fail(res, 400, 'Bad Request: not enough rights to read messages');
        this.reads.push({ token, connectionId: c.id, chatId: Number(body.chat_id), messageId: Number(body.message_id) });
        return ok(true);
      }
      case 'sendMessage': case 'sendPhoto': case 'sendVideo': case 'sendAudio': case 'sendDocument': case 'sendVoice':
        return this.send(bot, method, req, res, body);
      default: return this.fail(res, 404, 'Not Found');
    }
  }
  private send(bot: FakeBot, method: string, req: Request, res: Response, body: Record<string, any>) {
    const chatId = Number(body.chat_id);
    if (!Number.isFinite(chatId)) return this.fail(res, 400, 'Bad Request: chat_id is empty');
    const connId: string | undefined = body.business_connection_id ? String(body.business_connection_id) : undefined;
    if (connId) {
      const c = bot.connections.get(connId);
      if (!c) return this.fail(res, 400, 'Bad Request: business connection not found');
      if (!c.enabled) return this.fail(res, 400, 'Bad Request: business connection is disabled');
      if (!c.rights.can_reply) return this.fail(res, 400, 'Bad Request: not enough rights to reply on behalf of the business account');
      const last = bot.lastIncoming.get(`${connId}:${chatId}`);
      if (last === undefined || this.now() - last > 24 * 3600_000) return this.fail(res, 400, 'Bad Request: the chat has no incoming messages in the last 24 hours');
    } else {
      if (bot.blocked.has(chatId)) return this.fail(res, 403, 'Forbidden: bot was blocked by the user');
      if (!bot.started.has(chatId)) return this.fail(res, 403, "Forbidden: bot can't initiate conversation with a user");
    }
    const text = body.text !== undefined ? String(body.text) : undefined;
    const caption = body.caption !== undefined ? String(body.caption) : undefined;
    if (method === 'sendMessage') {
      if (!text) return this.fail(res, 400, 'Bad Request: message text is empty');
      if (text.length > 4096) return this.fail(res, 400, 'Bad Request: message is too long');
    }
    if (caption && caption.length > 1024) return this.fail(res, 400, 'Bad Request: message caption is too long');
    const reply = typeof body.reply_parameters === 'string' ? JSON.parse(body.reply_parameters) : body.reply_parameters;

    const msg: TgMessage = { message_id: this.msgId++, date: Math.floor(this.now() / 1000), chat: { id: chatId, type: 'private' }, from: this.botUser(bot) };
    if (connId) msg.business_connection_id = connId;
    if (text) msg.text = text;
    if (caption) msg.caption = caption;
    if (reply?.message_id) msg.reply_to_message = { message_id: Number(reply.message_id) };
    let file: SentRecord['file'];
    if (method !== 'sendMessage') {
      const kind = KIND_BY_METHOD[method]!;
      const uploaded = (req.files as Express.Multer.File[] | undefined)?.find((f) => f.fieldname === kind);
      const viaId = typeof body[kind] === 'string' ? this.files.get(body[kind]) : undefined;
      const src = uploaded ? { data: uploaded.buffer, mime: uploaded.mimetype, name: uploaded.originalname } : viaId;
      if (!src) return this.fail(res, 400, 'Bad Request: there is no media in the request');
      if (kind === 'photo' && src.data.length > 10 * 1024 * 1024) return this.fail(res, 400, 'Bad Request: file is too big');
      if (src.data.length > 50 * 1024 * 1024) return this.fail(res, 413, 'Request Entity Too Large');
      const file_id = uploaded ? this.storeFile(src.data, src.mime, src.name) : String(body[kind]);
      const base = { file_id, file_unique_id: `U${file_id.slice(4, 14)}`, file_size: src.data.length };
      if (kind === 'photo') msg.photo = [{ ...base, width: 1, height: 1 }]; else msg[kind as 'video' | 'audio' | 'document'] = { ...base, mime_type: src.mime, file_name: src.name };
      file = { name: src.name, mime: src.mime, size: src.data.length, viaFileId: !uploaded };
    }
    const markup = typeof body.reply_markup === 'string' ? JSON.parse(body.reply_markup) : body.reply_markup;
    this.sent.push({ token: bot.token, method, chatId, businessConnectionId: connId, text, caption, file, buttons: markup?.inline_keyboard, replyTo: reply?.message_id, messageId: msg.message_id, at: this.now() });
    return res.json({ ok: true, result: msg });
  }
}

/** Instance unique utilisée par le bac à sable de l'application. */
export const sandboxTelegram = new FakeTelegram();
