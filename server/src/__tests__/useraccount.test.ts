import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { Types } from 'mongoose';
import { accountConnectSchema, replyWindowEndsAt } from '@teledesk/shared';
import { api, auth, boot, registerOwner, shutdown, tick } from './helpers';
import { TelegramAccount } from '../models';
import { UserApi, toTgMessage, mapError } from '../providers/telegram/user';
import { ingestUpdate } from '../services/telegram/ingest';
import { loadAccountSecret, replyState } from '../services/telegram/runtime';
import { encryptSecret } from '../utils/crypto';
import { TelegramApiError } from '../providers/telegram/api';
import { env } from '../config/env';

let owner: string; let agencyId: string; let accId: string;
const sender = { id: 777001 as any, firstName: 'Léa', lastName: 'M', username: 'lea_m', bot: false };

beforeAll(async () => {
  await boot();
  const o = await registerOwner('own@user.test');
  owner = o.token; agencyId = o.user.agencyId;
  accId = String(new Types.ObjectId());
  await TelegramAccount.create({
    _id: accId, agencyId, label: 'Perso', mode: 'USER', botId: '555', phone: '+22990000000', status: 'CONNECTED', secretEnc: encryptSecret('session-factice', `account:${accId}`),
  });
});
afterAll(shutdown);

