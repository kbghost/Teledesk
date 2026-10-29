import crypto from 'node:crypto';
import { Types } from 'mongoose';
import type { Request } from 'express';
import { ACCOUNT_MODE_LABELS, can, isDirectMode, type AccountMode } from '@teledesk/shared';
import { env } from '../config/env';
import { Conversation, TelegramAccount, User } from '../models';
import { TelegramApi, TelegramApiError } from '../providers/telegram/api';
import { userLogout, userSendCode, userVerify } from '../providers/telegram/user';
import { sandboxTelegram } from '../providers/telegram/fake';
import type { TgBusinessConnection } from '../providers/telegram/types';
import { emitToUsers } from '../sockets/io';
import type { Actor } from '../types/express';
import { decryptSecret, encryptSecret, type EncryptedBlob } from '../utils/crypto';
import { AppError, conflict, notFound } from '../utils/errors';
import { randomToken } from '../utils/helpers';
import { nowDate } from '../utils/clock';
import { agencySupervisorIds, assertAccountAccess, requirePermission, visibleAccountIds } from './access.service';
import { audit } from './audit.service';
import { telegramManager, hasPublicHttps } from './telegram/manager';
import { apiFor, loadAccountSecret } from './telegram/runtime';

type Doc = Record<string, any>;

const conn = (c?: Doc | null) =>
  c?.connectionId
    ? { userName: c.userName ?? '', userUsername: c.userUsername ?? '', isEnabled: !!c.isEnabled, canReply: !!c.canReply, canRead: !!c.canRead, receivedAt: c.receivedAt ?? null }
    : null;

/**
 * Compte tel que l'interface le reçoit. Jamais de jeton ni de secret de webhook.
 * Le Super admin voit tout ; les autres rôles ne voient que ce qui sert à travailler (nom, état, mode).
 */
export function serializeAccount(a: Doc, actor: Actor) {
  const owner = can(actor, 'accounts.manage');
  const supervisor = can(actor, 'inbox.supervise');
  return {
    id: String(a._id), label: a.label, mode: a.mode as AccountMode, modeLabel: ACCOUNT_MODE_LABELS[a.mode as AccountMode], status: a.status as string,
    statusDetail: owner || supervisor ? a.statusDetail ?? '' : '',
    botUsername: owner ? a.botUsername ?? null : null, botName: owner ? a.botName ?? null : null,
    botLink: owner && a.botUsername && a.mode !== 'SANDBOX' ? `https://t.me/${a.botUsername}` : null,
    transport: owner ? (a.transport as string) : null,
    business: owner || supervisor ? conn(a.business) : null,
    pendingBusiness: owner ? conn(a.pendingBusiness) : null,
    modelUserId: owner && a.modelUserId ? String(a.modelUserId) : null, modelCanView: owner ? !!a.modelCanView : null,
    connectedAt: a.connectedAt ?? null, lastEventAt: a.lastEventAt ?? null,
    listening: owner ? telegramManager.isRunning(String(a._id)) || a.transport === 'WEBHOOK' : null,
    canManage: owner,
  };
}

export async function listAccounts(actor: Actor) {
  const ids = actor.role === 'MODEL' ? [] : await visibleAccountIds(actor);
  const accounts = await TelegramAccount.find({ _id: { $in: ids }, agencyId: actor.agencyId, deletedAt: null }).sort({ createdAt: 1 }).lean();
  return accounts.map((a) => serializeAccount(a, actor));
}

/** Comptes dont le modèle est le titulaire (page « Mon compte » du modèle). */
export async function listModelAccounts(actor: Actor) {
  const accounts = await TelegramAccount.find({ agencyId: actor.agencyId, modelUserId: actor.id, deletedAt: null }).sort({ createdAt: 1 }).lean();
  return accounts.map((a) => ({ id: String(a._id), label: a.label, status: a.status, modelCanView: !!a.modelCanView }));
}

async function loadOwned(actor: Actor, id: string) {
  requirePermission(actor, 'accounts.manage');
  const a = await TelegramAccount.findOne({ _id: id, agencyId: actor.agencyId, deletedAt: null });
  if (!a) throw notFound('Compte introuvable');
  return a;
}

const ownerIds = (agencyId: string) => agencySupervisorIds(agencyId);
const notify = async (a: Doc) => emitToUsers(await ownerIds(String(a.agencyId)), 'account:updated', { id: String(a._id) });

