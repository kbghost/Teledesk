import { MIN_PAYOUT_CENTS } from '@teledesk/shared';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { Agency, Payout, Sale, User } from '../models';
import type { Actor } from '../types/express';
import { requirePermission } from './access.service';
import { audit } from './audit.service';
import { AppError, notFound } from '../utils/errors';
import { nowDate } from '../utils/clock';

/** Une demande de retrait à la fois par agence (processus unique) : empêche deux retraits simultanés de dépasser le solde. */
const tails = new Map<string, Promise<unknown>>();
function exclusive<T>(key: string, job: () => Promise<T>): Promise<T> {
  const run = (tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(job);
  tails.set(key, run);
  void run.finally(() => { if (tails.get(key) === run) tails.delete(key); }).catch(() => undefined);
  return run;
}

async function sum(model: any, match: Record<string, unknown>, field: string) {
  const r = await model.aggregate([{ $match: match }, { $group: { _id: null, v: { $sum: `$${field}` } } }]);
  return (r[0]?.v as number) ?? 0;
}

/** Brut = ce que les fans ont payé ; commission = part plateforme ; net = revenu de l'agence ; disponible = net − retraits demandés ou versés. */
export async function walletOf(agencyId: string) {
  const aid = new Types.ObjectId(agencyId);
  const sales = { agencyId: aid, status: 'CONFIRMED' };
  const [gross, fee, paid, pending, approved] = await Promise.all([
    sum(Sale, sales, 'amountCents'),
    sum(Sale, sales, 'feeCents'),
    sum(Payout, { agencyId: aid, status: 'PAID' }, 'amountCents'),
    sum(Payout, { agencyId: aid, status: 'PENDING' }, 'amountCents'),
    sum(Payout, { agencyId: aid, status: 'APPROVED' }, 'amountCents'),
  ]);
  const net = gross - fee;
  const reserved = pending + approved;
  return { grossCents: gross, feeCents: fee, netCents: net, paidCents: paid, reservedCents: reserved, availableCents: Math.max(0, net - paid - reserved), minPayoutCents: MIN_PAYOUT_CENTS };
}

export const serializePayout = (p: any, extra: Record<string, unknown> = {}) => ({
  id: String(p._id), agencyId: String(p.agencyId), amountCents: p.amountCents, method: p.method, destination: p.destination, status: p.status, note: p.note ?? '',
  requestedBy: String(p.requestedBy), createdAt: p.createdAt, decidedAt: p.decidedAt ?? null, paidAt: p.paidAt ?? null, reference: p.reference ?? '', rejectReason: p.rejectReason ?? '', ...extra,
});

export async function wallet(actor: Actor) {
  requirePermission(actor, 'wallet.view');
  const rows = await Payout.find({ agencyId: actor.agencyId }).sort({ _id: -1 }).limit(100).lean();
  return { wallet: await walletOf(actor.agencyId), payouts: rows.map((p) => serializePayout(p)) };
}

export async function requestPayout(actor: Actor, input: { amountCents: number; method: string; destination: string; note?: string }, req: Request) {
  requirePermission(actor, 'payout.request');
  return exclusive(actor.agencyId, async () => {
    const w = await walletOf(actor.agencyId);
    if (input.amountCents < MIN_PAYOUT_CENTS) throw new AppError(400, 'PAYOUT_MIN', 'Minimum de retrait : 20 €');
    if (input.amountCents > w.availableCents) throw new AppError(409, 'PAYOUT_INSUFFICIENT', 'Montant supérieur au solde disponible');
    const p = await Payout.create({ agencyId: actor.agencyId, requestedBy: actor.id, amountCents: input.amountCents, method: input.method, destination: input.destination, note: input.note ?? '' });
    await audit(req, actor.agencyId, actor.id, 'PAYOUT_REQUESTED', 'Payout', String(p._id), { amountCents: input.amountCents });
    return serializePayout(p);
  });
}

export async function cancelPayout(actor: Actor, id: string, req: Request) {
  requirePermission(actor, 'payout.request');
  const r = await Payout.findOneAndUpdate({ _id: id, agencyId: actor.agencyId, status: 'PENDING' }, { $set: { status: 'REJECTED', rejectReason: 'Annulé par l’agence', decidedAt: nowDate() } }, { new: true });
  if (!r) throw new AppError(409, 'PAYOUT_LOCKED', 'Cette demande ne peut plus être annulée');
  await audit(req, actor.agencyId, actor.id, 'PAYOUT_CANCELLED', 'Payout', id);
  return serializePayout(r);
}

// ───────────── Côté plateforme ─────────────
export async function adminListPayouts(q: { status?: string }) {
  const filter: Record<string, unknown> = q.status ? { status: q.status } : {};
  const rows = await Payout.find(filter).sort({ _id: -1 }).limit(200).lean();
  const ags = await Agency.find({ _id: { $in: rows.map((r) => r.agencyId) } }).select('name').lean();
  const names = new Map(ags.map((a) => [String(a._id), a.name]));
  const users = await User.find({ _id: { $in: rows.map((r) => r.requestedBy) } }).select('displayName email').lean();
  const un = new Map(users.map((u) => [String(u._id), `${u.displayName} <${u.email}>`]));
  return { items: rows.map((p) => serializePayout(p, { agencyName: names.get(String(p.agencyId)) ?? '—', requesterName: un.get(String(p.requestedBy)) ?? '—' })) };
}

export async function adminDecidePayout(actor: Actor, id: string, d: { decision: 'APPROVE' | 'PAID' | 'REJECT'; reference?: string; reason?: string }, req: Request) {
  const cur = await Payout.findById(id).lean();
  if (!cur) throw notFound('Demande introuvable');
  const now = nowDate();
  const flow: Record<string, { from: string[]; set: Record<string, unknown> }> = {
    APPROVE: { from: ['PENDING'], set: { status: 'APPROVED', decidedBy: actor.id, decidedAt: now } },
    PAID: { from: ['PENDING', 'APPROVED'], set: { status: 'PAID', decidedBy: actor.id, decidedAt: now, paidAt: now, reference: d.reference ?? '' } },
    REJECT: { from: ['PENDING', 'APPROVED'], set: { status: 'REJECTED', decidedBy: actor.id, decidedAt: now, rejectReason: d.reason ?? '' } },
  };
  const step = flow[d.decision]!;
  const r = await Payout.findOneAndUpdate({ _id: id, status: { $in: step.from } }, { $set: step.set }, { new: true });
  if (!r) throw new AppError(409, 'PAYOUT_STATE', 'Cette demande a déjà été traitée');
  await audit(req, String(cur.agencyId), actor.id, `PAYOUT_${d.decision}`, 'Payout', id, { amountCents: cur.amountCents });
  return serializePayout(r);
}
