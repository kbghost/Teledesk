import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { Request } from 'express';
import { effectivePermissions, ROLE_LABELS, type AgencyRole, type RegisterInput } from '@teledesk/shared';
import { env, isTest } from '../config/env';
import { Agency, Invite, Session, User } from '../models';
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../utils/errors';
import { getIp, randomToken, sha256 } from '../utils/helpers';
import { decryptSecret, encryptSecret } from '../utils/crypto';
import { sendEmail, templates } from '../providers/email';
import { audit } from './audit.service';
import { createAgency, listMyAgencies, serializeAgency } from './agency.service';
import { buildActor } from '../middleware';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp.service';

const BCRYPT_COST = isTest ? 4 : 12;
const ACCESS_TTL = '15m';
const REFRESH_DAYS = 30;
const MAX_FAILS = 5;
const LOCK_MIN = 15;

export const hashPassword = (p: string) => bcrypt.hash(p, BCRYPT_COST);

/** Profil renvoyé à l'interface : jamais de secret, les permissions effectives (rôle + personnalisation), l'agence courante et les agences du chef. */
export async function publicUser(userId: string, agencyHint?: string) {
  const u = await User.findById(userId).lean();
  if (!u) return null;
  const actor = await buildActor(u, agencyHint);
  const agency = actor.agencyId ? await Agency.findById(actor.agencyId).lean() : null;
  const agencies = actor.platform ? [] : await listMyAgencies(actor);
  return {
    id: String(u._id), email: u.email, displayName: u.displayName, role: actor.role, roleLabel: ROLE_LABELS[actor.role], status: u.status,
    platform: actor.platform, agencyId: actor.agencyId, accountIds: actor.accountIds,
    emailVerified: !!u.emailVerifiedAt, totpEnabled: !!u.totpEnabledAt,
    agency: agency ? serializeAgency(agency) : null,
    agencies: agencies.length > 1 || actor.role === 'OWNER' ? agencies : [],
    permissions: actor.platform ? [] : effectivePermissions(actor),
  };
}

/** Crée le super admin de la plateforme s'il n'existe pas (identifiants dans .env : SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD). */
export async function ensureSuperAdmin(email: string, password: string, displayName = 'Administrateur'): Promise<boolean> {
  if (await User.exists({ platformRole: 'SUPERADMIN' })) return false;
  if (await User.exists({ email })) throw new Error(`SUPERADMIN_EMAIL (${email}) correspond déjà à un compte non administrateur`);
  const now = new Date();
  await User.create({ email, passwordHash: await hashPassword(password), displayName, platformRole: 'SUPERADMIN', emailVerifiedAt: now, consents: { tosAt: now, privacyAt: now } });
  return true;
}

function deviceLabel(ua = '') {
  const os = /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iOS' : /Mac/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Appareil inconnu';
  const br = /Edg\//i.test(ua) ? 'Edge' : /Chrome/i.test(ua) ? 'Chrome' : /Firefox/i.test(ua) ? 'Firefox' : /Safari/i.test(ua) ? 'Safari' : 'Navigateur';
  return `${br} · ${os}`;
}

async function issueSession(userId: string, req: Request, familyId: string = crypto.randomUUID()) {
  const refreshToken = randomToken(48);
  const session = await Session.create({
    userId, refreshHash: sha256(refreshToken), familyId, ip: getIp(req), userAgent: req.get('user-agent')?.slice(0, 250),
    device: deviceLabel(req.get('user-agent') ?? ''), expiresAt: new Date(Date.now() + REFRESH_DAYS * 864e5), lastUsedAt: new Date(),
  });
  const accessToken = jwt.sign({ sub: userId, sid: String(session._id) }, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL });
  return { accessToken, refreshToken };
}

