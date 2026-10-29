import { isDirectMode, isReplyWindowOpen, replyWindowEndsAt, type AccountMode, type SendError } from '@teledesk/shared';
import { TelegramAccount } from '../../models';
import { TelegramApi, sandboxBase } from '../../providers/telegram/api';
import { UserApi } from '../../providers/telegram/user';
import { decryptSecret, type EncryptedBlob } from '../../utils/crypto';
import { now } from '../../utils/clock';

/** Charge un compte AVEC ses secrets (jeton chiffré, secret de webhook). À ne jamais renvoyer tel quel à l'interface. */
export const loadAccountSecret = (id: string) => TelegramAccount.findById(id).select('+secretEnc +webhookSecret');

type AccountWithSecret = { _id: unknown; mode: string; secretEnc?: unknown };
export const accountToken = (a: AccountWithSecret) => decryptSecret(a.secretEnc as EncryptedBlob, `account:${String(a._id)}`);
/** Client de l'API Bot pour ce compte : le mode « bac à sable » parle au faux serveur intégré, les autres à Telegram. */
export const apiFor = (a: AccountWithSecret): TelegramApi => (a.mode === 'USER' ? (new UserApi(String(a._id), accountToken(a)) as unknown as TelegramApi) : new TelegramApi(accountToken(a), a.mode === 'SANDBOX' ? sandboxBase() : undefined));

interface AccountState { mode: string; status: string; business?: { isEnabled?: boolean; canReply?: boolean } | null }
interface ConvState { lastIncomingAt?: Date | null; hasIncoming?: boolean; blocked?: boolean }
export interface ReplyState { allowed: boolean; error?: SendError; windowEndsAt: Date | null }

/**
 * Règles d'envoi (une seule source de vérité, utilisée par l'API, par la file d'envoi et par l'interface) :
 * compte connecté · connexion Business active avec droit de répondre · contact non bloqué · le contact a écrit en premier ·
 * fenêtre de 24 h ouverte (comptes Business). Le CRM n'a donc aucun moyen d'écrire à froid à un inconnu.
 */
export function replyState(account: AccountState, conv: ConvState, at = now()): ReplyState {
  const windowEndsAt = isDirectMode(account.mode) ? null : replyWindowEndsAt(conv.lastIncomingAt);
  const deny = (error: SendError): ReplyState => ({ allowed: false, error, windowEndsAt });
  if (account.status !== 'CONNECTED') return deny('CONNECTION_DISABLED');
  if (!isDirectMode(account.mode)) {
    if (!account.business?.isEnabled) return deny('CONNECTION_DISABLED');
    if (!account.business.canReply) return deny('NO_RIGHTS');
  }
  if (conv.blocked) return deny('BLOCKED');
  if (!conv.hasIncoming) return deny('WINDOW_CLOSED');
  if (!isReplyWindowOpen(account.mode as AccountMode, conv.lastIncomingAt, at)) return deny('WINDOW_CLOSED');
  return { allowed: true, windowEndsAt };
}
