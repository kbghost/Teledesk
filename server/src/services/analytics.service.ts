import { Types } from 'mongoose';
import type { AnalyticsRange } from '@teledesk/shared';
import { Conversation, DailyStat, Message, Sale, Shift, TelegramAccount, User } from '../models';
import type { Actor } from '../types/express';
import { nowDate } from '../utils/clock';
import { groupSums } from '../utils/aggregate';
import { dayKey } from '../utils/helpers';
import { requirePermission, visibleAccountIds } from './access.service';
import { contactName } from '@teledesk/shared';

const oid = (id: string) => new Types.ObjectId(id);
const DAYS: Record<AnalyticsRange, number> = { today: 1, '7d': 7, '30d': 30, '90d': 90 };

/** Début de la période (minuit UTC du premier jour). « today » = aujourd'hui seulement ; « 7d » = aujourd'hui et les 6 jours précédents. */
export function rangeStart(range: AnalyticsRange, at = nowDate()): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - (DAYS[range] - 1));
  return d;
}
function dayList(range: AnalyticsRange, at = nowDate()) {
  const start = rangeStart(range, at);
  return Array.from({ length: DAYS[range] }, (_, i) => dayKey(new Date(start.getTime() + i * 864e5)));
}

const METRICS = { messagesIn: 'messagesIn', messagesOut: 'messagesOut', newConversations: 'newConversations', salesCount: 'salesCount', salesCents: 'salesCents', feeCents: 'feeCents', respCount: 'respCount', respMsSum: 'respMsSum' } as const;
type Row = Record<keyof typeof METRICS, number>;
const zero = (): Row => ({ messagesIn: 0, messagesOut: 0, newConversations: 0, salesCount: 0, salesCents: 0, feeCents: 0, respCount: 0, respMsSum: 0 });
const avg = (sum: number, n: number) => (n > 0 ? Math.round(sum / n) : null);

/**
 * Vue d'ensemble des métriques de l'agence (Super admin et Team leaders). Tous les chiffres viennent de compteurs incrémentés
 * lors d'évènements réels (message reçu, message envoyé, vente posée) : rien n'est estimé.
 */
