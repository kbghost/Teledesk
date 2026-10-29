import type { Readable } from 'node:stream';
import sharp from 'sharp';
import { isDirectMode, SEND_ERROR_LABELS, type SendError, type SendMessageInput } from '@teledesk/shared';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { Asset, Conversation, Message, TelegramAccount } from '../../models';
import { LIMITS, TelegramApiError, fileIdOf, type MediaKind } from '../../providers/telegram/api';
import type { TgMessage } from '../../providers/telegram/types';
import { getStorage } from '../../providers/storage';
import type { Actor } from '../../types/express';
import { nowDate } from '../../utils/clock';
import { AppError, forbidden, notFound } from '../../utils/errors';
import { dayKey } from '../../utils/helpers';
import { KeyedQueue } from '../../utils/queue';
import { loadReplyableConversation, requirePermission } from '../access.service';
import { audit } from '../audit.service';
import { insertSale } from '../sales.service';
import type { Request } from 'express';
import { checkoutUrl, ensureCheckout, euros } from '../checkout.service';
import { bumpStat } from '../stats.service';
import { publishConversation, publishMessage } from './audience';
import { apiFor, loadAccountSecret, replyState } from './runtime';

/** Un seul envoi à la fois par compte Telegram, espacés d'un délai minimal : évite les rafales qui déclencheraient la limite de débit. */
const queue = new KeyedQueue(() => env.OUTBOUND_MIN_INTERVAL_MS);
export const outboundIdle = () => queue.idle();
const MAX_ATTEMPTS = 3;

const KIND_TO_MEDIA: Record<string, MediaKind> = { IMAGE: 'photo', VIDEO: 'video', AUDIO: 'audio', FILE: 'document' };
const KIND_TO_TYPE: Record<string, string> = { IMAGE: 'PHOTO', VIDEO: 'VIDEO', AUDIO: 'AUDIO', FILE: 'DOCUMENT' };
const PREVIEW: Record<string, string> = { IMAGE: '📷 Photo', VIDEO: '🎥 Vidéo', AUDIO: '🎵 Audio', FILE: '📎 Document' };

const streamToBuffer = async (s: Readable) => { const chunks: Buffer[] = []; for await (const c of s) chunks.push(Buffer.from(c)); return Buffer.concat(chunks); };

/** Ajoute un message à la file d'envoi : la réponse est immédiate, l'envoi réel et son résultat arrivent par évènement temps réel. */
export async function sendFromCrm(actor: Actor, conversationId: string, input: SendMessageInput) {
  const conv = await loadReplyableConversation(actor, conversationId);
  const account = await TelegramAccount.findOne({ _id: conv.accountId, deletedAt: null });
  if (!account) throw notFound('Compte introuvable');
  const state = replyState(account, conv);
  if (!state.allowed) throw new AppError(409, state.error!, SEND_ERROR_LABELS[state.error!]);

  let asset: InstanceType<typeof Asset> | null = null;
  if (input.assetId) {
    asset = await Asset.findOne({ _id: input.assetId, agencyId: actor.agencyId, deletedAt: null });
    if (!asset) throw notFound('Fichier introuvable dans la médiathèque', 'ASSET_MISSING');
    if (asset.accountId && String(asset.accountId) !== String(conv.accountId)) throw forbidden('Ce fichier appartient à un autre compte Telegram');
    if (asset.size > LIMITS.uploadBytes) throw new AppError(413, 'ASSET_TOO_LARGE', 'Fichier trop volumineux pour Telegram (50 Mo maximum)');
  }
  let replyTo: number | undefined;
  if (input.replyToMessageId) {
    const r = await Message.findOne({ _id: input.replyToMessageId, conversationId: conv._id }).select('telegramMessageId').lean();
    replyTo = r?.telegramMessageId ?? undefined;
  }
  // Un média payant part TOUJOURS verrouillé (aperçu flouté + prix) ; l'original n'est envoyé qu'au déblocage.
  const locked = !!asset && asset.priceCents > 0;
  const message = await Message.create({
    agencyId: conv.agencyId, conversationId: conv._id, accountId: conv.accountId, direction: 'OUT', source: 'CRM', sentBy: actor.id, status: 'QUEUED',
    ppv: locked ? { priceCents: asset!.priceCents, state: 'LOCKED' } : undefined,
    type: asset ? KIND_TO_TYPE[asset.kind] : 'TEXT', text: input.text, assetId: asset?._id, replyToMessageId: input.replyToMessageId,
    attachment: asset ? { kind: asset.kind, key: asset.storageKey, thumbKey: asset.thumbKey, mime: asset.mime, size: asset.size, name: asset.name, width: asset.width, height: asset.height } : undefined,
    tgReplyTo: replyTo,
  });
  await publishMessage('message:new', conv.toObject(), message.toObject());
  enqueue(String(conv.accountId), String(message._id));
  return message;
}


