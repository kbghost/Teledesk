import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { api, auth, addMember, boot, convsOf, fanWrites, makeAccount, registerOwner, shutdown, tick, type Ctx } from './helpers';
import { sandboxTelegram } from '../providers/telegram/fake';
import { Conversation, Message, TelegramAccount } from '../models';
import { accountToken, loadAccountSecret } from '../services/telegram/runtime';
import { restoreSandbox } from '../services/telegram/sandbox';
import { telegramManager } from '../services/telegram/manager';

let ctx: Ctx; let owner: string;
let tl: { token: string; id: string }; let c1: { token: string; id: string }; let cB: { token: string; id: string }; let model: { token: string; id: string };
let accA: string; let accB: string;

beforeAll(async () => {
  ctx = await boot(true);
  owner = (await registerOwner()).token;
  accA = await makeAccount(owner, 'Luna'); accB = await makeAccount(owner, 'Mia');
  tl = await addMember(owner, 'TEAM_LEADER', 'tl@agence.test', [accA]);
  c1 = await addMember(owner, 'CHATTER', 'c1@agence.test', [accA]);
  cB = await addMember(owner, 'CHATTER', 'cb@agence.test', [accB]);
  model = await addMember(owner, 'MODEL', 'model@agence.test', []);
});
afterAll(shutdown);

const connect = (token: string) => new Promise<Socket>((resolve, reject) => {
  const s = ioc(ctx.base, { auth: { token }, transports: ['websocket'], reconnection: false });
  s.on('connect', () => resolve(s)); s.on('connect_error', reject);
});
const collect = (s: Socket, events: string[]) => { const got: Array<{ e: string; p: any }> = []; events.forEach((e) => s.on(e, (p) => got.push({ e, p }))); return got; };
const wait = (ms = 300) => new Promise((r) => setTimeout(r, ms));

describe('temps réel : chacun ne reçoit que ce qu’il a le droit de voir', () => {
  it('connexion refusée sans jeton valide', async () => {
    await expect(connect('mauvais')).rejects.toBeTruthy();
  });
  it('un message entrant n’atteint que les personnes autorisées, et un client ne peut rejoindre aucune autre salle', async () => {
    const sOwner = await connect(owner); const sC1 = await connect(c1.token); const sB = await connect(cB.token); const sM = await connect(model.token);
    const ev = ['message:new', 'conversation:updated'];
    const gOwner = collect(sOwner, ev); const gC1 = collect(sC1, ev); const gB = collect(sB, ev); const gM = collect(sM, ev);
    sB.emit('join', `user:${c1.id}`); sB.emit('join', 'agency'); // tentative d'espionnage : ignorée
    await fanWrites(owner, accA, 'Zoé', 'Bonjour');
    await wait();
    expect(gOwner.some((g) => g.e === 'message:new' && g.p.message.text === 'Bonjour')).toBe(true);
    expect(gC1.some((g) => g.e === 'message:new' && g.p.message.text === 'Bonjour')).toBe(true);
    expect(gB).toHaveLength(0);
    expect(gM).toHaveLength(0);
    // après l'assignation à c1, un autre chatter du compte (s'il y en avait) ne reçoit plus rien ; ici on vérifie la perte d'accès
    const conv = (await convsOf(owner, `?accountId=${accA}`)).body.items[0];
    await api().patch(`/api/conversations/${conv.id}`).set(auth(tl.token)).send({ assignedTo: c1.id });
    await api().post(`/api/accounts/${accA}/sandbox/incoming`).set(auth(owner)).send({ fanName: 'Zoé', text: 'Encore moi' });
    await tick(); await wait();
    expect(gC1.filter((g) => g.p?.message?.text === 'Encore moi')).toHaveLength(1);
    [sOwner, sC1, sB, sM].forEach((s) => s.close());
  });
  it('un membre suspendu est déconnecté du temps réel immédiatement', async () => {
    const s = await connect(c1.token);
    const closed = new Promise<string>((r) => s.on('disconnect', r));
    await api().patch(`/api/team/members/${c1.id}`).set(auth(owner)).send({ status: 'SUSPENDED' });
    expect(await Promise.race([closed, wait(2000).then(() => 'timeout')])).not.toBe('timeout');
    await api().patch(`/api/team/members/${c1.id}`).set(auth(owner)).send({ status: 'ACTIVE' });
  });
});

