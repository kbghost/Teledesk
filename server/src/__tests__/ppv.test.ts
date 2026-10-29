import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { api, auth, addMember, boot, convsOf, fanWrites, makeAccount, registerOwner, shutdown, tick } from './helpers';
import { sandboxTelegram } from '../providers/telegram/fake';
import { accountToken, loadAccountSecret } from '../services/telegram/runtime';

let owner: string; let tl: { token: string; id: string }; let ch: { token: string; id: string }; let ch2: { token: string; id: string };
let acc: string; let conv: string; let assetId: string; let original: Buffer; let ppvMsgId: string;

// Image « reconnaissable » : grands aplats nets, pour prouver que l'aperçu envoyé n'est pas l'original.
async function sharpImage() {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 250, g: 20, b: 20 } } })
    .composite([{ input: await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 10, g: 10, b: 240 } } }).png().toBuffer(), left: 100, top: 100 }]).png().toBuffer();
}
const sentFiles = async () => sandboxTelegram.sentTo(accountToken((await loadAccountSecret(acc))!)).filter((s) => s.file);
const fileData = async (n: number) => {
  const sent = (await sentFiles())[n]!;
  const store = [...sandboxTelegram.files.values()];
  return { sent, data: store.find((f) => f.name === sent.file!.name && f.data.length === sent.file!.size)!.data };
};

beforeAll(async () => {
  await boot();
  owner = (await registerOwner('own@ppv.test')).token;
  acc = await makeAccount(owner, 'Luna');
  tl = await addMember(owner, 'TEAM_LEADER', 'tl@ppv.test', [acc]);
  ch = await addMember(owner, 'CHATTER', 'c1@ppv.test', [acc]);
  ch2 = await addMember(owner, 'CHATTER', 'c2@ppv.test', [acc]);
  await fanWrites(owner, acc, 'Marc', 'salut');
  conv = (await convsOf(ch.token)).body.items[0].id;
  original = await sharpImage();
  const up = await api().post('/api/library/assets').set(auth(tl.token)).field('priceCents', '2500').field('accountId', acc).attach('file', original, 'pack.png');
  assetId = up.body.id;
});
afterAll(shutdown);

