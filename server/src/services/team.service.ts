import type { Request } from 'express';
import { ASSIGNABLE_ROLES, INVITABLE_ROLES, ROLE_LABELS, can, type AgencyRole, type Permission } from '@teledesk/shared';
import { env } from '../config/env';
import { Agency, Conversation, Invite, TelegramAccount, User } from '../models';
import { sendEmail, templates } from '../providers/email';
import { disconnectUser, getIo } from '../sockets/io';
import type { Actor } from '../types/express';
import { AppError, conflict, forbidden, notFound } from '../utils/errors';
import { randomToken, sha256 } from '../utils/helpers';
import { agencyOwnerIds, requirePermission } from './access.service';
import { getAgency } from './agency.service';
import { audit } from './audit.service';
import { revokeAllSessions } from './auth.service';
import { isOnline } from '../sockets/presence';

const INVITE_DAYS = 7;

async function validAccountIds(agencyId: string, ids: string[]) {
  if (!ids.length) return [];
  const ok = await TelegramAccount.find({ _id: { $in: ids }, agencyId, deletedAt: null }).select('_id').lean();
  if (ok.length !== new Set(ids).size) throw new AppError(400, 'BAD_ACCOUNTS', 'Un des comptes Telegram choisis est introuvable dans votre agence');
  return ok.map((a) => String(a._id));
}

/** Prévient les interfaces de l'équipe de relire leur inbox (changement massif de droits ou d'assignation). */
export async function refreshInboxes(agencyId: string) {
  const io = getIo();
  if (!io) return;
  const [users, owners] = await Promise.all([User.find({ agencyId, deletedAt: null }).select('_id').lean(), agencyOwnerIds(agencyId)]);
  for (const id of new Set([...users.map((u) => String(u._id)), ...owners])) io.to(`user:${id}`).emit('inbox:refresh', {});
}

/** Membres d'une agence, y compris son chef (qui peut avoir son compte rattaché à une autre de ses agences). */
async function members(agencyId: string) {
  const owner = (await Agency.findById(agencyId).select('ownerId').lean())?.ownerId;
  return User.find({ deletedAt: null, $or: [{ agencyId }, ...(owner ? [{ _id: owner }] : [])] }).sort({ createdAt: 1 }).lean();
}

export async function listTeam(actor: Actor) {
  requirePermission(actor, 'team.manage');
  const [users, invites] = await Promise.all([
    members(actor.agencyId),
    Invite.find({ agencyId: actor.agencyId, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).lean(),
  ]);
  return {
    members: users.map((u) => ({
      id: String(u._id), email: u.email, displayName: u.displayName, role: u.agencyRole as AgencyRole, roleLabel: ROLE_LABELS[u.agencyRole as AgencyRole],
      status: u.status, accountIds: (u.accountIds ?? []).map(String), lastLoginAt: u.lastLoginAt ?? null, lastSeenAt: u.lastSeenAt ?? null,
      totpEnabled: !!u.totpEnabledAt, online: isOnline(String(u._id)), permGrant: (u.permGrant ?? []).map(String), permRevoke: (u.permRevoke ?? []).map(String),
    })),
    invites: invites.map((i) => ({ id: String(i._id), email: i.email, displayName: i.displayName, role: i.role as AgencyRole, accountIds: (i.accountIds ?? []).map(String), permGrant: (i.permGrant ?? []).map(String), permRevoke: (i.permRevoke ?? []).map(String), expiresAt: i.expiresAt, createdAt: (i as any).createdAt })),
  };
}

/** Liste restreinte pour l'assignation et le filtrage : pas d'adresse e-mail, seulement les opérateurs actifs. */
export async function listAssignable(actor: Actor) {
  if (!can(actor, 'conversation.assign') && !can(actor, 'inbox.supervise')) throw forbidden('Action non autorisée pour votre rôle', 'FORBIDDEN_ROLE');
  const users = (await members(actor.agencyId)).filter((u) => u.status === 'ACTIVE' && (ASSIGNABLE_ROLES as readonly string[]).includes(String(u.agencyRole))).sort((a, b) => a.displayName.localeCompare(b.displayName));
  return users.map((u) => ({ id: String(u._id), displayName: u.displayName, role: u.agencyRole as AgencyRole, accountIds: (u.accountIds ?? []).map(String), online: isOnline(String(u._id)) }));
}

export async function createInvite(actor: Actor, input: { email: string; displayName: string; role: (typeof INVITABLE_ROLES)[number]; accountIds: string[]; permGrant?: Permission[]; permRevoke?: Permission[] }, req: Request) {
  requirePermission(actor, 'team.manage');
  if (await User.exists({ email: input.email })) throw conflict('EMAIL_TAKEN', 'Un compte existe déjà avec cet e-mail');
  const accountIds = await validAccountIds(actor.agencyId, input.accountIds);
  await Invite.updateMany({ agencyId: actor.agencyId, email: input.email, acceptedAt: null, revokedAt: null }, { $set: { revokedAt: new Date() } });
  const token = randomToken(32);
  const invite = await Invite.create({
    agencyId: actor.agencyId, email: input.email, displayName: input.displayName, role: input.role, accountIds, permGrant: input.permGrant ?? [], permRevoke: input.permRevoke ?? [], tokenHash: sha256(token),
    invitedBy: actor.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5),
  });
  const agencyName = (await getAgency(actor.agencyId)).name;
  await sendEmail(input.email, templates.invite(agencyName, actor.displayName, ROLE_LABELS[input.role], token), `${actor.displayName} vous invite sur ${env.APP_NAME}`);
  await audit(req, actor.agencyId, actor.id, 'MEMBER_INVITED', 'Invite', String(invite._id), { role: input.role, email: input.email });
  // Le lien n'est renvoyé qu'une fois, au Super admin : utile sans service d'e-mail (le jeton n'est stocké que haché).
  return { id: String(invite._id), email: invite.email, role: input.role, expiresAt: invite.expiresAt, inviteUrl: `${env.CLIENT_URL}/invitation/${token}` };
}

