import { isDirectMode, type MessageType } from '@teledesk/shared';
import { Conversation, Message } from '../../models';
import { agencySupervisorIds } from '../access.service';
import type { TgBusinessConnection, TgBusinessMessagesDeleted, TgChat, TgChatMemberUpdated, TgMessage, TgUpdate, TgUser } from '../../providers/telegram/types';
import { emitToUsers } from '../../sockets/io';
import { nowDate } from '../../utils/clock';
import { dayKey } from '../../utils/helpers';
import { bumpStat } from '../stats.service';
import { publishConversation, publishMessage } from './audience';
import { fetchIncomingAttachment } from './media';
import type { loadAccountSecret } from './runtime';

export type AccountDoc = NonNullable<Awaited<ReturnType<typeof loadAccountSecret>>>;
type Person = Pick<TgUser, 'id'> & Partial<Pick<TgUser, 'first_name' | 'last_name' | 'username' | 'language_code'>>;

/** Téléchargements de pièces jointes en cours (permet aux tests et à l'arrêt propre d'attendre la fin). */
const pending = new Set<Promise<void>>();
export const ingestIdle = async () => { while (pending.size) await Promise.all([...pending]); };

const fullName = (u: Pick<TgUser, 'first_name' | 'last_name'>) => [u.first_name, u.last_name].filter(Boolean).join(' ');

