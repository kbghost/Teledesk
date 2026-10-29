import { contactName, type SendError } from '@teledesk/shared';
import { signMediaUrl } from '../utils/signedUrl';
import { replyState } from './telegram/runtime';

type Id = { toString(): string };
const sid = (v: Id | null | undefined) => (v ? String(v) : null);

/** Conversation telle que l'interface la reçoit. `account` sert à calculer la possibilité de répondre. */
export function serializeConversation(
  c: Record<string, any>,
  account?: { mode: string; status: string; business?: { isEnabled?: boolean; canReply?: boolean } | null } | null,
) {
  const reply = account ? replyState(account, c) : null;
  return {
    id: sid(c._id)!, agencyId: sid(c.agencyId) ?? '', accountId: sid(c.accountId)!, chatId: c.chatId, channel: c.channel as 'BUSINESS' | 'BOT',
    contact: {
      tgUserId: c.contact?.tgUserId ?? '', name: contactName(c.contact ?? {}), firstName: c.contact?.firstName ?? '',
      lastName: c.contact?.lastName ?? '', username: c.contact?.username ?? '',
    },
    status: c.status as 'OPEN' | 'ARCHIVED', assignedTo: sid(c.assignedTo), assignedAt: c.assignedAt ?? null,
    tagIds: (c.tagIds ?? []).map(String), lastMessageAt: c.lastMessageAt, lastMessagePreview: c.lastMessagePreview ?? '',
    lastMessageDirection: (c.lastMessageDirection ?? null) as 'IN' | 'OUT' | null, awaitingSince: c.awaitingSince ?? null,
    unreadCount: c.unreadCount ?? 0, messagesCount: c.messagesCount ?? 0, blocked: !!c.blocked,
    totalSpentCents: c.totalSpentCents ?? 0, salesCount: c.salesCount ?? 0, firstContactAt: c.firstContactAt ?? c.createdAt ?? null,
    lastIncomingAt: c.lastIncomingAt ?? null,
    reply: reply ? { allowed: reply.allowed, error: (reply.error ?? null) as SendError | null, windowEndsAt: reply.windowEndsAt } : null,
  };
}

/** Message pour un utilisateur donné : les URLs de médias sont signées pour LUI (valables 5 minutes). */
export function serializeMessage(m: Record<string, any>, userId: string) {
  const a = m.attachment;
  const hasFile = !!a?.key;
  return {
    id: sid(m._id)!, conversationId: sid(m.conversationId)!, direction: m.direction as 'IN' | 'OUT', type: m.type as string,
    text: m.text ?? '', source: m.source as 'FAN' | 'CRM' | 'TELEGRAM_APP', sentBy: sid(m.sentBy), status: m.status as string,
    error: m.error ?? null, errorCode: (m.errorCode ?? null) as SendError | null, createdAt: m.createdAt, tgDate: m.tgDate ?? null,
    editedAt: m.editedAt ?? null, deletedByContactAt: m.deletedByContactAt ?? null, replyToMessageId: sid(m.replyToMessageId),
    assetId: sid(m.assetId),
    ppv: m.ppv ? { priceCents: m.ppv.priceCents as number, state: m.ppv.state as 'LOCKED' | 'UNLOCKING' | 'UNLOCKED' } : null,
    unlocksMessageId: sid(m.unlocksMessageId),
    attachment: a
      ? {
          kind: a.kind as string, mime: a.mime ?? null, size: a.size ?? null, name: a.name ?? null, width: a.width ?? null, height: a.height ?? null,
          url: hasFile ? signMediaUrl('msg', String(m._id), userId, 'orig') : null,
          thumbUrl: hasFile && a.thumbKey ? signMediaUrl('msg', String(m._id), userId, 'thumb') : null,
          pending: !hasFile && !a.unavailable, unavailable: a.unavailable ?? null,
        }
      : null,
  };
}

export function serializeAsset(a: Record<string, any>, userId: string) {
  return {
    id: sid(a._id)!, name: a.name, kind: a.kind as 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE', mime: a.mime, size: a.size,
    folderId: sid(a.folderId), accountId: sid(a.accountId), priceCents: a.priceCents ?? 0, tags: a.tags ?? [],
    width: a.width ?? null, height: a.height ?? null, usedCount: a.usedCount ?? 0, lastUsedAt: a.lastUsedAt ?? null,
    uploadedBy: sid(a.uploadedBy), createdAt: a.createdAt,
    url: signMediaUrl('asset', String(a._id), userId, 'orig'),
    thumbUrl: a.thumbKey ? signMediaUrl('asset', String(a._id), userId, 'thumb') : null,
  };
}
