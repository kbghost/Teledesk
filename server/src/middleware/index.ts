import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { ZodError, type ZodTypeAny } from 'zod';
import { can, type AgencyRole, type Permission } from '@teledesk/shared';
import { env, isProd, isTest } from '../config/env';
import { logger } from '../config/logger';
import { Agency, User } from '../models';
import type { Actor } from '../types/express';
import { AppError, forbidden, unauthorized } from '../utils/errors';
import { isOid } from '../utils/helpers';

export interface AccessPayload { sub: string; sid: string }

const ACTOR_FIELDS = 'agencyId agencyRole accountIds status displayName deletedAt platformRole permGrant permRevoke';

/** Construit l'acteur d'un utilisateur. Un chef d'agence peut posséder plusieurs agences : `agencyHint` choisit celle sur laquelle il agit. */
export async function buildActor(user: any, agencyHint?: string, sessionId?: string): Promise<Actor> {
  const base = { id: String(user._id), displayName: user.displayName, sessionId, grant: (user.permGrant ?? []).map(String), revoke: (user.permRevoke ?? []).map(String) };
  if (user.platformRole === 'SUPERADMIN') return { ...base, role: 'SUPERADMIN', agencyId: '', accountIds: [], ownedAgencyIds: [], platform: true, grant: [], revoke: [] };
  let agencyId = user.agencyId ? String(user.agencyId) : '';
  let owned: string[] = [];
  if (user.agencyRole === 'OWNER') {
    owned = (await Agency.find({ ownerId: user._id, deletedAt: null }).sort({ createdAt: 1 }).select('_id').lean()).map((a) => String(a._id));
    if (agencyHint && owned.includes(agencyHint)) agencyId = agencyHint;
    else if (!owned.includes(agencyId) && owned[0]) agencyId = owned[0];
  }
  return { ...base, role: user.agencyRole as AgencyRole, agencyId, accountIds: (user.accountIds ?? []).map(String), ownedAgencyIds: owned, platform: false };
}

/** Résout l'acteur à partir du jeton d'accès. Le rôle et le périmètre sont relus en base à chaque requête (révocation immédiate). */
export async function loadActor(authorization: string | undefined, agencyHint?: string): Promise<Actor | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(authorization.slice(7), env.JWT_ACCESS_SECRET) as AccessPayload;
    const user = await User.findById(payload.sub).select(ACTOR_FIELDS).lean();
    if (!user || user.deletedAt) return null;
    if (user.status !== 'ACTIVE') throw forbidden('Compte suspendu', 'ACCOUNT_DISABLED');
    return await buildActor(user, agencyHint && isOid(agencyHint) ? agencyHint : undefined, payload.sid);
  } catch (err) {
    if (err instanceof AppError) throw err;
    return null;
  }
}
/** Acteur reconstruit depuis un identifiant d'utilisateur (URLs signées de médias). Retourne null si le compte n'est plus actif. */
export async function actorById(userId: string, agencyHint?: string): Promise<Actor | null> {
  if (!isOid(userId)) return null;
  const user = await User.findById(userId).select(ACTOR_FIELDS).lean();
  if (!user || user.deletedAt || user.status !== 'ACTIVE') return null;
  return buildActor(user, agencyHint && isOid(agencyHint) ? agencyHint : undefined);
}
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const u = await loadActor(req.headers.authorization, String(req.headers['x-agency-id'] ?? '') || undefined);
    if (!u) throw unauthorized();
    req.user = u;
    next();
  } catch (e) { next(e); }
}
/** Autorisation par permission (matrice partagée avec l'interface). */
export const requirePerm = (permission: Permission) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(unauthorized());
  if (!can(req.user, permission)) return next(forbidden('Action non autorisée pour votre rôle', 'FORBIDDEN_ROLE'));
  next();
};

export const validate = (schema: ZodTypeAny, where: 'body' | 'query' = 'body') => (req: Request, _res: Response, next: NextFunction) => {
  const r = schema.safeParse(req[where]);
  if (!r.success) return next(new AppError(400, 'VALIDATION_ERROR', 'Données invalides', r.error.flatten()));
  if (where === 'body') req.body = r.data;
  else (req as any).validatedQuery = r.data;
  next();
};

const limiter = (windowMs: number, max: number, code = 'RATE_LIMITED') =>
  rateLimit({
    windowMs, max: isTest ? 100000 : max, standardHeaders: true, legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code, message: 'Trop de requêtes, réessayez plus tard' } }),
  });
export const globalLimiter = limiter(60_000, 900);
export const authLimiter = limiter(15 * 60_000, 30);
export const sensitiveLimiter = limiter(60 * 60_000, 20);
export const uploadLimiter = limiter(60_000, 60);
/** Les webhooks Telegram arrivent en rafale : limite généreuse, protégée de toute façon par un secret. */
export const webhookLimiter = limiter(60_000, 3000);

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });

/** Restrictions géographiques (en-tête posé par le CDN/proxy : cf-ipcountry, x-vercel-ip-country). */
export function geoBlock(req: Request, res: Response, next: NextFunction) {
  const c = String(req.headers['cf-ipcountry'] ?? req.headers['x-vercel-ip-country'] ?? '').toUpperCase();
  if (c && env.blockedCountries.includes(c)) return res.status(451).json({ error: { code: 'GEO_BLOCKED', message: 'Service indisponible dans votre pays' } });
  next();
}

/** Un compte dont l'agence est supprimée ou bannie ne peut plus rien faire (sauf consulter son profil pour voir le motif). */
export async function requireActiveAgency(req: Request, _res: Response, next: NextFunction) {
  try {
    if (req.user!.platform) return next();
    const a = await Agency.findOne({ _id: req.user!.agencyId, deletedAt: null }).select('status banReason').lean();
    if (!a) throw forbidden('Agence indisponible', 'AGENCY_DISABLED');
    if (a.status === 'BANNED' && !req.path.startsWith('/auth')) throw forbidden(`Cette agence a été suspendue par la plateforme${a.banReason ? ` : ${a.banReason}` : ''}`, 'AGENCY_BANNED');
    next();
  } catch (e) { next(e); }
}
/** Réservé au super admin de la plateforme (propriétaire du site). */
export function requirePlatform(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.platform) return next(forbidden('Réservé à l’administration de la plateforme', 'FORBIDDEN_PLATFORM'));
  next();
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  if (err instanceof ZodError) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Données invalides', details: err.flatten() } });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux' : err.message } });
  if ((err as any)?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'JSON invalide' } });
  if ((err as any)?.code === 11000) return res.status(409).json({ error: { code: 'DUPLICATE', message: 'Ressource déjà existante' } });
  logger.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: isProd ? 'Erreur interne' : String((err as Error)?.message ?? err) } });
}

/** Les paramètres de chemin `:id` doivent être des ObjectId : sinon 404 propre (au lieu d'un 500 « Cast to ObjectId failed »). */
export const validIdParam = (_req: Request, _res: Response, next: NextFunction, value: string) =>
  isOid(value) ? next() : next(new AppError(404, 'NOT_FOUND', 'Ressource introuvable'));
