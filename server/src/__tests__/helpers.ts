import http from 'node:http';
import mongoose from 'mongoose';
import request from 'supertest';
import sharp from 'sharp';
import { connectDb } from '../config/db';
import { createApp } from '../app';
import { setSandboxBase } from '../providers/telegram/api';
import { sandboxTelegram } from '../providers/telegram/fake';
import { setClock } from '../utils/clock';
import { outboundIdle } from '../services/telegram/outbound';
import { ingestIdle } from '../services/telegram/ingest';
import { initSockets } from '../sockets';

export interface Ctx { server: http.Server; base: string }
let ctx: Ctx;

export async function boot(withSockets = false): Promise<Ctx> {
  await connectDb();
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  sandboxTelegram.reset();
  setClock(undefined);
  const app = createApp();
  const server = http.createServer(app);
  if (withSockets) initSockets(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  setSandboxBase(`${base}/__sandbox/telegram`);
  ctx = { server, base };
  return ctx;
}
export async function shutdown() {
  await outboundIdle(); await ingestIdle();
  await new Promise<void>((r) => ctx.server.close(() => r()));
  await mongoose.disconnect();
}
export const api = () => request(ctx.base);
export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
export const tick = async () => { await ingestIdle(); await outboundIdle(); };

export async function registerOwner(email = 'owner@agence.test') {
  const r = await api().post('/api/auth/register').send({ agencyName: 'Agence Test', displayName: 'Boss', email, password: 'Motdepasse!2024', acceptTerms: true });
  if (r.status !== 201) throw new Error('register failed ' + JSON.stringify(r.body));
  return { token: r.body.accessToken as string, user: r.body.user };
}
export async function addMember(ownerToken: string, role: 'TEAM_LEADER' | 'CHATTER' | 'MODEL', email: string, accountIds: string[] = []) {
  const inv = await api().post('/api/team/invites').set(auth(ownerToken)).send({ email, displayName: email.split('@')[0], role, accountIds });
  if (inv.status !== 201) throw new Error('invite failed ' + JSON.stringify(inv.body));
  const token = String(inv.body.inviteUrl).split('/').pop()!;
  const acc = await api().post('/api/auth/accept-invite').send({ token, password: 'Motdepasse!2024' });
  if (acc.status !== 201) throw new Error('accept failed ' + JSON.stringify(acc.body));
  return { token: acc.body.accessToken as string, id: acc.body.user.id as string };
}
/** Compte « bac à sable » complet : créé, connecté côté Telegram, confirmé par le Super admin. */
export async function makeAccount(ownerToken: string, label: string) {
  const c = await api().post('/api/accounts').set(auth(ownerToken)).send({ label, mode: 'SANDBOX' });
  if (c.status !== 201) throw new Error('account failed ' + JSON.stringify(c.body));
  const id = c.body.id as string;
  const s = await api().post(`/api/accounts/${id}/sandbox/connect`).set(auth(ownerToken)).send({});
  if (s.status !== 200) throw new Error('sandbox connect failed ' + JSON.stringify(s.body));
  const d = await api().post(`/api/accounts/${id}/business`).set(auth(ownerToken)).send({ decision: 'APPROVE' });
  if (d.status !== 200) throw new Error('approve failed ' + JSON.stringify(d.body));
  return id;
}
export async function fanWrites(ownerToken: string, accountId: string, fanName: string, text = 'Salut !') {
  const r = await api().post(`/api/accounts/${accountId}/sandbox/incoming`).set(auth(ownerToken)).send({ fanName, text });
  if (r.status !== 200) throw new Error('incoming failed ' + JSON.stringify(r.body));
  await tick();
}
export async function convsOf(token: string, query = '') {
  const r = await api().get(`/api/conversations${query}`).set(auth(token));
  return r;
}
export const png = (w = 64, h = 48) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 90, g: 60, b: 160 } } }).png().toBuffer();
