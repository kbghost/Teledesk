import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, addMember, boot, convsOf, fanWrites, makeAccount, png, registerOwner, shutdown, tick } from './helpers';
import { sandboxTelegram } from '../providers/telegram/fake';
import { accountToken, loadAccountSecret } from '../services/telegram/runtime';
import { setClock } from '../utils/clock';

let owner: string; let ownerId: string;
let tl: { token: string; id: string }; let c1: { token: string; id: string }; let c2: { token: string; id: string }; let cB: { token: string; id: string }; let model: { token: string; id: string };
let accA: string; let accB: string;
let convA1: string;

beforeAll(async () => {
  await boot();
  const o = await registerOwner(); owner = o.token; ownerId = o.user.id;
  accA = await makeAccount(owner, 'Luna'); accB = await makeAccount(owner, 'Mia');
  tl = await addMember(owner, 'TEAM_LEADER', 'tl@agence.test', [accA]);
  c1 = await addMember(owner, 'CHATTER', 'chatter1@agence.test', [accA]);
  c2 = await addMember(owner, 'CHATTER', 'chatter2@agence.test', [accA]);
  cB = await addMember(owner, 'CHATTER', 'chatterb@agence.test', [accB]);
  model = await addMember(owner, 'MODEL', 'model@agence.test', [accA]);
});
afterAll(shutdown);

describe('connexion Telegram (bac à sable) et réception', () => {
  it('le compte est connecté et confirmé par le Super admin', async () => {
    const r = await api().get(`/api/accounts/${accA}`).set(auth(owner));
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('CONNECTED');
    expect(JSON.stringify(r.body)).not.toMatch(/secretEnc|123456:|webhookSecret/);
  });
  it('un message reçu crée une conversation non assignée, une seule fois même si l’évènement est rejoué', async () => {
    await fanWrites(owner, accA, 'Alex', 'Hello Luna');
    await fanWrites(owner, accB, 'Bob', 'Coucou Mia');
    const r = await convsOf(owner, `?accountId=${accA}`);
    expect(r.body.items).toHaveLength(1);
    convA1 = r.body.items[0].id;
    expect(r.body.items[0]).toMatchObject({ assignedTo: null, unreadCount: 1, lastMessagePreview: 'Hello Luna' });
    expect(r.body.items[0].reply.allowed).toBe(true);
  });
});

describe('périmètre de chaque rôle', () => {
  it('le chatter d’un autre compte ne voit rien, celui du compte voit la file', async () => {
    expect((await convsOf(cB.token, `?accountId=${accA}`)).body.items).toHaveLength(0);
    expect((await api().get(`/api/conversations/${convA1}`).set(auth(cB.token))).status).toBe(404);
    expect((await convsOf(c1.token)).body.items).toHaveLength(1);
  });
  it('un chatter ne peut pas administrer, exporter, ni voir l’audit et les métriques d’équipe', async () => {
    for (const [m, url] of [['get', '/api/team'], ['get', '/api/audit'], ['get', '/api/export/contacts.csv'], ['get', '/api/analytics/overview']] as const) {
      expect((await (api() as any)[m](url).set(auth(c1.token))).status, url).toBe(403);
    }
    expect((await api().post('/api/accounts').set(auth(c1.token)).send({ label: 'Nouveau', mode: 'SANDBOX' })).status).toBe(403);
    expect((await api().get('/api/analytics/me').set(auth(c1.token))).status).toBe(200);
  });
  it('le Team leader supervise ses comptes mais pas les autres, et ne gère pas l’équipe', async () => {
    expect((await convsOf(tl.token, `?accountId=${accB}`)).body.items).toHaveLength(0);
    expect((await api().get('/api/team').set(auth(tl.token))).status).toBe(403);
    expect((await api().get('/api/analytics/overview').set(auth(tl.token))).status).toBe(200);
    expect((await api().get('/api/export/contacts.csv').set(auth(tl.token))).status).toBe(403);
  });
  it('le modèle ne voit pas les conversations (sauf autorisation), ne répond pas, ne voit pas les notes', async () => {
    expect((await convsOf(model.token)).body.items).toHaveLength(0);
    expect((await api().post(`/api/conversations/${convA1}/messages`).set(auth(model.token)).send({ text: 'hey' })).status).toBe(403);
    expect((await api().get(`/api/conversations/${convA1}/notes`).set(auth(model.token))).status).toBe(403);
    expect((await api().get('/api/team').set(auth(model.token))).status).toBe(403);
  });
  it('sans jeton ou avec un jeton falsifié : 401', async () => {
    expect((await api().get('/api/conversations')).status).toBe(401);
    expect((await api().get('/api/conversations').set(auth('abc.def.ghi'))).status).toBe(401);
  });
  it('un identifiant mal formé donne 404, pas 500', async () => {
    expect((await api().get('/api/conversations/zzz').set(auth(owner))).status).toBe(404);
  });
});

