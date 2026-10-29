import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { forbidden } from '../utils/errors';

/** Protection contre l'injection NoSQL : supprime toute clé commençant par "$" ou contenant "." (opérateurs Mongo). */
function clean(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k.startsWith('$') || k.includes('.')) continue;
    out[k] = clean(v, depth + 1);
  }
  return out;
}
export function sanitize(req: Request, _res: Response, next: NextFunction) {
  if (req.body) req.body = clean(req.body);
  if (req.query) {
    const q = clean(req.query) as Record<string, unknown>;
    for (const k of Object.keys(req.query)) delete (req.query as Record<string, unknown>)[k];
    Object.assign(req.query, q);
  }
  if (req.params) req.params = clean(req.params) as Request['params'];
  next();
}

/** Défense en profondeur (CSRF) pour les routes qui s'appuient sur le cookie : l'Origin, s'il est présent, doit être le nôtre. */
export function sameOriginOnly(req: Request, _res: Response, next: NextFunction) {
  const origin = req.get('origin');
  if (!origin) return next();
  const allowed = new Set([new URL(env.CLIENT_URL).origin, `${req.protocol}://${req.get('host')}`]);
  if (!allowed.has(origin)) return next(forbidden('Origine non autorisée', 'BAD_ORIGIN'));
  next();
}