interface Parsed {
  type: MessageType; text: string; preview: string;
  attachment?: { kind: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE'; tgFileId: string; tgFileUniqueId?: string; mime?: string; size?: number; name?: string; width?: number; height?: number };
}
/** Traduit un message Telegram en contenu stocké. Les types non gérés (sticker, sondage…) restent visibles sous forme de texte. */
export function parseMessage(msg: TgMessage): Parsed {
  const text = msg.text ?? msg.caption ?? '';
  if (msg.photo?.length) {
    const p = msg.photo[msg.photo.length - 1]!;
    return { type: 'PHOTO', text, preview: text || '📷 Photo', attachment: { kind: 'IMAGE', tgFileId: p.file_id, tgFileUniqueId: p.file_unique_id, size: p.file_size, width: p.width, height: p.height, mime: 'image/jpeg' } };
  }
  const file = (kind: 'VIDEO' | 'AUDIO' | 'FILE', f: NonNullable<TgMessage['video']>) =>
    ({ kind, tgFileId: f.file_id, tgFileUniqueId: f.file_unique_id, mime: f.mime_type, size: f.file_size, name: f.file_name, width: f.width, height: f.height });
  if (msg.video) return { type: 'VIDEO', text, preview: text || '🎥 Vidéo', attachment: file('VIDEO', msg.video) };
  if (msg.voice) return { type: 'VOICE', text, preview: '🎤 Message vocal', attachment: file('AUDIO', msg.voice) };
  if (msg.audio) return { type: 'AUDIO', text, preview: text || '🎵 Audio', attachment: file('AUDIO', msg.audio) };
  if (msg.document) return { type: 'DOCUMENT', text, preview: text || `📎 ${msg.document.file_name ?? 'Document'}`, attachment: file('FILE', msg.document) };
  if (msg.sticker) return { type: 'OTHER', text: msg.sticker.emoji ?? '', preview: `${msg.sticker.emoji ?? ''} Sticker`.trim() };
  if (text) return { type: 'TEXT', text, preview: text };
  return { type: 'OTHER', text: '', preview: '[Message non pris en charge]' };
}

const ownerIds = (agencyId: unknown) => agencySupervisorIds(agencyId);
const notifyOwners = async (account: AccountDoc) => emitToUsers(await ownerIds(account.agencyId), 'account:updated', { id: String(account._id) });

// ───────────── Connexion Business ─────────────
/**
 * Telegram prévient le bot quand un compte le connecte (ou modifie/retire la connexion). Le nom d'un bot est public :
 * n'importe quel abonné Telegram Business pourrait le connecter. La connexion reste donc EN ATTENTE jusqu'à ce que le
 * Super admin la confirme ; tant qu'elle n'est pas confirmée, aucun message n'est lu.
 */
async function onBusinessConnection(account: AccountDoc, bc: TgBusinessConnection) {
  if (isDirectMode(account.mode)) return;
  const conn = {
    connectionId: bc.id, userId: String(bc.user.id), userName: fullName(bc.user), userUsername: bc.user.username ?? '',
    userChatId: bc.user_chat_id ? String(bc.user_chat_id) : undefined, isEnabled: bc.is_enabled,
    canReply: !!(bc.rights?.can_reply ?? bc.can_reply), canRead: !!bc.rights?.can_read_messages, receivedAt: new Date(bc.date * 1000),
  };
  if (account.business?.connectionId === bc.id) {
    account.set('business', conn);
    account.status = conn.isEnabled ? 'CONNECTED' : 'PENDING';
    account.statusDetail = conn.isEnabled
      ? (conn.canReply ? '' : 'Le droit « Répondre aux messages » n’est pas accordé au bot dans Telegram Business.')
      : 'La connexion a été désactivée dans Telegram (Paramètres › Telegram Business › Chatbots).';
    if (conn.isEnabled) account.connectedAt ??= nowDate();
  } else if (conn.isEnabled) {
    account.set('pendingBusiness', conn);
    account.statusDetail = `Connexion reçue de ${conn.userName || 'un compte Telegram'}${conn.userUsername ? ` (@${conn.userUsername})` : ''} : à confirmer par le Super admin.`;
  } else if (account.pendingBusiness?.connectionId === bc.id) {
    account.set('pendingBusiness', undefined);
    account.statusDetail = 'La connexion en attente a été retirée dans Telegram.';
  } else return;
  account.lastEventAt = nowDate();
  await account.save();
  await notifyOwners(account);
}

// ───────────── Conversations ─────────────
async function upsertConversation(account: AccountDoc, chatId: string, who: Person | TgChat, channel: 'BUSINESS' | 'BOT', connectionId: string | undefined, at: Date) {
  let conv = await Conversation.findOne({ accountId: account._id, chatId });
  if (conv) return { conv, created: false };
  try {
    conv = await Conversation.create({
      agencyId: account.agencyId, accountId: account._id, chatId, channel, businessConnectionId: connectionId, firstContactAt: at, lastMessageAt: at,
      contact: { tgUserId: chatId, firstName: who.first_name ?? '', lastName: who.last_name ?? '', username: who.username ?? '', languageCode: (who as Person).language_code ?? '' },
    });
    return { conv, created: true };
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
    return { conv: (await Conversation.findOne({ accountId: account._id, chatId }))!, created: false };
  }
}

interface Stored { direction: 'IN' | 'OUT'; source: 'FAN' | 'TELEGRAM_APP'; msg: TgMessage; who: Person | TgChat; channel: 'BUSINESS' | 'BOT'; connectionId?: string }

async function store(account: AccountDoc, chatId: string, s: Stored) {
  const at = new Date(s.msg.date * 1000);
  const parsed = parseMessage(s.msg);
  const { conv, created } = await upsertConversation(account, chatId, s.who, s.channel, s.connectionId, at);
  const dedupeKey = `${account._id}:${chatId}:${s.msg.message_id}`;
  let replyTo: unknown;
  if (s.msg.reply_to_message) replyTo = (await Message.findOne({ dedupeKey: `${account._id}:${chatId}:${s.msg.reply_to_message.message_id}` }).select('_id').lean())?._id;
  let message;
  try {
    message = await Message.create({
      agencyId: account.agencyId, conversationId: conv._id, accountId: account._id, direction: s.direction, type: parsed.type, text: parsed.text,
      attachment: parsed.attachment, source: s.source, telegramMessageId: s.msg.message_id, dedupeKey,
      status: s.direction === 'IN' ? 'RECEIVED' : 'SENT', tgDate: at, replyToMessageId: replyTo,
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return; // rejeu du même évènement : déjà traité
    throw e;
  }
  const set: Record<string, unknown> = { lastMessageAt: at, lastMessagePreview: parsed.preview.slice(0, 120), lastMessageDirection: s.direction };
  const inc: Record<string, number> = { messagesCount: 1 };
  const unset: Record<string, 1> = {};
  if (s.direction === 'IN') {
    Object.assign(set, {
      lastIncomingAt: at, hasIncoming: true, status: 'OPEN', 'contact.firstName': s.who.first_name ?? '', 'contact.lastName': s.who.last_name ?? '', 'contact.username': s.who.username ?? '',
    });
    inc.unreadCount = 1;
  } else { set.unreadCount = 0; unset.awaitingSince = 1; }
  await Conversation.updateOne({ _id: conv._id }, { $set: set, $inc: inc, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  if (s.direction === 'IN') await Conversation.updateOne({ _id: conv._id, awaitingSince: null }, { $set: { awaitingSince: at } });
  await bumpStat(account.agencyId, account._id, null, s.direction === 'IN' ? { messagesIn: 1, newConversations: created ? 1 : 0 } : { messagesOut: 1 }, dayKey(at));

  await publishMessage('message:new', conv, message.toObject(), { created });
  if (parsed.attachment) {
    const job = fetchIncomingAttachment(String(account._id), String(message._id)).finally(() => pending.delete(job));
    pending.add(job);
  }
}

async function onBusinessMessage(account: AccountDoc, msg: TgMessage, edited: boolean) {
  const conn = account.business;
  if (isDirectMode(account.mode) || !conn?.isEnabled || conn.connectionId !== msg.business_connection_id) return;
  if (msg.chat.type !== 'private') return;
  if (msg.sender_business_bot && String(msg.sender_business_bot.id) === account.botId) return; // écho d'un envoi du CRM
  const chatId = String(msg.chat.id);
  if (chatId === conn.userId) return; // « messages enregistrés » du titulaire
  if (edited) return onEdit(account, chatId, msg);
  const fromOwner = String(msg.from?.id) === conn.userId;
  await store(account, chatId, {
    direction: fromOwner ? 'OUT' : 'IN', source: fromOwner ? 'TELEGRAM_APP' : 'FAN', msg, who: fromOwner ? msg.chat : (msg.from ?? msg.chat), channel: 'BUSINESS', connectionId: conn.connectionId,
  });
}

async function onEdit(account: AccountDoc, chatId: string, msg: TgMessage) {
  const m = await Message.findOne({ dedupeKey: `${account._id}:${chatId}:${msg.message_id}` });
  if (!m) return;
  const parsed = parseMessage(msg);
  m.text = parsed.text;
  m.editedAt = nowDate();
  await m.save();
  const conv = await Conversation.findById(m.conversationId).lean();
  if (conv) await publishMessage('message:updated', conv, m.toObject());
}

async function onBusinessDeleted(account: AccountDoc, d: TgBusinessMessagesDeleted) {
  if (account.business?.connectionId !== d.business_connection_id) return;
  const keys = d.message_ids.map((id) => `${account._id}:${d.chat.id}:${id}`);
  await Message.updateMany({ dedupeKey: { $in: keys } }, { $set: { deletedByContactAt: nowDate() } });
  const messages = await Message.find({ dedupeKey: { $in: keys } });
  const conv = messages[0] && (await Conversation.findById(messages[0].conversationId).lean());
  if (conv) for (const m of messages) await publishMessage('message:updated', conv, m.toObject());
}

/** Mode « Bot Telegram » : le contact écrit directement au bot. */
async function onDirectMessage(account: AccountDoc, msg: TgMessage) {
  if (!isDirectMode(account.mode) || msg.chat.type !== 'private' || msg.from?.is_bot) return;
  await store(account, String(msg.chat.id), { direction: 'IN', source: 'FAN', msg, who: msg.from ?? msg.chat, channel: 'BOT' });
}

async function onMyChatMember(account: AccountDoc, u: TgChatMemberUpdated) {
  if (!isDirectMode(account.mode) || u.chat.type !== 'private') return;
  const status = u.new_chat_member.status;
  if (status !== 'kicked' && status !== 'member') return;
  const conv = await Conversation.findOneAndUpdate({ accountId: account._id, chatId: String(u.chat.id) }, { $set: { blocked: status === 'kicked' } }, { new: true });
  if (conv) await publishConversation(String(conv._id));
}

/** Point d'entrée unique : tout évènement reçu (polling ou webhook) passe ici. Rejouable sans effet de bord (déduplication). */
export async function ingestUpdate(account: AccountDoc, u: TgUpdate): Promise<void> {
  if (u.business_connection) return onBusinessConnection(account, u.business_connection);
  if (u.business_message) return onBusinessMessage(account, u.business_message, false);
  if (u.edited_business_message) return onBusinessMessage(account, u.edited_business_message, true);
  if (u.deleted_business_messages) return onBusinessDeleted(account, u.deleted_business_messages);
  if (u.message) return onDirectMessage(account, u.message);
  if (u.my_chat_member) return onMyChatMember(account, u.my_chat_member);
}
