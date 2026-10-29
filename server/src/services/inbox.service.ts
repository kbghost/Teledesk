import { Types } from 'mongoose';
import type { Request } from 'express';
import type { z } from 'zod';
import { can, contactName, seesAllAccounts } from '@teledesk/shared';
import type { conversationQuerySchema } from '@teledesk/shared';
import { Conversation, Message, Note, QuickReply, Sale, Tag, TelegramAccount, User } from '../models';
import { getStorage } from '../providers/storage';
import { emitToUsers } from '../sockets/io';
import type { Actor } from '../types/express';
import { csvRow } from '../utils/csv';
import { AppError, conflict, forbidden, notFound } from '../utils/errors';
import { escapeRegex, pageResult } from '../utils/helpers';
import { conversationFilter, findAssignee, loadReplyableConversation, loadVisibleConversation, requirePermission, visibleAccountIds } from './access.service';
import { audit } from './audit.service';
import { serializeConversation, serializeMessage } from './serializers';
import { conversationAudience, publishConversation, staffAudience } from './telegram/audience';
import { refreshInboxes } from './team.service';

type Query = z.infer<typeof conversationQuerySchema>;
const oid = (id: string) => new Types.ObjectId(id);
const accountView = (a: any) => (a ? { mode: a.mode, status: a.status, business: a.business } : null);

// ───────────── Conversations ─────────────
export async function listConversations(actor: Actor, q: Query) {
  const base = await conversationFilter(actor);
  const and: Record<string, unknown>[] = [base, { status: q.status }];
  if (q.accountId) {
    const visible = await visibleAccountIds(actor);
    if (!visible.includes(q.accountId)) return { items: [], nextCursor: null };
    and.push({ accountId: oid(q.accountId) });
  }
  const supervisor = can(actor, 'inbox.supervise');
  if (q.assigned === 'me') and.push({ assignedTo: oid(actor.id) });
  else if (q.assigned === 'none') and.push({ assignedTo: null });
  else if (q.assigned !== 'any' && supervisor) and.push({ assignedTo: oid(q.assigned) });
  if (q.tagId) and.push({ tagIds: oid(q.tagId) });
  if (q.unread) and.push({ unreadCount: { $gt: 0 } });
  if (q.waiting) and.push({ awaitingSince: { $ne: null } });
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    and.push({ $or: [{ 'contact.firstName': rx }, { 'contact.lastName': rx }, { 'contact.username': rx }, { lastMessagePreview: rx }] });
  }
  if (q.cursor) {
    const [iso, id] = q.cursor.split('_');
    const d = new Date(iso ?? '');
    if (!Number.isNaN(d.getTime()) && id && /^[a-f\d]{24}$/i.test(id)) and.push({ $or: [{ lastMessageAt: { $lt: d } }, { lastMessageAt: d, _id: { $lt: oid(id) } }] });
  }
  const rows = await Conversation.find({ $and: and }).sort({ lastMessageAt: -1, _id: -1 }).limit(q.limit + 1).lean();
  const accounts = await TelegramAccount.find({ _id: { $in: [...new Set(rows.map((r) => String(r.accountId)))] } }).lean();
  const byId = new Map(accounts.map((a) => [String(a._id), a]));
  const page = pageResult(rows, q.limit);
  const last = page.items[page.items.length - 1];
  return {
    items: page.items.map((c) => serializeConversation(c, accountView(byId.get(String(c.accountId))))),
    nextCursor: page.nextCursor && last ? `${new Date(last.lastMessageAt).toISOString()}_${String(last._id)}` : null,
  };
}

export async function getConversation(actor: Actor, id: string) {
  const c = await loadVisibleConversation(actor, id);
  const account = await TelegramAccount.findById(c.accountId).lean();
  return serializeConversation(c.toObject(), accountView(account));
}

