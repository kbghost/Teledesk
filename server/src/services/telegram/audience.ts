import { can, type AgencyRole } from '@teledesk/shared';
import { Conversation, TelegramAccount, User } from '../../models';
import { agencyOwnerIds } from '../access.service';
import { emitToEach, emitToUsers } from '../../sockets/io';
import { serializeConversation, serializeMessage } from '../serializers';

/**
 * Utilisateurs qui peuvent voir une conversation à cet instant (mêmes règles que access.service) :
 * Super admin · Team leaders et chatters des comptes concernés (chatter : non assignée ou assignée à lui) · modèle autorisé.
 */
export async function conversationAudience(conv: { agencyId: unknown; accountId: unknown; assignedTo?: unknown }): Promise<string[]> {
  const [account, owners, users] = await Promise.all([
    TelegramAccount.findById(conv.accountId).select('modelUserId modelCanView').lean(),
    agencyOwnerIds(conv.agencyId),
    User.find({
      agencyId: conv.agencyId, status: 'ACTIVE', deletedAt: null,
      $or: [{ agencyRole: 'MANAGER' }, { agencyRole: { $in: ['TEAM_LEADER', 'CHATTER'] }, accountIds: conv.accountId }],
    }).select('_id agencyRole permGrant permRevoke').lean(),
  ]);
  const assigned = conv.assignedTo ? String(conv.assignedTo) : null;
  // sans le droit de tout voir, un membre ne reçoit que les conversations libres ou assignées à lui (même règle que conversationFilter)
  const ids = users
    .filter((u) => can({ role: u.agencyRole as AgencyRole, grant: u.permGrant, revoke: u.permRevoke }, 'inbox.supervise') || !assigned || assigned === String(u._id))
    .map((u) => String(u._id));
  ids.push(...owners);
  if (account?.modelUserId && account.modelCanView) ids.push(String(account.modelUserId));
  return [...new Set(ids)];
}

type Doc = Record<string, any>;
const accountView = (a: Doc | null) => (a ? { mode: a.mode, status: a.status, business: a.business } : null);

/** Diffuse un message (nouveau ou modifié) et la conversation à jour à tous ceux qui ont le droit de les voir. */
export async function publishMessage(event: 'message:new' | 'message:updated', conv: Doc, message: Doc, extra: Record<string, unknown> = {}) {
  const [fresh, account] = await Promise.all([Conversation.findById(conv._id).lean(), TelegramAccount.findById(conv.accountId).lean()]);
  const c = fresh ?? conv;
  const audience = await conversationAudience(c as any);
  emitToEach(audience, event, (uid) => ({ conversation: serializeConversation(c, accountView(account)), message: serializeMessage(message, uid), ...extra }));
}

/** Diffuse un changement de conversation (assignation, tags, archivage, lu…). `previousAudience` : ceux qui doivent la retirer de leur liste. */
export async function publishConversation(convId: string, previousAudience: string[] = []) {
  const c = await Conversation.findById(convId).lean();
  if (!c) return;
  const account = await TelegramAccount.findById(c.accountId).lean();
  const audience = await conversationAudience(c);
  emitToUsers(audience, 'conversation:updated', serializeConversation(c, accountView(account)));
  const removed = previousAudience.filter((u) => !audience.includes(u));
  if (removed.length) emitToUsers(removed, 'conversation:removed', { id: convId });
}

/**
 * Comme conversationAudience, mais sans le modèle : pour les données internes à l'équipe (notes, ventes) que le modèle ne doit jamais voir,
 * même s'il a l'autorisation de lire les conversations.
 */
export async function staffAudience(conv: { agencyId: unknown; accountId: unknown; assignedTo?: unknown }): Promise<string[]> {
  const [all, account] = await Promise.all([conversationAudience(conv), TelegramAccount.findById(conv.accountId).select('modelUserId').lean()]);
  const model = account?.modelUserId ? String(account.modelUserId) : null;
  return all.filter((id) => id !== model);
}
