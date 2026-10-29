import crypto from 'node:crypto';
import { Types } from 'mongoose';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { assetPatchSchema, assetsQuerySchema, folderSchema, uploadFieldsSchema } from '@teledesk/shared';
import { Asset, Folder, Message, TelegramAccount } from '../models';
import { LIMITS } from '../providers/telegram/api';
import { getStorage } from '../providers/storage';
import type { Actor } from '../types/express';
import { AppError, conflict, forbidden, notFound } from '../utils/errors';
import { detectFileType, LIBRARY_EXTS } from '../utils/filetype';
import { escapeRegex, pageResult } from '../utils/helpers';
import { verifyMediaSig, type MediaKind } from '../utils/signedUrl';
import { actorById } from '../middleware';
import { libraryAccountIds, loadVisibleConversation, requirePermission } from './access.service';
import { audit } from './audit.service';
import { serializeAsset } from './serializers';
import { makeThumb } from './telegram/media';

const oid = (id: string) => new Types.ObjectId(id);
const newKey = (ext: string) => `${crypto.randomBytes(16).toString('hex')}.${ext}`;

/** Un fichier est accessible s'il est commun à l'agence (aucun compte) ou rattaché à un compte que l'acteur peut utiliser. Le modèle ne voit que ses propres comptes. */
async function scope(actor: Actor) {
  const accountIds = await libraryAccountIds(actor);
  const common = actor.role === 'MODEL' ? [] : [{ accountId: null }];
  return { accountIds, or: [...common, { accountId: { $in: accountIds.map(oid) } }] };
}
const canUseAsset = (accountId: unknown, ids: string[], actor: Actor) => (accountId ? ids.includes(String(accountId)) : actor.role !== 'MODEL');

// ───────────── Dossiers ─────────────
export async function listFolders(actor: Actor) {
  requirePermission(actor, 'library.read');
  const s = await scope(actor);
  const rows = await Folder.find({ agencyId: actor.agencyId, deletedAt: null, $or: s.or }).sort({ name: 1 }).lean();
  const counts = await Asset.aggregate([{ $match: { agencyId: oid(actor.agencyId), deletedAt: null, folderId: { $in: rows.map((r) => r._id) } } }, { $group: { _id: '$folderId', n: { $sum: 1 } } }]);
  const n = new Map(counts.map((c) => [String(c._id), c.n as number]));
  return rows.map((f) => ({ id: String(f._id), name: f.name, accountId: f.accountId ? String(f.accountId) : null, assetCount: n.get(String(f._id)) ?? 0 }));
}

async function assertLibraryAccount(actor: Actor, accountId: string | null | undefined) {
  if (!accountId) { if (actor.role === 'MODEL') throw forbidden('Choisissez votre compte', 'FORBIDDEN'); return; }
  if (!(await libraryAccountIds(actor)).includes(accountId)) throw notFound('Compte introuvable');
}

export async function createFolder(actor: Actor, input: z.infer<typeof folderSchema>) {
  requirePermission(actor, 'library.manage');
  await assertLibraryAccount(actor, input.accountId);
  const f = await Folder.create({ agencyId: actor.agencyId, name: input.name, accountId: input.accountId ?? undefined, createdBy: actor.id });
  return { id: String(f._id), name: f.name, accountId: f.accountId ? String(f.accountId) : null, assetCount: 0 };
}
async function loadFolder(actor: Actor, id: string) {
  const s = await scope(actor);
  const f = await Folder.findOne({ _id: id, agencyId: actor.agencyId, deletedAt: null, $or: s.or });
  if (!f) throw notFound('Dossier introuvable');
  return f;
}
export async function renameFolder(actor: Actor, id: string, name: string) {
  requirePermission(actor, 'library.manage');
  const f = await loadFolder(actor, id);
  f.name = name; await f.save();
  return { id, name };
}
export async function deleteFolder(actor: Actor, id: string) {
  requirePermission(actor, 'library.manage');
  const f = await loadFolder(actor, id);
  if (await Asset.exists({ folderId: f._id, deletedAt: null })) throw conflict('FOLDER_NOT_EMPTY', 'Déplacez ou supprimez d’abord les fichiers de ce dossier');
  f.deletedAt = new Date(); await f.save();
}

