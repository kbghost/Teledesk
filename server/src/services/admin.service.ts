import type { Request } from 'express';
import { Types } from 'mongoose';
import { Agency, Conversation, DailyStat, Message, Payout, TelegramAccount, User } from '../models';
import type { Actor } from '../types/express';
import { audit } from './audit.service';
import { serializeAgency } from './agency.service';
import { serializeConversation, serializeMessage } from './serializers';
import { telegramManager } from './telegram/manager';
import { groupSums } from '../utils/aggregate';
import { AppError, notFound } from '../utils/errors';
import { nowDate } from '../utils/clock';
import { oid, pageResult } from '../utils/helpers';

const dayAgo = (n: number) => new Date(nowDate().getTime() - n * 864e5).toISOString().slice(0, 10);

/** Écran d'accueil du super admin : l'évolution de la plateforme (pas les messages). */
export async function overview(days = 30) {
  const from = dayAgo(days - 1);
  const since = new Date(nowDate().getTime() - days * 864e5);
  const [agTotal, agBanned, users, accounts, pendingRows, stats, newAgencies, topRows] = await Promise.all([
    Agency.countDocuments({ deletedAt: null }),
    Agency.countDocuments({ deletedAt: null, status: 'BANNED' }),
    User.countDocuments({ deletedAt: null, platformRole: null }),
    TelegramAccount.countDocuments({ deletedAt: null }),
    Payout.find({ status: { $in: ['PENDING', 'APPROVED'] } }).select('amountCents status').lean(),
    groupSums<{ salesCents: number; feeCents: number; salesCount: number }>(DailyStat, { day: { $gte: from } }, '$day', { salesCents: 'salesCents', feeCents: 'feeCents', salesCount: 'salesCount' }),
    Agency.find({ deletedAt: null, createdAt: { $gte: since } }).select('createdAt').lean(),
    groupSums<{ salesCents: number; feeCents: number }>(DailyStat, { day: { $gte: from } }, '$agencyId', { salesCents: 'salesCents', feeCents: 'feeCents' }),
  ]);
  const byDay = new Map(stats.map((r) => [String(r._id), r]));
  const signups = new Map<string, number>();
  newAgencies.forEach((a) => { const k = (a as any).createdAt.toISOString().slice(0, 10); signups.set(k, (signups.get(k) ?? 0) + 1); });
  const series = Array.from({ length: days }, (_, i) => {
    const day = dayAgo(days - 1 - i); const r = byDay.get(day);
    return { day, grossCents: r?.salesCents ?? 0, feeCents: r?.feeCents ?? 0, sales: r?.salesCount ?? 0, newAgencies: signups.get(day) ?? 0 };
  });
  const sum = (k: 'grossCents' | 'feeCents' | 'sales' | 'newAgencies') => series.reduce((s, r) => s + r[k], 0);
  const top = topRows.sort((a, b) => b.salesCents - a.salesCents).slice(0, 5);
  const names = new Map((await Agency.find({ _id: { $in: top.map((t) => t._id) } }).select('name').lean()).map((a) => [String(a._id), a.name]));
  return {
    days,
    totals: { agencies: agTotal, bannedAgencies: agBanned, users, accounts, grossCents: sum('grossCents'), commissionCents: sum('feeCents'), sales: sum('sales'), newAgencies: sum('newAgencies') },
    pendingPayouts: { count: pendingRows.length, amountCents: pendingRows.reduce((s, p) => s + p.amountCents, 0) },
    series,
    topAgencies: top.map((t) => ({ id: String(t._id), name: names.get(String(t._id)) ?? '—', grossCents: t.salesCents, commissionCents: t.feeCents })),
  };
}

