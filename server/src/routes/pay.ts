import express, { Router } from 'express';
import { env } from '../config/env';
import { asyncHandler as h } from '../utils/helpers';
import { authLimiter } from '../middleware';
import { handleStripeWebhook, markPaid, renderCheckoutPage, stripeSessionUrl, viewCheckout, getCheckoutThumbnail } from '../services/payments.service';

/** Pages publiques de paiement (lien reçu par le fan dans Telegram) : le jeton aléatoire du lien est la seule clé. */
export const payRouter = Router();
const noStore = (res: express.Response) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); };

payRouter.get('/:token/thumb', authLimiter, h(async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  const buf = await getCheckoutThumbnail(String(req.params.token));
  res.type('image/jpeg').send(buf);
}));

payRouter.get('/:token', authLimiter, h(async (req, res) => {
  noStore(res);
  const v = await viewCheckout(String(req.params.token));
  res.type('html').send(renderCheckoutPage(v, { justPaid: req.query.done === '1' }));
}));

// Simulation : « payer » confirme immédiatement. Interdit si Stripe est le mode choisi.
// Retour JSON si appelé avec Accept: application/json (fetch async depuis la page HTML),
// sinon HTML classique (tests, formulaires de fallback).
payRouter.post('/:token/confirm', authLimiter, express.urlencoded({ extended: false }), h(async (req, res) => {
  noStore(res);
  const wantsJson = req.get('Accept') === 'application/json';
  if (env.PAYMENT_PROVIDER !== 'simulated') {
    if (wantsJson) return void res.status(403).json({ error: 'MODE_MISMATCH' });
    return void res.status(403).type('html').send(renderCheckoutPage({ state: 'UNKNOWN' }));
  }
  const token = String(req.params.token);
  const r = await markPaid(token, 'SIMULATED', `sim_${Date.now()}`);
  // Réponse JSON (appel fetch depuis la page de checkout HTML)
  if (wantsJson) {
    return void res.json({ result: r });
  }
  // Fallback HTML classique (tests, soumission de formulaire sans JS)
  if (r === 'UNKNOWN') return void res.status(404).type('html').send(renderCheckoutPage({ state: 'UNKNOWN' }));
  if (r === 'EXPIRED') return void res.status(410).type('html').send(renderCheckoutPage({ state: 'EXPIRED' }));
  const v = await viewCheckout(token);
  res.type('html').send(renderCheckoutPage(v, { justPaid: r === 'PAID' }));
}));

payRouter.post('/:token/start', authLimiter, h(async (req, res) => {
  if (env.PAYMENT_PROVIDER !== 'stripe') return res.status(403).type('html').send(renderCheckoutPage({ state: 'UNKNOWN' }));
  res.redirect(303, await stripeSessionUrl(String(req.params.token)));
}));

/** Webhook Stripe : corps BRUT obligatoire pour vérifier la signature. */
export const stripeWebhook = Router();
stripeWebhook.post('/', express.raw({ type: '*/*', limit: '1mb' }), h(async (req, res) => {
  res.json({ received: true, ...(await handleStripeWebhook(req.body as Buffer, req.get('stripe-signature'))) });
}));
