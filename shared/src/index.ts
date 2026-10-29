import { z } from 'zod';

// ───────────── Rôles ─────────────
/**
 * Hiérarchie : Super admin de la PLATEFORME (propriétaire du site) › Chef d'agence (OWNER, peut créer plusieurs agences) ›
 * Sous-chef (MANAGER : voit toutes les discussions de l'agence) › Team leader › Chatter › Modèle.
 */
export const AGENCY_ROLES = ['OWNER', 'MANAGER', 'TEAM_LEADER', 'CHATTER', 'MODEL'] as const;
export type AgencyRole = (typeof AGENCY_ROLES)[number];
/** Rôle de l'acteur connecté : un rôle d'agence, ou SUPERADMIN (propriétaire de la plateforme, sans agence). */
export type ActorRole = AgencyRole | 'SUPERADMIN';
export const ROLE_LABELS: Record<ActorRole, string> = {
  SUPERADMIN: 'Super admin plateforme',
  OWNER: 'Chef d’agence',
  MANAGER: 'Sous-chef',
  TEAM_LEADER: 'Team leader',
  CHATTER: 'Chatter',
  MODEL: 'Modèle',
};
export const ROLE_DESCRIPTIONS: Record<AgencyRole, string> = {
  OWNER: 'Contrôle total de l’agence : équipe, comptes Telegram, portefeuille et retraits.',
  MANAGER: 'Voit toutes les discussions et la performance de l’agence ; permissions ajustables.',
  TEAM_LEADER: 'Supervise les comptes qui lui sont confiés et assigne les conversations.',
  CHATTER: 'Répond aux conversations qui lui sont assignées ou libres.',
  MODEL: 'Dépose ses médias ; lecture seule de ses conversations si autorisé.',
};
/** Rôles que le chef d'agence peut créer par invitation. */
export const INVITABLE_ROLES = ['MANAGER', 'TEAM_LEADER', 'CHATTER', 'MODEL'] as const;
/** Rôles qui voient TOUS les comptes Telegram de l'agence (sans devoir leur être attribués). */
export const SEES_ALL_ACCOUNTS: readonly AgencyRole[] = ['OWNER', 'MANAGER'];
export const seesAllAccounts = (role: ActorRole | null | undefined) => !!role && (SEES_ALL_ACCOUNTS as readonly string[]).includes(role);
/** Rôles pouvant être assignés à une conversation. */
export const ASSIGNABLE_ROLES = ['OWNER', 'MANAGER', 'TEAM_LEADER', 'CHATTER'] as const;

/**
 * Matrice de permissions : source de vérité unique, utilisée par l'API (contrôle réel) et par l'interface (affichage).
 * Le serveur ne fait jamais confiance au client : chaque route re-vérifie ces règles.
 * Chaque membre peut recevoir des permissions en plus (permGrant) ou en moins (permRevoke) par rapport à son rôle.
 */
