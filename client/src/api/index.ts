import { del, get, patch, post, upload, qs } from './http';
import type {
  Account, AccountCheck, AdminAgency, AdminOverview, Agency, Assignable, Asset, AuditRow, Payout, Wallet, Conversation, Folder, InviteRow, Member, Message, MyStats, Note, Ok, Overview, Page,
  QuickReply, Sale, Shift, Tag, AnalyticsRange,
} from '../types/api';

type Q = Record<string, string | number | boolean | undefined | null>;
const items = <T>(p: Promise<{ items: T[] }>) => p.then((r) => r.items);

export const inboxApi = {
  conversations: (q: Q) => get<Page<Conversation>>('/conversations', q),
  conversation: (id: string) => get<Conversation>(`/conversations/${id}`),
  patch: (id: string, b: { assignedTo?: string | null; status?: 'OPEN' | 'ARCHIVED'; tagIds?: string[] }) => patch<Conversation>(`/conversations/${id}`, b),
  read: (id: string) => post<Ok>(`/conversations/${id}/read`),
  erase: (id: string) => del<Ok>(`/conversations/${id}`),
  bulkReassign: (b: { fromUserId: string; toUserId: string | null; accountId?: string }) => post<{ moved: number }>('/conversations/bulk-reassign', b),
  messages: (id: string, q: Q) => get<Page<Message>>(`/conversations/${id}/messages`, q),
  send: (id: string, b: { text?: string; assetId?: string; replyToMessageId?: string }) => post<Message>(`/conversations/${id}/messages`, b),
  retry: (messageId: string) => post<Message>(`/messages/${messageId}/retry`),
  unlock: (messageId: string) => post<Message>(`/messages/${messageId}/unlock`),
  notes: (id: string) => items<Note>(get(`/conversations/${id}/notes`)),
  addNote: (id: string, text: string) => post<Note>(`/conversations/${id}/notes`, { text }),
  deleteNote: (id: string) => del<Ok>(`/notes/${id}`),
  sale: (id: string, b: { amountCents: number; assetId?: string; note?: string }) => post<Sale>(`/conversations/${id}/sales`, b),
  tags: () => items<Tag>(get('/tags')),
  createTag: (b: { name: string; color: string }) => post<Tag>('/tags', b),
  updateTag: (id: string, b: Partial<{ name: string; color: string }>) => patch<Tag>(`/tags/${id}`, b),
  deleteTag: (id: string) => del<Ok>(`/tags/${id}`),
  quickReplies: () => items<QuickReply>(get('/quick-replies')),
  createQuickReply: (b: { title: string; text: string; shortcut: string }) => post<QuickReply>('/quick-replies', b),
  updateQuickReply: (id: string, b: Partial<{ title: string; text: string; shortcut: string }>) => patch<QuickReply>(`/quick-replies/${id}`, b),
  deleteQuickReply: (id: string) => del<Ok>(`/quick-replies/${id}`),
};

export const accountsApi = {
  list: () => items<Account>(get('/accounts')),
  mine: () => items<Account>(get('/accounts/mine')),
  get: (id: string) => get<Account>(`/accounts/${id}`),
  connect: (b: { label: string; mode: 'BUSINESS' | 'BOT' | 'USER' | 'SANDBOX'; token?: string; phone?: string; modelUserId?: string }) => post<Account>('/accounts', b),
  update: (id: string, b: { label?: string; modelUserId?: string | null; modelCanView?: boolean }) => patch<Account>(`/accounts/${id}`, b),
  decide: (id: string, decision: 'APPROVE' | 'REJECT') => post<Account>(`/accounts/${id}/business`, { decision }),
  check: (id: string) => post<AccountCheck>(`/accounts/${id}/check`),
  replaceToken: (id: string, token: string) => post<Account>(`/accounts/${id}/token`, { token }),
  disconnect: (id: string) => del<Ok>(`/accounts/${id}`),
  userCode: (id: string) => post<Ok>(`/accounts/${id}/user/code`),
  userVerify: (id: string, b: { code: string; password?: string }) => post<{ state: 'OK' | 'PASSWORD_NEEDED'; account?: Account }>(`/accounts/${id}/user/verify`, b),
  sandboxConnect: (id: string, b: { canReply: boolean; canRead: boolean }) => post<Ok>(`/accounts/${id}/sandbox/connect`, b),
  sandboxIncoming: (id: string, b: { fanName: string; fanUsername?: string; text: string }) => post<Ok>(`/accounts/${id}/sandbox/incoming`, b),
};

