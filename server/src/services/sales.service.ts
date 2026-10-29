import { Types } from 'mongoose';
import type { Request } from 'express';
import type { z } from 'zod';
import { can, contactName, DEFAULT_FEE_BPS, seesAllAccounts, splitSale } from '@teledesk/shared';
import type { salesQuerySchema, shiftSchema } from '@teledesk/shared';
import { Agency, Asset, Conversation, Sale, Shift, TelegramAccount, User } from '../models';
import type { Actor } from '../types/express';
import { nowDate } from '../utils/clock';
import { AppError, conflict, notFound } from '../utils/errors';
import { dayKey, pageResult } from '../utils/helpers';
import { findAssignee, loadReplyableConversation, requirePermission, visibleAccountIds } from './access.service';
import { audit } from './audit.service';
import { bumpStat } from './stats.service';
import { publishConversation } from './telegram/audience';
import { rangeStart } from './analytics.service';

const oid = (id: string) => new Types.ObjectId(id);

const serializeSale = (s: any, names: Map<string, string>, convNames: Map<string, string>) => ({
  id: String(s._id), conversationId: String(s.conversationId), contactName: convNames.get(String(s.conversationId)) ?? 'Contact supprimé', accountId: String(s.accountId),
  recordedBy: String(s.recordedBy), recordedByName: names.get(String(s.recordedBy)) ?? 'Ancien membre', amountCents: s.amountCents, grossCents: s.amountCents, feeCents: s.feeCents ?? 0, netCents: s.netCents ?? s.amountCents - (s.feeCents ?? 0), source: (s.source ?? 'MANUAL') as string, note: s.note ?? '',
  assetId: s.assetId ? String(s.assetId) : null, status: s.status as 'CONFIRMED' | 'VOID', createdAt: s.createdAt, shiftId: s.shiftId ? String(s.shiftId) : null,
});

async function decorate(rows: any[]) {
  const [users, convs] = await Promise.all([
    User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.recordedBy)))] } }).select('displayName').lean(),
    Conversation.find({ _id: { $in: [...new Set(rows.map((r) => String(r.conversationId)))] } }).select('contact').lean(),
  ]);
  return rows.map((s) => serializeSale(s, new Map(users.map((u) => [String(u._id), u.displayName])), new Map(convs.map((c) => [String(c._id), contactName(c.contact ?? {})]))));
}

/** Écriture d'une vente (sans contrôle de droits : l'appelant les a vérifiés) : total du contact, compteurs du chatter et shift en cours. */
export async function insertSale(agencyId: string, conv: { _id: Types.ObjectId; accountId: Types.ObjectId }, userId: string, input: { amountCents: number; assetId?: string; note: string; source?: 'MANUAL' | 'PPV_UNLOCK' | 'PPV_PAID' }) {
  const at = nowDate();
  const day = dayKey(at);
  const feeBps = (await Agency.findById(agencyId).select('feeBps').lean())?.feeBps ?? DEFAULT_FEE_BPS;
  const { feeCents, netCents } = splitSale(input.amountCents, feeBps);
  const shift = await Shift.findOne({ userId, accountId: conv.accountId, startsAt: { $lte: at }, endsAt: { $gte: at } }).select('_id').lean();
  const sale = await Sale.create({
    agencyId, accountId: conv.accountId, conversationId: conv._id, recordedBy: userId, assetId: input.assetId, amountCents: input.amountCents,
    feeBps, feeCents, netCents, source: input.source ?? 'MANUAL', note: input.note, shiftId: shift?._id, day,
  });
  await Conversation.updateOne({ _id: conv._id }, { $inc: { totalSpentCents: input.amountCents, salesCount: 1 } });
  await bumpStat(agencyId, conv.accountId, userId, { salesCount: 1, salesCents: input.amountCents, feeCents }, day);
  await publishConversation(String(conv._id));
  return sale;
}

/** Pose d'une vente : elle rejoint le total du contact, les compteurs du chatter et le shift en cours. Le paiement du fan se fait hors plateforme. */
export async function recordSale(actor: Actor, conversationId: string, input: { amountCents: number; assetId?: string; note: string }, req: Request) {
  requirePermission(actor, 'sales.record');
  const conv = await loadReplyableConversation(actor, conversationId);
  if (input.assetId && !(await Asset.exists({ _id: input.assetId, agencyId: actor.agencyId, deletedAt: null }))) throw new AppError(400, 'BAD_ASSET', 'Fichier introuvable dans la médiathèque');
  const sale = await insertSale(actor.agencyId, conv, actor.id, input);
  await audit(req, actor.agencyId, actor.id, 'SALE_RECORDED', 'Sale', String(sale._id), { amountCents: input.amountCents, conversationId });
  return (await decorate([sale.toObject()]))[0]!;
}

/** Annulation : l'opération est inversée partout (total du contact, compteurs du jour d'origine). Une vente ne s'annule qu'une fois. */
export async function voidSale(actor: Actor, id: string, req: Request) {
  requirePermission(actor, 'sales.void');
  const visible = await visibleAccountIds(actor);
  const sale = await Sale.findOneAndUpdate(
    { _id: id, agencyId: actor.agencyId, status: 'CONFIRMED', accountId: { $in: visible.map(oid) } },
    { $set: { status: 'VOID', voidedBy: actor.id, voidedAt: nowDate() } },
    { new: true },
  );
  if (!sale) {
    if (await Sale.exists({ _id: id, agencyId: actor.agencyId, status: 'VOID' })) throw conflict('ALREADY_VOID', 'Cette vente est déjà annulée');
    throw notFound('Vente introuvable');
  }
  await Conversation.updateOne({ _id: sale.conversationId }, { $inc: { totalSpentCents: -sale.amountCents, salesCount: -1 } });
  await bumpStat(sale.agencyId, sale.accountId, sale.recordedBy, { salesCount: -1, salesCents: -sale.amountCents, feeCents: -(sale.feeCents ?? 0) }, sale.day);
  await publishConversation(String(sale.conversationId));
  await audit(req, actor.agencyId, actor.id, 'SALE_VOIDED', 'Sale', id, { amountCents: sale.amountCents });
  return (await decorate([sale.toObject()]))[0]!;
}