/** Traduit une erreur de l'API Telegram en erreur lisible pour l'interface. */
function telegramFailure(e: unknown): AppError {
  if (e instanceof TelegramApiError) {
    if (e.isAuth) return new AppError(400, 'BAD_TOKEN', 'Telegram refuse ce jeton : copiez-le de nouveau depuis @BotFather');
    if (e.isNetwork) return new AppError(502, 'TELEGRAM_UNREACHABLE', 'Telegram est injoignable depuis le serveur. Réessayez dans un instant.');
    return new AppError(502, 'TELEGRAM_ERROR', `Telegram a répondu : ${e.description}`);
  }
  return e as AppError;
}

export async function connectAccount(actor: Actor, input: { label: string; mode: AccountMode; token?: string; modelUserId?: string }, req: Request) {
  requirePermission(actor, 'accounts.manage');
  let modelUserId: string | undefined;
  if (input.modelUserId) {
    const m = await User.findOne({ _id: input.modelUserId, agencyId: actor.agencyId, agencyRole: 'MODEL', deletedAt: null }).select('_id').lean();
    if (!m) throw new AppError(400, 'BAD_MODEL', 'Le modèle choisi est introuvable dans votre agence');
    modelUserId = String(m._id);
  }

  if (input.mode === 'USER') return connectUserAccount(actor, input, modelUserId, req);

  let token = input.token ?? '';
  let me: { id: number; username?: string; first_name?: string; can_connect_to_business?: boolean };
  if (input.mode === 'SANDBOX') {
    if (!env.ALLOW_SANDBOX) throw new AppError(400, 'SANDBOX_DISABLED', 'Le bac à sable est désactivé sur ce serveur');
    const slug = input.label.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'modele';
    const bot = sandboxTelegram.registerBot(undefined, { username: `${slug}_demo_bot`, name: input.label, businessMode: true });
    token = bot.token;
    me = { id: bot.id, username: bot.username, first_name: input.label, can_connect_to_business: true };
  } else {
    try { me = await new TelegramApi(token).getMe(); } catch (e) { throw telegramFailure(e); }
    if (input.mode === 'BUSINESS' && me.can_connect_to_business === false) {
      throw new AppError(400, 'BOT_NOT_BUSINESS', 'Ce bot n’accepte pas les connexions Business : dans @BotFather, ouvrez Bot Settings › Business Mode et activez-le.');
    }
  }
  if (await TelegramAccount.exists({ botId: String(me.id), deletedAt: null })) throw conflict('BOT_IN_USE', 'Ce bot est déjà connecté à un compte');

  const _id = new Types.ObjectId();
  const account = await TelegramAccount.create({
    _id, agencyId: actor.agencyId, label: input.label, mode: input.mode, botId: String(me.id), botUsername: me.username ?? '', botName: me.first_name ?? '',
    botBusinessReady: me.can_connect_to_business, secretEnc: encryptSecret(token, `account:${_id}`), webhookSecret: randomToken(24),
    transport: input.mode !== 'SANDBOX' && hasPublicHttps() ? 'WEBHOOK' : 'POLLING', modelUserId,
    status: input.mode === 'BOT' ? 'CONNECTED' : 'PENDING', connectedAt: input.mode === 'BOT' ? nowDate() : undefined,
    statusDetail: input.mode === 'BOT' ? '' : 'En attente : le modèle doit connecter le bot dans Telegram Business, puis vous confirmez ici.',
  });
  if (env.TELEGRAM_AUTOSTART) await telegramManager.start(String(_id)).catch(() => undefined);
  await audit(req, actor.agencyId, actor.id, 'ACCOUNT_CONNECTED', 'TelegramAccount', String(_id), { mode: input.mode, label: input.label });
  return serializeAccount(account.toObject(), actor);
}

/** Compte personnel : crée le compte en attente, demande à Telegram d'envoyer le code de connexion au numéro. */
async function connectUserAccount(actor: Actor, input: { label: string; phone?: string }, modelUserId: string | undefined, req: Request) {
  if (!env.TELEGRAM_API_ID || !env.TELEGRAM_API_HASH) throw new AppError(400, 'USER_MODE_UNAVAILABLE', 'Le mode « compte personnel » n’est pas activé sur ce serveur (TELEGRAM_API_ID / TELEGRAM_API_HASH).');
  const phone = input.phone!;
  if (await TelegramAccount.exists({ phone, deletedAt: null })) throw conflict('PHONE_IN_USE', 'Ce numéro est déjà connecté à un compte');
  const _id = new Types.ObjectId();
  const account = await TelegramAccount.create({
    _id, agencyId: actor.agencyId, label: input.label, mode: 'USER', botId: `pending:${_id}`, phone, secretEnc: encryptSecret('pending', `account:${_id}`), modelUserId,
    transport: 'POLLING', status: 'PENDING', statusDetail: 'Code envoyé dans Telegram : saisissez-le pour terminer la connexion.',
  });
  try { await userSendCode(String(_id), phone); }
  catch (e) { await TelegramAccount.deleteOne({ _id }); throw telegramFailure(e); }
  await audit(req, actor.agencyId, actor.id, 'ACCOUNT_CONNECTED', 'TelegramAccount', String(_id), { mode: 'USER', label: input.label });
  return serializeAccount(account.toObject(), actor);
}