// ───────────── Fichiers ─────────────
export async function listAssets(actor: Actor, q: z.infer<typeof assetsQuerySchema>) {
  requirePermission(actor, 'library.read');
  const s = await scope(actor);
  const and: Record<string, unknown>[] = [{ agencyId: oid(actor.agencyId), deletedAt: null }, { $or: s.or }];
  if (q.accountId) { if (!s.accountIds.includes(q.accountId)) return { items: [], nextCursor: null }; and.push({ $or: [{ accountId: oid(q.accountId) }, ...(actor.role === 'MODEL' ? [] : [{ accountId: null }])] }); }
  if (q.folderId === 'root') and.push({ folderId: null }); else if (q.folderId) and.push({ folderId: oid(q.folderId) });
  if (q.kind) and.push({ kind: q.kind });
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); and.push({ $or: [{ name: rx }, { tags: rx }] }); }
  if (q.cursor) and.push({ _id: { $lt: oid(q.cursor) } });
  const rows = await Asset.find({ $and: and }).sort({ _id: -1 }).limit(q.limit + 1).lean();
  const page = pageResult(rows, q.limit);
  return { items: page.items.map((a) => serializeAsset(a, actor.id)), nextCursor: page.nextCursor };
}

/** Dépôt d'un fichier : le type est déterminé par les octets (jamais par l'extension), les images sont décodées pour produire une miniature. */
export async function uploadAsset(actor: Actor, file: Express.Multer.File | undefined, fields: z.infer<typeof uploadFieldsSchema>, req: Request) {
  requirePermission(actor, 'library.upload');
  if (!file) throw new AppError(400, 'NO_FILE', 'Aucun fichier reçu');
  const type = detectFileType(file.buffer);
  if (!type || !LIBRARY_EXTS.has(type.ext)) throw new AppError(415, 'UNSUPPORTED_TYPE', 'Format non pris en charge (images JPG/PNG/GIF/WebP, vidéos MP4/MOV, audio MP3/M4A/OGG/WAV, PDF)');
  if (file.size > LIMITS.uploadBytes) throw new AppError(413, 'TOO_LARGE', 'Fichier trop volumineux pour Telegram (50 Mo maximum)');
  let accountId = fields.accountId ?? null;
  if (actor.role === 'MODEL') { // un modèle dépose toujours dans son propre compte
    const own = await libraryAccountIds(actor);
    accountId = accountId ?? own[0] ?? null;
  }
  await assertLibraryAccount(actor, accountId);
  if (fields.folderId) {
    const f = await loadFolder(actor, fields.folderId);
    if (String(f.accountId ?? '') !== String(accountId ?? '') && f.accountId) throw new AppError(400, 'BAD_FOLDER', 'Ce dossier appartient à un autre compte');
  }
  let thumb: Awaited<ReturnType<typeof makeThumb>> | null = null;
  if (type.kind === 'IMAGE') {
    try { thumb = await makeThumb(file.buffer); } catch { throw new AppError(415, 'BAD_IMAGE', 'Image illisible ou corrompue'); }
  }
  const storage = getStorage();
  const storageKey = newKey(type.ext);
  await storage.put('private', storageKey, file.buffer);
  let thumbKey: string | undefined;
  if (thumb) { thumbKey = newKey('webp'); await storage.put('private', thumbKey, thumb.data); }
  const base = (fields.name || file.originalname || 'fichier').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 100) || 'fichier';
  const asset = await Asset.create({
    agencyId: actor.agencyId, folderId: fields.folderId, accountId: accountId ?? undefined, name: base, kind: type.kind, mime: type.mime, size: file.size,
    storageKey, thumbKey, width: thumb?.width, height: thumb?.height, priceCents: actor.role === 'MODEL' ? 0 : fields.priceCents, tags: fields.tags, uploadedBy: actor.id,
  });
  await audit(req, actor.agencyId, actor.id, 'ASSET_UPLOADED', 'Asset', String(asset._id), { kind: type.kind, size: file.size });
  return serializeAsset(asset.toObject(), actor.id);
}