export const PERMISSIONS = {
  'team.manage': ['OWNER'],
  'accounts.manage': ['OWNER'],
  'agency.settings': ['OWNER'],
  'agency.create': ['OWNER'],
  'wallet.view': ['OWNER'],
  'payout.request': ['OWNER'],
  'export.contacts': ['OWNER'],
  'audit.view': ['OWNER'],
  'inbox.reply': ['OWNER', 'MANAGER', 'TEAM_LEADER', 'CHATTER'],
  'inbox.supervise': ['OWNER', 'MANAGER', 'TEAM_LEADER'],
  'conversation.assign': ['OWNER', 'MANAGER', 'TEAM_LEADER'],
  'notes.write': ['OWNER', 'MANAGER', 'TEAM_LEADER', 'CHATTER'],
  'tags.apply': ['OWNER', 'MANAGER', 'TEAM_LEADER', 'CHATTER'],
  'tags.manage': ['OWNER', 'MANAGER', 'TEAM_LEADER'],
  'scripts.manage': ['OWNER', 'MANAGER', 'TEAM_LEADER'],
  'sales.record': ['OWNER', 'MANAGER', 'TEAM_LEADER', 'CHATTER'],
  'sales.void': ['OWNER', 'MANAGER', 'TEAM_LEADER'],
  'library.read': ['OWNER', 'MANAGER', 'TEAM_LEADER', 'CHATTER', 'MODEL'],
  'library.upload': ['OWNER', 'MANAGER', 'TEAM_LEADER', 'MODEL'],
  'library.manage': ['OWNER', 'MANAGER', 'TEAM_LEADER'],
  'shifts.manage': ['OWNER', 'MANAGER', 'TEAM_LEADER'],
  'analytics.team': ['OWNER', 'MANAGER', 'TEAM_LEADER'],
  'analytics.me': ['CHATTER'],
} as const satisfies Record<string, readonly AgencyRole[]>;
export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];
export const PERMISSION_LABELS: Record<Permission, string> = {
  'team.manage': 'Gérer l’équipe (inviter, retirer, rôles)',
  'accounts.manage': 'Connecter / gérer les comptes Telegram',
  'agency.settings': 'Modifier les paramètres de l’agence',
  'agency.create': 'Créer de nouvelles agences',
  'wallet.view': 'Voir le portefeuille',
  'payout.request': 'Demander un retrait',
  'export.contacts': 'Exporter les contacts',
  'audit.view': 'Consulter le journal d’audit',
  'inbox.reply': 'Répondre aux conversations',
  'inbox.supervise': 'Voir toutes les conversations',
  'conversation.assign': 'Assigner les conversations',
  'notes.write': 'Écrire des notes internes',
  'tags.apply': 'Poser des étiquettes',
  'tags.manage': 'Gérer les étiquettes',
  'scripts.manage': 'Gérer les scripts (messages prêts)',
  'sales.record': 'Enregistrer des ventes',
  'sales.void': 'Annuler des ventes',
  'library.read': 'Voir la médiathèque',
  'library.upload': 'Ajouter des médias',
  'library.manage': 'Modifier / supprimer des médias',
  'shifts.manage': 'Gérer les shifts',
  'analytics.team': 'Voir les performances de l’équipe',
  'analytics.me': 'Voir ses propres statistiques',
};
/** Sujet d'un contrôle de droit : un rôle seul, ou un rôle avec ses permissions personnalisées. */
export type CanSubject = ActorRole | undefined | { role: ActorRole | undefined; grant?: readonly string[]; revoke?: readonly string[] };
export function can(subject: CanSubject, permission: Permission): boolean {
  const role = typeof subject === 'object' && subject !== null ? subject.role : subject;
  if (!role || role === 'SUPERADMIN') return false; // le super admin plateforme n'agit pas « dans » une agence (voir routes /admin)
  if (typeof subject === 'object' && subject !== null) {
    if (subject.revoke?.includes(permission) && role !== 'OWNER') return false;
    if (subject.grant?.includes(permission)) return true;
  }
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}
/** Liste des permissions effectives. */
export const effectivePermissions = (subject: CanSubject): Permission[] => ALL_PERMISSIONS.filter((p) => can(subject, p));