describe('répondre, assignation, fenêtre de 24 h', () => {
  it('le chatter répond : le message part vers Telegram, il devient responsable, le temps de réponse est mesuré', async () => {
    const t0 = Date.now() + 120_000; // le fan a écrit il y a ~0 s ; on répond 2 minutes plus tard (horloge simulée)
    setClock(() => t0);
    const r = await api().post(`/api/conversations/${convA1}/messages`).set(auth(c1.token)).send({ text: 'Salut Alex 💜' });
    expect(r.status).toBe(202);
    await tick();
    setClock(undefined);
    const msgs = await api().get(`/api/conversations/${convA1}/messages`).set(auth(c1.token));
    const out = msgs.body.items.find((m: any) => m.direction === 'OUT');
    expect(out.status).toBe('SENT');
    const secret = await loadAccountSecret(accA);
    const sent = sandboxTelegram.sentTo(accountToken(secret!));
    expect(sent.map((s) => s.text)).toContain('Salut Alex 💜');
    expect(sent[0]!.businessConnectionId).toBeTruthy();
    const conv = await api().get(`/api/conversations/${convA1}`).set(auth(c1.token));
    expect(conv.body.assignedTo).toBe(c1.id);
    expect(conv.body.unreadCount).toBe(0);
  });
  it('une fois assignée, la conversation disparaît pour l’autre chatter du compte', async () => {
    expect((await api().get(`/api/conversations/${convA1}`).set(auth(c2.token))).status).toBe(404);
    expect((await api().post(`/api/conversations/${convA1}/messages`).set(auth(c2.token)).send({ text: 'intrus' })).status).toBe(404);
  });
  it('le Team leader réassigne à l’autre chatter ; un chatter ne peut pas assigner', async () => {
    expect((await api().patch(`/api/conversations/${convA1}`).set(auth(c1.token)).send({ assignedTo: c2.id })).status).toBe(403);
    const r = await api().patch(`/api/conversations/${convA1}`).set(auth(tl.token)).send({ assignedTo: c2.id });
    expect(r.status).toBe(200);
    expect((await api().get(`/api/conversations/${convA1}`).set(auth(c1.token))).status).toBe(404);
    expect((await api().get(`/api/conversations/${convA1}`).set(auth(c2.token))).status).toBe(200);
    // on ne peut pas assigner à un chatter qui n'a pas accès au compte
    expect((await api().patch(`/api/conversations/${convA1}`).set(auth(tl.token)).send({ assignedTo: cB.id })).status).toBeGreaterThanOrEqual(400);
  });
  it('au-delà de 24 h sans message du contact, l’envoi est refusé avec un motif clair', async () => {
    const t = Date.now() + 25 * 3600_000;
    setClock(() => t); sandboxTelegram.setClock(() => t);
    try {
      const r = await api().post(`/api/conversations/${convA1}/messages`).set(auth(c2.token)).send({ text: 'trop tard' });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('WINDOW_CLOSED');
      const c = await api().get(`/api/conversations/${convA1}`).set(auth(c2.token));
      expect(c.body.reply).toMatchObject({ allowed: false, error: 'WINDOW_CLOSED' });
    } finally { setClock(undefined); sandboxTelegram.setClock(() => Date.now()); }
  });
  it('on ne peut pas écrire à quelqu’un qui n’a jamais écrit (pas de prospection à froid) : aucune route ne crée de conversation', async () => {
    const r = await api().post('/api/conversations').set(auth(owner)).send({ text: 'hello', accountId: accA });
    expect([404, 405]).toContain(r.status);
  });
});