describe('webhook Telegram', () => {
  it('refuse sans le bon secret, accepte avec, et ne duplique pas un évènement rejoué', async () => {
    const acc = await TelegramAccount.findById(accB).select('+webhookSecret');
    await TelegramAccount.updateOne({ _id: accB }, { $set: { transport: 'WEBHOOK' } });
    const connId = acc!.business!.connectionId!;
    const update = { update_id: 900001, business_message: { message_id: 4242, date: Math.floor(Date.now() / 1000), chat: { id: 777001, type: 'private', first_name: 'Webhook Fan' }, from: { id: 777001, first_name: 'Webhook Fan' }, business_connection_id: connId, text: 'via webhook' } };
    expect((await api().post(`/api/telegram/webhook/${accB}`).send(update)).status).toBe(403);
    expect((await api().post(`/api/telegram/webhook/${accB}`).set('x-telegram-bot-api-secret-token', 'faux').send(update)).status).toBe(403);
    expect((await api().post(`/api/telegram/webhook/000000000000000000000000`).set('x-telegram-bot-api-secret-token', acc!.webhookSecret!).send(update)).status).toBe(403);
    const hdr = { 'x-telegram-bot-api-secret-token': acc!.webhookSecret! };
    expect((await api().post(`/api/telegram/webhook/${accB}`).set(hdr).send(update)).status).toBe(200);
    expect((await api().post(`/api/telegram/webhook/${accB}`).set(hdr).send(update)).status).toBe(200); // rejeu
    await tick();
    expect(await Message.countDocuments({ accountId: accB, text: 'via webhook' })).toBe(1);
    const c = await convsOf(cB.token);
    expect(c.body.items.some((i: any) => i.contact.name.includes('Webhook Fan'))).toBe(true);
    await TelegramAccount.updateOne({ _id: accB }, { $set: { transport: 'POLLING' } });
  });
  it('un compte en mode polling n’accepte pas de webhook', async () => {
    const acc = await TelegramAccount.findById(accA).select('+webhookSecret');
    const r = await api().post(`/api/telegram/webhook/${accA}`).set('x-telegram-bot-api-secret-token', acc!.webhookSecret!).send({ update_id: 1 });
    expect(r.status).toBe(403);
  });
});

describe('redémarrage du serveur : le bac à sable est reconstruit depuis la base', () => {
  it('après perte de la mémoire du faux Telegram, on peut recevoir et répondre dans une conversation existante', async () => {
    const before = await Conversation.countDocuments({ accountId: accA });
    sandboxTelegram.reset(); // simule l'arrêt/redémarrage du processus
    expect(await restoreSandbox()).toBe(2);
    await fanWrites(owner, accA, 'Zoé', 'Après redémarrage');
    expect(await Conversation.countDocuments({ accountId: accA })).toBe(before); // même conversation
    const conv = (await convsOf(owner, `?accountId=${accA}`)).body.items.find((i: any) => i.contact.name.startsWith('Zoé'));
    expect(conv.lastMessagePreview).toBe('Après redémarrage');
    const r = await api().post(`/api/conversations/${conv.id}/messages`).set(auth(owner)).send({ text: 'Toujours là' });
    expect(r.status).toBe(202);
    await tick();
    const secret = await loadAccountSecret(accA);
    expect(sandboxTelegram.sentTo(accountToken(secret!)).map((s) => s.text)).toContain('Toujours là');
  });
});