export const teamApi = {
  list: () => get<{ members: Member[]; invites: InviteRow[] }>('/team'),
  assignable: () => items<Assignable>(get('/team/assignable')),
  invite: (b: { email: string; displayName: string; role: string; accountIds: string[]; permGrant?: string[]; permRevoke?: string[] }) => post<{ id: string; email: string; role: string; expiresAt: string; inviteUrl: string }>('/team/invites', b),
  revokeInvite: (id: string) => del<Ok>(`/team/invites/${id}`),
  update: (id: string, b: { role?: string; accountIds?: string[]; status?: 'ACTIVE' | 'SUSPENDED'; displayName?: string; permGrant?: string[]; permRevoke?: string[] }) => patch<Member>(`/team/members/${id}`, b),
  remove: (id: string) => del<Ok>(`/team/members/${id}`),
};

export const libraryApi = {
  folders: () => items<Folder>(get('/library/folders')),
  createFolder: (b: { name: string; accountId?: string | null }) => post<Folder>('/library/folders', b),
  renameFolder: (id: string, name: string) => patch<Folder>(`/library/folders/${id}`, { name }),
  deleteFolder: (id: string) => del<Ok>(`/library/folders/${id}`),
  assets: (q: Q) => get<Page<Asset>>('/library/assets', q),
  upload: (form: FormData, onProgress?: (n: number) => void) => upload<Asset>('/library/assets', form, onProgress),
  patch: (id: string, b: Partial<{ name: string; priceCents: number; folderId: string | null; tags: string[] }>) => patch<Asset>(`/library/assets/${id}`, b),
  remove: (id: string) => del<Ok>(`/library/assets/${id}`),
};

export const opsApi = {
  sales: (q: Q) => get<Page<Sale>>('/sales', q),
  voidSale: (id: string) => post<Sale>(`/sales/${id}/void`),
  shifts: (q: Q) => items<Shift>(get('/shifts', q)),
  createShift: (b: { userId: string; accountId: string; startsAt: string; endsAt: string }) => post<Shift>('/shifts', b),
  deleteShift: (id: string) => del<Ok>(`/shifts/${id}`),
  overview: (range: AnalyticsRange, accountId?: string) => get<Overview>('/analytics/overview', { range, accountId }),
  myStats: (range: AnalyticsRange) => get<MyStats>('/analytics/me', { range }),
};

export const agencyApi = {
  get: () => get<{ agency: Agency }>('/agency').then((r) => r.agency),
  update: (b: { name?: string; currency?: string; modelCanViewDefault?: boolean }) => patch<{ agency: Agency }>('/agency', b).then((r) => r.agency),
  list: () => get<{ items: Agency[] }>('/agencies').then((r) => r.items),
  create: (name: string) => post<{ agency: Agency }>('/agencies', { name }).then((r) => r.agency),
  audit: (q: Q) => get<Page<AuditRow>>('/audit', q),
  exportUrl: '/api/export/contacts.csv',
};
export const walletApi = {
  get: () => get<{ wallet: Wallet; payouts: Payout[] }>('/wallet'),
  request: (b: { amountCents: number; method: string; destination: string; note?: string }) => post<Payout>('/payouts', b),
  cancel: (id: string) => post<Payout>(`/payouts/${id}/cancel`),
};

export const adminApi = {
  overview: (days = 30) => get<AdminOverview>('/admin/overview', { days }),
  agencies: (search?: string) => get<{ items: AdminAgency[] }>('/admin/agencies', { search }).then((r) => r.items),
  ban: (id: string, reason: string) => post<{ agency: Agency }>(`/admin/agencies/${id}/ban`, { reason }),
  unban: (id: string) => post<{ agency: Agency }>(`/admin/agencies/${id}/unban`),
  setFee: (id: string, feeBps: number) => patch<{ agency: Agency }>(`/admin/agencies/${id}/fee`, { feeBps }),
  conversations: (id: string, q: Q) => get<Page<Conversation>>(`/admin/agencies/${id}/conversations`, q),
  messages: (id: string, q: Q) => get<Page<Message> & { conversation: Conversation }>(`/admin/conversations/${id}/messages`, q),
  payouts: (status?: string) => get<{ items: Payout[] }>('/admin/payouts', { status }).then((r) => r.items),
  decide: (id: string, b: { decision: 'APPROVE' | 'PAID' | 'REJECT'; reference?: string; reason?: string }) => post<Payout>(`/admin/payouts/${id}/decision`, b),
};
export { qs };
