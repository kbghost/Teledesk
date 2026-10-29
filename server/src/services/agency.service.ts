import { DEFAULT_FEE_BPS, type AgencyStatus } from '@teledesk/shared';
import type { Request } from 'express';
import { Agency, AuditLog, Invite, Tag, TelegramAccount, User } from '../models';
import type { Actor } from '../types/express';
import { requirePermission } from './access.service';
import { audit } from './audit.service';
import { notFound } from '../utils/errors';

export const DEFAULT_TAGS = [
  { name: 'Whale', color: '#E0A100' },
  { name: 'Nouveau', color: '#12A38A' },
  { name: 'À relancer', color: '#D9534F' },
  { name: 'Acheteur', color: '#5B3A99' },
];

export async function createAgency(name: string, ownerId?: unknown) {
  const agency = await Agency.create({ name, ownerId });
  await Tag.insertMany(DEFAULT_TAGS.map((t) => ({ agencyId: agency._id, name: t.name, nameLower: t.name.toLowerCase(), color: t.color })));
  return agency;
}

export async function getAgency(agencyId: string) {
  const a = await Agency.findOne({ _id: agencyId, deletedAt: null });
  if (!a) throw notFound('Agence introuvable');
  return a;
}

export function serializeAgency(a: { _id: unknown; name: string; currency: string; status?: string; banReason?: string | null; feeBps?: number; settings?: { modelCanViewDefault?: boolean } | null }) {
  return {
    id: String(a._id), name: a.name, currency: a.currency, status: (a.status ?? 'ACTIVE') as AgencyStatus, banReason: a.banReason ?? null,
    feeBps: a.feeBps ?? DEFAULT_FEE_BPS, settings: { modelCanViewDefault: !!a.settings?.modelCanViewDefault },
  };
}

/** Agences que le chef d'agence possède (sélecteur d'agence). */
export async function listMyAgencies(actor: Actor) {
  const rows = await Agency.find({ _id: { $in: actor.ownedAgencyIds.length ? actor.ownedAgencyIds : [actor.agencyId] }, deletedAt: null }).sort({ createdAt: 1 }).lean();
  return rows.map((a) => serializeAgency(a));
}

/** Un chef d'agence peut créer d'autres agences, chacune avec ses propres modèles, médias et équipe. */
export async function createMyAgency(actor: Actor, name: string, req: Request) {
  requirePermission(actor, 'agency.create');
  const a = await createAgency(name, actor.id);
  await audit(req, String(a._id), actor.id, 'AGENCY_CREATED', 'Agency', String(a._id), { name });
  return serializeAgency(a);
}

export async function usage(agencyId: string) {
  const [members, invites, accounts] = await Promise.all([
    User.countDocuments({ agencyId, deletedAt: null }),
    Invite.countDocuments({ agencyId, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } }),
    TelegramAccount.countDocuments({ agencyId, deletedAt: null }),
  ]);
  return { members, pendingInvites: invites, accounts };
}

// ───────────── Paramètres et journal ─────────────

export async function updateSettings(actor: Actor, patch: { name?: string; currency?: string; modelCanViewDefault?: boolean }, req: Request) {
  requirePermission(actor, 'agency.settings');
  const a = await getAgency(actor.agencyId);
  if (patch.name) a.name = patch.name;
  if (patch.currency) a.currency = patch.currency;
  if (patch.modelCanViewDefault !== undefined) a.settings = { modelCanViewDefault: patch.modelCanViewDefault };
  await a.save();
  await audit(req, actor.agencyId, actor.id, 'AGENCY_SETTINGS_UPDATED', 'Agency', actor.agencyId, patch);
  return serializeAgency(a);
}

export async function listAudit(actor: Actor, q: { action?: string; cursor?: string; limit: number }) {
  requirePermission(actor, 'audit.view');
  const filter: Record<string, unknown> = { agencyId: actor.agencyId };
  if (q.action) filter.action = q.action;
  if (q.cursor) filter._id = { $lt: q.cursor };
  const rows = await AuditLog.find(filter).sort({ _id: -1 }).limit(q.limit + 1).lean();
  const more = rows.length > q.limit;
  const items = (more ? rows.slice(0, q.limit) : rows).map((r) => ({
    id: String(r._id), action: r.action, actorId: r.actorId ? String(r.actorId) : null, targetType: r.targetType ?? null, targetId: r.targetId ?? null,
    metadata: r.metadata ?? {}, ip: r.ip ?? null, at: r.timestamp,
  }));
  return { items, nextCursor: more ? items[items.length - 1]!.id : null };
}
