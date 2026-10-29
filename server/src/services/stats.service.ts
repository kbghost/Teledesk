import { DailyStat } from '../models';
import { dayKey } from '../utils/helpers';
import { nowDate } from '../utils/clock';

export type StatInc = Partial<Record<'messagesIn' | 'messagesOut' | 'newConversations' | 'salesCount' | 'salesCents' | 'feeCents' | 'respCount' | 'respMsSum', number>>;

/**
 * Incrémente les compteurs journaliers (UTC) d'un compte et d'un opérateur. Idempotent côté base grâce à l'index unique
 * (agence, compte, opérateur, jour) : si deux évènements créent la ligne en même temps, le second réessaie en simple incrément.
 */
export async function bumpStat(agencyId: unknown, accountId: unknown, userId: unknown | null, inc: StatInc, day = dayKey(nowDate())) {
  const filter = { agencyId, accountId, userId: userId ?? null, day };
  for (let i = 0; i < 3; i++) {
    try {
      await DailyStat.updateOne(filter, { $inc: inc }, { upsert: true });
      return;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000 || i === 2) throw e;
    }
  }
}
