import { env } from '../config/env';
import { hmac, safeEqual } from './helpers';

/**
 * URLs de médias temporaires et signées (HMAC) : liées à un utilisateur, un objet et une variante, valables 5 minutes.
 * Les fichiers sont toujours dans le stockage PRIVÉ ; ces URLs sont le seul moyen d'y accéder depuis un navigateur.
 */
export type MediaKind = 'msg' | 'asset';
const TTL_MS = 5 * 60_000;
const sig = (kind: MediaKind, id: string, userId: string, exp: number, variant: string) => hmac(env.MEDIA_SIGNING_SECRET, `${kind}|${id}|${userId}|${exp}|${variant}`);

export function signMediaUrl(kind: MediaKind, id: string, userId: string, variant: 'orig' | 'thumb' = 'orig') {
  const exp = Date.now() + TTL_MS;
  return `/api/media/${kind}/${id}?v=${variant}&u=${userId}&e=${exp}&s=${sig(kind, id, userId, exp, variant)}`;
}
export function verifyMediaSig(kind: MediaKind, id: string, q: Record<string, unknown>) {
  const exp = Number(q.e); const u = String(q.u ?? ''); const s = String(q.s ?? ''); const v = String(q.v ?? 'orig');
  if (!u || !s || !Number.isFinite(exp) || exp < Date.now() || (v !== 'orig' && v !== 'thumb')) return null;
  return safeEqual(s, sig(kind, id, u, exp, v)) ? { userId: u, variant: v as 'orig' | 'thumb' } : null;
}