export async function patchConversation(actor: Actor, id: string, patch: { assignedTo?: string | null; status?: 'OPEN' | 'ARCHIVED'; tagIds?: string[] }, req: Request) {
  const conv = await loadVisibleConversation(actor, id);
  const previous = await conversationAudience(conv.toObject());
  const changes: Record<string, unknown> = {};

  if (patch.assignedTo !== undefined) {
    const target = patch.assignedTo;
    const selfService = (target === actor.id || (target === null && String(conv.assignedTo) === actor.id)) && can(actor, 'inbox.reply');
    if (!selfService) requirePermission(actor, 'conversation.assign');
    if (target) {
      const u = await findAssignee(actor.agencyId, target);
      if (!u) throw new AppError(400, 'BAD_ASSIGNEE', 'Ce membre ne peut pas recevoir de conversation');
      if (!seesAllAccounts(u.agencyRole) && !(u.accountIds ?? []).map(String).includes(String(conv.accountId))) throw new AppError(400, 'NO_ACCESS', 'Ce membre n’a pas accès au compte Telegram de cette conversation');
    }
    conv.assignedTo = (target ? oid(target) : null) as never;
    conv.assignedAt = new Date();
    changes.assignedTo = target;
  }
  if (patch.status) { requirePermission(actor, 'inbox.reply'); conv.status = patch.status; changes.status = patch.status; }
  if (patch.tagIds) {
    requirePermission(actor, 'tags.apply');
    const tags = patch.tagIds.length ? await Tag.find({ _id: { $in: patch.tagIds }, agencyId: actor.agencyId }).select('_id').lean() : [];
    if (tags.length !== new Set(patch.tagIds).size) throw new AppError(400, 'BAD_TAGS', 'Étiquette introuvable');
    conv.tagIds = tags.map((t) => t._id) as never;
    changes.tagIds = patch.tagIds;
  }
  await conv.save();
  await publishConversation(id, previous);
  if (changes.assignedTo !== undefined) await audit(req, actor.agencyId, actor.id, 'CONVERSATION_ASSIGNED', 'Conversation', id, { to: changes.assignedTo });
  const account = await TelegramAccount.findById(conv.accountId).lean();
  return serializeConversation(conv.toObject(), accountView(account));
}

/** Passation de shift : remet toutes les conversations d'un membre à un autre (ou dans la file commune). */
export async function bulkReassign(actor: Actor, input: { fromUserId: string; toUserId: string | null; accountId?: string }, req: Request) {
  requirePermission(actor, 'conversation.assign');
  const visible = await visibleAccountIds(actor);
  const filter: Record<string, unknown> = { agencyId: oid(actor.agencyId), assignedTo: oid(input.fromUserId), status: 'OPEN', accountId: { $in: visible.map(oid) } };
  if (input.accountId) { if (!visible.includes(input.accountId)) throw notFound('Compte introuvable'); filter.accountId = oid(input.accountId); }
  if (input.toUserId) {
    const u = await findAssignee(actor.agencyId, input.toUserId);
    if (!u) throw new AppError(400, 'BAD_ASSIGNEE', 'Ce membre ne peut pas recevoir de conversation');
    if (!seesAllAccounts(u.agencyRole)) {
      const allowed = (u.accountIds ?? []).map(String);
      filter.accountId = { $in: (input.accountId ? [input.accountId] : visible).filter((a) => allowed.includes(a)).map(oid) };
    }
  }
  const r = await Conversation.updateMany(filter, { $set: { assignedTo: input.toUserId ? oid(input.toUserId) : null, assignedAt: new Date() } });
  await refreshInboxes(actor.agencyId);
  await audit(req, actor.agencyId, actor.id, 'CONVERSATIONS_REASSIGNED', 'User', input.fromUserId, { to: input.toUserId, count: r.modifiedCount });
  return { moved: r.modifiedCount };
}

export async function markRead(actor: Actor, id: string) {
  const conv = await loadReplyableConversation(actor, id);
  if (conv.unreadCount > 0) { conv.unreadCount = 0; await conv.save(); await publishConversation(id); }
  return { ok: true };
}

/** Droit à l'effacement d'un contact : supprime la conversation, ses messages, notes et fichiers reçus. Réservé au Super admin. */
export async function deleteConversation(actor: Actor, id: string, req: Request) {
  requirePermission(actor, 'agency.settings');
  const conv = await Conversation.findOne({ _id: id, agencyId: actor.agencyId });
  if (!conv) throw notFound('Conversation introuvable');
  const audience = await conversationAudience(conv.toObject());
  const storage = getStorage();
  const messages = await Message.find({ conversationId: conv._id, 'attachment.key': { $ne: null } }).select('attachment assetId').lean();
  for (const m of messages) {
    if (m.assetId) continue; // fichier de la médiathèque (partagé) : il reste dans la médiathèque
    for (const k of [m.attachment?.key, m.attachment?.thumbKey]) if (k) await storage.delete('private', k).catch(() => undefined);
  }
  await Promise.all([Message.deleteMany({ conversationId: conv._id }), Note.deleteMany({ conversationId: conv._id })]);
  await Sale.updateMany({ conversationId: conv._id }, { $set: { note: '' } });
  await Conversation.deleteOne({ _id: conv._id });
  emitToUsers(audience, 'conversation:removed', { id });
  await audit(req, actor.agencyId, actor.id, 'CONTACT_ERASED', 'Conversation', id, { contact: contactName(conv.contact ?? {}) });
}