export async function listSales(actor: Actor, q: z.infer<typeof salesQuerySchema>) {
  const team = can(actor, 'analytics.team');
  if (!team && !can(actor, 'sales.record')) throw new AppError(403, 'FORBIDDEN_ROLE', 'Action non autorisée pour votre rôle');
  const visible = await visibleAccountIds(actor);
  const filter: Record<string, unknown> = { agencyId: oid(actor.agencyId), accountId: { $in: visible.map(oid) }, createdAt: { $gte: rangeStart(q.range) } };
  if (!team) filter.recordedBy = oid(actor.id);
  else if (q.userId) filter.recordedBy = oid(q.userId);
  if (q.accountId) { if (!visible.includes(q.accountId)) return { items: [], nextCursor: null }; filter.accountId = oid(q.accountId); }
  if (q.cursor) filter._id = { $lt: oid(q.cursor) };
  const rows = await Sale.find(filter).sort({ _id: -1 }).limit(q.limit + 1).lean();
  const page = pageResult(rows, q.limit);
  return { items: await decorate(page.items), nextCursor: page.nextCursor };
}

// ───────────── Shifts ─────────────
const serializeShift = (s: any, names: Map<string, string>, labels: Map<string, string>) => ({
  id: String(s._id), userId: String(s.userId), userName: names.get(String(s.userId)) ?? 'Ancien membre', accountId: String(s.accountId),
  accountLabel: labels.get(String(s.accountId)) ?? 'Compte supprimé', startsAt: s.startsAt, endsAt: s.endsAt,
});

export async function listShifts(actor: Actor, q: { from?: string; to?: string; userId?: string }) {
  const team = can(actor, 'shifts.manage');
  if (!team && !can(actor, 'inbox.reply')) throw new AppError(403, 'FORBIDDEN_ROLE', 'Action non autorisée pour votre rôle');
  const from = q.from ? new Date(q.from) : new Date(Date.now() - 24 * 3600_000);
  const to = q.to ? new Date(q.to) : new Date(Date.now() + 7 * 864e5);
  const filter: Record<string, unknown> = { agencyId: oid(actor.agencyId), startsAt: { $lt: to }, endsAt: { $gt: from } };
  if (!team) filter.userId = oid(actor.id);
  else if (q.userId) filter.userId = oid(q.userId);
  else { const visible = await visibleAccountIds(actor); filter.accountId = { $in: visible.map(oid) }; }
  const rows = await Shift.find(filter).sort({ startsAt: 1 }).limit(500).lean();
  const [users, accounts] = await Promise.all([
    User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.userId)))] } }).select('displayName').lean(),
    TelegramAccount.find({ _id: { $in: [...new Set(rows.map((r) => String(r.accountId)))] } }).select('label').lean(),
  ]);
  const names = new Map(users.map((u) => [String(u._id), u.displayName]));
  const labels = new Map(accounts.map((a) => [String(a._id), a.label]));
  return rows.map((s) => serializeShift(s, names, labels));
}

export async function createShift(actor: Actor, input: z.infer<typeof shiftSchema>) {
  requirePermission(actor, 'shifts.manage');
  const visible = await visibleAccountIds(actor);
  if (!visible.includes(input.accountId)) throw notFound('Compte introuvable');
  const u = await findAssignee(actor.agencyId, input.userId, ['MANAGER', 'TEAM_LEADER', 'CHATTER']);
  if (!u) throw new AppError(400, 'BAD_ASSIGNEE', 'Seuls les sous-chefs, team leaders et chatters actifs peuvent avoir un shift');
  if (!seesAllAccounts(u.agencyRole) && !(u.accountIds ?? []).map(String).includes(input.accountId)) throw new AppError(400, 'NO_ACCESS', 'Ce membre n’a pas accès à ce compte Telegram');
  const startsAt = new Date(input.startsAt); const endsAt = new Date(input.endsAt);
  if (await Shift.exists({ userId: u._id, startsAt: { $lt: endsAt }, endsAt: { $gt: startsAt } })) throw conflict('SHIFT_OVERLAP', 'Ce membre a déjà un shift sur ce créneau');
  const s = await Shift.create({ agencyId: actor.agencyId, userId: u._id, accountId: input.accountId, startsAt, endsAt, createdBy: actor.id });
  return serializeShift(s.toObject(), new Map([[String(u._id), u.displayName]]), new Map([[input.accountId, (await TelegramAccount.findById(input.accountId).select('label').lean())?.label ?? '']]));
}

export async function deleteShift(actor: Actor, id: string) {
  requirePermission(actor, 'shifts.manage');
  const visible = await visibleAccountIds(actor);
  const r = await Shift.deleteOne({ _id: id, agencyId: actor.agencyId, accountId: { $in: visible.map(oid) } });
  if (!r.deletedCount) throw notFound('Shift introuvable');
}