export async function listAgencies(search?: string) {
  const filter: Record<string, unknown> = { deletedAt: null };
  if (search) filter.name = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const rows = await Agency.find(filter).sort({ createdAt: -1 }).limit(300).lean();
  const [tot, paid, reserved] = await Promise.all([
    groupSums<{ g: number; f: number }>(DailyStat, {}, '$agencyId', { g: 'salesCents', f: 'feeCents' }),
    groupSums<{ v: number }>(Payout, { status: 'PAID' }, '$agencyId', { v: 'amountCents' }),
    groupSums<{ v: number }>(Payout, { status: { $in: ['PENDING', 'APPROVED'] } }, '$agencyId', { v: 'amountCents' }),
  ]);
  const T = new Map(tot.map((r) => [String(r._id), r])); const P = new Map(paid.map((r) => [String(r._id), r.v])); const R = new Map(reserved.map((r) => [String(r._id), r.v]));
  const owners = await User.find({ _id: { $in: rows.map((r) => r.ownerId).filter(Boolean) } }).select('displayName email').lean();
  const O = new Map(owners.map((u) => [String(u._id), u]));
  const [members, accs] = await Promise.all([
    groupSums<{ n: number }>(User, { deletedAt: null, agencyId: { $ne: null } }, '$agencyId', { n: 1 }),
    groupSums<{ n: number }>(TelegramAccount, { deletedAt: null }, '$agencyId', { n: 1 }),
  ]);
  const M = new Map(members.map((r) => [String(r._id), r.n])); const A = new Map(accs.map((r) => [String(r._id), r.n]));
  return {
    items: rows.map((a) => {
      const id = String(a._id); const t = T.get(id); const gross = t?.g ?? 0; const fee = t?.f ?? 0; const o = a.ownerId ? O.get(String(a.ownerId)) : undefined;
      return {
        ...serializeAgency(a), createdAt: (a as any).createdAt, owner: o ? { name: o.displayName, email: o.email } : null, members: M.get(id) ?? 0, accounts: A.get(id) ?? 0,
        grossCents: gross, feeCents: fee, netCents: gross - fee, paidCents: P.get(id) ?? 0, reservedCents: R.get(id) ?? 0,
        availableCents: Math.max(0, gross - fee - (P.get(id) ?? 0) - (R.get(id) ?? 0)),
      };
    }),
  };
}

async function load(id: string) {
  const a = await Agency.findOne({ _id: id, deletedAt: null });
  if (!a) throw notFound('Agence introuvable');
  return a;
}

/** Bannir : les membres sont refusés (AGENCY_BANNED), l'écoute Telegram s'arrête, les données sont conservées. */
export async function banAgency(actor: Actor, id: string, reason: string, req: Request) {
  const a = await load(id);
  a.status = 'BANNED'; a.bannedAt = nowDate(); a.banReason = reason; a.bannedBy = new Types.ObjectId(actor.id) as any;
  await a.save();
  const accs = await TelegramAccount.find({ agencyId: id, deletedAt: null }).select('_id').lean();
  for (const x of accs) await telegramManager.stop(String(x._id));
  await audit(req, id, actor.id, 'AGENCY_BANNED', 'Agency', id, { reason });
  return serializeAgency(a);
}

export async function unbanAgency(actor: Actor, id: string, req: Request) {
  const a = await load(id);
  a.status = 'ACTIVE'; a.banReason = null as any; a.bannedAt = undefined as any;
  await a.save();
  await telegramManager.startAll().catch(() => 0);
  await audit(req, id, actor.id, 'AGENCY_UNBANNED', 'Agency', id);
  return serializeAgency(a);
}

export async function setFee(actor: Actor, id: string, feeBps: number, req: Request) {
  const a = await load(id);
  const before = a.feeBps;
  a.feeBps = feeBps; await a.save();
  await audit(req, id, actor.id, 'AGENCY_FEE_CHANGED', 'Agency', id, { before, after: feeBps });
  return serializeAgency(a);
}

// ───────────── « Voir les messages » (lecture seule, journalisée) ─────────────
export async function listConversations(agencyId: string, q: { cursor?: string; limit: number; search?: string }) {
  await load(agencyId);
  const filter: Record<string, unknown> = { agencyId };
  if (q.cursor) filter._id = { $lt: oid(q.cursor) };
  const rows = await Conversation.find(filter).sort({ _id: -1 }).limit(q.limit + 1).lean();
  const page = pageResult(rows, q.limit);
  return { items: page.items.map((c) => serializeConversation(c)), nextCursor: page.nextCursor };
}

export async function listMessages(actor: Actor, conversationId: string, q: { cursor?: string; limit: number }, req: Request) {
  const conv = await Conversation.findById(conversationId).lean();
  if (!conv) throw notFound('Conversation introuvable');
  const filter: Record<string, unknown> = { conversationId: conv._id };
  if (q.cursor) filter._id = { $lt: oid(q.cursor) };
  const rows = await Message.find(filter).sort({ _id: -1 }).limit(q.limit + 1).lean();
  const page = pageResult(rows, q.limit);
  if (!q.cursor) await audit(req, String(conv.agencyId), actor.id, 'ADMIN_VIEW_MESSAGES', 'Conversation', conversationId);
  return { items: page.items.map((m) => serializeMessage(m, actor.id)), nextCursor: page.nextCursor, conversation: serializeConversation(conv) };
}
