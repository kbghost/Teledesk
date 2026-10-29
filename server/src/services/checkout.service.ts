import { Checkout, Message } from '../models';
import { env } from '../config/env';
import { randomToken } from '../utils/helpers';
import { nowDate } from '../utils/clock';

export const euros = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',').replace(',00', '')} €`;

/** URL publique de la page de paiement. Telegram n'ouvre que des liens HTTPS publics : sans PUBLIC_URL, pas de bouton (déblocage manuel). */
export function checkoutUrl(token: string): string | null {
  const base = env.PUBLIC_URL.replace(/\/$/, '');
  if (!base) return null;
  return `${base}/pay/${token}`;
}

/** Un lien de paiement par média payant envoyé (idempotent : un renvoi après échec réutilise le même lien). */
export async function ensureCheckout(m: InstanceType<typeof Message>, assetName: string) {
  const existing = await Checkout.findOne({ messageId: m._id });
  if (existing) return existing;
  try {
    return await Checkout.create({
      token: randomToken(24), agencyId: m.agencyId, accountId: m.accountId, conversationId: m.conversationId, messageId: m._id,
      assetName: assetName.slice(0, 120), amountCents: m.ppv!.priceCents, provider: env.PAYMENT_PROVIDER === 'stripe' ? 'STRIPE' : 'SIMULATED',
      expiresAt: new Date(nowDate().getTime() + env.CHECKOUT_TTL_HOURS * 3600_000),
    });
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
    return (await Checkout.findOne({ messageId: m._id }))!;
  }
}
