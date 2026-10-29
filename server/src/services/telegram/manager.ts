import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { Agency, TelegramAccount } from '../../models';
import { TelegramApiError } from '../../providers/telegram/api';
import { nowDate } from '../../utils/clock';
import { AppError } from '../../utils/errors';
import { sleep } from '../../utils/queue';
import { ingestUpdate } from './ingest';
import { accountToken, apiFor, loadAccountSecret } from './runtime';
import { userListen } from '../../providers/telegram/user';

interface Ctl { stopped: boolean; done: Promise<void>; stopFn?: () => Promise<void> }
const running = new Map<string, Ctl>();
const poisoned = new Map<string, number>();
const MAX_TRIES_PER_UPDATE = 3;

export const publicWebhookUrl = (accountId: string) => `${env.PUBLIC_URL.replace(/\/$/, '')}/api/telegram/webhook/${accountId}`;
/** Le mode webhook exige une adresse HTTPS publique ; sinon le serveur interroge Telegram lui-même (long polling). */
export const hasPublicHttps = () => /^https:\/\//i.test(env.PUBLIC_URL);

async function markError(id: string, detail: string) {
  await TelegramAccount.updateOne({ _id: id }, { $set: { status: 'ERROR', statusDetail: detail } });
}

/** Un passage de long polling. Retourne le nombre d'évènements traités, ou -1 si le compte n'est plus à écouter. */
async function pollBatch(id: string, timeoutS: number, ctl?: Ctl): Promise<number> {
  const account = await loadAccountSecret(id);
  if (!account || account.deletedAt || account.status === 'DISCONNECTED' || account.transport !== 'POLLING') return -1;
  const updates = await apiFor(account).getUpdates(account.pollOffset ?? 0, timeoutS);
  if (ctl?.stopped) return -1; // arrêt demandé pendant l'attente : rien n'est acquitté, Telegram redonnera ces évènements
  for (const u of updates) {
    try { await ingestUpdate(account, u); }
    catch (err) {
      // L'évènement n'est pas acquitté tant qu'il échoue (panne de base momentanée) ; un évènement « empoisonné » est abandonné après 3 essais.
      const key = `${id}:${u.update_id}`;
      const n = (poisoned.get(key) ?? 0) + 1;
      poisoned.set(key, n);
      if (n < MAX_TRIES_PER_UPDATE) throw err;
      logger.error({ err, updateId: u.update_id }, 'update abandoned after repeated failures');
      poisoned.delete(key);
    }
  }
  if (updates.length) await TelegramAccount.updateOne({ _id: id }, { $set: { pollOffset: updates[updates.length - 1]!.update_id + 1, lastEventAt: nowDate() } });
  return updates.length;
}

async function loop(id: string, ctl: Ctl) {
  let backoff = 1000;
  while (!ctl.stopped) {
    try {
      const n = await pollBatch(id, env.POLL_TIMEOUT_S, ctl);
      if (n < 0) break;
      backoff = 1000;
    } catch (e) {
      if (ctl.stopped) break;
      if (e instanceof TelegramApiError && e.isAuth) { await markError(id, 'Jeton refusé par Telegram : remplacez-le dans les paramètres du compte.'); break; }
      if (e instanceof TelegramApiError && e.code === 409) {
        // un webhook est encore actif côté Telegram : on le retire pour reprendre le polling
        try { const a = await loadAccountSecret(id); if (a) await apiFor(a).deleteWebhook(); } catch { /* réessayé au tour suivant */ }
      } else logger.warn({ err: e instanceof TelegramApiError ? e.description : (e as Error).message }, 'polling error');
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
}

export const telegramManager = {
  isRunning: (id: string) => running.has(id),
  count: () => running.size,
  /** Un seul passage, sans attente (tests, démo, vérification manuelle). */
  pollOnce: (id: string) => pollBatch(id, 0),

  async registerWebhook(id: string) {
    const account = await loadAccountSecret(id);
    if (!account) return;
    if (!hasPublicHttps()) throw new AppError(400, 'PUBLIC_URL_REQUIRED', 'PUBLIC_URL (HTTPS) est requis pour le mode webhook');
    await apiFor(account).setWebhook(publicWebhookUrl(id), account.webhookSecret!);
  },

  /** Démarre l'écoute d'un compte (polling ou webhook selon sa configuration). Idempotent. */
  async start(id: string) {
    if (running.has(id)) return;
    const account = await loadAccountSecret(id);
    if (!account || account.deletedAt || account.status === 'DISCONNECTED' || account.status === 'ERROR') return;
    if (account.mode === 'USER') {
      // Compte personnel : une connexion MTProto persistante (aucun polling HTTP). Rien à écouter tant que le code n'a pas été validé.
      if (account.status !== 'CONNECTED') return;
      const ctl: Ctl = { stopped: false, done: Promise.resolve() };
      running.set(id, ctl);
      try {
        let seq = Date.now();
        ctl.stopFn = await userListen(id, accountToken(account), async (message) => {
          const fresh = await loadAccountSecret(id);
          if (fresh && !fresh.deletedAt) { await ingestUpdate(fresh, { update_id: ++seq, message }); await TelegramAccount.updateOne({ _id: id }, { $set: { lastEventAt: nowDate() } }); }
        });
      } catch (e) {
        running.delete(id);
        const detail = e instanceof TelegramApiError && e.isAuth ? 'Session refusée par Telegram : reconnectez le compte avec le numéro.' : 'Connexion à Telegram impossible (réessayée automatiquement).';
        if (e instanceof TelegramApiError && e.isAuth) await markError(id, detail); else logger.warn({ err: (e as Error).message, accountId: id }, 'user listen failed');
      }
      return;
    }
    if (account.transport === 'WEBHOOK') { await this.registerWebhook(id); return; }
    try { await apiFor(account).deleteWebhook(); } catch (e) {
      if (e instanceof TelegramApiError && e.isAuth) { await markError(id, 'Jeton refusé par Telegram : remplacez-le dans les paramètres du compte.'); return; }
    }
    const ctl: Ctl = { stopped: false, done: Promise.resolve() };
    running.set(id, ctl);
    ctl.done = loop(id, ctl).finally(() => { if (running.get(id) === ctl) running.delete(id); });
  },

  stop(id: string) {
    const ctl = running.get(id);
    if (ctl) { ctl.stopped = true; running.delete(id); void ctl.stopFn?.().catch(() => undefined); }
  },
  async stopAll() {
    const all = [...running.values()];
    all.forEach((c) => { c.stopped = true; void c.stopFn?.().catch(() => undefined); });
    running.clear();
    await Promise.race([Promise.all(all.map((c) => c.done)), sleep(3000)]);
  },

  /** Au démarrage du serveur, et régulièrement (tâche de surveillance) : relance l'écoute des comptes actifs. */
  async startAll() {
    if (!env.TELEGRAM_AUTOSTART) return 0;
    const banned = (await Agency.find({ status: 'BANNED' }).select('_id').lean()).map((a) => a._id);
    const accounts = await TelegramAccount.find({ deletedAt: null, status: { $in: ['PENDING', 'CONNECTED'] }, ...(banned.length ? { agencyId: { $nin: banned } } : {}) }).select('_id').lean();
    let n = 0;
    for (const a of accounts) {
      const id = String(a._id);
      if (running.has(id)) continue;
      try { await this.start(id); n++; } catch (err) { logger.warn({ err, accountId: id }, 'telegram start failed'); }
    }
    return n;
  },
};