// ───────────── Messages ─────────────
export async function listMessages(actor: Actor, id: string, q: { cursor?: string; limit: number }) {
  const conv = await loadVisibleConversation(actor, id);
  const filter: Record<string, unknown> = { conversationId: conv._id };
  if (q.cursor) filter._id = { $lt: oid(q.cursor) };
  const rows = await Message.find(filter).sort({ _id: -1 }).limit(q.limit + 1).lean();
  const page = pageResult(rows, q.limit);
  return { items: page.items.map((m) => serializeMessage(m, actor.id)), nextCursor: page.nextCursor };
}

// ───────────── Notes internes ─────────────
function assertCanSeeNotes(actor: Actor) {
  if (!can(actor, 'inbox.reply') && !can(actor, 'inbox.supervise')) throw forbidden('Les notes internes sont réservées à l’équipe', 'FORBIDDEN_ROLE');
}
const serializeNote = (n: any, names: Map<string, string>) => ({ id: String(n._id), conversationId: String(n.conversationId), authorId: String(n.authorId), authorName: names.get(String(n.authorId)) ?? 'Ancien membre', text: n.text, createdAt: n.createdAt });

export async function listNotes(actor: Actor, id: string) {
  assertCanSeeNotes(actor);
  const conv = await loadVisibleConversation(actor, id);
  const notes = await Note.find({ conversationId: conv._id }).sort({ _id: -1 }).limit(100).lean();
  const users = await User.find({ _id: { $in: [...new Set(notes.map((n) => String(n.authorId)))] } }).select('displayName').lean();
  const names = new Map(users.map((u) => [String(u._id), u.displayName]));
  return notes.map((n) => serializeNote(n, names));
}
export async function addNote(actor: Actor, id: string, text: string) {
  requirePermission(actor, 'notes.write');
  const conv = await loadVisibleConversation(actor, id);
  const note = await Note.create({ agencyId: actor.agencyId, conversationId: conv._id, authorId: actor.id, text });
  const out = serializeNote(note.toObject(), new Map([[actor.id, actor.displayName]]));
  emitToUsers(await staffAudience(conv.toObject()), 'note:new', out);
  return out;
}
export async function deleteNote(actor: Actor, noteId: string) {
  assertCanSeeNotes(actor);
  const n = await Note.findOne({ _id: noteId, agencyId: actor.agencyId });
  if (!n) throw notFound('Note introuvable');
  const conv = await loadVisibleConversation(actor, String(n.conversationId));
  if (String(n.authorId) !== actor.id && !can(actor, 'inbox.supervise')) throw forbidden('Vous ne pouvez supprimer que vos propres notes', 'FORBIDDEN_ROLE');
  await n.deleteOne();
  emitToUsers(await staffAudience(conv.toObject()), 'note:removed', { id: noteId, conversationId: String(n.conversationId) });
}

// ───────────── Étiquettes ─────────────
const serializeTag = (t: any) => ({ id: String(t._id), name: t.name, color: t.color });
export async function listTags(actor: Actor) {
  return (await Tag.find({ agencyId: actor.agencyId }).sort({ nameLower: 1 }).lean()).map(serializeTag);
}
export async function createTag(actor: Actor, input: { name: string; color: string }) {
  requirePermission(actor, 'tags.manage');
  try { return serializeTag(await Tag.create({ agencyId: actor.agencyId, name: input.name, nameLower: input.name.toLowerCase(), color: input.color, createdBy: actor.id })); }
  catch (e) { if ((e as { code?: number }).code === 11000) throw conflict('TAG_EXISTS', 'Cette étiquette existe déjà'); throw e; }
}
export async function updateTag(actor: Actor, id: string, patch: { name?: string; color?: string }) {
  requirePermission(actor, 'tags.manage');
  const t = await Tag.findOne({ _id: id, agencyId: actor.agencyId });
  if (!t) throw notFound('Étiquette introuvable');
  if (patch.name) { t.name = patch.name; t.nameLower = patch.name.toLowerCase(); }
  if (patch.color) t.color = patch.color;
  try { await t.save(); } catch (e) { if ((e as { code?: number }).code === 11000) throw conflict('TAG_EXISTS', 'Cette étiquette existe déjà'); throw e; }
  await refreshInboxes(actor.agencyId);
  return serializeTag(t);
}
export async function deleteTag(actor: Actor, id: string) {
  requirePermission(actor, 'tags.manage');
  const t = await Tag.findOneAndDelete({ _id: id, agencyId: actor.agencyId });
  if (!t) throw notFound('Étiquette introuvable');
  await Conversation.updateMany({ agencyId: actor.agencyId, tagIds: t._id }, { $pull: { tagIds: t._id } });
  await refreshInboxes(actor.agencyId);
}