/** Redemande un code (le précédent a expiré ou n'est pas arrivé). */
export async function userRequestCode(actor: Actor, id: string) {
  const a = await loadOwned(actor, id);
  if (a.mode !== 'USER' || a.status !== 'PENDING') throw new AppError(400, 'NOT_APPLICABLE', 'Ce compte n’attend pas de code');
  const full = await TelegramAccount.findById(id).select('+phone');
  try { await userSendCode(id, full!.phone!); } catch (e) { throw telegramFailure(e); }
  return { ok: true };
}

/** Valide le code reçu dans Telegram (puis le mot de passe de double authentification s'il existe) et active l'écoute. */
export async function userVerifyLogin(actor: Actor, id: string, input: { code: string; password?: string }, req: Request) {
  const a = await loadOwned(actor, id);
  if (a.mode !== 'USER' || a.status !== 'PENDING') throw new AppError(400, 'NOT_APPLICABLE', 'Ce compte n’attend pas de code');
  let r;
  try { r = await userVerify(id, input.code, input.password); } catch (e) { throw telegramFailure(e); }
  if (r.state === 'PASSWORD_NEEDED') return { state: 'PASSWORD_NEEDED' as const };
  const taken = await TelegramAccount.exists({ botId: String(r.me.id), deletedAt: null, _id: { $ne: id } });
  if (taken) { await userLogout(id, r.session); throw conflict('BOT_IN_USE', 'Ce compte Telegram est déjà connecté'); }
  await TelegramAccount.updateOne({ _id: id }, { $set: {
    botId: String(r.me.id), botUsername: r.me.username ?? '', botName: [r.me.first_name, r.me.last_name].filter(Boolean).join(' '), secretEnc: encryptSecret(r.session, `account:${id}`),
    status: 'CONNECTED', statusDetail: '', connectedAt: nowDate(),
  } });
  await telegramManager.start(id).catch(() => undefined);
  await audit(req, actor.agencyId, actor.id, 'ACCOUNT_USER_LOGIN', 'TelegramAccount', id, { telegramId: r.me.id });
  return { state: 'OK' as const, account: await getAccount(actor, id) };
}

export async function getAccount(actor: Actor, id: string) {
  await assertAccountAccess(actor, id);
  const a = await TelegramAccount.findOne({ _id: id, agencyId: actor.agencyId, deletedAt: null }).lean();
  if (!a) throw notFound('Compte introuvable');
  return serializeAccount(a, actor);
}

export async function updateAccount(actor: Actor, id: string, patch: { label?: string; modelUserId?: string | null; modelCanView?: boolean }, req: Request) {
  const a = await loadOwned(actor, id);
  if (patch.label !== undefined) a.label = patch.label;
  if (patch.modelCanView !== undefined) a.modelCanView = patch.modelCanView;
  if (patch.modelUserId !== undefined) {
    if (patch.modelUserId === null) a.modelUserId = undefined as never;
    else {
      const m = await User.findOne({ _id: patch.modelUserId, agencyId: actor.agencyId, agencyRole: 'MODEL', deletedAt: null }).select('_id').lean();
      if (!m) throw new AppError(400, 'BAD_MODEL', 'Le modèle choisi est introuvable dans votre agence');
      a.modelUserId = m._id;
    }
  }
  await a.save();
  await audit(req, actor.agencyId, actor.id, 'ACCOUNT_UPDATED', 'TelegramAccount', id, patch as Record<string, unknown>);
  return serializeAccount(a.toObject(), actor);
}

/**
 * Décision du Super admin sur une connexion Business reçue de Telegram. Le nom d'un bot est public : tant que le Super admin n'a
 * pas confirmé que la connexion vient bien du bon compte, aucun message n'est lu.
 */
