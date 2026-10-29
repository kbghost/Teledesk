import type { ActorRole, AgencyRole, AnalyticsRange, Permission, SendError } from '@teledesk/shared';

export type { ActorRole, AgencyRole, AnalyticsRange, Permission, SendError };
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface Ok { ok: true }
export interface ApiErrorBody { error: { code: string; message: string; details?: { formErrors: string[]; fieldErrors: Record<string, string[]> } } }

export interface Agency { id: string; name: string; currency: string; status: 'ACTIVE' | 'BANNED'; banReason: string | null; feeBps: number; settings: { modelCanViewDefault: boolean } }
export interface Me {
  id: string; email: string; displayName: string; role: ActorRole; roleLabel: string; status: string; platform: boolean; agencyId: string | null; accountIds: string[];
  emailVerified: boolean; totpEnabled: boolean; agency: Agency | null; agencies: Agency[]; permissions: Permission[];
}
export interface AuthResponse { accessToken: string; user: Me }
export interface Session { id: string; device: string; ip: string; createdAt: string; lastUsedAt: string; current: boolean }

export interface Business { userName: string; userUsername: string; isEnabled: boolean; canReply: boolean; canRead: boolean; receivedAt: string | null }
export interface Account {
  id: string; label: string; mode: 'BUSINESS' | 'BOT' | 'USER' | 'SANDBOX'; modeLabel: string; status: 'PENDING' | 'CONNECTED' | 'ERROR' | 'DISCONNECTED'; statusDetail: string;
  botUsername: string | null; botName: string | null; botLink: string | null; transport: string | null;
  business: Business | null; pendingBusiness: Business | null; modelUserId: string | null; modelCanView: boolean | null;
  connectedAt: string | null; lastEventAt: string | null; listening: boolean | null; canManage: boolean;
}
export interface AccountCheck { account: Account; checks: Array<{ key: string; ok: boolean; detail: string }> }

export interface Conversation {
  id: string; agencyId: string; accountId: string; chatId: string; channel: 'BUSINESS' | 'BOT';
  contact: { tgUserId: string; name: string; firstName: string; lastName: string; username: string };
  status: 'OPEN' | 'ARCHIVED'; assignedTo: string | null; assignedAt: string | null; tagIds: string[];
  lastMessageAt: string; lastMessagePreview: string; lastMessageDirection: 'IN' | 'OUT' | null; awaitingSince: string | null;
  unreadCount: number; messagesCount: number; blocked: boolean; totalSpentCents: number; salesCount: number; firstContactAt: string | null; lastIncomingAt: string | null;
  reply: { allowed: boolean; error: SendError | null; windowEndsAt: string | null } | null;
}
export interface Attachment { kind: string; mime: string | null; size: number | null; name: string | null; width: number | null; height: number | null; url: string | null; thumbUrl: string | null; pending: boolean; unavailable: string | null }
export interface Message {
  id: string; conversationId: string; direction: 'IN' | 'OUT'; type: string; text: string; source: 'FAN' | 'CRM' | 'TELEGRAM_APP'; sentBy: string | null;
  status: 'RECEIVED' | 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED'; error: string | null; errorCode: SendError | null; createdAt: string; tgDate: string | null;
  editedAt: string | null; deletedByContactAt: string | null; replyToMessageId: string | null; assetId: string | null; attachment: Attachment | null;
  ppv: { priceCents: number; state: 'LOCKED' | 'UNLOCKING' | 'UNLOCKED' } | null; unlocksMessageId: string | null;
}
export interface Note { id: string; conversationId: string; authorId: string; authorName: string; text: string; createdAt: string }
export interface Tag { id: string; name: string; color: string }
export interface QuickReply { id: string; title: string; text: string; shortcut: string }

export interface Asset {
  id: string; name: string; kind: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE'; mime: string; size: number; folderId: string | null; accountId: string | null; priceCents: number; tags: string[];
  width: number | null; height: number | null; usedCount: number; lastUsedAt: string | null; uploadedBy: string | null; createdAt: string; url: string; thumbUrl: string | null;
}
export interface Folder { id: string; name: string; accountId: string | null; assetCount: number }