describe('notes, étiquettes, réponses rapides', () => {
  it('les notes sont internes : visibles par l’équipe, jamais par le modèle', async () => {
    const n = await api().post(`/api/conversations/${convA1}/notes`).set(auth(c2.token)).send({ text: 'Aime les packs photo' });
    expect(n.status).toBe(201);
    const list = await api().get(`/api/conversations/${convA1}/notes`).set(auth(tl.token));
    expect(list.body.items).toHaveLength(1);
    expect((await api().get(`/api/conversations/${convA1}/notes`).set(auth(model.token))).status).toBe(403);
  });
  it('étiquettes : seul TL/Super admin crée, tout opérateur applique', async () => {
    expect((await api().post('/api/tags').set(auth(c2.token)).send({ name: 'VIP' })).status).toBe(403);
    const t = await api().post('/api/tags').set(auth(tl.token)).send({ name: 'VIP', color: '#FF00AA' });
    expect(t.status).toBe(201);
    const p = await api().patch(`/api/conversations/${convA1}`).set(auth(c2.token)).send({ tagIds: [t.body.id] });
    expect(p.status).toBe(200);
    expect(p.body.tagIds).toContain(t.body.id);
  });
  it('réponses rapides : création réservée aux superviseurs, lecture pour tous les opérateurs', async () => {
    expect((await api().post('/api/quick-replies').set(auth(c2.token)).send({ title: 'Bienvenue', text: 'Hello', shortcut: 'hi' })).status).toBe(403);
    expect((await api().post('/api/quick-replies').set(auth(tl.token)).send({ title: 'Bienvenue', text: 'Hello !', shortcut: 'hi' })).status).toBe(201);
    expect((await api().get('/api/quick-replies').set(auth(c2.token))).body.items).toHaveLength(1);
  });
});

describe('ventes et métriques', () => {
  it('une vente met à jour le total du contact et les métriques ; l’annulation inverse tout, une seule fois', async () => {
    const s1 = await api().post(`/api/conversations/${convA1}/sales`).set(auth(c2.token)).send({ amountCents: 2500, note: 'PPV photo' });
    expect(s1.status).toBe(201);
    const s2 = await api().post(`/api/conversations/${convA1}/sales`).set(auth(c2.token)).send({ amountCents: 1000 });
    expect(s2.status).toBe(201);
    let conv = await api().get(`/api/conversations/${convA1}`).set(auth(c2.token));
    expect(conv.body).toMatchObject({ totalSpentCents: 3500, salesCount: 2 });
    let ov = await api().get('/api/analytics/overview?range=7d').set(auth(owner));
    expect(ov.body.totals).toMatchObject({ salesCount: 2, salesCents: 3500 });
    const row = ov.body.perChatter.find((r: any) => r.userId === c2.id);
    expect(row).toMatchObject({ salesCount: 2, salesCents: 3500 });
    expect(ov.body.topFans[0]).toMatchObject({ totalSpentCents: 3500 });

    expect((await api().post(`/api/sales/${s1.body.id}/void`).set(auth(c2.token))).status).toBe(403); // un chatter n'annule pas
    expect((await api().post(`/api/sales/${s1.body.id}/void`).set(auth(tl.token))).status).toBe(200);
    expect((await api().post(`/api/sales/${s1.body.id}/void`).set(auth(tl.token))).status).toBe(409);
    conv = await api().get(`/api/conversations/${convA1}`).set(auth(c2.token));
    expect(conv.body).toMatchObject({ totalSpentCents: 1000, salesCount: 1 });
    ov = await api().get('/api/analytics/overview?range=7d').set(auth(owner));
    expect(ov.body.totals).toMatchObject({ salesCount: 1, salesCents: 1000 });
  });
  it('montants invalides refusés (zéro, négatif, décimal)', async () => {
    for (const amountCents of [0, -5, 10.5]) expect((await api().post(`/api/conversations/${convA1}/sales`).set(auth(c2.token)).send({ amountCents })).status).toBe(400);
  });
  it('le TL ne voit pas les ventes ni les métriques d’un compte qui n’est pas le sien', async () => {
    const ov = await api().get(`/api/analytics/overview?range=7d&accountId=${accB}`).set(auth(tl.token));
    expect(ov.body.totals.messagesIn).toBe(0);
    expect(ov.body.perAccount).toHaveLength(0);
  });
  it('les métriques comptent les vrais évènements (messages reçus / envoyés, temps de réponse)', async () => {
    const ov = await api().get('/api/analytics/overview?range=today').set(auth(owner));
    expect(ov.body.totals.messagesIn).toBeGreaterThanOrEqual(2);
    expect(ov.body.totals.messagesOut).toBe(1);
    expect(ov.body.totals.avgResponseMs).toBeGreaterThanOrEqual(100_000);
    const me = await api().get('/api/analytics/me?range=today').set(auth(c1.token));
    expect(me.body.totals.messagesOut).toBe(1);
    const other = await api().get('/api/analytics/me?range=today').set(auth(cB.token));
    expect(other.body.totals.messagesOut).toBe(0);
  });
});

