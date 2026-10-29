import { Schema, model } from 'mongoose';
import { AGENCY_ROLES, AGENCY_STATUSES, DEFAULT_FEE_BPS } from '@teledesk/shared';
import { oid, timestamps } from './base';

const agency = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    ownerId: oid('User'),
    status: { type: String, enum: AGENCY_STATUSES, default: 'ACTIVE', index: true },
    bannedAt: Date,
    banReason: String,
    bannedBy: oid('User'),
    /** Commission de la plateforme sur chaque vente, en points de base (1500 = 15 %). */
    feeBps: { type: Number, default: DEFAULT_FEE_BPS },
    currency: { type: String, default: 'EUR' },
    settings: { modelCanViewDefault: { type: Boolean, default: false } },
    deletedAt: Date,
  },
  timestamps,
);
export const Agency = model('Agency', agency);

/** Invitation d'un membre : le lien contient un jeton aléatoire dont seul le hachage est stocké. */
const invite = new Schema(
  {
    agencyId: oid('Agency', true),
    email: { type: String, required: true, lowercase: true, trim: true },
    displayName: { type: String, required: true, trim: true, maxlength: 60 },
    role: { type: String, enum: AGENCY_ROLES, required: true },
    accountIds: [oid('TelegramAccount')],
    permGrant: { type: [String], default: [] },
    permRevoke: { type: [String], default: [] },
    tokenHash: { type: String, required: true, index: true },
    invitedBy: oid('User'),
    expiresAt: { type: Date, required: true },
    acceptedAt: Date,
    revokedAt: Date,
  },
  timestamps,
);
invite.index({ agencyId: 1, email: 1 });
export const Invite = model('Invite', invite);