/** Inscription = création d'une agence et de son Super admin. */
export async function register(input: RegisterInput, req: Request) {
  if (await User.exists({ email: input.email })) throw conflict('EMAIL_TAKEN', 'Cet email est déjà utilisé');
  const agency = await createAgency(input.agencyName);
  const verifyToken = randomToken(32);
  const now = new Date();
  let user;
  try {
    user = await User.create({
      email: input.email, passwordHash: await hashPassword(input.password), displayName: input.displayName,
      agencyId: agency._id, agencyRole: 'OWNER', verifyTokenHash: sha256(verifyToken), consents: { tosAt: now, privacyAt: now },
    });
  } catch (e) {
    await Agency.deleteOne({ _id: agency._id });
    throw e;
  }
  agency.ownerId = user._id;
  await agency.save();
  await sendEmail(user.email, templates.welcome(user.displayName, agency.name), `Bienvenue sur ${env.APP_NAME}`);
  await sendEmail(user.email, templates.verifyEmail(verifyToken), 'Confirmez votre email');
  await audit(req, String(agency._id), String(user._id), 'AGENCY_CREATED', 'Agency', String(agency._id));
  const tokens = await issueSession(String(user._id), req);
  return { ...tokens, user: await publicUser(String(user._id)) };
}

export async function login(email: string, password: string, totp: string | undefined, req: Request) {
  const user = await User.findOne({ email, deletedAt: null }).select('+passwordHash +totpSecretEnc +totpLastStep +totpRecoveryHashes');
  const generic = unauthorized('Email ou mot de passe incorrect', 'INVALID_CREDENTIALS');
  if (!user) { await bcrypt.compare(password, '$2a$04$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi'); throw generic; }
  if (user.lockUntil && user.lockUntil > new Date()) throw new AppError(429, 'ACCOUNT_LOCKED', 'Trop de tentatives, réessayez dans quelques minutes');
  const fail = async (err: AppError) => {
    user.failedLogins += 1;
    if (user.failedLogins >= MAX_FAILS) { user.lockUntil = new Date(Date.now() + LOCK_MIN * 60_000); user.failedLogins = 0; }
    await user.save();
    await audit(req, String(user.agencyId), String(user._id), 'LOGIN_FAILED', 'User', String(user._id));
    throw err;
  };
  if (!(await bcrypt.compare(password, user.passwordHash))) await fail(generic);
  if (user.status !== 'ACTIVE') throw forbidden('Compte suspendu', 'ACCOUNT_DISABLED');
  if (env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerifiedAt) throw forbidden('Vérifiez votre email avant de vous connecter', 'EMAIL_NOT_VERIFIED');

  if (user.totpEnabledAt && user.totpSecretEnc) {
    if (!totp) throw unauthorized('Code de double authentification requis', 'TOTP_REQUIRED');
    const secret = decryptSecret(user.totpSecretEnc as any, `totp:${user._id}`);
    const step = verifyTotp(secret, totp, Date.now(), user.totpLastStep ?? 0);
    if (step) {
      user.totpLastStep = step; // un code ne peut servir qu'une fois
    } else {
      const h = sha256(totp.replace(/\s|-/g, '').toLowerCase());
      const idx = (user.totpRecoveryHashes ?? []).indexOf(h);
      if (idx < 0) await fail(unauthorized('Code de double authentification invalide', 'INVALID_TOTP'));
      user.totpRecoveryHashes = (user.totpRecoveryHashes ?? []).filter((_, i) => i !== idx);
      await audit(req, String(user.agencyId), String(user._id), 'TOTP_RECOVERY_USED', 'User', String(user._id));
    }
  }
  user.failedLogins = 0; user.lockUntil = undefined; user.lastLoginAt = new Date();
  await user.save();
  const tokens = await issueSession(String(user._id), req);
  return { ...tokens, user: await publicUser(String(user._id)) };
}

