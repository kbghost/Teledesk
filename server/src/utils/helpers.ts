import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import mongoose from 'mongoose';
import { badRequest } from './errors';

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const hmac = (secret: string, data: string | Buffer) => crypto.createHmac('sha256', secret).update(data).digest('hex');
export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const oid = (id: string) => {
  if (!mongoose.isValidObjectId(id)) throw badRequest('INVALID_ID', 'Identifiant invalide');
  return new mongoose.Types.ObjectId(id);
};
export const isOid = (id: unknown): id is string => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
export const getIp = (req: Request) => req.ip || req.socket.remoteAddress || '';

/** Pagination par curseur (_id décroissant). */
export function parsePage(query: Record<string, unknown>, def = 20, max = 50) {
  const limit = Math.min(Math.max(parseInt(String(query.limit ?? def), 10) || def, 1), max);
  const cursor = typeof query.cursor === 'string' && isOid(query.cursor) ? query.cursor : undefined;
  return { limit, cursor };
}
export function pageResult<T extends { _id?: unknown }>(items: T[], limit: number) {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  const last = data[data.length - 1];
  return { items: data, nextCursor: hasMore && last ? String(last._id) : null };
}
export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