export interface Sale { id: string; conversationId: string; contactName: string; accountId: string; recordedBy: string; recordedByName: string; amountCents: number; grossCents: number; feeCents: number; netCents: number; source: 'MANUAL' | 'PPV_UNLOCK' | 'PPV_PAID'; note: string; assetId: string | null; status: 'CONFIRMED' | 'VOID'; createdAt: string; shiftId: string | null }
export interface Shift { id: string; userId: string; userName: string; accountId: string; accountLabel: string; startsAt: string; endsAt: string }

export interface Member { id: string; email: string; displayName: string; role: AgencyRole; roleLabel: string; permGrant: Permission[]; permRevoke: Permission[]; status: 'ACTIVE' | 'SUSPENDED'; accountIds: string[]; lastLoginAt: string | null; lastSeenAt: string | null; totpEnabled: boolean; online: boolean }
export interface InviteRow { id: string; email: string; displayName: string; role: AgencyRole; accountIds: string[]; expiresAt: string; createdAt: string }
export interface Assignable { id: string; displayName: string; role: AgencyRole; accountIds: string[]; online: boolean }

export interface DayPoint { day: string; messagesIn: number; messagesOut: number; newConversations: number; salesCount: number; salesCents: number; feeCents: number; netCents: number }
export interface Totals extends DayPoint { avgResponseMs: number | null; respCount?: number; respMsSum?: number }
export interface Overview {
  range: AnalyticsRange; from: string; to: string;
  totals: Omit<Totals, 'day'>;
  live: { waiting: number; oldestWaitingSince: string | null; unassigned: number };
  series: DayPoint[];
  perChatter: Array<{ userId: string; name: string; role: AgencyRole | null; messagesOut: number; salesCount: number; salesCents: number; feeCents: number; netCents: number; avgResponseMs: number | null; conversationsAnswered: number; conversionRate: number | null }>;
  perAccount: Array<{ accountId: string; label: string; messagesIn: number; messagesOut: number; newConversations: number; salesCount: number; salesCents: number; avgResponseMs: number | null }>;
  topFans: Array<{ conversationId: string; name: string; totalSpentCents: number; salesCount: number; accountLabel: string }>;
  shifts: Array<{ id: string; userName: string; accountLabel: string; startsAt: string; endsAt: string; salesCount: number; salesCents: number }>;
}
export interface MyStats { range: AnalyticsRange; series: DayPoint[]; totals: Omit<Totals, 'day'>; currentShift: { id: string; accountLabel: string; startsAt: string; endsAt: string } | null }

export interface Wallet { grossCents: number; feeCents: number; netCents: number; paidCents: number; reservedCents: number; availableCents: number; minPayoutCents: number }
export type PayoutStatus = 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';
export interface Payout { id: string; agencyId: string; amountCents: number; method: 'BANK' | 'MOBILE_MONEY' | 'CRYPTO' | 'OTHER'; destination: string; status: PayoutStatus; note: string; createdAt: string; decidedAt: string | null; paidAt: string | null; reference: string; rejectReason: string; agencyName?: string; requesterName?: string }
export interface AdminOverview {
  days: number;
  totals: { agencies: number; bannedAgencies: number; users: number; accounts: number; grossCents: number; commissionCents: number; sales: number; newAgencies: number };
  pendingPayouts: { count: number; amountCents: number };
  series: Array<{ day: string; grossCents: number; feeCents: number; sales: number; newAgencies: number }>;
  topAgencies: Array<{ id: string; name: string; grossCents: number; commissionCents: number }>;
}
export interface AdminAgency extends Agency { createdAt: string; owner: { name: string; email: string } | null; members: number; accounts: number; grossCents: number; feeCents: number; netCents: number; paidCents: number; reservedCents: number; availableCents: number }
export interface AuditRow { id: string; action: string; actorId: string | null; targetType: string | null; targetId: string | null; metadata: Record<string, unknown>; ip: string | null; at: string }

export interface ServerToClientEvents {
  'message:new': (p: { conversation: Conversation; message: Message }) => void;
  'message:updated': (p: { conversation: Conversation; message: Message }) => void;
  'conversation:updated': (c: Conversation) => void;
  'conversation:removed': (p: { id: string }) => void;
  'note:new': (n: Note) => void;
  'note:removed': (p: { id: string; conversationId: string }) => void;
  'inbox:refresh': () => void;
  'presence:update': (p: { userId: string; online: boolean }) => void;
}
export type ClientToServerEvents = Record<string, never>;