/** Légende de l'aperçu verrouillé : texte du chatter + mention du prix (limite Telegram : 1024 caractères). */
export function lockedCaption(text: string, priceCents: number): string {
  const tail = `\n\n🔒 Contenu verrouillé — ${euros(priceCents)}`;
  return `${text.slice(0, CAPTION_LIMIT - tail.length)}${tail}`.trim();
}
const CAPTION_LIMIT = 1024;

const LOCK_SVG = (size: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 200 200"><circle cx="100" cy="100" r="92" fill="#111827" fill-opacity=".62"/><circle cx="100" cy="100" r="92" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3"/><path d="M68 92V74a32 32 0 0 1 64 0v18" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round"/><rect x="52" y="90" width="96" height="68" rx="16" fill="#fff"/><circle cx="100" cy="118" r="9" fill="#111827"/><rect x="95.5" y="120" width="9" height="20" rx="4.5" fill="#111827"/></svg>`;

/** Aperçu verrouillé (JPEG) : miniature très floutée avec un GRAND cadenas au centre ; sans miniature (vidéo, audio, PDF), un visuel générique avec cadenas. */
export async function lockedPreview(asset: InstanceType<typeof Asset>): Promise<Buffer> {
  let base: Buffer | null = null;
  if (asset.thumbKey) {
    try {
      const thumb = await streamToBuffer(await getStorage().getStream('private', asset.thumbKey));
      base = await sharp(thumb).resize({ width: 480, height: 480, fit: 'cover' }).blur(26).modulate({ brightness: 0.8 }).jpeg({ quality: 70 }).toBuffer();
    } catch { /* retombe sur le visuel générique */ }
  }
  if (!base) {
    const label = asset.kind === 'VIDEO' ? 'VIDÉO' : asset.kind === 'AUDIO' ? 'AUDIO' : asset.kind === 'IMAGE' ? 'PHOTO' : 'FICHIER';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#312e81"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="240" y="446" font-family="sans-serif" font-size="30" font-weight="700" fill="#fff" text-anchor="middle" opacity=".9">${label}</text></svg>`;
    base = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  }
  const lock = await sharp(Buffer.from(LOCK_SVG(220))).png().toBuffer();
  return sharp(base).composite([{ input: lock, gravity: 'center' }]).jpeg({ quality: 80 }).toBuffer();
}

/**
 * Déblocage d'un PPV après paiement (reçu hors plateforme) : envoie l'original, puis enregistre la vente au prix du PPV.
 * Un seul déblocage à la fois par PPV ; en cas d'échec d'envoi le PPV redevient verrouillé.
 */
export async function unlockPpv(actor: Actor, messageId: string, req: Request) {
  requirePermission(actor, 'inbox.reply');
  const ppvMsg = await Message.findOne({ _id: messageId, agencyId: actor.agencyId, direction: 'OUT', status: 'SENT', 'ppv.state': { $in: ['LOCKED', 'UNLOCKED', 'UNLOCKING'] } });
  if (!ppvMsg?.ppv) throw notFound('PPV introuvable');
  const conv = await loadReplyableConversation(actor, String(ppvMsg.conversationId));
  if (ppvMsg.ppv.state === 'UNLOCKED') throw new AppError(409, 'ALREADY_UNLOCKED', 'Ce contenu est déjà débloqué');
  if (ppvMsg.ppv.state === 'UNLOCKING') throw new AppError(409, 'UNLOCK_IN_PROGRESS', 'Déblocage déjà en cours');
  const account = await TelegramAccount.findOne({ _id: conv.accountId, deletedAt: null });
  if (!account) throw notFound('Compte introuvable');
  const state = replyState(account, conv);
  if (!state.allowed) throw new AppError(409, state.error!, SEND_ERROR_LABELS[state.error!]);
  const asset = ppvMsg.assetId ? await Asset.findOne({ _id: ppvMsg.assetId, deletedAt: null }) : null;
  if (!asset) throw new AppError(409, 'ASSET_MISSING', SEND_ERROR_LABELS.ASSET_MISSING);
  const r = await startUnlock(ppvMsg, conv, asset, actor.id, 'MANUAL', async () => {
    const prev = await Message.findOne({ unlocksMessageId: ppvMsg._id }).select('_id status').lean();
    return prev?.status === 'FAILED' ? retryMessage(actor, String(prev._id)) : null;
  });
  if ('retried' in r) return r.retried;
  await audit(req, actor.agencyId, actor.id, 'PPV_UNLOCK_REQUESTED', 'Message', String(ppvMsg._id), { priceCents: ppvMsg.ppv.priceCents });
  return r.message;
}

/** Verrou atomique : le message de déblocage est unique par PPV (index unique) — un seul des appels simultanés le crée. */
async function startUnlock(
  ppvMsg: InstanceType<typeof Message>, conv: InstanceType<typeof Conversation>, asset: InstanceType<typeof Asset>, sentBy: unknown, via: 'MANUAL' | 'CHECKOUT',
  onDuplicate: () => Promise<InstanceType<typeof Message> | null>,
): Promise<{ message: InstanceType<typeof Message> } | { retried: InstanceType<typeof Message> }> {
  let unlock: InstanceType<typeof Message>;
  try {
    unlock = await Message.create({
      agencyId: conv.agencyId, conversationId: conv._id, accountId: conv.accountId, direction: 'OUT', source: 'CRM', sentBy, status: 'QUEUED',
      type: KIND_TO_TYPE[asset.kind], text: `🔓 ${asset.name}`.slice(0, 200), assetId: asset._id, unlocksMessageId: ppvMsg._id,
      attachment: { kind: asset.kind, key: asset.storageKey, thumbKey: asset.thumbKey, mime: asset.mime, size: asset.size, name: asset.name, width: asset.width, height: asset.height },
    });
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
    const again = await onDuplicate(); // un essai précédent a échoué : on le relance
    if (again) return { retried: again };
    throw new AppError(409, 'UNLOCK_IN_PROGRESS', 'Déblocage déjà en cours ou terminé');
  }
  await Message.updateOne({ _id: ppvMsg._id }, { $set: { 'ppv.state': 'UNLOCKING', 'ppv.unlockMessageId': unlock._id, 'ppv.unlockedBy': sentBy, 'ppv.via': via } });
  await publishMessage('message:new', conv.toObject(), unlock.toObject());
  await publishMessage('message:updated', conv.toObject(), (await Message.findById(ppvMsg._id))!.toObject());
  enqueue(String(conv.accountId), String(unlock._id));
  return { message: unlock };
}

/**
 * Le fan a payé (page de paiement) : l'original lui est envoyé sans intervention d'un opérateur, et la vente est créditée au chatter qui a envoyé le PPV.
 * Idempotent : un second appel (webhook rejoué, double clic) ne renvoie rien et ne crée aucune seconde vente.
 */
export async function unlockPaid(messageId: string): Promise<'UNLOCKED' | 'ALREADY' | 'MISSING'> {
  const ppvMsg = await Message.findOne({ _id: messageId, direction: 'OUT', 'ppv.state': { $in: ['LOCKED', 'UNLOCKING', 'UNLOCKED'] } });
  if (!ppvMsg?.ppv) return 'MISSING';
  if (ppvMsg.ppv.state !== 'LOCKED') return 'ALREADY';
  const conv = await Conversation.findById(ppvMsg.conversationId);
  const asset = ppvMsg.assetId ? await Asset.findOne({ _id: ppvMsg.assetId, deletedAt: null }) : null;
  if (!conv || !asset) return 'MISSING';
  try {
    await startUnlock(ppvMsg, conv, asset, ppvMsg.sentBy, 'CHECKOUT', async () => {
      // un essai précédent a échoué (ex. fenêtre de 24 h expirée) : on le remet en file, le PPV repasse « en cours »
      const prev = await Message.findOne({ unlocksMessageId: ppvMsg._id, status: 'FAILED' });
      if (!prev) return null;
      await Message.updateOne({ _id: ppvMsg._id }, { $set: { 'ppv.state': 'UNLOCKING', 'ppv.via': 'CHECKOUT' } });
      prev.status = 'QUEUED'; prev.attempts = 0; prev.error = undefined; prev.errorCode = undefined; await prev.save();
      await publishMessage('message:updated', conv.toObject(), prev.toObject());
      enqueue(String(conv.accountId), String(prev._id));
      return prev;
    });
  } catch (e) { if (e instanceof AppError && e.code === 'UNLOCK_IN_PROGRESS') return 'ALREADY'; throw e; }
  return 'UNLOCKED';
}

/** Suite d'un déblocage réussi (original livré) : le PPV passe en « débloqué » et la vente est enregistrée. */
async function completeUnlock(unlock: InstanceType<typeof Message>, conv: InstanceType<typeof Conversation>) {
  const ppvMsg = await Message.findOneAndUpdate({ _id: unlock.unlocksMessageId, 'ppv.state': 'UNLOCKING' }, { $set: { 'ppv.state': 'UNLOCKED', 'ppv.unlockedAt': nowDate() } }, { new: true });
  if (!ppvMsg?.ppv || !unlock.sentBy) return;
  const sale = await insertSale(String(conv.agencyId), conv, String(unlock.sentBy), { amountCents: ppvMsg.ppv.priceCents, assetId: ppvMsg.assetId ? String(ppvMsg.assetId) : undefined, note: ppvMsg.ppv.via === 'CHECKOUT' ? 'PPV payé par le fan' : 'PPV débloqué', source: ppvMsg.ppv.via === 'CHECKOUT' ? 'PPV_PAID' : 'PPV_UNLOCK' });
  await Message.updateOne({ _id: ppvMsg._id }, { $set: { 'ppv.saleId': sale._id } });
  await publishMessage('message:updated', conv.toObject(), (await Message.findById(ppvMsg._id))!.toObject());
}

/** Envoi du déblocage définitivement échoué : le PPV redevient verrouillé (on peut réessayer le déblocage). */
async function revertUnlock(unlock: InstanceType<typeof Message>, conv: InstanceType<typeof Conversation>) {
  const r = await Message.findOneAndUpdate({ _id: unlock.unlocksMessageId, 'ppv.state': 'UNLOCKING' }, { $set: { 'ppv.state': 'LOCKED' } }, { new: true });
  if (r) await publishMessage('message:updated', conv.toObject(), r.toObject());
}

function enqueue(accountId: string, messageId: string, delayMs = 0) {
  const run = () => void queue.push(accountId, () => deliver(messageId));
  if (delayMs > 0) setTimeout(run, delayMs).unref();
  else run();
}

/** Remet un envoi échoué en file (même contrôle d'accès qu'un nouvel envoi). */
export async function retryMessage(actor: Actor, messageId: string) {
  requirePermission(actor, 'inbox.reply');
  const m = await Message.findOne({ _id: messageId, agencyId: actor.agencyId, direction: 'OUT', status: 'FAILED' });
  if (!m) throw notFound('Message introuvable ou non échoué');
  const conv = await loadReplyableConversation(actor, String(m.conversationId));
  const account = await TelegramAccount.findOne({ _id: conv.accountId, deletedAt: null });
  const state = account ? replyState(account, conv) : null;
  if (!state?.allowed) throw new AppError(409, state?.error ?? 'CONNECTION_DISABLED', SEND_ERROR_LABELS[state?.error ?? 'CONNECTION_DISABLED']);
  if (m.unlocksMessageId) { // nouvel essai d'un déblocage : le PPV doit être de nouveau « en cours de déblocage »
    const again = await Message.findOneAndUpdate({ _id: m.unlocksMessageId, 'ppv.state': 'LOCKED' }, { $set: { 'ppv.state': 'UNLOCKING' } }, { new: true });
    if (!again) throw new AppError(409, 'ALREADY_UNLOCKED', 'Ce contenu est déjà débloqué ou en cours de déblocage');
    await publishMessage('message:updated', conv.toObject(), again.toObject());
  }
  m.status = 'QUEUED'; m.attempts = 0; m.error = undefined; m.errorCode = undefined;
  await m.save();
  await publishMessage('message:updated', conv.toObject(), m.toObject());
  enqueue(String(conv.accountId), String(m._id));
  return m;
}

interface Failure { code: SendError; detail: string; transient: boolean; delayMs: number; auth: boolean }
function classify(e: unknown): Failure {
  const f = (code: SendError, detail: string, extra: Partial<Failure> = {}): Failure => ({ code, detail, transient: false, delayMs: 0, auth: false, ...extra });
  if (!(e instanceof TelegramApiError)) {
    const err = e as NodeJS.ErrnoException;
    return err?.code === 'ENOENT' ? f('ASSET_MISSING', SEND_ERROR_LABELS.ASSET_MISSING) : f('TELEGRAM_ERROR', 'Erreur interne lors de l’envoi');
  }
  const d = e.description.toLowerCase();
  if (e.isNetwork) return f('TELEGRAM_ERROR', 'Telegram est injoignable', { transient: true, delayMs: 2000 });
  if (e.isRateLimit) return f('TELEGRAM_ERROR', 'Limite de débit de Telegram atteinte', { transient: true, delayMs: Math.min((e.retryAfter ?? 5) * 1000, 30_000) });
  if (e.isAuth) return f('TELEGRAM_ERROR', 'Accès refusé par Telegram (jeton ou session invalide)', { auth: true });
  if (e.isForbidden) return f('BLOCKED', SEND_ERROR_LABELS.BLOCKED);
  if (d.includes('24 hours') || d.includes('no incoming')) return f('WINDOW_CLOSED', SEND_ERROR_LABELS.WINDOW_CLOSED);
  if (d.includes('rights')) return f('NO_RIGHTS', SEND_ERROR_LABELS.NO_RIGHTS);
  if (d.includes('disabled') || d.includes('connection not found')) return f('CONNECTION_DISABLED', SEND_ERROR_LABELS.CONNECTION_DISABLED);
  if (e.code >= 500) return f('TELEGRAM_ERROR', 'Telegram a rencontré une erreur', { transient: true, delayMs: 3000 });
  return f('TELEGRAM_ERROR', e.description);
}

async function sendOnce(account: NonNullable<Awaited<ReturnType<typeof loadAccountSecret>>>, chatId: string, m: InstanceType<typeof Message>, asset: InstanceType<typeof Asset> | null, replyTo?: number): Promise<TgMessage> {
  const api = apiFor(account);
  const opts = { businessConnectionId: isDirectMode(account.mode) ? undefined : account.business?.connectionId, replyToMessageId: replyTo };
  if (!asset) return api.sendMessage(chatId, m.text, opts);
  const storage = getStorage();
  if (m.ppv?.state === 'LOCKED') {
    // Verrouillé : on n'envoie JAMAIS l'original (ni son file_id Telegram), seulement un aperçu flouté généré à la volée.
    const preview = await lockedPreview(asset);
    const co = await ensureCheckout(m, asset.name);
    const url = checkoutUrl(co.token);
    // Bouton « lien » sous l'image : seul type de bouton accepté dans une conversation Business ; il ouvre la page de paiement dans le navigateur intégré de Telegram.
    const label = `🔓 Débloquer — ${euros(m.ppv.priceCents)}`;
    // La légende inclut TOUJOURS le lien (fallback si les boutons sont désactivés ou en mode compte personnel).
    const baseCaption = lockedCaption(m.text, m.ppv.priceCents);
    const captionWithUrl = url ? `${baseCaption}\n\n${label} 👉 ${url}`.slice(0, 1024) : baseCaption;
    // Un compte personnel ne peut pas poser de bouton (réservé aux bots) : le lien est dans la légende uniquement.
    if (account.mode === 'USER') {
      return api.sendMedia('photo', chatId, { data: preview, filename: 'apercu.jpg', mime: 'image/jpeg' }, captionWithUrl, opts);
    }
    // Bot Business : bouton ET lien en légende (double canal pour maximiser le taux de clic).
    const buttons = url ? [[{ text: label, url }]] : undefined;
    return api.sendMedia('photo', chatId, { data: preview, filename: 'apercu.jpg', mime: 'image/jpeg' }, captionWithUrl, { ...opts, buttons });
  }
  const kind: MediaKind = asset.kind === 'IMAGE' && asset.size > LIMITS.photoBytes ? 'document' : KIND_TO_MEDIA[asset.kind]!;
  const accountKey = String(account._id);
  const cached = asset.tgFileIds?.get(accountKey);
  if (cached) {
    try { return await api.sendMedia(kind, chatId, { fileId: cached }, m.text, opts); }
    catch (e) { if (!(e instanceof TelegramApiError && e.code === 400 && /file/i.test(e.description))) throw e; }
  }
  await storage.size('private', asset.storageKey); // lève ENOENT si le fichier a disparu
  const data = await streamToBuffer(await storage.getStream('private', asset.storageKey));
  const ext = asset.storageKey.split('.').pop() ?? 'bin';
  const sent = await api.sendMedia(kind, chatId, { data, filename: `${asset.name.replace(/[^\w.-]+/g, '_').slice(0, 60)}.${ext}`, mime: asset.mime }, m.text, opts);
  const fid = fileIdOf(sent);
  if (fid) await Asset.updateOne({ _id: asset._id }, { $set: { [`tgFileIds.${accountKey}`]: fid } });
  return sent;
}

async function deliver(messageId: string) {
  const m = await Message.findOneAndUpdate({ _id: messageId, status: 'QUEUED' }, { $set: { status: 'SENDING' }, $inc: { attempts: 1 } }, { new: true });
  if (!m) return;
  const [conv, account, asset] = await Promise.all([Conversation.findById(m.conversationId), loadAccountSecret(String(m.accountId)), m.assetId ? Asset.findById(m.assetId) : null]);
  if (!conv || !account) return fail(m, conv, { code: 'CONNECTION_DISABLED', detail: SEND_ERROR_LABELS.CONNECTION_DISABLED, transient: false, delayMs: 0, auth: false });
  // Les règles sont revérifiées au moment de l'envoi : la fenêtre de 24 h ou la connexion ont pu changer pendant l'attente.
  const state = replyState(account, conv);
  if (!state.allowed) return fail(m, conv, { code: state.error!, detail: SEND_ERROR_LABELS[state.error!], transient: false, delayMs: 0, auth: false });
  try {
    const sent = await sendOnce(account, conv.chatId, m, asset, m.tgReplyTo ?? undefined);
    await succeed(m, conv, asset?.kind ?? null, sent);
  } catch (e) {
    const f = classify(e);
    if (f.transient && m.attempts < MAX_ATTEMPTS) {
      await Message.updateOne({ _id: m._id }, { $set: { status: 'QUEUED' } });
      enqueue(String(m.accountId), String(m._id), f.delayMs * m.attempts);
      return;
    }
    if (f.auth) await TelegramAccount.updateOne({ _id: account._id }, { $set: { status: 'ERROR', statusDetail: 'Accès refusé par Telegram : remplacez le jeton (bot) ou reconnectez le compte (numéro).' } });
    await fail(m, conv, f);
  }
}

async function succeed(m: InstanceType<typeof Message>, conv: InstanceType<typeof Conversation>, assetKind: string | null, sent: TgMessage) {
  const at = nowDate();
  const prev = await Conversation.findOneAndUpdate(
    { _id: conv._id },
    { $set: { lastMessageAt: at, lastMessagePreview: (m.text || (assetKind ? PREVIEW[assetKind] : '')).slice(0, 120), lastMessageDirection: 'OUT', unreadCount: 0 }, $inc: { messagesCount: 1 }, $unset: { awaitingSince: 1 } },
    { new: false },
  );
  const responseMs = prev?.awaitingSince ? Math.max(0, at.getTime() - prev.awaitingSince.getTime()) : undefined;
  m.status = 'SENT'; m.telegramMessageId = sent.message_id; m.tgDate = new Date(sent.date * 1000);
  m.dedupeKey = `${m.accountId}:${conv.chatId}:${sent.message_id}`; m.error = undefined; m.errorCode = undefined;
  if (responseMs !== undefined) m.responseMs = responseMs;
  await m.save();
  if (m.sentBy) {
    // le premier chatter qui répond à une conversation non assignée en devient responsable
    if (!prev?.assignedTo) await Conversation.updateOne({ _id: conv._id, assignedTo: null }, { $set: { assignedTo: m.sentBy, assignedAt: at } });
    await bumpStat(m.agencyId, m.accountId, m.sentBy, { messagesOut: 1, ...(responseMs !== undefined ? { respCount: 1, respMsSum: responseMs } : {}) }, dayKey(at));
  }
  if (m.assetId) await Asset.updateOne({ _id: m.assetId }, { $inc: { usedCount: 1 }, $set: { lastUsedAt: at } });
  await publishMessage('message:updated', conv.toObject(), m.toObject());
  if (m.unlocksMessageId) await completeUnlock(m, conv);
  await publishConversation(String(conv._id));
}

async function fail(m: InstanceType<typeof Message>, conv: InstanceType<typeof Conversation> | null, f: Failure) {
  logger.info({ code: f.code, messageId: String(m._id) }, 'outbound failed');
  m.status = 'FAILED'; m.errorCode = f.code; m.error = f.detail;
  await m.save();
  if (conv) {
    if (f.code === 'BLOCKED') await Conversation.updateOne({ _id: conv._id }, { $set: { blocked: true } });
    await publishMessage('message:updated', conv.toObject(), m.toObject());
    if (m.unlocksMessageId) await revertUnlock(m, conv);
    if (f.code === 'BLOCKED') await publishConversation(String(conv._id));
  }
}

/**
 * Reprise après redémarrage ou plantage : les messages restés « en cours d'envoi » depuis plus de 2 minutes (le processus s'est arrêté
 * pendant l'appel) sont marqués ÉCHOUÉS — on ne les renvoie pas automatiquement, car Telegram a peut-être déjà livré le message (risque de doublon).
 * Les messages simplement en file (QUEUED) sont remis dans la file d'envoi.
 */
export async function resumeOutbound(): Promise<{ requeued: number; failed: number }> {
  const stale = new Date(Date.now() - 2 * 60_000);
  const stuck = await Message.find({ direction: 'OUT', status: 'SENDING', updatedAt: { $lt: stale } });
  for (const m of stuck) {
    m.status = 'FAILED'; m.errorCode = 'TELEGRAM_ERROR'; m.error = 'Envoi interrompu : vérifiez dans Telegram avant de renvoyer';
    await m.save();
    const conv = await Conversation.findById(m.conversationId);
    if (conv) { await publishMessage('message:updated', conv.toObject(), m.toObject()); if (m.unlocksMessageId) await revertUnlock(m, conv); }
  }
  const queued = await Message.find({ direction: 'OUT', status: 'QUEUED' }).select('_id accountId').sort({ _id: 1 }).lean();
  for (const q of queued) enqueue(String(q.accountId), String(q._id));
  return { requeued: queued.length, failed: stuck.length };
}