// ───────────── Argent ─────────────
/** Commission de la plateforme sur chaque vente, en points de base (1500 = 15 %). Réglable par agence par le super admin. */
export const DEFAULT_FEE_BPS = 1500;
export const MIN_PAYOUT_CENTS = 2000;
/** Calcul brut / commission / net (arrondi de la commission à l'entier de centime, au profit de l'agence). */
export function splitSale(grossCents: number, feeBps = DEFAULT_FEE_BPS) {
  const feeCents = Math.floor((grossCents * feeBps) / 10000);
  return { grossCents, feeCents, netCents: grossCents - feeCents };
}
export const PAYOUT_STATUSES = ['PENDING', 'APPROVED', 'PAID', 'REJECTED'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = { PENDING: 'En attente', APPROVED: 'Validé', PAID: 'Payé', REJECTED: 'Refusé' };
export const AGENCY_STATUSES = ['ACTIVE', 'BANNED'] as const;
export type AgencyStatus = (typeof AGENCY_STATUSES)[number];

// ───────────── Telegram ─────────────
/**
 * Modes de connexion d'un compte « modèle » (tous passent par l'API Bot officielle de Telegram) :
 * - BUSINESS : bot connecté au compte Telegram Business du modèle → les fans écrivent au compte du modèle.
 * - BOT      : bot classique → les fans écrivent directement au bot.
 * - USER     : compte Telegram PERSONNEL connecté par son numéro (protocole MTProto, comme l'appli Telegram) — sans bot ni Premium ; expérimental, voir docs.
 * - SANDBOX  : faux serveur Telegram intégré (démo et tests sans Telegram), désactivé en production.
 */
export const ACCOUNT_MODES = ['BUSINESS', 'BOT', 'USER', 'SANDBOX'] as const;
export type AccountMode = (typeof ACCOUNT_MODES)[number];
export const ACCOUNT_MODE_LABELS: Record<AccountMode, string> = { BUSINESS: 'Compte Telegram (bot Business)', BOT: 'Bot Telegram', USER: 'Compte personnel (numéro)', SANDBOX: 'Bac à sable' };
export const ACCOUNT_STATUSES = ['PENDING', 'CONNECTED', 'ERROR', 'DISCONNECTED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export const BOT_TRANSPORTS = ['POLLING', 'WEBHOOK'] as const;
export type BotTransport = (typeof BOT_TRANSPORTS)[number];
export const TEXT_MAX = 4096;
export const CAPTION_MAX = 1024;

/**
 * Règle officielle de Telegram : un bot connecté à un compte Business ne peut envoyer/modifier des messages que dans
 * les chats privés ayant reçu un message entrant au cours des dernières 24 heures (droit « can_reply »).
 */
export const REPLY_WINDOW_HOURS = 24;
export const REPLY_WINDOW_MS = REPLY_WINDOW_HOURS * 3600_000;
export function replyWindowEndsAt(lastIncomingAt?: Date | string | null): Date | null {
  return lastIncomingAt ? new Date(new Date(lastIncomingAt).getTime() + REPLY_WINDOW_MS) : null;
}
/** Modes où le fan écrit directement (bot classique ou compte personnel) : pas de connexion Business ni de fenêtre de 24 h. */
export const isDirectMode = (mode: string) => mode === 'BOT' || mode === 'USER';
export function isReplyWindowOpen(mode: AccountMode, lastIncomingAt?: Date | string | null, now = Date.now()): boolean {
  if (isDirectMode(mode)) return !!lastIncomingAt; // bot classique ou compte personnel : pas de fenêtre, mais le fan doit avoir écrit en premier
  const end = replyWindowEndsAt(lastIncomingAt);
  return !!end && end.getTime() > now;
}
/** Codes d'erreur d'envoi exposés à l'interface. */
export const SEND_ERRORS = ['WINDOW_CLOSED', 'NO_RIGHTS', 'CONNECTION_DISABLED', 'BLOCKED', 'ASSET_MISSING', 'TELEGRAM_ERROR'] as const;
export type SendError = (typeof SEND_ERRORS)[number];
export const SEND_ERROR_LABELS: Record<SendError, string> = {
  WINDOW_CLOSED: 'Fenêtre de 24 h fermée : attendez un nouveau message du contact',
  NO_RIGHTS: 'Le droit de répondre n’a pas été accordé au bot dans Telegram Business',
  CONNECTION_DISABLED: 'La connexion Telegram Business est désactivée',
  BLOCKED: 'Le contact a bloqué le compte',
  ASSET_MISSING: 'Fichier de la médiathèque introuvable',
  TELEGRAM_ERROR: 'Telegram a refusé l’envoi',
};

// ───────────── Inbox ─────────────
export const CONVERSATION_STATUSES = ['OPEN', 'ARCHIVED'] as const;
export const MESSAGE_DIRECTIONS = ['IN', 'OUT'] as const;
export const MESSAGE_TYPES = ['TEXT', 'PHOTO', 'VIDEO', 'AUDIO', 'VOICE', 'DOCUMENT', 'OTHER'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];
export const MESSAGE_STATUSES = ['RECEIVED', 'QUEUED', 'SENDING', 'SENT', 'FAILED'] as const;
/** FAN : écrit par le contact · CRM : envoyé par un opérateur · TELEGRAM_APP : écrit par le titulaire depuis son appli Telegram. */
export const MESSAGE_SOURCES = ['FAN', 'CRM', 'TELEGRAM_APP'] as const;
export const ASSET_KINDS = ['IMAGE', 'VIDEO', 'AUDIO', 'FILE'] as const;
export const SALE_STATUSES = ['CONFIRMED', 'VOID'] as const;
export const USER_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export const ANALYTICS_RANGES = ['today', '7d', '30d', '90d'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export interface ContactLike { firstName?: string; lastName?: string; username?: string; tgUserId?: string }
export function contactName(c: ContactLike): string {
  const full = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return full || (c.username ? `@${c.username}` : c.tgUserId ? `Contact ${c.tgUserId.slice(-4)}` : 'Contact');
}

// ───────────── Argent (montants en centimes, entiers) ─────────────
export function formatMoney(cents: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

// ───────────── Schémas Zod ─────────────
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Identifiant invalide');
const password = z.string().min(10, 'Min. 10 caractères').max(128).refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Doit contenir lettres et chiffres');
const email = z.string().trim().toLowerCase().email().max(254);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const registerSchema = z.object({
  agencyName: z.string().trim().min(2, 'Nom trop court').max(60),
  displayName: z.string().trim().min(2).max(60),
  email,
  password,
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Vous devez accepter les CGU et la politique de confidentialité' }) }),
});
export const loginSchema = z.object({ email, password: z.string().min(1).max(128), totp: z.string().trim().max(20).optional() });
export const forgotSchema = z.object({ email });
export const resetSchema = z.object({ token: z.string().min(20).max(200), password });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });
export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });
export const acceptInviteSchema = z.object({ token: z.string().min(20).max(200), password, displayName: z.string().trim().min(2).max(60).optional() });
export const profileUpdateSchema = z.object({ displayName: z.string().trim().min(2).max(60) });