describe('titulaire du compte et droits Business', () => {
  it('une connexion Business venant d’un autre titulaire est refusée quand des conversations existent', async () => {
    const secret = await loadAccountSecret(accA);
    await sandboxTelegram.connectBusiness(accountToken(secret!), { id: 999111222, first_name: 'Quelqu’un d’autre' });
    await telegramManager.pollOnce(accA);
    const r = await api().post(`/api/accounts/${accA}/business`).set(auth(owner)).send({ decision: 'APPROVE' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DIFFERENT_OWNER');
    await api().post(`/api/accounts/${accA}/business`).set(auth(owner)).send({ decision: 'REJECT' });
  });
  it('si le modèle retire le droit de répondre dans Telegram, l’envoi est bloqué avec un motif clair', async () => {
    const acc = await TelegramAccount.findById(accB);
    const secret = await loadAccountSecret(accB);
    await sandboxTelegram.updateBusiness(accountToken(secret!), acc!.business!.connectionId!, { rights: { can_reply: false, can_read_messages: true } });
    await telegramManager.pollOnce(accB);
    const conv = (await convsOf(owner, `?accountId=${accB}`)).body.items[0];
    const c = await api().get(`/api/conversations/${conv.id}`).set(auth(owner));
    expect(c.body.reply.allowed).toBe(false);
    const r = await api().post(`/api/conversations/${conv.id}/messages`).set(auth(owner)).send({ text: 'test' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('NO_RIGHTS');
  });
  it('un contact qui bloque le bot : le message échoue proprement et la conversation est marquée', async () => {
    // compte A : rouvre un échange puis simule une erreur 403 de Telegram sur l'envoi
    const secret = await loadAccountSecret(accA);
    const conv = (await convsOf(owner, `?accountId=${accA}`)).body.items.find((i: any) => i.contact.name.startsWith('Zoé'));
    sandboxTelegram.failNext(accountToken(secret!), 'sendMessage', { code: 403, description: 'Forbidden: bot was blocked by the user' });
    const r = await api().post(`/api/conversations/${conv.id}/messages`).set(auth(owner)).send({ text: 'ça passe ?' });
    expect(r.status).toBe(202);
    await tick();
    const msgs = await api().get(`/api/conversations/${conv.id}/messages`).set(auth(owner));
    const failed = msgs.body.items.find((m: any) => m.text === 'ça passe ?');
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'BLOCKED' });
    // la conversation est marquée : on ne peut plus ni écrire ni relancer l'envoi tant que le contact n'a pas relancé le bot
    const c = await api().get(`/api/conversations/${conv.id}`).set(auth(owner));
    expect(c.body.blocked).toBe(true);
    expect(c.body.reply).toMatchObject({ allowed: false, error: 'BLOCKED' });
    const retry = await api().post(`/api/messages/${failed.id}/retry`).set(auth(owner));
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('BLOCKED');
  });
});

describe('modèle : accès en lecture seule accordé par le Super admin', () => {
  it('rattaché à un compte, il ne voit rien tant que l’accès n’est pas accordé, puis voit sans pouvoir répondre', async () => {
    const link = await api().patch(`/api/accounts/${accA}`).set(auth(owner)).send({ modelUserId: model.id });
    expect(link.status).toBe(200);
    expect((await convsOf(model.token)).body.items).toHaveLength(0);
    await api().patch(`/api/accounts/${accA}`).set(auth(owner)).send({ modelCanView: true });
    const list = await convsOf(model.token);
    expect(list.body.items.length).toBeGreaterThan(0);
    const id = list.body.items[0].id;
    expect((await api().post(`/api/conversations/${id}/messages`).set(auth(model.token)).send({ text: 'x' })).status).toBe(403);
    expect((await api().get(`/api/conversations/${id}/notes`).set(auth(model.token))).status).toBe(403);
    expect((await api().post(`/api/conversations/${id}/sales`).set(auth(model.token)).send({ amountCents: 100 })).status).toBe(403);
    expect((await api().get('/api/accounts/mine').set(auth(model.token))).body.items).toHaveLength(1);
  });
  it('le modèle dépose dans sa médiathèque (prix ignoré) mais ne voit pas celle des autres comptes', async () => {
    const { png } = await import('./helpers');
    const up = await api().post('/api/library/assets').set(auth(model.token)).field('priceCents', '9900').attach('file', await png(), 'moi.png');
    expect(up.status).toBe(201);
    expect(up.body.priceCents).toBe(0);
    expect(up.body.accountId).toBe(accA);
    expect((await api().get('/api/library/assets').set(auth(model.token))).body.items).toHaveLength(1);
    expect((await api().get('/api/library/assets').set(auth(cB.token))).body.items).toHaveLength(0);
  });
});

describe('secrets et sessions', () => {
  it('le jeton du bot n’est jamais stocké ni renvoyé en clair', async () => {
    const raw = await TelegramAccount.collection.findOne({ _id: (await TelegramAccount.findOne({ _id: accA }))!._id });
    const secret = await loadAccountSecret(accA);
    const token = accountToken(secret!);
    expect(JSON.stringify(raw)).not.toContain(token);
    for (const url of [`/api/accounts`, `/api/accounts/${accA}`]) expect(JSON.stringify((await api().get(url).set(auth(owner))).body)).not.toContain(token);
  });
  it('rotation du refresh token : un jeton rejoué révoque toute la session', async () => {
    const login = await api().post('/api/auth/login').send({ email: 'tl@agence.test', password: 'Motdepasse!2024' });
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const r1 = await api().post('/api/auth/refresh').set('Cookie', cookie);
    expect(r1.status).toBe(200);
    const newCookie = (r1.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    expect((await api().post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401); // rejeu de l'ancien
    expect((await api().post('/api/auth/refresh').set('Cookie', newCookie)).status).toBe(401); // la famille entière est révoquée
  });
  it('verrouillage après des mots de passe erronés répétés', async () => {
    for (let i = 0; i < 5; i++) await api().post('/api/auth/login').send({ email: 'cb@agence.test', password: 'mauvais-mot-de-passe' });
    const r = await api().post('/api/auth/login').send({ email: 'cb@agence.test', password: 'Motdepasse!2024' });
    expect(r.status).toBe(429);
  });
  it('un membre retiré perd tout accès et ses conversations retournent dans la file', async () => {
    const extra = await addMember(owner, 'CHATTER', 'tmp@agence.test', [accA]);
    const conv = (await convsOf(owner, `?accountId=${accA}`)).body.items[0];
    await api().patch(`/api/conversations/${conv.id}`).set(auth(tl.token)).send({ assignedTo: extra.id });
    expect((await api().delete(`/api/team/members/${extra.id}`).set(auth(owner))).status).toBe(200);
    expect((await api().get('/api/conversations').set(auth(extra.token))).status).toBe(401);
    expect((await api().get(`/api/conversations/${conv.id}`).set(auth(owner))).body.assignedTo).toBeNull();
  });
  it('en-têtes de sécurité et 404 JSON sur les routes inconnues', async () => {
    const r = await api().get('/api/health');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect((await api().get('/api/inconnue')).status).toBe(401);
    expect((await api().get('/api/inconnue').set(auth(owner))).status).toBe(404);
  });
  it('injection NoSQL : un opérateur Mongo dans le corps est neutralisé', async () => {
    const r = await api().post('/api/auth/login').send({ email: { $ne: '' }, password: { $ne: '' } });
    expect(r.status).toBe(400);
  });
});