export async function decideBusiness(actor: Actor, id: string, decision: 'APPROVE' | 'REJECT', req: Request) {
  const a = await loadOwned(actor, id);
  const pending = a.pendingBusiness;
  if (!pending?.connectionId) throw new AppError(409, 'NO_PENDING', 'Aucune connexion en attente');
  if (decision === 'REJECT') {
    a.set('pendingBusiness', undefined);
    a.statusDetail = a.business?.connectionId ? a.statusDetail : 'Connexion refusée. Le modèle peut reconnecter le bot dans Telegram Business.';
    await a.save();
    await audit(req, actor.agencyId, actor.id, 'BUSINESS_REJECTED', 'TelegramAccount', id, { telegramUser: pending.userId });
    return serializeAccount(a.toObject(), actor);
  }
  // Un compte ne change pas de titulaire : les conversations existantes appartiennent au titulaire d'origine.
  if (a.business?.userId && a.business.userId !== pending.userId && (await Conversation.exists({ accountId: a._id, deletedAt: null }))) {
    throw new AppError(409, 'DIFFERENT_OWNER', 'Cette connexion vient d’un autre compte Telegram que celui d’origine. Créez un nouveau compte dans TeleDesk pour ce modèle.');
  }
  let fresh: TgBusinessConnection | null = null;
  const secret = await loadAccountSecret(id);
  if (secret && a.mode !== 'SANDBOX') {
    try { fresh = await apiFor(secret).getBusinessConnection(pending.connectionId); }
    catch (e) {
      if (e instanceof TelegramApiError && e.code === 400) throw new AppError(409, 'CONNECTION_GONE', 'Cette connexion n’existe plus dans Telegram : demandez au modèle de la recréer.');
      throw telegramFailure(e);
    }
  }
  const rights = fresh?.rights;
  const next = {
    connectionId: pending.connectionId, userId: pending.userId, userName: pending.userName, userUsername: pending.userUsername, userChatId: pending.userChatId,
    isEnabled: fresh ? fresh.is_enabled : pending.isEnabled, canReply: fresh ? !!(rights?.can_reply ?? fresh.can_reply) : pending.canReply,
    canRead: fresh ? !!rights?.can_read_messages : pending.canRead, receivedAt: pending.receivedAt,
  };
  a.set('business', next);
  a.set('pendingBusiness', undefined);
  a.status = next.isEnabled ? 'CONNECTED' : 'PENDING';
  a.statusDetail = !next.isEnabled ? 'La connexion est désactivée dans Telegram.' : next.canReply ? '' : 'Le droit « Répondre aux messages » n’est pas accordé au bot dans Telegram Business.';
  a.connectedAt ??= nowDate();
  await a.save();
  await audit(req, actor.agencyId, actor.id, 'BUSINESS_APPROVED', 'TelegramAccount', id, { telegramUser: pending.userId });
  return serializeAccount(a.toObject(), actor);
}

