import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import {
  acceptInviteSchema, agencyCreateSchema, accountConnectSchema, accountUpdateSchema, agencySettingsSchema, analyticsQuerySchema, assetPatchSchema, assetsQuerySchema, auditQuerySchema,
  bulkReassignSchema, businessDecisionSchema, changePasswordSchema, conversationPatchSchema, conversationQuerySchema, folderSchema, forgotSchema, inviteCreateSchema,
  loginSchema, memberUpdateSchema, messagesQuerySchema, noteSchema, profileUpdateSchema, quickReplyPatchSchema, quickReplySchema, registerSchema, resetSchema,
  saleSchema, salesQuerySchema, sandboxConnectSchema, sendMessageSchema, shiftSchema, shiftsQuerySchema, simulateIncomingSchema, tagPatchSchema, tagSchema,
  tokenReplaceSchema, uploadFieldsSchema, verifyEmailSchema, userVerifySchema, banSchema, feeSchema, payoutRequestSchema, payoutDecisionSchema,
} from '@teledesk/shared';
import { z } from 'zod';
import { isProd } from '../config/env';
import { User } from '../models';
import { authLimiter, requireActiveAgency, requireAuth, requirePerm, requirePlatform, sensitiveLimiter, upload, uploadLimiter, validate, validIdParam, webhookLimiter } from '../middleware';
import { sameOriginOnly } from '../middleware/security';
import * as accounts from '../services/account.service';
import * as admin from '../services/admin.service';
import * as wallet from '../services/wallet.service';
import * as agency from '../services/agency.service';
import * as analytics from '../services/analytics.service';
import * as auth from '../services/auth.service';
import * as inbox from '../services/inbox.service';
import * as library from '../services/library.service';
import * as sales from '../services/sales.service';
import { serializeMessage } from '../services/serializers';
import * as sandbox from '../services/telegram/sandbox';
import { ingestUpdate } from '../services/telegram/ingest';
import { loadAccountSecret } from '../services/telegram/runtime';
import { sendFromCrm, retryMessage, unlockPpv } from '../services/telegram/outbound';
import * as team from '../services/team.service';
import { AppError, notFound } from '../utils/errors';
import { asyncHandler as h, safeEqual } from '../utils/helpers';
import { nowDate } from '../utils/clock';
import { onlineCount } from '../sockets/presence';

const router = Router();
router.param('id', validIdParam);

const me = (req: Request) => req.user!;
const q = <T>(req: Request) => (req as any).validatedQuery as T;
const REFRESH_COOKIE = 'td_refresh';
const setRefresh = (res: Response, token: string) =>
  res.cookie(REFRESH_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: isProd, path: '/api/auth', maxAge: 30 * 864e5 });

// ───────────── Santé ─────────────
router.get('/health', h(async (_req, res) => {
  res.json({ ok: true, db: mongoose.connection.readyState === 1, online: onlineCount(), time: nowDate().toISOString() });
}));

// ───────────── Webhook Telegram (pas de session : authentifié par le jeton secret propre à chaque compte) ─────────────
router.post('/telegram/webhook/:id', webhookLimiter, h(async (req, res) => {
  const a = await loadAccountSecret(String(req.params.id));
  const given = String(req.get('x-telegram-bot-api-secret-token') ?? '');
  // même réponse pour « compte inconnu » et « mauvais secret » : on ne révèle pas quels comptes existent
  if (!a || a.deletedAt || a.transport !== 'WEBHOOK' || !a.webhookSecret || !safeEqual(given, a.webhookSecret)) throw new AppError(403, 'BAD_WEBHOOK', 'Refusé');
  await ingestUpdate(a, req.body); // en cas d'échec : 500 → Telegram réessaiera
  res.json({ ok: true });
}));

// ───────────── Médias (URL signée, droits revérifiés à chaque lecture) ─────────────
router.get('/media/:kind/:id', h(async (req, res) => {
  const kind = req.params.kind;
  if (kind !== 'msg' && kind !== 'asset') throw notFound();
  await library.serveMedia(kind, String(req.params.id), req.query as Record<string, unknown>, req.get('range'), res);
}));