export const inviteCreateSchema = z.object({
  email,
  displayName: z.string().trim().min(2).max(60),
  role: z.enum(INVITABLE_ROLES),
  accountIds: z.array(objectId).max(50).default([]),
  permGrant: z.array(z.enum(Object.keys(PERMISSIONS) as [Permission, ...Permission[]])).max(40).default([]),
  permRevoke: z.array(z.enum(Object.keys(PERMISSIONS) as [Permission, ...Permission[]])).max(40).default([]),
});
export const memberUpdateSchema = z.object({
  role: z.enum(INVITABLE_ROLES).optional(),
  accountIds: z.array(objectId).max(50).optional(),
  status: z.enum(USER_STATUSES).optional(),
  displayName: z.string().trim().min(2).max(60).optional(),
  permGrant: z.array(z.enum(Object.keys(PERMISSIONS) as [Permission, ...Permission[]])).max(40).optional(),
  permRevoke: z.array(z.enum(Object.keys(PERMISSIONS) as [Permission, ...Permission[]])).max(40).optional(),
});
export const agencyCreateSchema = z.object({ name: z.string().trim().min(2, 'Nom trop court').max(60) });
export const banSchema = z.object({ reason: z.string().trim().min(3, 'Indiquez un motif').max(300) });
export const PAYOUT_METHODS = ['BANK', 'MOBILE_MONEY', 'CRYPTO', 'OTHER'] as const;
export const PAYOUT_METHOD_LABELS: Record<(typeof PAYOUT_METHODS)[number], string> = { BANK: 'Virement bancaire', MOBILE_MONEY: 'Mobile money', CRYPTO: 'Crypto', OTHER: 'Autre' };
export const payoutRequestSchema = z.object({
  amountCents: z.number().int().min(MIN_PAYOUT_CENTS, 'Minimum de retrait : 20 €'),
  method: z.enum(PAYOUT_METHODS),
  destination: z.string().trim().min(4, 'Indiquez où envoyer l’argent').max(300),
  note: z.string().trim().max(300).optional(),
});
export const payoutDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('APPROVE') }),
  z.object({ decision: z.literal('PAID'), reference: z.string().trim().max(120).optional() }),
  z.object({ decision: z.literal('REJECT'), reason: z.string().trim().min(3, 'Indiquez un motif').max(300) }),
]);
export const feeSchema = z.object({ feeBps: z.number().int().min(0).max(5000) });

export const BOT_TOKEN_REGEX = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
export const accountConnectSchema = z
  .object({
    label: z.string().trim().min(2).max(60),
    mode: z.enum(ACCOUNT_MODES),
    token: z.string().trim().optional(),
    /** Numéro de téléphone du compte personnel (mode USER), au format international. */
    phone: z.string().trim().regex(/^\+\d{8,15}$/, 'Numéro invalide : format international, ex. +22991234567').optional(),
    modelUserId: objectId.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'USER') { if (!v.phone) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Indiquez le numéro du compte Telegram' }); return; }
    if (v.mode !== 'SANDBOX' && !BOT_TOKEN_REGEX.test(v.token ?? '')) ctx.addIssue({ code: 'custom', path: ['token'], message: 'Jeton invalide (format 123456:ABC… fourni par @BotFather)' });
  });
export const userVerifySchema = z.object({ code: z.string().trim().regex(/^\d{4,8}$/, 'Code à 5 chiffres reçu dans Telegram'), password: z.string().max(200).optional() });
export const userPasswordSchema = z.object({ password: z.string().min(1).max(200) });
export const businessDecisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']) });
export const accountUpdateSchema = z.object({
  label: z.string().trim().min(2).max(60).optional(),
  modelUserId: objectId.nullable().optional(),
  modelCanView: z.boolean().optional(),
});

export const sendMessageSchema = z
  .object({
    text: z.string().trim().max(TEXT_MAX).optional().default(''),
    assetId: objectId.optional(),
    replyToMessageId: objectId.optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.text && !v.assetId) ctx.addIssue({ code: 'custom', path: ['text'], message: 'Message vide' });
    if (v.assetId && v.text.length > CAPTION_MAX) ctx.addIssue({ code: 'custom', path: ['text'], message: `Légende limitée à ${CAPTION_MAX} caractères` });
  });