describe('PPV : le contenu payant reste verrouillé tant que le paiement n’est pas confirmé', () => {
  it('l’envoi d’un média payant ne transmet à Telegram qu’un aperçu flouté + le prix', async () => {
    const r = await api().post(`/api/conversations/${conv}/messages`).set(auth(ch.token)).send({ assetId, text: 'Mon nouveau pack 🔥' });
    expect(r.status).toBe(202);
    expect(r.body.ppv).toEqual({ priceCents: 2500, state: 'LOCKED' });
    ppvMsgId = r.body.id;
    await tick();
    const files = await sentFiles();
    expect(files).toHaveLength(1);
    const { sent, data } = await fileData(0);
    expect(sent.file!.viaFileId).toBe(false);
    expect(sent.caption).toContain('Mon nouveau pack');
    expect(sent.caption).toContain('🔒');
    expect(sent.caption).toContain('25 €');
    expect(data.equals(original)).toBe(false);
    // l'aperçu est vraiment flou : le coin bleu net de l'original (centre du carré) n'est plus net, et l'image est petite
    const meta = await sharp(data).metadata();
    expect(meta.width).toBeLessThanOrEqual(480);
    const edge = async (img: Buffer) => { const { data: px, info } = await sharp(img).resize(200, 150, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
      let max = 0; for (let x = 1; x < info.width; x++) { const i = (40 * info.width + x) * info.channels, j = i - info.channels; max = Math.max(max, Math.abs(px[i + 2]! - px[j + 2]!)); } return max; };
    expect(await edge(original)).toBeGreaterThan(150);
    expect(await edge(data)).toBeLessThan(60);
  });
  it('aucun file_id de l’original n’est mis en cache ni réutilisé tant que c’est verrouillé', async () => {
    const asset = (await api().get('/api/library/assets').set(auth(tl.token))).body.items[0];
    expect(asset.id).toBe(assetId);
    await fanWrites(owner, acc, 'Marc', 'combien ?');
    const r = await api().post(`/api/conversations/${conv}/messages`).set(auth(ch.token)).send({ assetId });
    await tick();
    expect(r.body.ppv.state).toBe('LOCKED');
    const files = await sentFiles();
    expect(files).toHaveLength(2);
    expect(files.every((f) => !f.file!.viaFileId)).toBe(true);
  });
  it('le déblocage envoie l’original, enregistre la vente (25 €) et marque le PPV débloqué', async () => {
    const before = (await api().get(`/api/conversations/${conv}`).set(auth(ch.token))).body;
    const r = await api().post(`/api/messages/${ppvMsgId}/unlock`).set(auth(tl.token));
    expect(r.status).toBe(202);
    await tick();
    const files = await sentFiles();
    expect(files).toHaveLength(3);
    const { data } = await fileData(2);
    expect(data.equals(original)).toBe(true);
    const msgs = (await api().get(`/api/conversations/${conv}/messages`).set(auth(ch.token))).body.items as any[];
    expect(msgs.find((m) => m.id === ppvMsgId).ppv.state).toBe('UNLOCKED');
    const after = (await api().get(`/api/conversations/${conv}`).set(auth(ch.token))).body;
    expect((after.totalSpentCents ?? 0) - (before.totalSpentCents ?? 0)).toBe(2500);
    const sales = (await api().get('/api/sales').set(auth(tl.token))).body.items as any[];
    expect(sales.filter((s) => s.note === 'PPV débloqué' && s.amountCents === 2500)).toHaveLength(1);
    expect(sales[0].recordedByName).toMatch(/./);
  });
  it('on ne peut pas débloquer deux fois (pas de double vente)', async () => {
    const r = await api().post(`/api/messages/${ppvMsgId}/unlock`).set(auth(ch.token));
    expect(r.status).toBe(409);
    await tick();
    const sales = (await api().get('/api/sales').set(auth(tl.token))).body.items as any[];
    expect(sales.filter((s) => s.note === 'PPV débloqué')).toHaveLength(1);
    expect((await sentFiles())).toHaveLength(3);
  });
  it('déblocages simultanés : un seul gagne', async () => {
    const second = (await api().get(`/api/conversations/${conv}/messages`).set(auth(ch.token))).body.items.filter((m: any) => m.ppv?.state === 'LOCKED')[0];
    const rs = await Promise.all([1, 2, 3].map(() => api().post(`/api/messages/${second.id}/unlock`).set(auth(ch.token))));
    expect(rs.filter((r) => r.status === 202)).toHaveLength(1);
    await tick();
    const sales = (await api().get('/api/sales').set(auth(tl.token))).body.items as any[];
    expect(sales.filter((s) => s.note === 'PPV débloqué')).toHaveLength(2);
  });
  it('un échec d’envoi du déblocage remet le PPV en verrouillé, sans vente', async () => {
    await fanWrites(owner, acc, 'Marc', 'encore');
    const r = await api().post(`/api/conversations/${conv}/messages`).set(auth(ch.token)).send({ assetId });
    await tick();
    const id = r.body.id;
    const salesBefore = ((await api().get('/api/sales').set(auth(tl.token))).body.items as any[]).length;
    const token = accountToken((await loadAccountSecret(acc))!);
    sandboxTelegram.failNext(token, 'sendPhoto', { code: 403, description: 'Forbidden: bot was blocked by the user' });
    const u = await api().post(`/api/messages/${id}/unlock`).set(auth(ch.token));
    expect(u.status).toBe(202);
    await tick();
    const msgs = (await api().get(`/api/conversations/${conv}/messages`).set(auth(ch.token))).body.items as any[];
    expect(msgs.find((m) => m.id === id).ppv.state).toBe('LOCKED');
    expect(((await api().get('/api/sales').set(auth(tl.token))).body.items as any[]).length).toBe(salesBefore);
  });
});