// ───────────── Réponses rapides ─────────────
const serializeQuick = (q: any) => ({ id: String(q._id), title: q.title, text: q.text, shortcut: q.shortcut });
export async function listQuickReplies(actor: Actor) {
  if (!can(actor, 'inbox.reply')) throw forbidden('Action non autorisée pour votre rôle', 'FORBIDDEN_ROLE');
  return (await QuickReply.find({ agencyId: actor.agencyId }).sort({ shortcut: 1 }).lean()).map(serializeQuick);
}
export async function createQuickReply(actor: Actor, input: { title: string; text: string; shortcut: string }) {
  requirePermission(actor, 'scripts.manage');
  try { return serializeQuick(await QuickReply.create({ ...input, agencyId: actor.agencyId, createdBy: actor.id })); }
  catch (e) { if ((e as { code?: number }).code === 11000) throw conflict('SHORTCUT_EXISTS', 'Ce raccourci existe déjà'); throw e; }
}
export async function updateQuickReply(actor: Actor, id: string, patch: { title?: string; text?: string; shortcut?: string }) {
  requirePermission(actor, 'scripts.manage');
  const q = await QuickReply.findOne({ _id: id, agencyId: actor.agencyId });
  if (!q) throw notFound('Réponse rapide introuvable');
  Object.assign(q, patch);
  try { await q.save(); } catch (e) { if ((e as { code?: number }).code === 11000) throw conflict('SHORTCUT_EXISTS', 'Ce raccourci existe déjà'); throw e; }
  return serializeQuick(q);
}
export async function deleteQuickReply(actor: Actor, id: string) {
  requirePermission(actor, 'scripts.manage');
  const r = await QuickReply.deleteOne({ _id: id, agencyId: actor.agencyId });
  if (!r.deletedCount) throw notFound('Réponse rapide introuvable');
}

// ───────────── Export des contacts ─────────────
/** Export CSV réservé au Super admin (les chatters n'y ont jamais accès) ; chaque export est journalisé. */
export async function exportContactsCsv(actor: Actor, req: Request) {
  requirePermission(actor, 'export.contacts');
  const [convs, accounts, tags] = await Promise.all([
    Conversation.find({ agencyId: actor.agencyId, deletedAt: null }).sort({ _id: 1 }).lean(),
    TelegramAccount.find({ agencyId: actor.agencyId }).select('label').lean(),
    Tag.find({ agencyId: actor.agencyId }).select('name').lean(),
  ]);
  const acc = new Map(accounts.map((a) => [String(a._id), a.label]));
  const tg = new Map(tags.map((t) => [String(t._id), t.name]));
  const lines = [csvRow(['Compte', 'Nom', 'Identifiant Telegram', 'Nom d’utilisateur', 'Premier contact', 'Dernier message', 'Messages', 'Ventes', 'Total dépensé (centimes)', 'Étiquettes'])];
  for (const c of convs) {
    lines.push(csvRow([acc.get(String(c.accountId)) ?? '', contactName(c.contact ?? {}), c.contact?.tgUserId, c.contact?.username ? `@${c.contact.username}` : '', c.firstContactAt, c.lastMessageAt, c.messagesCount, c.salesCount, c.totalSpentCents, (c.tagIds ?? []).map((t) => tg.get(String(t)) ?? '').filter(Boolean).join(' | ')]));
  }
  await audit(req, actor.agencyId, actor.id, 'CONTACTS_EXPORTED', 'Agency', actor.agencyId, { rows: convs.length });
  return lines.join('\r\n') + '\r\n';
}