async function loadAsset(actor: Actor, id: string) {
  const s = await scope(actor);
  const a = await Asset.findOne({ _id: id, agencyId: actor.agencyId, deletedAt: null, $or: s.or });
  if (!a) throw notFound('Fichier introuvable');
  return a;
}
export async function patchAsset(actor: Actor, id: string, patch: z.infer<typeof assetPatchSchema>) {
  requirePermission(actor, 'library.manage');
  const a = await loadAsset(actor, id);
  if (patch.folderId) { const f = await loadFolder(actor, patch.folderId); if (f.accountId && String(f.accountId) !== String(a.accountId ?? '')) throw new AppError(400, 'BAD_FOLDER', 'Ce dossier appartient à un autre compte'); a.folderId = f._id; }
  else if (patch.folderId === null) a.folderId = undefined as never;
  if (patch.name !== undefined) a.name = patch.name;
  if (patch.priceCents !== undefined) a.priceCents = patch.priceCents;
  if (patch.tags) a.tags = patch.tags as never;
  await a.save();
  return serializeAsset(a.toObject(), actor.id);
}
/** Suppression logique ; le fichier physique n'est effacé que si aucun message envoyé ne s'y réfère encore. */
export async function deleteAsset(actor: Actor, id: string, req: Request) {
  requirePermission(actor, 'library.manage');
  const a = await loadAsset(actor, id);
  a.deletedAt = new Date(); await a.save();
  const used = await Message.exists({ 'attachment.key': a.storageKey });
  if (!used) {
    const storage = getStorage();
    await storage.delete('private', a.storageKey).catch(() => undefined);
    if (a.thumbKey) await storage.delete('private', a.thumbKey).catch(() => undefined);
  }
  await audit(req, actor.agencyId, actor.id, 'ASSET_DELETED', 'Asset', id, { name: a.name });
}

// ───────────── Service des médias (URL signée + droits vérifiés à chaque lecture) ─────────────
/**
 * La signature seule ne suffit pas : l'utilisateur doit toujours avoir le droit de voir la conversation (ou le fichier)
 * au moment de la lecture. Un membre retiré, suspendu ou dé-assigné perd l'accès même avec une URL encore valide.
 */
export async function serveMedia(kind: MediaKind, id: string, query: Record<string, unknown>, rangeHeader: string | undefined, res: Response) {
  const sig = verifyMediaSig(kind, id, query);
  if (!sig) throw new AppError(403, 'BAD_SIGNATURE', 'Lien expiré ou invalide');
  const actor = await actorById(sig.userId);
  if (!actor) throw new AppError(403, 'BAD_SIGNATURE', 'Lien expiré ou invalide');
  let key: string | undefined; let mime = 'application/octet-stream'; let name = 'fichier';
  if (kind === 'msg') {
    const m = await Message.findById(id).select('conversationId attachment').lean();
    if (!m?.attachment?.key) throw notFound('Fichier introuvable');
    if (!actor.platform) await loadVisibleConversation(actor, String(m.conversationId));
    key = sig.variant === 'thumb' ? m.attachment.thumbKey ?? undefined : m.attachment.key;
    mime = m.attachment.mime ?? mime; name = m.attachment.name ?? name;
  } else {
    requirePermission(actor, 'library.read');
    const a = await Asset.findOne({ _id: id, agencyId: actor.agencyId, deletedAt: null }).lean();
    if (!a || !canUseAsset(a.accountId, await libraryAccountIds(actor), actor)) throw notFound('Fichier introuvable');
    key = sig.variant === 'thumb' ? a.thumbKey ?? undefined : a.storageKey;
    mime = a.mime; name = a.name;
  }
  if (!key) throw notFound('Fichier introuvable');
  const storage = getStorage();
  const total = await storage.size('private', key).catch(() => { throw notFound('Fichier introuvable'); });
  const isThumb = sig.variant === 'thumb';
  const type = isThumb ? { mime: 'image/webp', inline: true } : (() => { const ext = key!.split('.').pop() ?? ''; const inline = ['jpg', 'png', 'gif', 'webp', 'mp4', 'mov', 'webm', 'mp3', 'm4a', 'ogg', 'wav'].includes(ext); return { mime: inline ? mime : 'application/octet-stream', inline }; })();
  res.setHeader('Content-Type', type.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Disposition', `${type.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}${key.includes('.') ? '.' + key.split('.').pop() : ''}`);
  let range: { start: number; end: number } | undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2])); let end = m[1] && m[2] ? Number(m[2]) : total - 1;
    end = Math.min(end, total - 1);
    if (start > end || start >= total) { res.status(416).setHeader('Content-Range', `bytes */${total}`); res.end(); return; }
    range = { start, end };
  }
  if (range) {
    res.status(206); res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${total}`); res.setHeader('Content-Length', String(range.end - range.start + 1));
  } else res.setHeader('Content-Length', String(total));
  const stream = await storage.getStream('private', key, range);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