// ───────────── Authentification (publique) ─────────────
router.post('/auth/register', authLimiter, validate(registerSchema), h(async (req, res) => {
  const r = await auth.register(req.body, req);
  setRefresh(res, r.refreshToken);
  res.status(201).json({ accessToken: r.accessToken, user: r.user });
}));
router.post('/auth/login', authLimiter, validate(loginSchema), h(async (req, res) => {
  const r = await auth.login(req.body.email, req.body.password, req.body.totp, req);
  setRefresh(res, r.refreshToken);
  res.json({ accessToken: r.accessToken, user: r.user });
}));
router.post('/auth/refresh', sameOriginOnly, h(async (req, res) => {
  const r = await auth.refresh(req.cookies?.[REFRESH_COOKIE], req);
  setRefresh(res, r.refreshToken);
  res.json({ accessToken: r.accessToken, user: r.user });
}));
router.post('/auth/logout', sameOriginOnly, h(async (req, res) => {
  await auth.logout(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.json({ ok: true });
}));
router.post('/auth/verify-email', authLimiter, validate(verifyEmailSchema), h(async (req, res) => { await auth.verifyEmail(req.body.token); res.json({ ok: true }); }));
router.post('/auth/forgot-password', sensitiveLimiter, validate(forgotSchema), h(async (req, res) => { await auth.forgotPassword(req.body.email); res.json({ ok: true }); }));
router.post('/auth/reset-password', sensitiveLimiter, validate(resetSchema), h(async (req, res) => { await auth.resetPassword(req.body.token, req.body.password, req); res.json({ ok: true }); }));
router.get('/auth/invite/:token', authLimiter, h(async (req, res) => { res.json(await auth.inviteInfo(String(req.params.token))); }));
router.post('/auth/accept-invite', authLimiter, validate(acceptInviteSchema), h(async (req, res) => {
  const r = await auth.acceptInvite(req.body.token, req.body.password, req.body.displayName, req);
  setRefresh(res, r.refreshToken);
  res.status(201).json({ accessToken: r.accessToken, user: r.user });
}));

// ───────────── Tout ce qui suit exige une session valide ─────────────
router.use(requireAuth);

// ───────────── Super admin de la plateforme (aucune donnée d'agence hors de ces routes) ─────────────
const adm = Router();
adm.use(requirePlatform);
adm.get('/overview', h(async (req, res) => { res.json(await admin.overview(Math.min(90, Math.max(7, Number(req.query.days) || 30)))); }));
adm.get('/agencies', h(async (req, res) => { res.json(await admin.listAgencies(String(req.query.search ?? '') || undefined)); }));
adm.post('/agencies/:id/ban', validate(banSchema), h(async (req, res) => { res.json({ agency: await admin.banAgency(me(req), String(req.params.id), req.body.reason, req) }); }));
adm.post('/agencies/:id/unban', h(async (req, res) => { res.json({ agency: await admin.unbanAgency(me(req), String(req.params.id), req) }); }));
adm.patch('/agencies/:id/fee', validate(feeSchema), h(async (req, res) => { res.json({ agency: await admin.setFee(me(req), String(req.params.id), req.body.feeBps, req) }); }));
adm.get('/agencies/:id/conversations', validate(messagesQuerySchema, 'query'), h(async (req, res) => { res.json(await admin.listConversations(String(req.params.id), q(req))); }));
adm.get('/conversations/:id/messages', validate(messagesQuerySchema, 'query'), h(async (req, res) => { res.json(await admin.listMessages(me(req), String(req.params.id), q(req), req)); }));
adm.get('/payouts', h(async (req, res) => { res.json(await wallet.adminListPayouts({ status: String(req.query.status ?? '') || undefined })); }));
adm.post('/payouts/:id/decision', validate(payoutDecisionSchema), h(async (req, res) => { res.json(await wallet.adminDecidePayout(me(req), String(req.params.id), req.body, req)); }));
router.use('/admin', adm);

router.use(requireActiveAgency);

router.get('/auth/me', h(async (req, res) => { res.json({ user: await auth.publicUser(me(req).id, String(req.headers['x-agency-id'] ?? '') || undefined) }); }));
router.patch('/auth/me', validate(profileUpdateSchema), h(async (req, res) => {
  await User.updateOne({ _id: me(req).id }, { $set: { displayName: req.body.displayName } });
  res.json({ user: await auth.publicUser(me(req).id, String(req.headers['x-agency-id'] ?? '') || undefined) });
}));
router.post('/auth/change-password', sensitiveLimiter, validate(changePasswordSchema), h(async (req, res) => { await auth.changePassword(me(req), req.body.currentPassword, req.body.newPassword, me(req).sessionId, req); res.json({ ok: true }); }));
router.get('/auth/sessions', h(async (req, res) => { res.json(await auth.listSessions(me(req).id, me(req).sessionId)); }));
router.delete('/auth/sessions/:id', h(async (req, res) => { await auth.revokeSession(me(req).id, String(req.params.id)); res.json({ ok: true }); }));
router.post('/auth/totp/setup', sensitiveLimiter, h(async (req, res) => { res.json(await auth.totpSetup(me(req))); }));
router.post('/auth/totp/enable', sensitiveLimiter, validate(z.object({ code: z.string().trim().min(6).max(10) })), h(async (req, res) => { res.json(await auth.totpEnable(me(req), req.body.code, req)); }));
router.post('/auth/totp/disable', sensitiveLimiter, validate(z.object({ password: z.string().min(1).max(128) })), h(async (req, res) => { await auth.totpDisable(me(req), req.body.password, req); res.json({ ok: true }); }));

// ───────────── Agence ─────────────
router.get('/agency', h(async (req, res) => { res.json({ agency: agency.serializeAgency(await agency.getAgency(me(req).agencyId)) }); }));
router.patch('/agency', requirePerm('agency.settings'), validate(agencySettingsSchema), h(async (req, res) => { res.json({ agency: await agency.updateSettings(me(req), req.body, req) }); }));
// Agences du chef d'agence (sélecteur) et création d'une nouvelle agence
router.get('/agencies', h(async (req, res) => { res.json({ items: await agency.listMyAgencies(me(req)) }); }));
router.post('/agencies', requirePerm('agency.create'), validate(agencyCreateSchema), h(async (req, res) => { res.status(201).json({ agency: await agency.createMyAgency(me(req), req.body.name, req) }); }));
router.get('/audit', validate(auditQuerySchema, 'query'), h(async (req, res) => { res.json(await agency.listAudit(me(req), q(req))); }));
router.get('/export/contacts.csv', sensitiveLimiter, h(async (req, res) => {
  const csv = await inbox.exportContactsCsv(me(req), req);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
  res.send('﻿' + csv);
}));

// ───────────── Portefeuille et retraits (brut / commission / net) ─────────────
router.get('/wallet', h(async (req, res) => { res.json(await wallet.wallet(me(req))); }));
router.post('/payouts', sensitiveLimiter, requirePerm('payout.request'), validate(payoutRequestSchema), h(async (req, res) => { res.status(201).json(await wallet.requestPayout(me(req), req.body, req)); }));
router.post('/payouts/:id/cancel', h(async (req, res) => { res.json(await wallet.cancelPayout(me(req), String(req.params.id), req)); }));

// ───────────── Équipe ─────────────
router.get('/team', h(async (req, res) => { res.json(await team.listTeam(me(req))); }));
router.get('/team/assignable', h(async (req, res) => { res.json({ items: await team.listAssignable(me(req)) }); }));
router.post('/team/invites', requirePerm('team.manage'), validate(inviteCreateSchema), h(async (req, res) => { res.status(201).json(await team.createInvite(me(req), req.body, req)); }));
router.delete('/team/invites/:id', h(async (req, res) => { await team.revokeInvite(me(req), String(req.params.id), req); res.json({ ok: true }); }));
router.patch('/team/members/:id', requirePerm('team.manage'), validate(memberUpdateSchema), h(async (req, res) => { res.json(await team.updateMember(me(req), String(req.params.id), req.body, req)); }));
router.delete('/team/members/:id', h(async (req, res) => { await team.removeMember(me(req), String(req.params.id), req); res.json({ ok: true }); }));

// ───────────── Comptes Telegram ─────────────
router.get('/accounts', h(async (req, res) => { res.json({ items: await accounts.listAccounts(me(req)) }); }));
router.get('/accounts/mine', h(async (req, res) => { res.json({ items: await accounts.listModelAccounts(me(req)) }); }));
router.post('/accounts', sensitiveLimiter, requirePerm('accounts.manage'), validate(accountConnectSchema), h(async (req, res) => { res.status(201).json(await accounts.connectAccount(me(req), req.body, req)); }));
router.get('/accounts/:id', h(async (req, res) => { res.json(await accounts.getAccount(me(req), String(req.params.id))); }));
router.patch('/accounts/:id', requirePerm('accounts.manage'), validate(accountUpdateSchema), h(async (req, res) => { res.json(await accounts.updateAccount(me(req), String(req.params.id), req.body, req)); }));
router.post('/accounts/:id/business', requirePerm('accounts.manage'), validate(businessDecisionSchema), h(async (req, res) => { res.json(await accounts.decideBusiness(me(req), String(req.params.id), req.body.decision, req)); }));
router.post('/accounts/:id/check', sensitiveLimiter, h(async (req, res) => { res.json(await accounts.checkAccount(me(req), String(req.params.id))); }));
router.post('/accounts/:id/user/code', sensitiveLimiter, requirePerm('accounts.manage'), h(async (req, res) => { res.json(await accounts.userRequestCode(me(req), String(req.params.id))); }));
router.post('/accounts/:id/user/verify', sensitiveLimiter, requirePerm('accounts.manage'), validate(userVerifySchema), h(async (req, res) => { res.json(await accounts.userVerifyLogin(me(req), String(req.params.id), req.body, req)); }));
router.post('/accounts/:id/token', sensitiveLimiter, requirePerm('accounts.manage'), validate(tokenReplaceSchema), h(async (req, res) => { res.json(await accounts.replaceToken(me(req), String(req.params.id), req.body.token, req)); }));
router.delete('/accounts/:id', h(async (req, res) => { await accounts.disconnectAccount(me(req), String(req.params.id), req); res.json({ ok: true }); }));
router.post('/accounts/:id/sandbox/connect', requirePerm('accounts.manage'), validate(sandboxConnectSchema), h(async (req, res) => { await sandbox.sandboxConnect(me(req), String(req.params.id), req.body, req); res.json({ ok: true }); }));
router.post('/accounts/:id/sandbox/incoming', requirePerm('inbox.supervise'), validate(simulateIncomingSchema), h(async (req, res) => { await sandbox.sandboxIncoming(me(req), String(req.params.id), req.body); res.json({ ok: true }); }));

// ───────────── Inbox ─────────────
router.get('/conversations', validate(conversationQuerySchema, 'query'), h(async (req, res) => { res.json(await inbox.listConversations(me(req), q(req))); }));
router.post('/conversations/bulk-reassign', requirePerm('conversation.assign'), validate(bulkReassignSchema), h(async (req, res) => { res.json(await inbox.bulkReassign(me(req), req.body, req)); }));
router.get('/conversations/:id', h(async (req, res) => { res.json(await inbox.getConversation(me(req), String(req.params.id))); }));
router.patch('/conversations/:id', validate(conversationPatchSchema), h(async (req, res) => { res.json(await inbox.patchConversation(me(req), String(req.params.id), req.body, req)); }));
router.post('/conversations/:id/read', h(async (req, res) => { await inbox.markRead(me(req), String(req.params.id)); res.json({ ok: true }); }));
router.delete('/conversations/:id', sensitiveLimiter, h(async (req, res) => { await inbox.deleteConversation(me(req), String(req.params.id), req); res.json({ ok: true }); }));
router.get('/conversations/:id/messages', validate(messagesQuerySchema, 'query'), h(async (req, res) => { res.json(await inbox.listMessages(me(req), String(req.params.id), q(req))); }));
router.post('/conversations/:id/messages', requirePerm('inbox.reply'), validate(sendMessageSchema), h(async (req, res) => {
  const m = await sendFromCrm(me(req), String(req.params.id), req.body);
  res.status(202).json(serializeMessage(m.toObject(), me(req).id));
}));
router.post('/messages/:id/unlock', requirePerm('inbox.reply'), h(async (req, res) => { const m = await unlockPpv(me(req), String(req.params.id), req); res.status(202).json(serializeMessage(m.toObject(), me(req).id)); }));
router.post('/messages/:id/retry', h(async (req, res) => { const m = await retryMessage(me(req), String(req.params.id)); res.status(202).json(serializeMessage(m.toObject(), me(req).id)); }));
router.get('/conversations/:id/notes', h(async (req, res) => { res.json({ items: await inbox.listNotes(me(req), String(req.params.id)) }); }));
router.post('/conversations/:id/notes', requirePerm('notes.write'), validate(noteSchema), h(async (req, res) => { res.status(201).json(await inbox.addNote(me(req), String(req.params.id), req.body.text)); }));
router.delete('/notes/:id', h(async (req, res) => { await inbox.deleteNote(me(req), String(req.params.id)); res.json({ ok: true }); }));
router.post('/conversations/:id/sales', requirePerm('sales.record'), validate(saleSchema), h(async (req, res) => { res.status(201).json(await sales.recordSale(me(req), String(req.params.id), req.body, req)); }));

router.get('/tags', h(async (req, res) => { res.json({ items: await inbox.listTags(me(req)) }); }));
router.post('/tags', requirePerm('tags.manage'), validate(tagSchema), h(async (req, res) => { res.status(201).json(await inbox.createTag(me(req), req.body)); }));
router.patch('/tags/:id', requirePerm('tags.manage'), validate(tagPatchSchema), h(async (req, res) => { res.json(await inbox.updateTag(me(req), String(req.params.id), req.body)); }));
router.delete('/tags/:id', h(async (req, res) => { await inbox.deleteTag(me(req), String(req.params.id)); res.json({ ok: true }); }));
router.get('/quick-replies', h(async (req, res) => { res.json({ items: await inbox.listQuickReplies(me(req)) }); }));
router.post('/quick-replies', requirePerm('scripts.manage'), validate(quickReplySchema), h(async (req, res) => { res.status(201).json(await inbox.createQuickReply(me(req), req.body)); }));
router.patch('/quick-replies/:id', requirePerm('scripts.manage'), validate(quickReplyPatchSchema), h(async (req, res) => { res.json(await inbox.updateQuickReply(me(req), String(req.params.id), req.body)); }));
router.delete('/quick-replies/:id', h(async (req, res) => { await inbox.deleteQuickReply(me(req), String(req.params.id)); res.json({ ok: true }); }));

// ───────────── Ventes, shifts, métriques ─────────────
router.get('/sales', validate(salesQuerySchema, 'query'), h(async (req, res) => { res.json(await sales.listSales(me(req), q(req))); }));
router.post('/sales/:id/void', h(async (req, res) => { res.json(await sales.voidSale(me(req), String(req.params.id), req)); }));
router.get('/shifts', validate(shiftsQuerySchema, 'query'), h(async (req, res) => { res.json({ items: await sales.listShifts(me(req), q(req)) }); }));
router.post('/shifts', requirePerm('shifts.manage'), validate(shiftSchema), h(async (req, res) => { res.status(201).json(await sales.createShift(me(req), req.body)); }));
router.delete('/shifts/:id', h(async (req, res) => { await sales.deleteShift(me(req), String(req.params.id)); res.json({ ok: true }); }));
router.get('/analytics/overview', validate(analyticsQuerySchema, 'query'), h(async (req, res) => { res.json(await analytics.overview(me(req), q(req))); }));
router.get('/analytics/me', validate(analyticsQuerySchema, 'query'), h(async (req, res) => {
  if (me(req).role !== 'CHATTER') throw new AppError(403, 'FORBIDDEN_ROLE', 'Action non autorisée pour votre rôle');
  res.json(await analytics.myStats(me(req), q<{ range: any }>(req).range));
}));

// ───────────── Médiathèque ─────────────
router.get('/library/folders', h(async (req, res) => { res.json({ items: await library.listFolders(me(req)) }); }));
router.post('/library/folders', requirePerm('library.manage'), validate(folderSchema), h(async (req, res) => { res.status(201).json(await library.createFolder(me(req), req.body)); }));
router.patch('/library/folders/:id', requirePerm('library.manage'), validate(z.object({ name: z.string().trim().min(1).max(60) })), h(async (req, res) => { res.json(await library.renameFolder(me(req), String(req.params.id), req.body.name)); }));
router.delete('/library/folders/:id', h(async (req, res) => { await library.deleteFolder(me(req), String(req.params.id)); res.json({ ok: true }); }));
router.get('/library/assets', validate(assetsQuerySchema, 'query'), h(async (req, res) => { res.json(await library.listAssets(me(req), q(req))); }));
router.post('/library/assets', uploadLimiter, requirePerm('library.upload'), upload.single('file'), h(async (req, res) => {
  const f = uploadFieldsSchema.safeParse(req.body ?? {});
  if (!f.success) throw new AppError(400, 'VALIDATION_ERROR', 'Données invalides', f.error.flatten());
  res.status(201).json(await library.uploadAsset(me(req), req.file, f.data, req));
}));
router.patch('/library/assets/:id', requirePerm('library.manage'), validate(assetPatchSchema), h(async (req, res) => { res.json(await library.patchAsset(me(req), String(req.params.id), req.body)); }));
router.delete('/library/assets/:id', h(async (req, res) => { await library.deleteAsset(me(req), String(req.params.id), req); res.json({ ok: true }); }));

export default router;