export async function revokeInvite(actor: Actor, id: string, req: Request) {
  requirePermission(actor, 'team.manage');
  const r = await Invite.updateOne({ _id: id, agencyId: actor.agencyId, acceptedAt: null, revokedAt: null }, { $set: { revokedAt: new Date() } });
  if (!r.matchedCount) throw notFound('Invitation introuvable');
  await audit(req, actor.agencyId, actor.id, 'INVITE_REVOKED', 'Invite', id);
}

async function loadMember(actor: Actor, id: string) {
  requirePermission(actor, 'team.manage');
  const owner = (await Agency.findById(actor.agencyId).select('ownerId').lean())?.ownerId;
  const u = await User.findOne({ _id: id, deletedAt: null, $or: [{ agencyId: actor.agencyId }, ...(owner ? [{ _id: owner }] : [])] });
  if (!u) throw notFound('Membre introuvable');
  return u;
}

export async function updateMember(
  actor: Actor, id: string, patch: { role?: (typeof INVITABLE_ROLES)[number]; accountIds?: string[]; status?: 'ACTIVE' | 'SUSPENDED'; displayName?: string; permGrant?: Permission[]; permRevoke?: Permission[] }, req: Request,
) {
  const u = await loadMember(actor, id);
  const protectedOwner = u.agencyRole === 'OWNER';
  if (protectedOwner && (patch.role || patch.status || patch.accountIds || patch.permGrant || patch.permRevoke)) throw forbidden('Le chef d’agence ne peut pas être modifié ici', 'OWNER_PROTECTED');
  const before = { role: u.agencyRole, status: u.status, accountIds: (u.accountIds ?? []).map(String) };
  if (patch.displayName) u.displayName = patch.displayName;
  if (patch.permGrant) u.permGrant = patch.permGrant as never;
  if (patch.permRevoke) u.permRevoke = patch.permRevoke as never;
  if (patch.accountIds) u.accountIds = (await validAccountIds(actor.agencyId, patch.accountIds)) as never;
  if (patch.role && patch.role !== u.agencyRole) {
    if (u.agencyRole === 'MODEL') await TelegramAccount.updateMany({ modelUserId: u._id }, { $unset: { modelUserId: 1 } });
    u.agencyRole = patch.role;
  }
  if (patch.status) u.status = patch.status;
  await u.save();

  const nowIds = (u.accountIds ?? []).map(String);
  const scoped = ['TEAM_LEADER', 'CHATTER'].includes(String(u.agencyRole));
  // un modèle ne peut être assigné à rien ; un membre limité à des comptes perd les conversations des comptes retirés (sous-chef : voit tout, rien à retirer)
  if (u.agencyRole === 'MODEL') await Conversation.updateMany({ assignedTo: u._id }, { $set: { assignedTo: null } });
  else if (scoped) await Conversation.updateMany({ assignedTo: u._id, accountId: { $nin: nowIds } }, { $set: { assignedTo: null } });
  if (patch.status === 'SUSPENDED') { await revokeAllSessions(id); disconnectUser(id); await Conversation.updateMany({ assignedTo: u._id }, { $set: { assignedTo: null } }); }
  await refreshInboxes(actor.agencyId);
  await audit(req, actor.agencyId, actor.id, patch.status === 'SUSPENDED' ? 'MEMBER_SUSPENDED' : 'MEMBER_UPDATED', 'User', id, { before, patch });
  return { id, role: u.agencyRole, status: u.status, accountIds: nowIds, displayName: u.displayName, permGrant: (u.permGrant ?? []).map(String), permRevoke: (u.permRevoke ?? []).map(String) };
}

/** Retrait d'un membre : accès coupé immédiatement, conversations remises dans la file, adresse e-mail libérée. L'historique reste attribué à son nom. */
export async function removeMember(actor: Actor, id: string, req: Request) {
  const u = await loadMember(actor, id);
  if (u.agencyRole === 'OWNER') throw forbidden('Le chef d’agence ne peut pas être retiré', 'OWNER_PROTECTED');
  await revokeAllSessions(id);
  disconnectUser(id);
  await Conversation.updateMany({ assignedTo: u._id }, { $set: { assignedTo: null } });
  await TelegramAccount.updateMany({ modelUserId: u._id }, { $unset: { modelUserId: 1 } });
  const email = u.email;
  await User.updateOne({ _id: u._id }, { $set: { deletedAt: new Date(), status: 'SUSPENDED', email: `${u._id}.removed@teledesk.invalid`, accountIds: [] } });
  await refreshInboxes(actor.agencyId);
  await audit(req, actor.agencyId, actor.id, 'MEMBER_REMOVED', 'User', id, { email, role: u.agencyRole });
}
