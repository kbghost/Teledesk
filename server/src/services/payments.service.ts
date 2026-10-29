import crypto from 'node:crypto';
import sharp from 'sharp';
import { Checkout, Conversation, Message, TelegramAccount } from '../models';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../utils/errors';
import { nowDate } from '../utils/clock';
import { euros, checkoutUrl } from './checkout.service';
import { unlockPaid } from './telegram/outbound';
import { getStorage } from '../providers/storage';

export type CheckoutView =
  | {
      state: 'OPEN';
      token: string;
      assetName: string;
      amountCents: number;
      provider: 'SIMULATED' | 'STRIPE';
      creatorName: string;
      creatorUsername: string;
      teaserText: string;
      mediaKind: string;
      formattedPrice: string;
      chatUrl: string;
    }
  | { state: 'PAID'; chatUrl: string; token?: string }
  | { state: 'EXPIRED'; chatUrl: string; token?: string }
  | { state: 'UNKNOWN'; chatUrl: string; token?: string };

export async function viewCheckout(token: string): Promise<CheckoutView> {
  const c = await Checkout.findOne({ token }).lean();
  if (!c) return { state: 'UNKNOWN', chatUrl: 'https://t.me' };

  const [account, conv, msg] = await Promise.all([
    TelegramAccount.findById(c.accountId).lean(),
    Conversation.findById(c.conversationId).lean(),
    Message.findById(c.messageId).lean(),
  ]);

  const creatorName = account?.business?.userName || account?.botName || account?.label || 'Prince';
  const creatorUsername = account?.business?.userUsername || account?.botUsername || (account?.label ? account.label.toLowerCase().replace(/[^a-z0-9_]+/g, '_') : 'ettine_');
  let chatUrl = 'https://t.me';
  if (account?.botUsername) {
    chatUrl = `https://t.me/${account.botUsername}`;
  } else if (account?.business?.userUsername) {
    chatUrl = `https://t.me/${account.business.userUsername}`;
  } else if (conv?.chatId) {
    chatUrl = `tg://user?id=${conv.chatId}`;
  }

  if (c.status === 'PAID') return { state: 'PAID', chatUrl, token };
  if (c.status === 'CANCELLED' || c.expiresAt.getTime() < nowDate().getTime()) return { state: 'EXPIRED', chatUrl, token };

  const teaserText = msg?.text || 'Viens me prendre en missionnaire 💦💦💦';
  const mediaKind = msg?.attachment?.kind || 'VIDEO';

  return {
    state: 'OPEN',
    token,
    assetName: c.assetName || (mediaKind === 'VIDEO' ? '2 photos et 2 vidéos' : 'Contenu exclusif'),
    amountCents: c.amountCents,
    provider: c.provider,
    creatorName,
    creatorUsername,
    teaserText,
    mediaKind,
    formattedPrice: euros(c.amountCents),
    chatUrl,
  };
}