describe('shifts', () => {
  it('création, chevauchement refusé, droits, ventes rattachées au shift en cours', async () => {
    const starts = new Date(Date.now() - 3600_000).toISOString(); const ends = new Date(Date.now() + 3600_000).toISOString();
    expect((await api().post('/api/shifts').set(auth(c1.token)).send({ userId: c1.id, accountId: accA, startsAt: starts, endsAt: ends })).status).toBe(403);
    const ok = await api().post('/api/shifts').set(auth(tl.token)).send({ userId: c2.id, accountId: accA, startsAt: starts, endsAt: ends });
    expect(ok.status).toBe(201);
    expect((await api().post('/api/shifts').set(auth(tl.token)).send({ userId: c2.id, accountId: accA, startsAt: starts, endsAt: ends })).status).toBe(409);
    expect((await api().post('/api/shifts').set(auth(tl.token)).send({ userId: cB.id, accountId: accA, startsAt: starts, endsAt: ends })).status).toBe(400);
    await api().post(`/api/conversations/${convA1}/sales`).set(auth(c2.token)).send({ amountCents: 700 });
    const ov = await api().get('/api/analytics/overview?range=7d').set(auth(owner));
    const sh = ov.body.shifts.find((s: any) => s.userName.startsWith('chatter2'));
    expect(sh).toMatchObject({ salesCount: 1, salesCents: 700 });
    expect((await api().delete(`/api/shifts/${ok.body.id}`).set(auth(tl.token))).status).toBe(200);
  });
});