export const conversationPatchSchema = z.object({
  assignedTo: objectId.nullable().optional(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
  tagIds: z.array(objectId).max(20).optional(),
});
export const bulkReassignSchema = z.object({ fromUserId: objectId, toUserId: objectId.nullable(), accountId: objectId.optional() });
export const noteSchema = z.object({ text: z.string().trim().min(1).max(2000) });
export const tagSchema = z.object({ name: z.string().trim().min(1).max(24), color: hexColor.default('#6B7280') });
export const saleSchema = z.object({
  amountCents: z.number().int().min(1).max(100_000_000),
  assetId: objectId.optional(),
  note: z.string().trim().max(200).optional().default(''),
});
export const folderSchema = z.object({ name: z.string().trim().min(1).max(60), accountId: objectId.nullable().optional() });
export const assetPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  folderId: objectId.nullable().optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(24)).max(10).optional(),
});
export const shiftSchema = z
  .object({ userId: objectId, accountId: objectId, startsAt: z.string().datetime(), endsAt: z.string().datetime() })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { message: 'La fin doit suivre le début', path: ['endsAt'] })
  .refine((v) => new Date(v.endsAt).getTime() - new Date(v.startsAt).getTime() <= 24 * 3600_000, { message: 'Un shift dure 24 h maximum', path: ['endsAt'] });
export const quickReplySchema = z.object({
  title: z.string().trim().min(1).max(60),
  text: z.string().trim().min(1).max(TEXT_MAX),
  shortcut: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,20}$/, '2-20 caractères : a-z, 0-9, - _'),
});
export const agencySettingsSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  currency: z.enum(['EUR', 'USD', 'XOF', 'GBP', 'CAD', 'CHF']).optional(),
  modelCanViewDefault: z.boolean().optional(),
});
export const simulateIncomingSchema = z.object({
  fanName: z.string().trim().min(1).max(40),
  fanUsername: z.string().trim().max(32).optional(),
  fanId: z.string().regex(/^\d{4,15}$/).optional(),
  text: z.string().trim().min(1).max(TEXT_MAX),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

// ───────────── Requêtes (paramètres d'URL) ─────────────
export const tokenReplaceSchema = z.object({ token: z.string().trim().regex(BOT_TOKEN_REGEX, 'Jeton invalide (format 123456:ABC… fourni par @BotFather)') });
export const conversationQuerySchema = z.object({
  accountId: objectId.optional(),
  status: z.enum(CONVERSATION_STATUSES).default('OPEN'),
  /** me · none (non assignées) · any · identifiant d'un membre (réservé aux superviseurs) */
  assigned: z.union([z.enum(['me', 'none', 'any']), objectId]).default('any'),
  tagId: objectId.optional(),
  q: z.string().trim().max(60).optional(),
  unread: z.enum(['1']).optional(),
  waiting: z.enum(['1']).optional(),
  cursor: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export const messagesQuerySchema = z.object({ cursor: objectId.optional(), limit: z.coerce.number().int().min(1).max(100).default(40) });
export const analyticsQuerySchema = z.object({ range: z.enum(ANALYTICS_RANGES).default('7d'), accountId: objectId.optional() });
export const salesQuerySchema = z.object({
  userId: objectId.optional(), accountId: objectId.optional(), range: z.enum(ANALYTICS_RANGES).default('30d'),
  cursor: objectId.optional(), limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const assetsQuerySchema = z.object({
  folderId: z.union([objectId, z.literal('root')]).optional(), accountId: objectId.optional(), kind: z.enum(ASSET_KINDS).optional(),
  q: z.string().trim().max(60).optional(), cursor: objectId.optional(), limit: z.coerce.number().int().min(1).max(100).default(40),
});
export const shiftsQuerySchema = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional(), userId: objectId.optional() });
export const auditQuerySchema = z.object({ action: z.string().trim().max(40).optional(), cursor: objectId.optional(), limit: z.coerce.number().int().min(1).max(100).default(40) });
export const quickReplyPatchSchema = quickReplySchema.partial();
export const tagPatchSchema = tagSchema.partial();
export const uploadFieldsSchema = z.object({
  name: z.string().trim().max(100).optional(),
  folderId: objectId.optional(),
  accountId: objectId.optional(),
  priceCents: z.coerce.number().int().min(0).max(100_000_000).default(0),
  tags: z.string().max(300).optional().transform((v) => (v ? v.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 10) : [])),
});
export const sandboxConnectSchema = z.object({ canReply: z.boolean().default(true), canRead: z.boolean().default(true) });
