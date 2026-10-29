import { Schema, model } from 'mongoose';
import { CONVERSATION_STATUSES, MESSAGE_DIRECTIONS, MESSAGE_SOURCES, MESSAGE_STATUSES, MESSAGE_TYPES } from '@teledesk/shared';
import { oid, timestamps } from './base';

const conversation = new Schema(
  {
    agencyId: oid('Agency', true),
    accountId: oid('TelegramAccount', true),
    chatId: { type: String, required: true }, // identifiant Telegram du contact (discussion privée)
    contact: {
      tgUserId: { type: String, required: true },
      firstName: { type: String, default: '' },
      lastName: { type: String, default: '' },
      username: { type: String, default: '' },
      languageCode: { type: String, default: '' },
    },
    /** BUSINESS : chat du compte du modèle (via business_connection_id) · BOT : discussion avec le bot. */
    channel: { type: String, enum: ['BUSINESS', 'BOT'], required: true },
    businessConnectionId: String,
    status: { type: String, enum: CONVERSATION_STATUSES, default: 'OPEN' },
    assignedTo: { ...oid('User'), default: null },
    assignedAt: Date,
    tagIds: [oid('Tag')],
    lastMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: { type: String, default: '' },
    lastMessageDirection: { type: String, enum: MESSAGE_DIRECTIONS },
    /** Date du premier message du contact resté sans réponse (sert au calcul du temps de réponse). */
    awaitingSince: Date,
    unreadCount: { type: Number, default: 0 },
    messagesCount: { type: Number, default: 0 },
    /** Dernier message du contact : la fenêtre de réponse de 24 h (Telegram Business) se calcule à partir de cette date. */
    lastIncomingAt: Date,
    /** Le contact a écrit en premier : condition pour qu'un opérateur puisse répondre (pas de prospection à froid). */
    hasIncoming: { type: Boolean, default: false },
    blocked: { type: Boolean, default: false },
    totalSpentCents: { type: Number, default: 0 },
    salesCount: { type: Number, default: 0 },
    firstContactAt: { type: Date, default: Date.now },
    deletedAt: Date,
  },
  timestamps,
);
conversation.index({ accountId: 1, chatId: 1 }, { unique: true });
conversation.index({ agencyId: 1, accountId: 1, status: 1, lastMessageAt: -1 });
conversation.index({ assignedTo: 1, status: 1, lastMessageAt: -1 });
conversation.index({ agencyId: 1, totalSpentCents: -1 });
export const Conversation = model('Conversation', conversation);

const attachment = new Schema(
  {
    key: String, // clé de stockage privé (absente tant que le fichier reçu n'a pas été téléchargé depuis Telegram)
    tgFileId: String,
    tgFileUniqueId: String,
    thumbKey: String,
    kind: { type: String, enum: ['IMAGE', 'VIDEO', 'AUDIO', 'FILE'], required: true },
    mime: String,
    size: Number,
    name: String,
    width: Number,
    height: Number,
    /** Raison pour laquelle le fichier n'est pas consultable (trop volumineux, type refusé, téléchargement impossible). */
    unavailable: String,
  },
  { _id: false },
);
const message = new Schema(
  {
    agencyId: oid('Agency', true),
    conversationId: oid('Conversation', true),
    accountId: oid('TelegramAccount', true),
    direction: { type: String, enum: MESSAGE_DIRECTIONS, required: true },
    type: { type: String, enum: MESSAGE_TYPES, default: 'TEXT' },
    text: { type: String, default: '' },
    attachment: attachment,
    assetId: oid('Asset'),
    sentBy: oid('User'), // opérateur à l'origine de l'envoi (absent pour le contact et pour l'appli Telegram)
    source: { type: String, enum: MESSAGE_SOURCES, required: true },
    telegramMessageId: Number,
    /** « compte:contact:idTelegram » : clé unique pour dédupliquer les rejeux de webhook et les doublons d'événements. */
    dedupeKey: { type: String },
    status: { type: String, enum: MESSAGE_STATUSES, required: true },
    error: String,
    errorCode: String,
    tgDate: Date,
    attempts: { type: Number, default: 0 },
    /** PPV : tant que l'état est LOCKED, seul un aperçu flouté + le prix a été envoyé sur Telegram ; l'original n'est transmis qu'au déblocage. */
    ppv: {
      type: new Schema(
        {
          priceCents: { type: Number, required: true },
          state: { type: String, enum: ['LOCKED', 'UNLOCKING', 'UNLOCKED'], required: true },
          unlockMessageId: oid('Message'),
          unlockedAt: Date,
          unlockedBy: oid('User'),
          /** MANUAL : déblocage par un opérateur ; CHECKOUT : le fan a payé sur la page de paiement. */
          via: { type: String, enum: ['MANUAL', 'CHECKOUT'], default: 'MANUAL' },
          saleId: oid('Sale'),
        },
        { _id: false },
      ),
    },
    /** Message de déblocage : renvoie l'original du PPV référencé. */
    unlocksMessageId: oid('Message'),
    replyToMessageId: oid('Message'),
    /** Numéro Telegram du message auquel on répond (renseigné pour un envoi en attente). */
    tgReplyTo: Number,
    editedAt: Date,
    /** Le contact a supprimé le message dans Telegram : on le garde (historique de l'agence) en le signalant. */
    deletedByContactAt: Date,
    responseMs: Number,
  },
  timestamps,
);
message.index({ conversationId: 1, _id: -1 });
message.index({ agencyId: 1, sentBy: 1, createdAt: -1 });
message.index({ dedupeKey: 1 }, { unique: true, sparse: true });
/** Un seul message de déblocage par PPV (verrou atomique contre les doubles déblocages). */
message.index({ unlocksMessageId: 1 }, { unique: true, sparse: true });
message.index({ status: 1, updatedAt: 1 });
message.index({ 'attachment.key': 1 }, { sparse: true });
export const Message = model('Message', message);

const note = new Schema(
  {
    agencyId: oid('Agency', true),
    conversationId: oid('Conversation', true),
    authorId: oid('User', true),
    text: { type: String, required: true, maxlength: 2000 },
  },
  timestamps,
);
note.index({ conversationId: 1, _id: -1 });
export const Note = model('Note', note);

const tag = new Schema(
  {
    agencyId: oid('Agency', true),
    name: { type: String, required: true, trim: true, maxlength: 24 },
    nameLower: { type: String, required: true },
    color: { type: String, default: '#6B7280' },
    createdBy: oid('User'),
  },
  timestamps,
);
tag.index({ agencyId: 1, nameLower: 1 }, { unique: true });
export const Tag = model('Tag', tag);

const quickReply = new Schema(
  {
    agencyId: oid('Agency', true),
    title: { type: String, required: true, maxlength: 60 },
    text: { type: String, required: true, maxlength: 4096 },
    shortcut: { type: String, required: true },
    createdBy: oid('User'),
  },
  timestamps,
);
quickReply.index({ agencyId: 1, shortcut: 1 }, { unique: true });
export const QuickReply = model('QuickReply', quickReply);