describe('compte Telegram personnel (MTProto) — logique du CRM, sans réseau', () => {
  it('le formulaire exige un numéro international, pas de jeton', () => {
    expect(accountConnectSchema.safeParse({ label: 'Luna', mode: 'USER' }).success).toBe(false);
    expect(accountConnectSchema.safeParse({ label: 'Luna', mode: 'USER', phone: '0612345678' }).success).toBe(false);
    expect(accountConnectSchema.safeParse({ label: 'Luna', mode: 'USER', phone: '+22991234567' }).success).toBe(true);
  });
  it('sans identifiants d’application Telegram sur le serveur, la création est refusée clairement', async () => {
    const prevId = env.TELEGRAM_API_ID;
    env.TELEGRAM_API_ID = 0;
    try {
      const r = await api().post('/api/accounts').set(auth(owner)).send({ label: 'Luna', mode: 'USER', phone: '+22991234567' });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('USER_MODE_UNAVAILABLE');
    } finally {
      env.TELEGRAM_API_ID = prevId;
    }
  });
  it('les messages MTProto sont traduits au format du CRM (texte, photo, vocal, document)', () => {
    expect(toTgMessage({ id: 5, date: 1700000000, message: 'coucou' }, sender)).toMatchObject({ message_id: 5, text: 'coucou', chat: { id: 777001, type: 'private', first_name: 'Léa' }, from: { id: 777001, username: 'lea_m' } });
    const photo = toTgMessage({ id: 6, date: 1, message: 'regarde', media: { className: 'MessageMediaPhoto', photo: { id: 9, sizes: [{ w: 90, h: 60 }, { w: 800, h: 600, size: 5000 }] } } }, sender);
    expect(photo.photo?.[0]).toMatchObject({ file_id: 'u:777001:6', width: 800, height: 600, file_size: 5000 });
    expect(photo.caption).toBe('regarde');
    const voice = toTgMessage({ id: 7, date: 1, media: { className: 'MessageMediaDocument', document: { id: 3, size: 100, mimeType: 'audio/ogg', attributes: [{ className: 'DocumentAttributeAudio', voice: true, duration: 4 }] } } }, sender);
    expect(voice.voice).toMatchObject({ file_id: 'u:777001:7', duration: 4 });
    const doc = toTgMessage({ id: 8, date: 1, media: { className: 'MessageMediaDocument', document: { id: 4, mimeType: 'application/pdf', attributes: [{ className: 'DocumentAttributeFilename', fileName: 'a.pdf' }] } } }, sender);
    expect(doc.document).toMatchObject({ file_name: 'a.pdf' });
  });
  it('les erreurs MTProto deviennent des erreurs que la file d’envoi sait gérer', () => {
    expect(mapError({ errorMessage: 'FLOOD_WAIT_42' })).toMatchObject({ code: 429, retryAfter: 42 });
    expect(mapError({ errorMessage: 'AUTH_KEY_UNREGISTERED' })).toMatchObject({ code: 401 });
    expect(mapError({ errorMessage: 'USER_IS_BLOCKED' })).toMatchObject({ code: 403 });
    expect(mapError(new Error('ETIMEDOUT'))).toMatchObject({ code: 0 });
  });
  it('règles d’envoi : la personne doit avoir écrit en premier, pas de fenêtre de 24 h', () => {
    const acct = { mode: 'USER', status: 'CONNECTED' };
    expect(replyState(acct, { hasIncoming: false }).error).toBe('WINDOW_CLOSED');
    const old = new Date(Date.now() - 5 * 864e5);
    expect(replyState(acct, { hasIncoming: true, lastIncomingAt: old })).toMatchObject({ allowed: true, windowEndsAt: null });
    expect(replyWindowEndsAt(old)).toBeTruthy();
  });
  it('un message reçu sur le compte personnel arrive dans l’inbox ; la réponse part par MTProto, le lien de paiement est dans la légende', async () => {
    const acct = (await loadAccountSecret(accId))!;
    await ingestUpdate(acct, { update_id: 1, message: toTgMessage({ id: 11, date: Math.floor(Date.now() / 1000), message: 'salut' }, sender) });
    await ingestUpdate(acct, { update_id: 2, message: toTgMessage({ id: 11, date: Math.floor(Date.now() / 1000), message: 'salut' }, sender) }); // rejeu : sans doublon
    await tick();
    const convs = await api().get('/api/conversations').set(auth(owner));
    expect(convs.body.items).toHaveLength(1);
    expect(convs.body.items[0]).toMatchObject({ channel: 'BOT', contact: { name: 'Léa M' } });
    expect(convs.body.items[0].reply.allowed).toBe(true);
    const cid = convs.body.items[0].id;

    const sendMessage = vi.spyOn(UserApi.prototype, 'sendMessage').mockResolvedValue({ message_id: 900, date: Math.floor(Date.now() / 1000), chat: { id: 777001, type: 'private' } });
    const sendMedia = vi.spyOn(UserApi.prototype, 'sendMedia').mockResolvedValue({ message_id: 901, date: Math.floor(Date.now() / 1000), chat: { id: 777001, type: 'private' } });
    const r = await api().post(`/api/conversations/${cid}/messages`).set(auth(owner)).send({ text: 'Hello Léa' });
    expect(r.status).toBe(202);
    await tick();
    expect(sendMessage).toHaveBeenCalledWith('777001', 'Hello Léa', expect.objectContaining({ businessConnectionId: undefined }));

    const img = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer();
    const asset = await api().post('/api/library/assets').set(auth(owner)).field('priceCents', '1500').field('accountId', accId).attach('file', img, 'p.png');
    const p = await api().post(`/api/conversations/${cid}/messages`).set(auth(owner)).send({ assetId: asset.body.id, text: 'Pour toi' });
    expect(p.status).toBe(202);
    await tick();
    expect(sendMedia).toHaveBeenCalledTimes(1);
    const [kind, chat, source, caption, opts] = sendMedia.mock.calls[0]!;
    expect(kind).toBe('photo'); expect(chat).toBe('777001');
    expect('data' in (source as object)).toBe(true);
    expect(caption).toContain('Débloquer — 15 €');
    expect(caption).toMatch(/https:\/\/pay\.example\.test\/pay\/[\w-]+/);
    expect((opts as any).buttons).toBeUndefined(); // un compte personnel ne peut pas avoir de bouton
    const m = await api().get(`/api/conversations/${cid}/messages`).set(auth(owner));
    expect(m.body.items.find((x: any) => x.ppv)?.status).toBe('SENT');
  });
  it('un plafond horaire protège le compte : au-delà, l’envoi est repoussé (429) au lieu de partir', async () => {
    const e = new UserApi('limit-test', 'x') as any;
    const { env } = await import('../config/env');
    const old = env.USER_MAX_SENDS_PER_HOUR; (env as any).USER_MAX_SENDS_PER_HOUR = 2;
    e.throttle(); e.throttle();
    expect(() => e.throttle()).toThrowError(TelegramApiError);
    (env as any).USER_MAX_SENDS_PER_HOUR = old;
  });
});
