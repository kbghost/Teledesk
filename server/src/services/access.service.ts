import { Types } from 'mongoose';
import { ASSIGNABLE_ROLES, can, seesAllAccounts, type Permission } from '@teledesk/shared';
import { Agency, Conversation, TelegramAccount, User } from '../models';
import type { Actor } from '../types/express';
import { forbidden, notFound } from '../utils/errors';

const oid = (id: string) => new Types.ObjectId(id);

export function requirePermission(actor: Actor, permission: Permission) {
  if (!can(actor, permission)) throw forbidden('Action non autorisée pour votre rôle', 'FORBIDDEN_ROLE');
}

/** Identifiants des comptes Telegram que l'acteur peut voir. Super admin : tous les comptes de l'agence. */
export async function visibleAccountIds(actor: Actor): Promise<string[]> {
  if (seesAllAccounts(actor.role)) {
    const all = await TelegramAccount.find({ agencyId: actor.agencyId, deletedAt: null }).select('_id').lean();
    return all.map((a) => String(a._id));
  }
  if (actor.role === 'MODEL') {
    // un modèle ne voit que son propre compte, et seulement si le Super admin l'y autorise (lecture seule)
    const own = await TelegramAccount.find({ agencyId: actor.agencyId, modelUserId: actor.id, modelCanView: true, deletedAt: null }).select('_id').lean();
    return own.map((a) => String(a._id));
  }
  if (!actor.accountIds.length) return [];
  const ok = await TelegramAccount.find({ _id: { $in: actor.accountIds.map(oid) }, agencyId: actor.agencyId, deletedAt: null }).select('_id').lean();
  return ok.map((a) => String(a._id));
}

/** Comptes accessibles pour la médiathèque (le modèle y accède même sans droit de lecture des conversations). */
export async function libraryAccountIds(actor: Actor): Promise<string[]> {
  if (actor.role === 'MODEL') {
    const own = await TelegramAccount.find({ agencyId: actor.agencyId, modelUserId: actor.id, deletedAt: null }).select('_id').lean();
    return own.map((a) => String(a._id));
  }
  return visibleAccountIds(actor);
}

export async function assertAccountAccess(actor: Actor, accountId: string) {
  const ids = await visibleAccountIds(actor);
  if (!ids.includes(accountId)) throw notFound('Compte introuvable');
}

/**
 * Filtre Mongo des conversations visibles :
 * - Super admin : toute l'agence · Team leader : ses comptes · Modèle : son compte (si autorisé, lecture seule)
 * - Chatter : conversations non assignées OU assignées à lui, sur les comptes qui lui sont confiés.
 */
export async function conversationFilter(actor: Actor): Promise<Record<string, unknown>> {
  const accountIds = await visibleAccountIds(actor);
  const base: Record<string, unknown> = { agencyId: oid(actor.agencyId), deletedAt: null, accountId: { $in: accountIds.map(oid) } };
  // sans le droit de superviser, on ne voit que les conversations libres ou assignées à soi (le modèle lit tout son compte, en lecture seule)
  if (actor.role !== 'MODEL' && !can(actor, 'inbox.supervise')) base.$or = [{ assignedTo: null }, { assignedTo: oid(actor.id) }];
  return base;
}

/** Charge une conversation SI l'acteur peut la voir (sinon 404 : on ne révèle pas son existence). */
export async function loadVisibleConversation(actor: Actor, conversationId: string) {
  const filter = await conversationFilter(actor);
  const conv = await Conversation.findOne({ ...filter, _id: conversationId });
  if (!conv) throw notFound('Conversation introuvable');
  return conv;
}

/** Peut répondre : rôle autorisé, conversation visible, et (chatter) pas assignée à un autre. */
export async function loadReplyableConversation(actor: Actor, conversationId: string) {
  requirePermission(actor, 'inbox.reply');
  return loadVisibleConversation(actor, conversationId);
}

/** Le chef d'agence (propriétaire) d'une agence : un même chef peut posséder plusieurs agences, d'où Agency.ownerId plutôt que User.agencyId. */
export async function agencyOwnerIds(agencyId: unknown): Promise<string[]> {
  const a = await Agency.findById(agencyId).select('ownerId').lean();
  return a?.ownerId ? [String(a.ownerId)] : [];
}
/** Chef d'agence + sous-chefs actifs : ceux qui voient tout l'agence et reçoivent ses alertes (comptes, présence). */
export async function agencySupervisorIds(agencyId: unknown): Promise<string[]> {
  const [owners, managers] = await Promise.all([
    agencyOwnerIds(agencyId),
    User.find({ agencyId, agencyRole: 'MANAGER', status: 'ACTIVE', deletedAt: null }).select('_id').lean(),
  ]);
  return [...new Set([...owners, ...managers.map((m) => String(m._id))])];
}

/** Membre actif pouvant recevoir une conversation (ou un shift) dans cette agence — le chef d'agence compris, même rattaché à une autre de ses agences. */
export async function findAssignee(agencyId: string, userId: string, roles: readonly string[] = ASSIGNABLE_ROLES) {
  const owner = (await Agency.findById(agencyId).select('ownerId').lean())?.ownerId;
  return User.findOne({ _id: userId, status: 'ACTIVE', deletedAt: null, agencyRole: { $in: roles }, $or: [{ agencyId }, ...(owner ? [{ _id: owner }] : [])] }).lean();
}
