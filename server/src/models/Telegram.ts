import { Schema, model } from 'mongoose';
import { ACCOUNT_MODES, ACCOUNT_STATUSES, BOT_TRANSPORTS } from '@teledesk/shared';
import { encryptedBlob, oid, timestamps } from './base';

/** Connexion Business reçue de Telegram (mise à jour `business_connection`). */
const businessConn = new Schema(
  {
    connectionId: { type: String, required: true },
    userId: { type: String, required: true }, // identifiant Telegram du titulaire du compte
    userName: { type: String, default: '' },
    userUsername: { type: String, default: '' },
    userChatId: String,
    isEnabled: { type: Boolean, default: true },
    canReply: { type: Boolean, default: false },
    canRead: { type: Boolean, default: false },
    receivedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

/**
 * Compte Telegram connecté au CRM (un « modèle » = un compte).
 * secretEnc contient le jeton du bot, chiffré (AES-256-GCM) : il n'est JAMAIS renvoyé par l'API et n'est lisible par
 * aucun rôle de l'agence (ni le Super admin) : seul le serveur le déchiffre pour parler à Telegram.
 * Mode USER (compte personnel) : le numéro est conservé (masqué dans l'interface) et la SESSION MTProto est chiffrée dans secretEnc.
 */
const account = new Schema(
  {
    agencyId: oid('Agency', true),
    label: { type: String, required: true, trim: true, maxlength: 60 },
    mode: { type: String, enum: ACCOUNT_MODES, required: true },
    status: { type: String, enum: ACCOUNT_STATUSES, default: 'PENDING', index: true },
    statusDetail: { type: String, default: '' },
    botId: String,
    phone: { type: String, select: false },
    botUsername: String,
    botName: String,
    /** Le bot accepte d'être connecté à un compte Business (champ can_connect_to_business de getMe, si fourni). */
    botBusinessReady: Boolean,
    secretEnc: { type: encryptedBlob, select: false },
    webhookSecret: { type: String, select: false },
    transport: { type: String, enum: BOT_TRANSPORTS, default: 'POLLING' },
    pollOffset: { type: Number, default: 0 },
    /** Connexion Business confirmée par le Super admin : seule celle-ci alimente l'inbox. */
    business: businessConn,
    /** Connexion reçue mais non confirmée : aucun message n'est lu tant que le Super admin ne l'a pas approuvée. */
    pendingBusiness: businessConn,
    modelUserId: oid('User'),
    modelCanView: { type: Boolean, default: false },
    connectedAt: Date,
    lastEventAt: Date,
    deletedAt: Date,
  },
  timestamps,
);
account.index({ agencyId: 1, deletedAt: 1 });
account.index({ botId: 1, deletedAt: 1 });
export const TelegramAccount = model('TelegramAccount', account);
