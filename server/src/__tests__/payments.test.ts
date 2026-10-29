import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { api, auth, addMember, boot, convsOf, fanWrites, makeAccount, registerOwner, shutdown, tick } from './helpers';
import { sandboxTelegram } from '../providers/telegram/fake';
import { accountToken, loadAccountSecret } from '../services/telegram/runtime';
import { env } from '../config/env';
import { Checkout, Message } from '../models';

let owner: string; let ch: { token: string; id: string }; let acc: string; let conv: string; let assetId: string; let ppvId: string; let token: string;
const sent = async () => sandboxTelegram.sentTo(accountToken((await loadAccountSecret(acc))!));

beforeAll(async () => {
  await boot();
  owner = (await registerOwner('own@pay.test')).token;
  acc = await makeAccount(owner, 'Luna');
  ch = await addMember(owner, 'CHATTER', 'c1@pay.test', [acc]);
  await fanWrites(owner, acc, 'Marc', 'salut');
  conv = (await convsOf(ch.token)).body.items[0].id;
  const img = await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
  assetId = (await api().post('/api/library/assets').set(auth(owner)).field('priceCents', '2000').field('accountId', acc).attach('file', img, 'pack.png')).body.id;
});
afterAll(shutdown);

describe('paiement du média payant par le fan', () => {
  it('l’aperçu verrouillé part avec un bouton « Débloquer — 20 € » qui mène à la page de paiement', async () => {
    const r = await api().post(`/api/conversations/${conv}/messages`).set(auth(ch.token)).send({ assetId, text: 'Pour toi 🔥' });
    ppvId = r.body.id;
    await tick();
    const s = (await sent()).filter((x) => x.file);
    expect(s).toHaveLength(1);
    const btn = s[0]!.buttons?.[0]?.[0];
    expect(btn?.text).toBe('🔓 Débloquer — 20 €');
    expect(btn?.url).toMatch(/^https:\/\/pay\.example\.test\/pay\/[\w-]{20,}$/);
    token = btn!.url!.split('/').pop()!;
  });
  it('la page de paiement s’affiche (mode simulation clairement annoncé, aucune vraie carte)', async () => {
    const r = await api().get(`/pay/${token}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Mode simulation');
    expect(r.text).toContain('Payer 20 €');
    expect(r.text).toContain('action="/pay/' + token + '/confirm"');
    expect((await api().get('/pay/inconnu123')).text).toContain('Lien invalide');
  });
  it('payer débloque automatiquement : original envoyé, UNE vente (20 € brut, 3 € commission, 17 € net) créditée au chatter', async () => {
    const before = (await sent()).filter((x) => x.file).length;
    const [a, b] = await Promise.all([api().post(`/pay/${token}/confirm`), api().post(`/pay/${token}/confirm`)]); // double clic
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(a.text + b.text).toContain('Paiement confirmé');
    await tick(); await tick();
    expect((await sent()).filter((x) => x.file).length).toBe(before + 1);
    const m = await Message.findById(ppvId).lean();
    expect(m?.ppv?.state).toBe('UNLOCKED');
    expect(m?.ppv?.via).toBe('CHECKOUT');
    const sales = await api().get('/api/sales').set(auth(owner));
    const mine = sales.body.items.filter((x: any) => x.source === 'PPV_PAID');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ grossCents: 2000, feeCents: 300, netCents: 1700, recordedBy: ch.id });
    expect((await api().get(`/pay/${token}`)).text).toContain('Déjà débloqué');
    expect((await api().post(`/api/messages/${ppvId}/unlock`).set(auth(ch.token))).status).toBe(409);
  });
  it('un lien expiré ne peut plus être payé', async () => {
    await api().post(`/api/conversations/${conv}/messages`).set(auth(ch.token)).send({ assetId });
    await tick();
    const co = await Checkout.findOne({ status: 'PENDING' });
    await Checkout.updateOne({ _id: co!._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await api().post(`/pay/${co!.token}/confirm`);
    expect(r.status).toBe(410);
    expect(r.text).toContain('Lien expiré');
  });
});

describe('Stripe réel (webhook signé)', () => {
  const sign = (body: string, secret = env.STRIPE_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  it('la simulation est coupée en mode stripe ; un webhook signé débloque, un faux est refusé', async () => {
    (env as any).PAYMENT_PROVIDER = 'stripe';
    await api().post(`/api/conversations/${conv}/messages`).set(auth(ch.token)).send({ assetId });
    await tick();
    const co = await Checkout.findOne({ status: 'PENDING', provider: 'STRIPE', expiresAt: { $gt: new Date() } });
    expect(co).toBeTruthy();
    expect((await api().post(`/pay/${co!.token}/confirm`)).status).toBe(403); // pas de « faux paiement » en production
    const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', metadata: { token: co!.token } } } });
    expect((await api().post('/api/stripe/webhook').set('stripe-signature', sign(body, 'autre_secret')).set('content-type', 'application/json').send(body)).status).toBe(400);
    expect((await api().post('/api/stripe/webhook').set('stripe-signature', sign(body, undefined, 1000)).set('content-type', 'application/json').send(body)).status).toBe(400); // trop ancien
    expect((await api().post('/api/stripe/webhook').set('content-type', 'application/json').send(body)).status).toBe(400);
    const ok = await api().post('/api/stripe/webhook').set('stripe-signature', sign(body)).set('content-type', 'application/json').send(body);
    expect(ok.status).toBe(200);
    await api().post('/api/stripe/webhook').set('stripe-signature', sign(body)).set('content-type', 'application/json').send(body); // rejeu
    await tick(); await tick();
    const after = await Checkout.findById(co!._id).lean();
    expect(after).toMatchObject({ status: 'PAID', providerRef: 'cs_test_1' });
    const sales = (await api().get('/api/sales').set(auth(owner))).body.items.filter((x: any) => x.source === 'PPV_PAID');
    expect(sales).toHaveLength(2); // une par PPV payé, jamais deux pour le rejeu
    (env as any).PAYMENT_PROVIDER = 'simulated';
  });
});
