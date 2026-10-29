import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, boot, convsOf, fanWrites, makeAccount, registerOwner, shutdown, tick } from './helpers';
import { ensureSuperAdmin } from '../services/auth.service';
import { Agency } from '../models';

const PW = 'Motdepasse!2024';
const withAg = (t: string, agencyId?: string) => ({ ...auth(t), ...(agencyId ? { 'x-agency-id': agencyId } : {}) });
async function invite(ownerToken: string, role: string, email: string, extra: Record<string, unknown> = {}, agencyId?: string) {
  const inv = await api().post('/api/team/invites').set(withAg(ownerToken, agencyId)).send({ email, displayName: email.split('@')[0], role, ...extra });
  expect(inv.status).toBe(201);
  const acc = await api().post('/api/auth/accept-invite').send({ token: String(inv.body.inviteUrl).split('/').pop(), password: PW });
  expect(acc.status).toBe(201);
  return { token: acc.body.accessToken as string, id: acc.body.user.id as string };
}

let owner: string; let ownerUser: any; let ag1: string; let ag2: string; let admin: string;
let acc1: string; let conv1: string;

beforeAll(async () => {
  await boot();
  await ensureSuperAdmin('root@plateforme.test', 'SuperAdmin!2024xx');
  const r = await api().post('/api/auth/login').send({ email: 'root@plateforme.test', password: 'SuperAdmin!2024xx' });
  admin = r.body.accessToken;
  const o = await registerOwner();
  owner = o.token; ownerUser = o.user; ag1 = o.user.agencyId;
}, 60_000);
afterAll(shutdown);

describe('chef d’agence : plusieurs agences', () => {
  it('crée une seconde agence ; chaque agence a ses propres comptes et son équipe', async () => {
    const c = await api().post('/api/agencies').set(auth(owner)).send({ name: 'Seconde agence' });
    expect(c.status).toBe(201);
    ag2 = c.body.agency.id;
    const list = await api().get('/api/agencies').set(auth(owner));
    expect(list.body.items.map((a: any) => a.id).sort()).toEqual([ag1, ag2].sort());
    acc1 = await makeAccount(owner, 'Modèle A');
    const a1 = await api().get('/api/accounts').set(withAg(owner, ag1));
    const a2 = await api().get('/api/accounts').set(withAg(owner, ag2));
    expect(a1.body.items).toHaveLength(1);
    expect(a2.body.items).toHaveLength(0);
  });
  it('un chef ne peut pas viser l’agence d’un autre', async () => {
    const other = await registerOwner('autre@agence.test');
    const r = await api().get('/api/accounts').set(withAg(other.token, ag1));
    expect(JSON.stringify(r.body)).not.toContain('Modèle A'); // l'en-tête visant l'agence d'autrui est sans effet : aucune fuite
  });
});

describe('sous-chef et permissions personnalisées', () => {
  let manager: { token: string; id: string }; let chatter: { token: string; id: string };
  it('le sous-chef voit toutes les discussions sans être assigné', async () => {
    await fanWrites(owner, acc1, 'Fan Un');
    manager = await invite(owner, 'MANAGER', 'sous@agence.test');
    const l = await convsOf(manager.token);
    expect(l.status).toBe(200);
    expect(l.body.items.length).toBe(1);
    conv1 = l.body.items[0].id;
    expect(l.body.items[0].agencyId).toBe(ag1);
  });
  it('le sous-chef ne gère ni équipe ni retraits', async () => {
    expect((await api().post('/api/team/invites').set(auth(manager.token)).send({ email: 'x@y.test', displayName: 'Xx', role: 'CHATTER' })).status).toBe(403);
    expect((await api().get('/api/wallet').set(auth(manager.token))).status).toBe(403);
  });
  it('permissions en plus / en moins par membre', async () => {
    chatter = await invite(owner, 'CHATTER', 'chat@agence.test', { accountIds: [acc1], permGrant: ['sales.void'], permRevoke: ['notes.write'] });
    const me = await api().get('/api/auth/me').set(auth(chatter.token));
    expect(me.body.user.permissions).toContain('sales.void');
    expect(me.body.user.permissions).not.toContain('notes.write');
    const n = await api().post(`/api/conversations/${conv1}/notes`).set(auth(chatter.token)).send({ text: 'secret' });
    expect(n.status).toBe(403);
    const s = await api().post(`/api/conversations/${conv1}/sales`).set(auth(chatter.token)).send({ amountCents: 1000 });
    expect(s.status).toBe(201);
    expect((await api().post(`/api/sales/${s.body.id}/void`).set(auth(chatter.token))).status).toBe(200);
  });
  it('le chef d’agence peut modifier les permissions d’un membre existant', async () => {
    const r = await api().patch(`/api/team/members/${chatter.id}`).set(auth(owner)).send({ permGrant: [], permRevoke: ['sales.record'] });
    expect(r.status).toBe(200);
    expect((await api().post(`/api/conversations/${conv1}/sales`).set(auth(chatter.token)).send({ amountCents: 500 })).status).toBe(403);
  });
});

