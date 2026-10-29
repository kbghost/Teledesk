import { logger } from '../config/logger';
import { Invite, Session } from '../models';
import { resumeOutbound } from '../services/telegram/outbound';
import { telegramManager } from '../services/telegram/manager';

let timer: NodeJS.Timeout | undefined;

/** Tâche de surveillance (60 s) : relance l'écoute des comptes tombés, reprend les envois bloqués, purge les invitations et sessions expirées. */
async function tick() {
  try {
    await telegramManager.startAll();
    await resumeOutbound();
    const now = new Date();
    await Invite.deleteMany({ expiresAt: { $lt: new Date(now.getTime() - 30 * 864e5) } });
    await Session.deleteMany({ expiresAt: { $lt: now } });
  } catch (err) {
    logger.error({ err }, 'job failed');
  }
}
export function startJobs() { if (!timer) { timer = setInterval(() => void tick(), 60_000); timer.unref(); } }
export function stopJobs() { if (timer) clearInterval(timer); timer = undefined; }