describe('médiathèque et envoi PPV', () => {
  let assetId: string; let url: string;
  it('dépôt : le type réel est vérifié par les octets, un faux PNG est refusé', async () => {
    const good = await api().post('/api/library/assets').set(auth(tl.token)).field('priceCents', '1500').field('accountId', accA).attach('file', await png(), 'pack.png');
    expect(good.status).toBe(201);
    assetId = good.body.id; url = good.body.url;
    expect(good.body).toMatchObject({ kind: 'IMAGE', mime: 'image/png', priceCents: 1500 });
    expect(good.body.thumbUrl).toBeTruthy();
    const fake = await api().post('/api/library/assets').set(auth(tl.token)).field('accountId', accA).attach('file', Buffer.from('<script>alert(1)</script> not an image at all'), 'evil.png');
    expect(fake.status).toBe(415);
    const exe = await api().post('/api/library/assets').set(auth(tl.token)).attach('file', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]), 'a.png');
    expect(exe.status).toBe(415);
  });
  it('un chatter lit la médiathèque mais n’y dépose ni ne supprime rien', async () => {
    expect((await api().get('/api/library/assets').set(auth(c2.token))).body.items).toHaveLength(1);
    expect((await api().post('/api/library/assets').set(auth(c2.token)).attach('file', await png(), 'x.png')).status).toBe(403);
    expect((await api().delete(`/api/library/assets/${assetId}`).set(auth(c2.token))).status).toBe(403);
    expect((await api().get('/api/library/assets').set(auth(cB.token))).body.items).toHaveLength(0); // autre compte
  });
  it('envoi du média en un clic : Telegram reçoit le fichier ; le second envoi réutilise le file_id', async () => {
    const free = await api().post('/api/library/assets').set(auth(tl.token)).field('priceCents', '0').field('accountId', accA).attach('file', await png(70, 50), 'gratuit.png');
    expect(free.status).toBe(201);
    const freeId = free.body.id;
    const r = await api().post(`/api/conversations/${convA1}/messages`).set(auth(c2.token)).send({ assetId: freeId, text: 'Ton pack 💜' });
    expect(r.status).toBe(202);
    await tick();
    await fanWrites(owner, accA, 'Alex', 'merci'); // rouvre la fenêtre (horloge réelle)
    const r2 = await api().post(`/api/conversations/${convA1}/messages`).set(auth(c2.token)).send({ assetId: freeId });
    expect(r2.status).toBe(202);
    await tick();
    const secret = await loadAccountSecret(accA);
    const files = sandboxTelegram.sentTo(accountToken(secret!)).filter((s) => s.file);
    expect(files).toHaveLength(2);
    expect(files[0]!.file!.viaFileId).toBe(false);
    expect(files[1]!.file!.viaFileId).toBe(true);
    expect(files[0]!.caption).toBe('Ton pack 💜');
  });
  it('un chatter d’un autre compte ne peut pas envoyer le fichier de ce compte', async () => {
    await fanWrites(owner, accB, 'Bob', 'yo');
    const list = await convsOf(cB.token);
    const r = await api().post(`/api/conversations/${list.body.items[0].id}/messages`).set(auth(cB.token)).send({ assetId });
    expect([403, 404]).toContain(r.status);
  });
  it('lecture du média : signature obligatoire, droits revérifiés, Range géré, type forcé', async () => {
    const ok = await api().get(url.replace(/^.*\/api/, '/api'));
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    const tampered = await api().get(url.replace(/s=[a-f0-9]+/, 's=' + 'a'.repeat(64)));
    expect(tampered.status).toBe(403);
    const range = await api().get(url).set('Range', 'bytes=0-9');
    expect(range.status).toBe(206);
    expect(range.headers['content-range']).toMatch(/^bytes 0-9\//);
    expect(range.body.length ?? range.text.length).toBe(10);
    // l'URL signée pour le chatter d'un autre compte ne donne rien : droits revérifiés
    const list = await api().get('/api/library/assets').set(auth(c2.token));
    const signedForC2 = list.body.items[0].url as string;
    await api().patch(`/api/team/members/${c2.id}`).set(auth(owner)).send({ status: 'SUSPENDED' });
    expect((await api().get(signedForC2)).status).toBe(403);
    await api().patch(`/api/team/members/${c2.id}`).set(auth(owner)).send({ status: 'ACTIVE' });
  });
  it('un membre suspendu perd immédiatement l’accès, sessions comprises', async () => {
    await api().patch(`/api/team/members/${c1.id}`).set(auth(owner)).send({ status: 'SUSPENDED' });
    expect((await api().get('/api/conversations').set(auth(c1.token))).status).toBe(403);
    const login = await api().post('/api/auth/login').send({ email: 'chatter1@agence.test', password: 'Motdepasse!2024' });
    expect(login.status).toBe(403);
    await api().patch(`/api/team/members/${c1.id}`).set(auth(owner)).send({ status: 'ACTIVE' });
  });
});

describe('Super admin : protections', () => {
  it('le Super admin ne peut être ni suspendu ni retiré ; export CSV audité', async () => {
    expect((await api().patch(`/api/team/members/${ownerId}`).set(auth(owner)).send({ status: 'SUSPENDED' })).status).toBe(403);
    expect((await api().delete(`/api/team/members/${ownerId}`).set(auth(owner))).status).toBe(403);
    const csv = await api().get('/api/export/contacts.csv').set(auth(owner));
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Alex');
    const audit = await api().get('/api/audit?action=CONTACTS_EXPORTED').set(auth(owner));
    expect(audit.body.items).toHaveLength(1);
  });
  it('l’effacement d’un contact supprime conversation, messages et notes', async () => {
    const list = await convsOf(owner, `?accountId=${accB}`);
    const id = list.body.items[0].id;
    expect((await api().delete(`/api/conversations/${id}`).set(auth(tl.token))).status).toBe(403);
    expect((await api().delete(`/api/conversations/${id}`).set(auth(owner))).status).toBe(200);
    expect((await api().get(`/api/conversations/${id}`).set(auth(owner))).status).toBe(404);
  });
});