describe('argent : brut, commission 15 %, net, retraits', () => {
  it('une vente de 100,00 € → 15,00 € de commission, 85,00 € net', async () => {
    const s = await api().post(`/api/conversations/${conv1}/sales`).set(auth(owner)).send({ amountCents: 10000 });
    expect(s.status).toBe(201);
    expect(s.body).toMatchObject({ grossCents: 10000, feeCents: 1500, netCents: 8500 });
    const w = await api().get('/api/wallet').set(auth(owner));
    expect(w.body.wallet).toMatchObject({ grossCents: 10000, feeCents: 1500, netCents: 8500, availableCents: 8500 });
    const ov = await api().get('/api/analytics/overview?range=today').set(auth(owner));
    expect(ov.body.totals).toMatchObject({ salesCents: 10000, feeCents: 1500, netCents: 8500 });
  });
  it('annuler une vente retire aussi la commission', async () => {
    const s = await api().post(`/api/conversations/${conv1}/sales`).set(auth(owner)).send({ amountCents: 2000 });
    expect((await api().get('/api/wallet').set(auth(owner))).body.wallet.grossCents).toBe(12000);
    await api().post(`/api/sales/${s.body.id}/void`).set(auth(owner));
    const w = await api().get('/api/wallet').set(auth(owner));
    expect(w.body.wallet).toMatchObject({ grossCents: 10000, feeCents: 1500, netCents: 8500 });
  });
  it('retrait : minimum, plafond au solde, pas de double retrait simultané', async () => {
    const body = { method: 'BANK', destination: 'FR76 1234 5678' };
    expect((await api().post('/api/payouts').set(auth(owner)).send({ ...body, amountCents: 500 })).status).toBe(400);
    expect((await api().post('/api/payouts').set(auth(owner)).send({ ...body, amountCents: 9000 })).status).toBe(409);
    const rs = await Promise.all([1, 2, 3].map(() => api().post('/api/payouts').set(auth(owner)).send({ ...body, amountCents: 5000 })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    const w = await api().get('/api/wallet').set(auth(owner));
    expect(w.body.wallet).toMatchObject({ reservedCents: 5000, availableCents: 3500 });
  });
  it('seul le super admin valide ; le net payé sort du solde, un refus le rend', async () => {
    const list = await api().get('/api/admin/payouts').set(auth(admin));
    expect(list.body.items).toHaveLength(1);
    const id = list.body.items[0].id;
    expect(list.body.items[0].agencyName).toBe('Agence Test');
    expect((await api().post(`/api/admin/payouts/${id}/decision`).set(auth(owner)).send({ decision: 'PAID' })).status).toBe(403);
    expect((await api().post(`/api/admin/payouts/${id}/decision`).set(auth(admin)).send({ decision: 'APPROVE' })).status).toBe(200);
    const paid = await api().post(`/api/admin/payouts/${id}/decision`).set(auth(admin)).send({ decision: 'PAID', reference: 'VIR-1' });
    expect(paid.body).toMatchObject({ status: 'PAID', reference: 'VIR-1' });
    expect((await api().post(`/api/admin/payouts/${id}/decision`).set(auth(admin)).send({ decision: 'REJECT', reason: 'trop tard' })).status).toBe(409);
    expect((await api().get('/api/wallet').set(auth(owner))).body.wallet).toMatchObject({ paidCents: 5000, reservedCents: 0, availableCents: 3500 });
    const p2 = await api().post('/api/payouts').set(auth(owner)).send({ method: 'CRYPTO', destination: 'bc1qxyz-wallet', amountCents: 2500 });
    const rej = await api().post(`/api/admin/payouts/${p2.body.id}/decision`).set(auth(admin)).send({ decision: 'REJECT', reason: 'Adresse invalide' });
    expect(rej.body.status).toBe('REJECTED');
    expect((await api().get('/api/wallet').set(auth(owner))).body.wallet.availableCents).toBe(3500);
  });
});

describe('super admin de la plateforme', () => {
  it('vue d’ensemble : évolution, commission, retraits en attente', async () => {
    const r = await api().get('/api/admin/overview').set(auth(admin));
    expect(r.status).toBe(200);
    expect(r.body.totals).toMatchObject({ grossCents: 10000, commissionCents: 1500 });
    expect(r.body.totals.agencies).toBeGreaterThanOrEqual(3);
    expect(r.body.series).toHaveLength(30);
    expect(r.body.topAgencies[0]).toMatchObject({ name: 'Agence Test', grossCents: 10000 });
  });
  it('les routes admin sont fermées aux chefs d’agence, et le super admin n’a pas de données d’agence', async () => {
    expect((await api().get('/api/admin/overview').set(auth(owner))).status).toBe(403);
    expect((await api().get('/api/conversations').set(auth(admin))).status).toBeGreaterThanOrEqual(400);
    expect((await api().post('/api/team/invites').set(auth(admin)).send({ email: 'a@b.test', displayName: 'Aa', role: 'CHATTER' })).status).toBeGreaterThanOrEqual(400);
  });
  it('liste des agences avec brut / commission / net / disponible', async () => {
    const r = await api().get('/api/admin/agencies').set(auth(admin));
    const a = r.body.items.find((x: any) => x.id === ag1);
    expect(a).toMatchObject({ grossCents: 10000, feeCents: 1500, netCents: 8500, paidCents: 5000, availableCents: 3500, status: 'ACTIVE' });
    expect(a.owner.email).toBe('owner@agence.test');
  });
  it('« voir les messages » : lecture seule, journalisée dans l’audit de l’agence', async () => {
    const cs = await api().get(`/api/admin/agencies/${ag1}/conversations`).set(auth(admin));
    expect(cs.body.items.length).toBe(1);
    const ms = await api().get(`/api/admin/conversations/${cs.body.items[0].id}/messages`).set(auth(admin));
    expect(ms.status).toBe(200);
    expect(ms.body.items.length).toBeGreaterThan(0);
    const audit = await api().get('/api/audit').set(auth(owner));
    expect(JSON.stringify(audit.body)).toContain('ADMIN_VIEW_MESSAGES');
    expect((await api().post(`/api/conversations/${cs.body.items[0].id}/messages`).set(auth(admin)).send({ text: 'hello' })).status).toBeGreaterThanOrEqual(400);
  });
  it('commission personnalisée par agence (appliquée aux ventes suivantes)', async () => {
    expect((await api().patch(`/api/admin/agencies/${ag1}/fee`).set(auth(admin)).send({ feeBps: 1000 })).status).toBe(200);
    const s = await api().post(`/api/conversations/${conv1}/sales`).set(auth(owner)).send({ amountCents: 1000 });
    expect(s.body).toMatchObject({ feeCents: 100, netCents: 900 });
    await api().patch(`/api/admin/agencies/${ag1}/fee`).set(auth(admin)).send({ feeBps: 1500 });
    await api().post(`/api/sales/${s.body.id}/void`).set(auth(owner));
  });
  it('bannir une agence bloque tous ses membres ; la débannir les rétablit', async () => {
    const mgr = await api().post('/api/auth/login').send({ email: 'sous@agence.test', password: PW });
    expect((await api().post(`/api/admin/agencies/${ag1}/ban`).set(auth(admin)).send({ reason: 'x' })).status).toBe(400);
    const b = await api().post(`/api/admin/agencies/${ag1}/ban`).set(auth(admin)).send({ reason: 'Contenu interdit' });
    expect(b.body.agency.status).toBe('BANNED');
    for (const t of [owner, mgr.body.accessToken]) {
      const r = await api().get('/api/conversations').set(auth(t));
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('AGENCY_BANNED');
    }
    // la seconde agence du même chef reste utilisable
    expect((await api().get('/api/accounts').set(withAg(owner, ag2))).status).toBe(200);
    expect((await Agency.findById(ag1).lean())?.banReason).toBe('Contenu interdit');
    await api().post(`/api/admin/agencies/${ag1}/unban`).set(auth(admin));
    expect((await api().get('/api/conversations').set(auth(owner))).status).toBe(200);
  });
});