/** Rotation du refresh token + détection de réutilisation (révoque toute la famille). */
export async function refresh(token: string | undefined, req: Request) {
  if (!token) throw unauthorized('Session absente', 'NO_REFRESH');
  const s = await Session.findOne({ refreshHash: sha256(token) });
  if (!s) throw unauthorized('Session invalide', 'BAD_REFRESH');
  if (s.rotated || s.revokedAt) {
    await Session.updateMany({ familyId: s.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await audit(req, null, String(s.userId), 'REFRESH_REUSE_DETECTED', 'Session', String(s._id));
    throw unauthorized('Session compromise : reconnectez-vous', 'REFRESH_REUSED');
  }
  if (s.expiresAt < new Date()) throw unauthorized('Session expirée', 'REFRESH_EXPIRED');
  const user = await User.findById(s.userId).lean();
  if (!user || user.deletedAt || user.status !== 'ACTIVE') throw unauthorized('Compte indisponible', 'ACCOUNT_DISABLED');
  // Passage atomique rotated=false → true : une seule requête gagne en cas de course.
  const res = await Session.updateOne({ _id: s._id, rotated: false }, { $set: { rotated: true, revokedAt: new Date() } });
  if (res.modifiedCount !== 1) throw unauthorized('Session invalide', 'BAD_REFRESH');
  const tokens = await issueSession(String(user._id), req, s.familyId);
  return { ...tokens, user: await publicUser(String(user._id)) };
}

export async function logout(token: string | undefined) {
  if (!token) return;
  await Session.updateOne({ refreshHash: sha256(token) }, { $set: { revokedAt: new Date() } });
}

export async function listSessions(userId: string, currentSid?: string) {
  const list = await Session.find({ userId, revokedAt: null, rotated: false, expiresAt: { $gt: new Date() } }).sort({ lastUsedAt: -1 }).lean();
  return list.map((s) => ({ id: String(s._id), device: s.device, ip: s.ip, createdAt: (s as any).createdAt, lastUsedAt: s.lastUsedAt, current: String(s._id) === currentSid }));
}
export async function revokeSession(userId: string, sessionId: string) {
  const s = await Session.findOne({ _id: sessionId, userId });
  if (!s) throw notFound('Session introuvable');
  await Session.updateMany({ familyId: s.familyId }, { $set: { revokedAt: new Date() } });
}
export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  const keep = exceptSessionId ? await Session.findById(exceptSessionId).lean() : null;
  await Session.updateMany({ userId, revokedAt: null, ...(keep ? { familyId: { $ne: keep.familyId } } : {}) }, { $set: { revokedAt: new Date() } });
}

export async function verifyEmail(token: string) {
  const r = await User.updateOne({ verifyTokenHash: sha256(token) }, { $set: { emailVerifiedAt: new Date() }, $unset: { verifyTokenHash: 1 } });
  if (!r.matchedCount) throw badRequest('BAD_TOKEN', 'Lien invalide ou expiré');
}
export async function forgotPassword(email: string) {
  const u = await User.findOne({ email, deletedAt: null });
  if (!u) return; // ne révèle pas l'existence du compte
  const token = randomToken(32);
  u.resetTokenHash = sha256(token); u.resetExpiresAt = new Date(Date.now() + 3600_000);
  await u.save();
  await sendEmail(u.email, templates.resetPassword(token), 'Réinitialisation du mot de passe');
}
export async function resetPassword(token: string, password: string, req: Request) {
  const u = await User.findOne({ resetTokenHash: sha256(token), resetExpiresAt: { $gt: new Date() } }).select('+resetTokenHash +resetExpiresAt');
  if (!u) throw badRequest('BAD_TOKEN', 'Lien invalide ou expiré');
  u.passwordHash = await hashPassword(password); u.resetTokenHash = undefined; u.resetExpiresAt = undefined; u.failedLogins = 0; u.lockUntil = undefined;
  await u.save();
  await revokeAllSessions(String(u._id));
  await sendEmail(u.email, templates.security('Votre mot de passe a été modifié.'), 'Mot de passe modifié');
  await audit(req, String(u.agencyId), String(u._id), 'PASSWORD_RESET', 'User', String(u._id));
}
export async function changePassword(actor: { id: string; agencyId: string }, current: string, next: string, sid: string | undefined, req: Request) {
  const u = await User.findById(actor.id).select('+passwordHash');
  if (!u || !(await bcrypt.compare(current, u.passwordHash))) throw badRequest('INVALID_CREDENTIALS', 'Mot de passe actuel incorrect');
  u.passwordHash = await hashPassword(next);
  await u.save();
  await revokeAllSessions(actor.id, sid);
  await sendEmail(u.email, templates.security('Votre mot de passe a été modifié.'), 'Mot de passe modifié');
  await audit(req, actor.agencyId, actor.id, 'PASSWORD_CHANGED', 'User', actor.id);
}

// ───────────── Invitations ─────────────
export async function inviteInfo(token: string) {
  const inv = await Invite.findOne({ tokenHash: sha256(token), acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
  if (!inv) throw notFound('Invitation invalide ou expirée', 'INVITE_INVALID');
  const agency = await Agency.findById(inv.agencyId).lean();
  return { email: inv.email, displayName: inv.displayName, role: inv.role, roleLabel: ROLE_LABELS[inv.role as AgencyRole], agencyName: agency?.name ?? '' };
}
export async function acceptInvite(token: string, password: string, displayName: string | undefined, req: Request) {
  // revendication atomique : une invitation ne sert qu'une fois, même en cas de double clic
  const inv = await Invite.findOneAndUpdate(
    { tokenHash: sha256(token), acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { acceptedAt: new Date() } },
    { new: true },
  );
  if (!inv) throw notFound('Invitation invalide ou expirée', 'INVITE_INVALID');
  try {
    if (await User.exists({ email: inv.email })) throw conflict('EMAIL_TAKEN', 'Un compte existe déjà avec cet email');
    const agency = await Agency.findOne({ _id: inv.agencyId, deletedAt: null }).lean();
    if (!agency) throw notFound('Agence introuvable');
    const now = new Date();
    const user = await User.create({
      email: inv.email, passwordHash: await hashPassword(password), displayName: displayName ?? inv.displayName,
      agencyId: inv.agencyId, agencyRole: inv.role, accountIds: inv.accountIds, permGrant: inv.permGrant ?? [], permRevoke: inv.permRevoke ?? [], emailVerifiedAt: now, consents: { tosAt: now, privacyAt: now },
    });
    // un modèle invité sur un compte devient « le modèle » de ce compte
    if (inv.role === 'MODEL' && inv.accountIds.length) {
      const { TelegramAccount } = await import('../models');
      await TelegramAccount.updateMany({ _id: { $in: inv.accountIds }, agencyId: inv.agencyId, modelUserId: null }, { $set: { modelUserId: user._id } });
    }
    await audit(req, String(inv.agencyId), String(user._id), 'INVITE_ACCEPTED', 'User', String(user._id), { role: inv.role });
    const tokens = await issueSession(String(user._id), req);
    return { ...tokens, user: await publicUser(String(user._id)) };
  } catch (e) {
    await Invite.updateOne({ _id: inv._id }, { $set: { acceptedAt: null } }); // l'invitation reste utilisable si la création échoue
    throw e;
  }
}

// ───────────── Double authentification (TOTP) ─────────────
export async function totpSetup(actor: { id: string; agencyId: string }) {
  const u = await User.findById(actor.id);
  if (!u) throw notFound();
  if (u.totpEnabledAt) throw conflict('TOTP_ALREADY', 'La double authentification est déjà active');
  const secret = generateTotpSecret();
  u.totpSecretEnc = encryptSecret(secret, `totp:${u._id}`) as any;
  await u.save();
  return { secret, otpauthUrl: otpauthUrl(secret, u.email, env.APP_NAME) };
}
export async function totpEnable(actor: { id: string; agencyId: string }, code: string, req: Request) {
  const u = await User.findById(actor.id).select('+totpSecretEnc +totpLastStep +totpRecoveryHashes');
  if (!u?.totpSecretEnc) throw badRequest('TOTP_NOT_STARTED', 'Lancez d\'abord la configuration');
  if (u.totpEnabledAt) throw conflict('TOTP_ALREADY', 'Déjà active');
  const step = verifyTotp(decryptSecret(u.totpSecretEnc as any, `totp:${u._id}`), code);
  if (!step) throw badRequest('INVALID_TOTP', 'Code invalide');
  const recovery = Array.from({ length: 8 }, () => `${randomToken(5)}-${randomToken(5)}`.toLowerCase().replace(/[^a-z0-9-]/g, 'x'));
  u.totpEnabledAt = new Date(); u.totpLastStep = step; u.totpRecoveryHashes = recovery.map((c) => sha256(c.replace(/-/g, '')));
  await u.save();
  await audit(req, actor.agencyId, actor.id, 'TOTP_ENABLED', 'User', actor.id);
  return { recoveryCodes: recovery };
}
export async function totpDisable(actor: { id: string; agencyId: string }, password: string, req: Request) {
  const u = await User.findById(actor.id).select('+passwordHash');
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) throw badRequest('INVALID_CREDENTIALS', 'Mot de passe incorrect');
  await User.updateOne({ _id: u._id }, { $unset: { totpEnabledAt: 1, totpSecretEnc: 1, totpLastStep: 1, totpRecoveryHashes: 1 } });
  await audit(req, actor.agencyId, actor.id, 'TOTP_DISABLED', 'User', actor.id);
}
