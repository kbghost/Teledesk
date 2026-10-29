import { Schema, model } from 'mongoose';
import { AGENCY_ROLES, USER_STATUSES } from '@teledesk/shared';
import { encryptedBlob, oid, timestamps } from './base';

const user = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true, maxlength: 60 },
    /** SUPERADMIN = propriétaire de la plateforme (aucune agence). Tous les autres sont USER. */
    platformRole: { type: String, enum: ['SUPERADMIN', 'USER'], default: 'USER', index: true },
    /** Agence « d'origine » : celle du membre, ou la première agence d'un chef d'agence (qui peut en posséder plusieurs, voir Agency.ownerId). */
    agencyId: oid('Agency'),
    agencyRole: { type: String, enum: AGENCY_ROLES, index: true },
    /** Permissions ajoutées / retirées par rapport au rôle (voir shared/PERMISSIONS). */
    permGrant: { type: [String], default: [] },
    permRevoke: { type: [String], default: [] },
    /** Comptes Telegram auxquels le membre a accès (le Super admin voit tous les comptes de l'agence). */
    accountIds: [oid('TelegramAccount')],
    status: { type: String, enum: USER_STATUSES, default: 'ACTIVE', index: true },
    emailVerifiedAt: Date,
    verifyTokenHash: { type: String, index: true },
    resetTokenHash: { type: String, select: false },
    resetExpiresAt: { type: Date, select: false },
    failedLogins: { type: Number, default: 0 },
    lockUntil: Date,
    lastLoginAt: Date,
    lastSeenAt: Date,
    consents: { tosAt: Date, privacyAt: Date },
    // Double authentification (TOTP) : secret chiffré, jamais renvoyé par l'API
    totpSecretEnc: { type: encryptedBlob, select: false },
    totpEnabledAt: Date,
    totpLastStep: { type: Number, select: false },
    totpRecoveryHashes: { type: [String], select: false },
    deletedAt: Date,
  },
  timestamps,
);
user.index({ agencyId: 1, agencyRole: 1, status: 1 });
export const User = model('User', user);

const session = new Schema(
  {
    userId: oid('User', true),
    familyId: { type: String, required: true, index: true }, // une famille = une connexion ; réutilisation d'un jeton → toute la famille est révoquée
    refreshHash: { type: String, required: true, index: true },
    rotated: { type: Boolean, default: false },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    device: { type: String, default: '' },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
  },
  timestamps,
);
session.index({ userId: 1, revokedAt: 1 });
export const Session = model('Session', session);

const audit = new Schema(
  {
    agencyId: oid('Agency'),
    actorId: oid('User'),
    action: { type: String, required: true, index: true },
    targetType: String,
    targetId: String,
    metadata: Schema.Types.Mixed,
    ip: String,
    userAgent: String,
    timestamp: { type: Date, default: Date.now },
  },
  timestamps,
);
audit.index({ agencyId: 1, _id: -1 });
export const AuditLog = model('AuditLog', audit);