export async function overview(actor: Actor, q: { range: AnalyticsRange; accountId?: string }) {
  requirePermission(actor, 'analytics.team');
  const visible = await visibleAccountIds(actor);
  const accountIds = q.accountId ? visible.filter((a) => a === q.accountId) : visible;
  const days = dayList(q.range);
  const match = { agencyId: oid(actor.agencyId), accountId: { $in: accountIds.map(oid) }, day: { $gte: days[0], $lte: days[days.length - 1] } };
  const [byDay, byUser, byAccount] = await Promise.all([
    groupSums<Row>(DailyStat, match, '$day', METRICS),
    groupSums<Row>(DailyStat, { ...match, userId: { $ne: null } }, '$userId', METRICS),
    groupSums<Row>(DailyStat, match, '$accountId', METRICS),
  ]);
  const dayMap = new Map(byDay.map((r) => [String(r._id), r]));
  const series = days.map((day) => ({ day, ...pick(dayMap.get(day)) }));
  const totals = byDay.reduce((acc, r) => { for (const k of Object.keys(acc) as Array<keyof Row>) acc[k] += r[k] ?? 0; return acc; }, zero());

  const since = rangeStart(q.range);
  const userIds = byUser.map((r) => String(r._id));
  const [users, accounts] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select('displayName agencyRole').lean(),
    TelegramAccount.find({ _id: { $in: accountIds.map(oid) } }).select('label').lean(),
  ]);
  const uName = new Map(users.map((u) => [String(u._id), u]));
  const aName = new Map(accounts.map((a) => [String(a._id), a.label]));

  // Conversion d'un chatter = conversations avec au moins une vente ÷ conversations auxquelles il a répondu (sur la période).
  const perChatter = await Promise.all(byUser.map(async (r) => {
    const id = String(r._id);
    const [answered, converted] = await Promise.all([
      Message.distinct('conversationId', { agencyId: oid(actor.agencyId), sentBy: oid(id), direction: 'OUT', accountId: { $in: accountIds.map(oid) }, createdAt: { $gte: since } }),
      Sale.distinct('conversationId', { agencyId: oid(actor.agencyId), recordedBy: oid(id), status: 'CONFIRMED', accountId: { $in: accountIds.map(oid) }, createdAt: { $gte: since } }),
    ]);
    const answeredSet = new Set(answered.map(String));
    const won = converted.map(String).filter((c) => answeredSet.has(c)).length;
    return {
      userId: id, name: uName.get(id)?.displayName ?? 'Ancien membre', role: uName.get(id)?.agencyRole ?? null, messagesOut: r.messagesOut, salesCount: r.salesCount, salesCents: r.salesCents, feeCents: r.feeCents, netCents: r.salesCents - r.feeCents,
      avgResponseMs: avg(r.respMsSum, r.respCount), conversationsAnswered: answeredSet.size, conversionRate: answeredSet.size ? won / answeredSet.size : null,
    };
  }));
  perChatter.sort((a, b) => b.salesCents - a.salesCents || b.messagesOut - a.messagesOut);

  const convFilter = { agencyId: oid(actor.agencyId), deletedAt: null, accountId: { $in: accountIds.map(oid) } };
  const [waiting, oldest, unassigned, whales, shifts] = await Promise.all([
    Conversation.countDocuments({ ...convFilter, status: 'OPEN', awaitingSince: { $ne: null } }),
    Conversation.findOne({ ...convFilter, status: 'OPEN', awaitingSince: { $ne: null } }).sort({ awaitingSince: 1 }).select('awaitingSince').lean(),
    Conversation.countDocuments({ ...convFilter, status: 'OPEN', assignedTo: null }),
    Conversation.find({ ...convFilter, totalSpentCents: { $gt: 0 } }).sort({ totalSpentCents: -1 }).limit(5).select('contact totalSpentCents salesCount accountId').lean(),
    Shift.find({ agencyId: oid(actor.agencyId), accountId: { $in: accountIds.map(oid) }, startsAt: { $gte: since } }).sort({ startsAt: -1 }).limit(40).lean(),
  ]);

  const shiftSales = shifts.length ? await groupSums<{ salesCount: number; salesCents: number }>(Sale, { agencyId: oid(actor.agencyId), status: 'CONFIRMED', shiftId: { $in: shifts.map((s) => s._id) } }, '$shiftId', { salesCount: 1, salesCents: 'amountCents' }) : [];
  const ss = new Map(shiftSales.map((r) => [String(r._id), r]));
  const shiftUsers = await User.find({ _id: { $in: [...new Set(shifts.map((s) => String(s.userId)))] } }).select('displayName').lean();
  const sName = new Map(shiftUsers.map((u) => [String(u._id), u.displayName]));

  return {
    range: q.range, from: days[0]!, to: days[days.length - 1]!,
    totals: { ...totals, netCents: totals.salesCents - totals.feeCents, avgResponseMs: avg(totals.respMsSum, totals.respCount) },
    live: { waiting, oldestWaitingSince: oldest?.awaitingSince ?? null, unassigned },
    series,
    perChatter,
    perAccount: byAccount.map((r) => ({ accountId: String(r._id), label: aName.get(String(r._id)) ?? 'Compte', ...pick(r), avgResponseMs: avg(r.respMsSum, r.respCount) })).sort((a, b) => b.salesCents - a.salesCents),
    topFans: whales.map((c) => ({ conversationId: String(c._id), name: contactName(c.contact ?? {}), totalSpentCents: c.totalSpentCents, salesCount: c.salesCount, accountLabel: aName.get(String(c.accountId)) ?? '' })),
    shifts: shifts.map((s) => ({ id: String(s._id), userName: sName.get(String(s.userId)) ?? 'Ancien membre', accountLabel: aName.get(String(s.accountId)) ?? '', startsAt: s.startsAt, endsAt: s.endsAt, salesCount: ss.get(String(s._id))?.salesCount ?? 0, salesCents: ss.get(String(s._id))?.salesCents ?? 0 })),
  };
}

function pick(r?: Partial<Row>) {
  return { messagesIn: r?.messagesIn ?? 0, messagesOut: r?.messagesOut ?? 0, newConversations: r?.newConversations ?? 0, salesCount: r?.salesCount ?? 0, salesCents: r?.salesCents ?? 0, feeCents: r?.feeCents ?? 0, netCents: (r?.salesCents ?? 0) - (r?.feeCents ?? 0) };
}

/** Statistiques personnelles d'un chatter : uniquement les siennes. */
export async function myStats(actor: Actor, range: AnalyticsRange) {
  const days = dayList(range);
  const rows = await groupSums<Row>(DailyStat, { agencyId: oid(actor.agencyId), userId: oid(actor.id), day: { $gte: days[0], $lte: days[days.length - 1] } }, '$day', METRICS);
  const byDay = new Map(rows.map((r) => [String(r._id), r]));
  const totals = rows.reduce((acc, r) => { for (const k of Object.keys(acc) as Array<keyof Row>) acc[k] += r[k] ?? 0; return acc; }, zero());
  const at = nowDate();
  const shift = await Shift.findOne({ userId: oid(actor.id), startsAt: { $lte: at }, endsAt: { $gte: at } }).lean();
  const account = shift ? await TelegramAccount.findById(shift.accountId).select('label').lean() : null;
  return {
    range, series: days.map((day) => ({ day, ...pick(byDay.get(day)) })),
    totals: { ...pick(totals), avgResponseMs: avg(totals.respMsSum, totals.respCount) },
    currentShift: shift ? { id: String(shift._id), accountLabel: account?.label ?? '', startsAt: shift.startsAt, endsAt: shift.endsAt } : null,
  };
}