/** « Tester la connexion » : relit l'état réel chez Telegram et renvoie une liste de contrôles lisibles. */
export async function checkAccount(actor: Actor, id: string) {
  const a = await loadOwned(actor, id);
  const secret = await loadAccountSecret(id);
  const checks: Array<{ key: string; ok: boolean; detail: string }> = [];
  if (!secret) throw notFound('Compte introuvable');
  try {
    const me = await apiFor(secret).getMe();
    checks.push({ key: 'token', ok: true, detail: `Jeton valide (@${me.username ?? 'bot'})` });
    a.botUsername = me.username ?? a.botUsername; a.botName = me.first_name ?? a.botName; a.botBusinessReady = me.can_connect_to_business;
    if (a.status === 'ERROR') { a.status = a.business?.connectionId ? 'CONNECTED' : isDirectMode(a.mode) ? 'CONNECTED' : 'PENDING'; a.statusDetail = ''; }
    if (!isDirectMode(a.mode)) checks.push({ key: 'businessMode', ok: me.can_connect_to_business !== false, detail: me.can_connect_to_business === false ? 'Business Mode désactivé dans @BotFather' : 'Business Mode activé' });
  } catch (e) {
    const f = telegramFailure(e);
    checks.push({ key: 'token', ok: false, detail: f.message });
    if (e instanceof TelegramApiError && e.isAuth) { a.status = 'ERROR'; a.statusDetail = 'Jeton refusé par Telegram : remplacez-le dans les paramètres du compte.'; }
    await a.save();
    return { account: serializeAccount(a.toObject(), actor), checks };
  }
  if (!isDirectMode(a.mode)) {
    const c = a.business;
    if (!c?.connectionId) checks.push({ key: 'connection', ok: false, detail: a.pendingBusiness?.connectionId ? 'Connexion reçue : à confirmer par le Super admin' : 'Aucun compte Telegram n’a encore connecté ce bot' });
    else {
      let live: TgBusinessConnection | null = null;
      if (a.mode !== 'SANDBOX') { try { live = await apiFor(secret).getBusinessConnection(c.connectionId); } catch { /* état conservé */ } }
      if (live) {
        a.set('business.isEnabled', live.is_enabled); a.set('business.canReply', !!(live.rights?.can_reply ?? live.can_reply)); a.set('business.canRead', !!live.rights?.can_read_messages);
        a.status = live.is_enabled ? 'CONNECTED' : 'PENDING';
      }
      checks.push({ key: 'connection', ok: !!a.business?.isEnabled, detail: a.business?.isEnabled ? 'Connexion Business active' : 'Connexion désactivée dans Telegram' });
      checks.push({ key: 'reply', ok: !!a.business?.canReply, detail: a.business?.canReply ? 'Droit de répondre accordé' : 'Droit « Répondre aux messages » manquant' });
    }
  }
  const listening = a.transport === 'WEBHOOK' || telegramManager.isRunning(id);
  checks.push({ key: 'listening', ok: listening, detail: listening ? (a.transport === 'WEBHOOK' ? 'Webhook actif' : 'Écoute active (long polling)') : 'Écoute arrêtée' });
  if (!listening && env.TELEGRAM_AUTOSTART && (a.status as string) !== 'ERROR') await telegramManager.start(id).catch(() => undefined);
  await a.save();
  return { account: serializeAccount(a.toObject(), actor), checks };
}

export async function replaceToken(actor: Actor, id: string, token: string, req: Request) {
  const a = await loadOwned(actor, id);
  if (a.mode === 'SANDBOX' || a.mode === 'USER') throw new AppError(400, 'NOT_APPLICABLE', 'Ce compte n’a pas de jeton à remplacer (compte personnel : reconnectez-le avec le numéro)');
  let me;
  try { me = await new TelegramApi(token).getMe(); } catch (e) { throw telegramFailure(e); }
  if (String(me.id) !== a.botId) throw new AppError(409, 'DIFFERENT_BOT', 'Ce jeton appartient à un autre bot. Pour changer de bot, créez un nouveau compte.');
  a.secretEnc = encryptSecret(token, `account:${a._id}`) as never;
  if (a.status === 'ERROR') { a.status = isDirectMode(a.mode) || a.business?.connectionId ? 'CONNECTED' : 'PENDING'; a.statusDetail = ''; }
  await a.save();
  telegramManager.stop(id);
  if (env.TELEGRAM_AUTOSTART) await telegramManager.start(id).catch(() => undefined);
  await audit(req, actor.agencyId, actor.id, 'ACCOUNT_TOKEN_REPLACED', 'TelegramAccount', id);
  return serializeAccount(a.toObject(), actor);
}

/** Déconnexion : l'écoute s'arrête, le jeton est effacé. L'historique des conversations est conservé (supprimable séparément). */
export async function disconnectAccount(actor: Actor, id: string, req: Request) {
  const a = await loadOwned(actor, id);
  telegramManager.stop(id);
  const secret = await loadAccountSecret(id);
  if (secret && a.mode === 'USER') { try { await userLogout(id, decryptSecret(secret.secretEnc as EncryptedBlob, `account:${id}`)); } catch { /* oublié de toute façon */ } }
  else if (secret && a.mode !== 'SANDBOX') { try { await apiFor(secret).deleteWebhook(); } catch { /* le jeton est effacé de toute façon */ } }
  await TelegramAccount.updateOne({ _id: id }, { $set: { status: 'DISCONNECTED', deletedAt: nowDate(), statusDetail: 'Compte déconnecté' }, $unset: { secretEnc: 1, webhookSecret: 1 } });
  await User.updateMany({ agencyId: actor.agencyId, accountIds: id }, { $pull: { accountIds: id } });
  await audit(req, actor.agencyId, actor.id, 'ACCOUNT_DISCONNECTED', 'TelegramAccount', id, { label: a.label });
}

/** Empreinte courte et stable d'un identifiant d'événement : utilisée pour nommer les faux contacts du bac à sable. */
export const fakeId = (seed: string) => 100_000_000 + (parseInt(crypto.createHash('sha1').update(seed).digest('hex').slice(0, 7), 16) % 800_000_000);