export async function getCheckoutThumbnail(token: string): Promise<Buffer> {
  const c = await Checkout.findOne({ token }).lean();
  if (c?.messageId) {
    const msg = await Message.findById(c.messageId).lean();
    const storage = getStorage();
    const key = msg?.attachment?.thumbKey || msg?.attachment?.key;
    if (key) {
      try {
        const stream = await storage.getStream('private', key);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        const buf = Buffer.concat(chunks);
        return await sharp(buf)
          .resize({ width: 720, height: 720, fit: 'cover' })
          .blur(30)
          .modulate({ brightness: 0.65 })
          .jpeg({ quality: 80 })
          .toBuffer();
      } catch {
        /* fallback to stylized background */
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720">
    <defs>
      <radialGradient id="bg" cx="40%" cy="35%" r="65%">
        <stop offset="0%" stop-color="#4c382b"/>
        <stop offset="35%" stop-color="#2a201b"/>
        <stop offset="70%" stop-color="#141110"/>
        <stop offset="100%" stop-color="#080707"/>
      </radialGradient>
      <radialGradient id="highlight" cx="60%" cy="60%" r="50%">
        <stop offset="0%" stop-color="#8a533c" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <rect width="100%" height="100%" fill="url(#highlight)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

/**
 * Paiement confirmé (simulation, ou webhook Stripe signé). Idempotent : le lien passe à PAID une seule fois, puis le déblocage
 * (lui-même protégé par un index unique) livre l'original et crée UNE vente (brut, commission 15 %, net).
 */
export async function markPaid(token: string, provider: 'SIMULATED' | 'STRIPE', providerRef: string): Promise<'PAID' | 'ALREADY' | 'EXPIRED' | 'UNKNOWN'> {
  const c = await Checkout.findOne({ token });
  if (!c) return 'UNKNOWN';
  if (c.status === 'CANCELLED') return 'EXPIRED';
  if (c.provider !== provider) throw new AppError(409, 'WRONG_PROVIDER', 'Mode de paiement incompatible avec ce lien');
  if (c.status === 'PENDING') {
    if (provider === 'SIMULATED' && c.expiresAt.getTime() < nowDate().getTime()) return 'EXPIRED';
    await Checkout.updateOne({ _id: c._id, status: 'PENDING' }, { $set: { status: 'PAID', paidAt: nowDate(), providerRef } });
  }
  const r = await unlockPaid(String(c.messageId));
  if (r === 'MISSING') logger.warn({ token }, 'paiement reçu mais PPV introuvable');
  return c.status === 'PAID' && r === 'ALREADY' ? 'ALREADY' : 'PAID';
}

// ───────────── Stripe Checkout (réel, activé par PAYMENT_PROVIDER=stripe) ─────────────
export async function stripeSessionUrl(token: string): Promise<string> {
  if (!env.STRIPE_SECRET_KEY) throw new AppError(500, 'STRIPE_NOT_CONFIGURED', 'Stripe n’est pas configuré');
  const c = await Checkout.findOne({ token }).lean();
  if (!c || c.status !== 'PENDING') throw new AppError(409, 'CHECKOUT_CLOSED', 'Ce lien n’est plus valable');
  const back = checkoutUrl(token)!;
  const form = new URLSearchParams({
    mode: 'payment',
    client_reference_id: token,
    'metadata[token]': token,
    success_url: `${back}?done=1`,
    cancel_url: back,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': c.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(c.amountCents),
    'line_items[0][price_data][product_data][name]': c.assetName || 'Contenu exclusif',
  });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const j = (await r.json()) as { url?: string; id?: string; error?: { message?: string } };
  if (!r.ok || !j.url) throw new AppError(502, 'STRIPE_ERROR', j.error?.message ?? 'Stripe a refusé la création du paiement');
  await Checkout.updateOne({ token }, { $set: { providerRef: j.id ?? '' } });
  return j.url;
}

/** Vérifie la signature d'un webhook Stripe (en-tête `Stripe-Signature`, HMAC-SHA256, tolérance 5 minutes) puis traite `checkout.session.completed`. */
export function verifyStripeSignature(raw: Buffer, header: string, secret: string, now = Date.now()): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw.toString('utf8')}`).digest('hex');
  const given = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  return given.some((g) => g.length === expected.length && crypto.timingSafeEqual(Buffer.from(g), Buffer.from(expected)));
}

export async function handleStripeWebhook(raw: Buffer, signature: string | undefined) {
  if (!env.STRIPE_WEBHOOK_SECRET || !signature || !verifyStripeSignature(raw, signature, env.STRIPE_WEBHOOK_SECRET))
    throw new AppError(400, 'BAD_SIGNATURE', 'Signature invalide');
  const ev = JSON.parse(raw.toString('utf8')) as {
    type: string;
    data?: { object?: { id?: string; payment_status?: string; metadata?: { token?: string }; client_reference_id?: string } };
  };
  if (ev.type !== 'checkout.session.completed' && ev.type !== 'checkout.session.async_payment_succeeded')
    return { ignored: true };
  const o = ev.data?.object;
  const token = o?.metadata?.token ?? o?.client_reference_id;
  if (!token || o?.payment_status !== 'paid') return { ignored: true };
  return { result: await markPaid(token, 'STRIPE', o.id ?? '') };
}

// ───────────── Pages HTML Ultra-Pro avec Google Poppins & Interface Telegram ─────────────
const esc = (s: string) =>
  String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const htmlShell = (title: string, bodyContent: string, thumbUrl?: string) => `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
  <meta name="robots" content="noindex,nofollow" />
  <meta name="theme-color" content="#111827" />
  <title>${esc(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,600&display=swap" rel="stylesheet" />
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Poppins', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: #0b0c10;
      color: #ffffff;
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
      padding-bottom: env(safe-area-inset-bottom);
    }
    .bg-backdrop {
      position: fixed;
      inset: 0;
      background: ${thumbUrl ? `url("${thumbUrl}") center/cover no-repeat` : '#181920'};
      filter: blur(28px) brightness(0.65);
      transform: scale(1.15);
      z-index: 0;
      pointer-events: none;
    }
    .bg-overlay {
      position: fixed;
      inset: 0;
      background: radial-gradient(circle at 50% 30%, rgba(17, 24, 39, 0.4) 0%, rgba(10, 11, 16, 0.85) 100%);
      z-index: 1;
      pointer-events: none;
    }
    .main-wrapper {
      position: relative;
      z-index: 2;
      width: 100%;
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 16px 20px 24px;
    }
    .top-bar {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      font-size: 13px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.8);
      letter-spacing: -0.01em;
    }
    .center-content {
      width: 100%;
      max-width: 480px;
      margin: 0 auto;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
    }
    .unlock-title {
      font-size: clamp(24px, 5.5vw, 32px);
      font-weight: 700;
      color: #ffffff;
      line-height: 1.2;
      letter-spacing: -0.02em;
    }
    .unlock-subtitle {
      font-size: clamp(22px, 5vw, 28px);
      font-weight: 700;
      color: #ffffff;
      line-height: 1.2;
      letter-spacing: -0.02em;
      margin-top: -6px;
    }
    .creator-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.88);
      margin-top: 2px;
      margin-bottom: 6px;
    }
    .creator-badge .icon {
      font-size: 14px;
      color: #ff3366;
    }
    .btn-fanclub {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: auto;
      min-width: 200px;
      background: linear-gradient(135deg, #ff2a6d 0%, #ff0853 100%);
      color: #ffffff;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      padding: 11px 24px;
      border-radius: 9999px;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 18px rgba(255, 18, 92, 0.45);
      transition: transform 0.15s ease, filter 0.15s ease;
    }
    .btn-fanclub:active {
      transform: scale(0.97);
      filter: brightness(0.92);
    }
    .divider-row {
      display: flex;
      align-items: center;
      width: 100%;
      max-width: 240px;
      margin: 10px 0 6px;
      gap: 12px;
    }
    .divider-line {
      flex: 1;
      height: 1px;
      background: rgba(255, 255, 255, 0.2);
    }
    .divider-text {
      font-size: 13px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.65);
    }
    .single-title {
      font-size: clamp(19px, 4.5vw, 24px);
      font-weight: 700;
      color: #ffffff;
      line-height: 1.25;
      letter-spacing: -0.015em;
    }
    .teaser-text {
      font-size: 14px;
      font-style: italic;
      color: rgba(255, 255, 255, 0.85);
      margin: 4px 0 10px;
      max-width: 380px;
      line-height: 1.45;
    }
    .btn-pay-single {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 150px;
      background: rgba(24, 76, 42, 0.65);
      border: 1.5px solid #22c55e;
      color: #ffffff;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      padding: 10px 28px;
      border-radius: 9999px;
      cursor: pointer;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 16px rgba(34, 197, 94, 0.3);
      transition: transform 0.15s ease, background 0.15s ease;
    }
    .btn-pay-single:active {
      transform: scale(0.97);
      background: rgba(34, 197, 94, 0.4);
    }

    /* Modal Checkout */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(12px);
      z-index: 50;
      display: none;
      align-items: flex-end;
      justify-content: center;
      animation: fadeIn 0.2s ease-out;
    }
    .modal-backdrop.open {
      display: flex;
    }
    @media (min-width: 640px) {
      .modal-backdrop {
        align-items: center;
      }
    }
    .modal-card {
      width: 100%;
      max-width: 440px;
      background: #ffffff;
      color: #0f172a;
      border-radius: 24px 24px 0 0;
      padding: 22px 20px 28px;
      position: relative;
      animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    }
    @media (min-width: 640px) {
      .modal-card {
        border-radius: 24px;
      }
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }
    .modal-title {
      font-size: 17px;
      font-weight: 700;
      color: #0f172a;
    }
    .modal-close {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #f1f5f9;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      color: #64748b;
      cursor: pointer;
    }
    .banner {
      background: #fef3c7;
      border: 1px solid #fde68a;
      color: #92400e;
      border-radius: 12px;
      padding: 9px 12px;
      font-size: 12px;
      line-height: 1.4;
      margin-bottom: 14px;
    }
    .prod-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 12px 14px;
      margin-bottom: 14px;
    }
    .prod-summary-left {
      text-align: left;
    }
    .prod-summary-name {
      font-size: 13.5px;
      font-weight: 600;
      color: #0f172a;
    }
    .prod-summary-sub {
      font-size: 12px;
      color: #64748b;
      margin-top: 1px;
    }
    .prod-summary-price {
      font-size: 18px;
      font-weight: 700;
      color: #4f46e5;
    }

    .methods-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }
    .method-pill {
      border: 1.5px solid #e2e8f0;
      border-radius: 12px;
      padding: 9px 10px;
      font-size: 12px;
      font-weight: 600;
      color: #334155;
      background: #f8fafc;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: left;
    }
    .method-pill.active {
      border-color: #4f46e5;
      background: #eef2ff;
      color: #4338ca;
    }

    .field-group {
      margin-bottom: 10px;
      text-align: left;
    }
    .field-label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #475569;
      margin-bottom: 4px;
    }
    .field-input {
      width: 100%;
      padding: 10px 12px;
      font-size: 14px;
      font-family: inherit;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      background: #f8fafc;
      color: #0f172a;
    }
    .field-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .btn-submit-pay {
      width: 100%;
      background: #4f46e5;
      color: #ffffff;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      padding: 13px;
      border-radius: 12px;
      border: none;
      cursor: pointer;
      margin-top: 8px;
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.35);
      transition: filter 0.15s ease, transform 0.15s ease;
    }
    .btn-submit-pay:active {
      filter: brightness(0.92);
      transform: scale(0.98);
    }
    .btn-submit-pay:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .secure-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      font-size: 11.5px;
      color: #64748b;
      margin-top: 10px;
    }

    /* Result Card (Paid / Expired / Error) */
    .card-result {
      background: #ffffff;
      color: #0f172a;
      border-radius: 20px;
      padding: 32px 20px;
      max-width: 420px;
      margin: 40px auto;
      text-align: center;
      box-shadow: 0 10px 35px rgba(0, 0, 0, 0.3);
    }
    .card-result .icon-large {
      font-size: 48px;
      margin-bottom: 12px;
    }
    .card-result h1 {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .card-result p {
      font-size: 14px;
      color: #64748b;
      line-height: 1.5;
      margin-bottom: 20px;
    }
    .btn-return-tg {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      background: #0088cc;
      color: #ffffff;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      padding: 13px 20px;
      border-radius: 12px;
      border: none;
      text-decoration: none;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 136, 204, 0.35);
    }
  </style>
