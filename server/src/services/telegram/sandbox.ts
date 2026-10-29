import type { Request } from 'express';
import { env } from '../../config/env';
import { Conversation, TelegramAccount } from '../../models';
import { sandboxTelegram, type FakeUser } from '../../providers/telegram/fake';
import type { Actor } from '../../types/express';
import { AppError, notFound } from '../../utils/errors';
import { requirePermission } from '../access.service';
import { fakeId } from '../account.service';
import { audit } from '../audit.service';
import { ingestIdle } from './ingest';
import { telegramManager } from './manager';
import { accountToken, loadAccountSecret } from './runtime';

const assertSandbox = () => { if (!env.ALLOW_SANDBOX) throw new AppError(404, 'SANDBOX_DISABLED', 'Le bac à sable est désactivé sur ce serveur'); };

/**
 * Le faux Telegram vit en mémoire : au démarrage du serveur on le reconstruit depuis la base (bot, connexion Business confirmée,
 * fenêtres de 24 h). Sans cela, un redémarrage rendrait tous les comptes « bac à sable » orphelins.
 */
export async function restoreSandbox() {
  if (!env.ALLOW_SANDBOX) return 0;
  const accounts = await TelegramAccount.find({ mode: 'SANDBOX', deletedAt: null }).select('+secretEnc').lean();
  for (const a of accounts) {
    const token = accountToken(a);
    sandboxTelegram.restoreBot(token, { username: a.botUsername ?? 'sandbox_bot', name: a.botName ?? a.label, nextUpdateId: a.pollOffset ?? 1 });
    const b = a.business;
    if (!b?.connectionId) continue;
    sandboxTelegram.restoreBusiness(token, {
      connectionId: b.connectionId, owner: { id: Number(b.userId), first_name: b.userName || a.label, username: b.userUsername || undefined },
      enabled: !!b.isEnabled, rights: { can_reply: !!b.canReply, can_read_messages: !!b.canRead },
    });
    const convs = await Conversation.find({ accountId: a._id, lastIncomingAt: { $ne: null } }).select('chatId lastIncomingAt').lean();
    for (const c of convs) sandboxTelegram.restoreIncoming(token, b.connectionId, Number(c.chatId), new Date(c.lastIncomingAt!).getTime());
  }
  return accounts.length;
}

async function loadSandbox(actor: Actor, id: string) {
  assertSandbox();
  const a = await loadAccountSecret(id);
  if (!a || a.deletedAt || String(a.agencyId) !== actor.agencyId) throw notFound('Compte introuvable');
  if (a.mode !== 'SANDBOX') throw new AppError(400, 'NOT_SANDBOX', 'Cette action n’existe que pour les comptes en bac à sable');
  if (!sandboxTelegram.hasBot(accountToken(a))) await restoreSandbox();
  return a;
}

/** Simule le modèle qui connecte le bot dans « Telegram › Paramètres › Telegram Business › Chatbots ». */
export async function sandboxConnect(actor: Actor, id: string, rights: { canReply: boolean; canRead: boolean }, req: Request) {
  requirePermission(actor, 'accounts.manage');
  const a = await loadSandbox(actor, id);
  const token = accountToken(a);
  const owner: FakeUser = { id: fakeId(`owner:${a.label}`), first_name: a.label, username: `${a.label.toLowerCase().replace(/[^a-z0-9]+/g, '')}`.slice(0, 24) || undefined };
  await sandboxTelegram.connectBusiness(token, owner, { rights: { can_reply: rights.canReply, can_read_messages: rights.canRead } });
  await telegramManager.pollOnce(id);
  await audit(req, actor.agencyId, actor.id, 'SANDBOX_CONNECT', 'TelegramAccount', id);
}

/** Simule un contact qui écrit au compte du modèle (le message traverse le vrai chemin : API Bot → ingestion → inbox). */
export async function sandboxIncoming(actor: Actor, id: string, input: { fanName: string; fanUsername?: string; fanId?: string; text: string }) {
  requirePermission(actor, 'inbox.supervise');
  const a = await loadSandbox(actor, id);
  const conn = a.business;
  if (!conn?.connectionId || !conn.isEnabled) throw new AppError(409, 'NOT_CONNECTED', 'Connectez d’abord le compte (étape « Connexion Business »)');
  const fan: FakeUser = { id: input.fanId ? Number(input.fanId) : fakeId(`fan:${input.fanName.toLowerCase()}`), first_name: input.fanName, username: input.fanUsername || undefined };
  await sandboxTelegram.fanSends(accountToken(a), conn.connectionId, fan, { text: input.text });
  await telegramManager.pollOnce(id);
  await ingestIdle();
}
