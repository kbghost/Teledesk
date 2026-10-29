import { Schema, model } from 'mongoose';
import { PAYOUT_STATUSES, SALE_STATUSES } from '@teledesk/shared';
import { oid, timestamps } from './base';

/** Vente (PPV, pack…) déclarée par un opérateur ; le paiement du fan se fait hors plateforme (lien de paiement, crypto…). */
const sale = new Schema(
  {
    agencyId: oid('Agency', true),
    accountId: oid('TelegramAccount', true),
    conversationId: oid('Conversation', true),
    recordedBy: oid('User', true),
    assetId: oid('Asset'),
    /** Prix BRUT payé par le fan, en centimes. */
    amountCents: { type: Number, required: true, min: 1 },
    /** Commission de la plateforme (figée au moment de la vente) et net revenant à l'agence. */
    feeBps: { type: Number, default: 0 },
    feeCents: { type: Number, default: 0 },
    netCents: { type: Number, default: 0 },
    /** Origine : MANUAL (déclarée par un opérateur) ou PPV_PAID (paiement du fan sur la page de paiement) / PPV_UNLOCK (déblocage manuel). */
    source: { type: String, enum: ['MANUAL', 'PPV_UNLOCK', 'PPV_PAID'], default: 'MANUAL' },
    note: { type: String, default: '', maxlength: 200 },
    shiftId: oid('Shift'),
    day: { type: String, required: true }, // YYYY-MM-DD (UTC) : sert à corriger les compteurs en cas d'annulation
    status: { type: String, enum: SALE_STATUSES, default: 'CONFIRMED' },
    voidedBy: oid('User'),
    voidedAt: Date,
  },
  timestamps,
);
sale.index({ agencyId: 1, createdAt: -1 });
sale.index({ recordedBy: 1, createdAt: -1 });
sale.index({ conversationId: 1 });
export const Sale = model('Sale', sale);

const shift = new Schema(
  {
    agencyId: oid('Agency', true),
    userId: oid('User', true),
    accountId: oid('TelegramAccount', true),
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    createdBy: oid('User'),
  },
  timestamps,
);
shift.index({ agencyId: 1, startsAt: 1 });
shift.index({ userId: 1, startsAt: 1, endsAt: 1 });
export const Shift = model('Shift', shift);

/**
 * Compteurs journaliers (UTC) par compte et par opérateur, incrémentés au moment des événements.
 * userId absent = activité du contact ou de l'appli Telegram. Aucun chiffre n'est estimé : tout provient d'événements réels.
 */
const dailyStat = new Schema(
  {
    agencyId: oid('Agency', true),
    accountId: oid('TelegramAccount', true),
    userId: oid('User'),
    day: { type: String, required: true },
    messagesIn: { type: Number, default: 0 },
    messagesOut: { type: Number, default: 0 },
    newConversations: { type: Number, default: 0 },
    salesCount: { type: Number, default: 0 },
    salesCents: { type: Number, default: 0 },
    feeCents: { type: Number, default: 0 },
    respCount: { type: Number, default: 0 },
    respMsSum: { type: Number, default: 0 },
  },
  timestamps,
);
dailyStat.index({ agencyId: 1, accountId: 1, userId: 1, day: 1 }, { unique: true });
dailyStat.index({ agencyId: 1, day: 1 });
export const DailyStat = model('DailyStat', dailyStat);

/** Demande de retrait du net d'une agence ; validée (puis payée) par le super admin de la plateforme. */
const payout = new Schema(
  {
    agencyId: oid('Agency', true),
    requestedBy: oid('User', true),
    amountCents: { type: Number, required: true, min: 1 },
    method: { type: String, enum: ['BANK', 'MOBILE_MONEY', 'CRYPTO', 'OTHER'], required: true },
    destination: { type: String, required: true, maxlength: 300 },
    status: { type: String, enum: PAYOUT_STATUSES, default: 'PENDING', index: true },
    note: { type: String, default: '', maxlength: 300 },
    decidedBy: oid('User'),
    decidedAt: Date,
    paidAt: Date,
    reference: { type: String, default: '', maxlength: 120 },
    rejectReason: { type: String, default: '', maxlength: 300 },
  },
  timestamps,
);
payout.index({ agencyId: 1, createdAt: -1 });
payout.index({ status: 1, createdAt: -1 });
export const Payout = model('Payout', payout);

/** Lien de paiement d'un média payant (PPV) : envoyé au fan sous forme de bouton ; le paiement déclenche le déblocage automatique. */
const checkout = new Schema(
  {
    token: { type: String, required: true, unique: true },
    agencyId: oid('Agency', true),
    accountId: oid('TelegramAccount', true),
    conversationId: oid('Conversation', true),
    messageId: { type: Schema.Types.ObjectId, ref: 'Message', required: true, unique: true },
    assetName: { type: String, default: '' },
    amountCents: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'EUR' },
    status: { type: String, enum: ['PENDING', 'PAID', 'CANCELLED'], default: 'PENDING' },
    expiresAt: { type: Date, required: true },
    paidAt: Date,
    provider: { type: String, enum: ['SIMULATED', 'STRIPE'], default: 'SIMULATED' },
    providerRef: { type: String, default: '' },
  },
  timestamps,
);
export const Checkout = model('Checkout', checkout);