</head>
<body>
  <div class="bg-backdrop"></div>
  <div class="bg-overlay"></div>
  ${bodyContent}
</body>
</html>`;

export function renderCheckoutPage(v: CheckoutView, opts: { justPaid?: boolean } = {}): string {
  if (v.state === 'UNKNOWN') {
    return htmlShell(
      'Lien invalide',
      `<div class="main-wrapper" style="justify-content:center;">
        <div class="card-result">
          <div class="icon-large">🔗</div>
          <h1>Lien invalide</h1>
          <p>Ce lien de paiement n’existe pas. Demande-en un nouveau dans la conversation Telegram.</p>
          <a href="${esc(v.chatUrl)}" class="btn-return-tg">👉 Revenir à la discussion Telegram</a>
        </div>
      </div>`,
    );
  }

  if (v.state === 'EXPIRED') {
    return htmlShell(
      'Lien expiré',
      `<div class="main-wrapper" style="justify-content:center;">
        <div class="card-result">
          <div class="icon-large">⌛</div>
          <h1>Lien expiré</h1>
          <p>Ce lien de paiement n’est plus valable. Demande-en un nouveau dans la conversation Telegram.</p>
          <a href="${esc(v.chatUrl)}" class="btn-return-tg">👉 Revenir à la discussion Telegram</a>
        </div>
      </div>`,
    );
  }

  if (v.state === 'PAID') {
    const isNew = opts.justPaid;
    return htmlShell(
      isNew ? 'Paiement confirmé' : 'Déjà débloqué',
      `<div class="main-wrapper" style="justify-content:center;">
        <div class="card-result">
          <div class="icon-large">✅</div>
          <h1>${isNew ? 'Paiement confirmé' : 'Déjà débloqué'}</h1>
          <p>Ton contenu t’a été envoyé dans la conversation Telegram. Déjà débloqué et accessible dès maintenant !</p>
          <a href="${esc(v.chatUrl)}" class="btn-return-tg" id="returnTgBtn" onclick="return closeToTelegram()">👉 Revenir à la discussion Telegram</a>
          <p id="countdownNote" style="font-size:12px; color:#94a3b8; margin-top:12px;">Redirection automatique dans <span id="cdNum">3</span>s…</p>
        </div>
      </div>
      <script>
        function closeToTelegram() {
          if (window.Telegram && window.Telegram.WebApp) {
            try { window.Telegram.WebApp.close(); return false; } catch (e) {}
          }
          return true;
        }
        var count = 3;
        var el = document.getElementById('cdNum');
        var timer = setInterval(function() {
          count--;
          if (el) el.innerText = count;
          if (count <= 0) {
            clearInterval(timer);
            if (window.Telegram && window.Telegram.WebApp) {
              try { window.Telegram.WebApp.close(); return; } catch (e) {}
            }
            window.location.href = '${esc(v.chatUrl)}';
          }
        }, 1000);
      </script>`,
    );
  }

  const thumbUrl = `/pay/${esc(v.token)}/thumb`;
  const sim = v.provider === 'SIMULATED';

  const previewScreen = `
    <div class="main-wrapper">
      <div class="top-bar">
        <span>${esc(v.creatorUsername)}</span>
      </div>

      <div class="center-content">
        <h1 class="unlock-title">Déverrouillez</h1>
        <h2 class="unlock-subtitle">${esc(v.assetName)}</h2>
        
        <div class="creator-badge">
          <span class="icon">💖</span>
          <span class="creator-name">${esc(v.creatorName)}</span>
        </div>

        <button type="button" class="btn-fanclub" onclick="openPaymentModal('fanclub')">
          S'abonner au Fan-club
        </button>

        <div class="divider-row">
          <div class="divider-line"></div>
          <span class="divider-text">ou</span>
          <div class="divider-line"></div>
        </div>

        <h3 class="single-title">Déverrouiller cette vidéo uniquement</h3>
        <p class="teaser-text">« ${esc(v.teaserText)} »</p>

        <button type="button" class="btn-pay-single" id="openPayBtn" onclick="openPaymentModal('single')">
          Payer ${esc(v.formattedPrice)}
        </button>
      </div>

      <div style="height: 10px;"></div>
    </div>

    <!-- Modal Paiement Sécurisé -->
    <div class="modal-backdrop" id="paymentModal">
      <div class="modal-card">
        <div class="modal-header">
          <h4 class="modal-title">Paiement sécurisé</h4>
          <button type="button" class="modal-close" onclick="closePaymentModal()">✕</button>
        </div>

        ${
          sim
            ? `<div class="banner"><b>Mode simulation</b> — aucune vraie carte, aucun débit. Le paiement est fictif.</div>`
            : ''
        }

        <div class="prod-summary">
          <div class="prod-summary-left">
            <div class="prod-summary-name" id="summaryTitle">${esc(v.assetName)}</div>
            <div class="prod-summary-sub">💖 ${esc(v.creatorName)} · Déblocage immédiat</div>
          </div>
          <div class="prod-summary-price" id="summaryPrice">${esc(v.formattedPrice)}</div>
        </div>

        <div class="methods-grid">
          <div class="method-pill active" onclick="selectMethod(this, 'card')">
            <span>💳</span> Carte bancaire
          </div>
          <div class="method-pill" onclick="selectMethod(this, 'stars')">
            <span>⭐</span> Telegram Stars
          </div>
          <div class="method-pill" onclick="selectMethod(this, 'crypto')">
            <span>🪙</span> Crypto (TON)
          </div>
          <div class="method-pill" onclick="selectMethod(this, 'apple')">
            <span>📱</span> Apple / Google Pay
          </div>
        </div>

        <form id="payForm" method="post" action="${sim ? `/pay/${esc(v.token)}/confirm` : `/pay/${esc(v.token)}/start`}">
          <input type="hidden" name="paymentMethod" id="selectedMethodInput" value="card" />

          <div id="cardFields">
            <div class="field-group">
              <label class="field-label">Numéro de carte</label>
              <input class="field-input" value="4242 4242 4242 4242" readonly inputmode="numeric" aria-readonly="true" />
            </div>
            <div class="field-row">
              <div class="field-group">
                <label class="field-label">Expiration</label>
                <input class="field-input" value="12 / 34" readonly />
              </div>
              <div class="field-group">
                <label class="field-label">CVC</label>
                <input class="field-input" value="123" readonly />
              </div>
            </div>
            <div class="field-group">
              <label class="field-label">Nom sur la carte</label>
              <input class="field-input" value="Client test" readonly />
            </div>
          </div>

          <div id="starsFields" style="display:none; text-align:center; padding:12px; background:#f8fafc; border-radius:10px; margin-bottom:10px; font-size:13px; color:#475569;">
            ⭐ Déblocage instantané via votre solde Telegram Stars in-app.
          </div>

          <div id="cryptoFields" style="display:none; text-align:center; padding:12px; background:#f8fafc; border-radius:10px; margin-bottom:10px; font-size:13px; color:#475569;">
            🪙 Paiement sécurisé sur la blockchain TON / USDT testnet.
          </div>

          <div id="appleFields" style="display:none; text-align:center; padding:12px; background:#f8fafc; border-radius:10px; margin-bottom:10px; font-size:13px; color:#475569;">
            📱 Authentification Touch ID / Face ID via votre portefeuille mobile.
          </div>

          <button type="submit" class="btn-submit-pay" id="submitBtn">
            Payer ${esc(v.formattedPrice)}
          </button>
        </form>

        <div class="secure-badge">
          <span>🔒</span> Paiement sécurisé Telegram · Déblocage automatique
        </div>
      </div>
    </div>

    <!-- Écran de confirmation affiché en overlay après paiement (sans rechargement) -->
    <div id="successOverlay" style="display:none; position:fixed; inset:0; z-index:100; background:rgba(0,0,0,0.85); backdrop-filter:blur(16px); align-items:center; justify-content:center; flex-direction:column; text-align:center; padding:32px;">
      <div style="background:#ffffff; color:#0f172a; border-radius:24px; padding:36px 24px; max-width:400px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        <div style="font-size:56px; margin-bottom:16px;">✅</div>
        <h1 style="font-size:22px; font-weight:700; margin-bottom:10px;">Paiement confirmé !</h1>
        <p style="font-size:14px; color:#475569; line-height:1.6; margin-bottom:24px;">
          Ton contenu a été débloqué et t'a été envoyé directement dans la conversation Telegram.
        </p>
        <button id="returnBtn" onclick="closeToTelegram()" style="width:100%; background:#0088cc; color:#fff; font-family:inherit; font-size:15px; font-weight:600; padding:14px 20px; border-radius:12px; border:none; cursor:pointer; box-shadow:0 4px 14px rgba(0,136,204,0.35);">
          👉 Revenir à la discussion
        </button>
        <p id="cdNote" style="font-size:12px; color:#94a3b8; margin-top:12px;">Redirection automatique dans <span id="cdNum">3</span>s…</p>
      </div>
    </div>

    <script>
      var CHAT_URL = '${esc(v.chatUrl)}';
      var TOKEN = '${esc(v.token)}';
      var IS_SIM = ${sim ? 'true' : 'false'};

      function openPaymentModal(type) {
        document.getElementById('paymentModal').classList.add('open');
      }
      function closePaymentModal() {
        document.getElementById('paymentModal').classList.remove('open');
      }
      function selectMethod(el, method) {
        var pills = document.querySelectorAll('.method-pill');
        pills.forEach(function(p) { p.classList.remove('active'); });
        el.classList.add('active');
        document.getElementById('selectedMethodInput').value = method;
        document.getElementById('cardFields').style.display = method === 'card' ? 'block' : 'none';
        document.getElementById('starsFields').style.display = method === 'stars' ? 'block' : 'none';
        document.getElementById('cryptoFields').style.display = method === 'crypto' ? 'block' : 'none';
        document.getElementById('appleFields').style.display = method === 'apple' ? 'block' : 'none';
      }

      function closeToTelegram() {
        if (window.Telegram && window.Telegram.WebApp) {
          try { window.Telegram.WebApp.close(); return; } catch (e) {}
        }
        window.location.href = CHAT_URL || 'https://t.me';
      }

      function showSuccessScreen() {
        var overlay = document.getElementById('successOverlay');
        overlay.style.display = 'flex';
        // Countdown auto-close
        var count = 3;
        var el = document.getElementById('cdNum');
        var timer = setInterval(function() {
          count--;
          if (el) el.innerText = count;
          if (count <= 0) {
            clearInterval(timer);
            closeToTelegram();
          }
        }, 1000);
      }

      // Interception async : pas de rechargement de page, confirmation inline
      document.getElementById('payForm').addEventListener('submit', function(e) {
        e.preventDefault();
        var btn = document.getElementById('submitBtn');
        btn.disabled = true;
        btn.innerText = '⏳ Validation du paiement…';

        var action = this.action;

        if (IS_SIM) {
          // Mode simulation : appel fetch JSON vers /pay/:token/confirm
          fetch('/pay/' + TOKEN + '/confirm', {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'paymentMethod=' + encodeURIComponent(document.getElementById('selectedMethodInput').value),
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.result === 'PAID' || data.result === 'ALREADY') {
              closePaymentModal();
              showSuccessScreen();
            } else if (data.result === 'EXPIRED') {
              btn.disabled = false;
              btn.innerText = '⌛ Lien expiré';
            } else {
              btn.disabled = false;
              btn.innerText = '❌ Erreur — réessayer';
            }
          })
          .catch(function(err) {
            btn.disabled = false;
            btn.innerText = '❌ Erreur réseau — réessayer';
          });
        } else {
          // Mode Stripe : redirect vers Stripe Checkout
          this.submit();
        }
      });

      // Fermeture par clic sur le fond du modal
      document.getElementById('paymentModal').addEventListener('click', function(e) {
        if (e.target === this) closePaymentModal();
      });

      // Expansion Telegram WebApp si disponible
      if (window.Telegram && window.Telegram.WebApp) {
        try {
          window.Telegram.WebApp.ready();
          window.Telegram.WebApp.expand();
        } catch (e) {}
      }
    </script>
  `;

  return htmlShell('Déverrouiller le contenu', previewScreen, thumbUrl);
}
