/**
 * Données de démonstration : une agence fictive, ses comptes Telegram « bac à sable » (déjà confirmés), son équipe,
 * une médiathèque d'images abstraites générées localement, des contacts fictifs, 14 jours d'historique cohérent
 * (messages, réponses, ventes, shifts, compteurs). Aucune donnée réelle, aucune image de personne.
 *
 *   npm run seed               crée la démo (refuse s'il y a déjà des données)
 *   npm run seed -- --reset    efface la base puis recrée la démo
 */
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { env } from '../config/env';
import { connectDb } from '../config/db';
import { splitSale } from '@teledesk/shared';
import { Agency, Asset, Conversation, DailyStat, Folder, Message, Note, QuickReply, Sale, Shift, Tag, TelegramAccount, User } from '../models';
import { getStorage } from '../providers/storage';
import { encryptSecret } from '../utils/crypto';
import { dayKey } from '../utils/helpers';
import { hashPassword } from '../services/auth.service';
import { createAgency } from '../services/agency.service';
import { bumpStat } from '../services/stats.service';
import { fakeId } from '../services/account.service';
import { makeThumb } from '../services/telegram/media';

const PASSWORD = 'Demo!2024secure';
const MIN = 60_000; const HOUR = 3_600_000; const DAY = 86_400_000;

function rng(seed: number) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(20261016);
const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)]!;
const between = (a: number, b: number) => a + rand() * (b - a);

const FANS = ['Thomas', 'Lucas', 'Hugo', 'Nathan', 'Maxime', 'Enzo', 'Louis', 'Mathis', 'Jules', 'Adam', 'Théo', 'Paul', 'Léo', 'Axel', 'Noé', 'Rayan', 'Sacha', 'Tom', 'Eliott', 'Victor', 'Gabin', 'Ethan', 'Malo', 'Timéo', 'Ilyes', 'Samuel', 'Oscar'];
const OPENERS = ['Salut, comment tu vas ?', 'Hello ! Je viens de te trouver, ton contenu est top', 'Coucou, tu as des nouveautés cette semaine ?', 'Bonsoir, je voulais te dire merci pour hier', 'Hey ! Tu fais des packs spéciaux ?', 'Salut, c’est possible d’avoir un message personnalisé ?'];
const FOLLOWUPS = ['Tu as quelque chose de nouveau ?', 'Haha merci, ça me fait plaisir', 'Je suis intéressé, c’est combien ?', 'OK je prends, dis-moi comment faire', 'Tu es dispo ce soir ?', 'Super, merci beaucoup !', 'Tu peux m’en dire plus ?'];
const REPLIES = ['Salut ! Ça va très bien, et toi ? 💜', 'Merci beaucoup, ça me touche ! Qu’est-ce qui t’a plu ?', 'Oui, j’ai préparé quelque chose de nouveau cette semaine ✨', 'Avec plaisir ! Je te montre ça tout de suite', 'Bien sûr, dis-moi ce que tu aimerais', 'Je te réponds dans un instant 😊'];
const PPV = ['Voici le pack de la semaine 💜', 'Ton exclu est là, dis-moi ce que tu en penses ✨', 'Pour toi, comme promis 🎁'];

async function image(hue: number, label: number) {
  const w = 960, h = 1200;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360},65%,30%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${300 + label * 40}" cy="420" r="260" fill="hsl(${(hue + 140) % 360},60%,65%)" opacity=".35"/><circle cx="700" cy="860" r="320" fill="hsl(${(hue + 200) % 360},60%,70%)" opacity=".28"/><rect x="80" y="80" width="800" height="1040" rx="36" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="6"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

async function main() {
  await connectDb();
  const reset = process.argv.includes('--reset');
  if (reset) { await mongoose.connection.dropDatabase(); console.log('Base effacée.'); }
  await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch(() => undefined)));
  if (await Agency.exists({})) { console.log('Des données existent déjà. Relancez avec « npm run seed -- --reset » pour repartir de zéro.'); await mongoose.disconnect(); return; }

  const now = Date.now();
  const agency = await createAgency('Studio Aurora (démo)');
  const hash = await hashPassword(PASSWORD);
  const mkUser = (email: string, displayName: string, agencyRole: string, accountIds: unknown[] = []) =>
    User.create({ email, passwordHash: hash, displayName, agencyId: agency._id, agencyRole, accountIds, emailVerifiedAt: new Date(), consents: { tosAt: new Date(), privacyAt: new Date() }, lastLoginAt: new Date(now - between(1, 20) * HOUR) });

  const owner = await mkUser('owner@teledesk.local', 'Alex Martin', 'OWNER');
  agency.ownerId = owner._id; await agency.save();
  const adminEmail = env.SUPERADMIN_EMAIL ?? 'admin@teledesk.local';
  await User.create({ email: adminEmail, passwordHash: hash, displayName: 'Super admin', platformRole: 'SUPERADMIN', emailVerifiedAt: new Date(), consents: { tosAt: new Date(), privacyAt: new Date() } });

  // Comptes Telegram « bac à sable » : le serveur reconstruit les faux bots depuis ces lignes à chaque démarrage.
  const accounts: Array<InstanceType<typeof TelegramAccount>> = [];
  for (const [i, label] of ['Luna', 'Mia', 'Sasha'].entries()) {
    const _id = new mongoose.Types.ObjectId();
    const botId = 8_000_000 + i;
    const token = `${botId}:${crypto.randomBytes(24).toString('base64url')}`;
    accounts.push(await TelegramAccount.create({
      _id, agencyId: agency._id, label, mode: 'SANDBOX', status: 'CONNECTED', botId: String(botId), botUsername: `${label.toLowerCase()}_demo_bot`, botName: label, botBusinessReady: true,
      secretEnc: encryptSecret(token, `account:${_id}`), webhookSecret: crypto.randomBytes(18).toString('base64url'), transport: 'POLLING', pollOffset: 1,
      business: { connectionId: `demo_conn_${i}`, userId: String(fakeId(`owner:${label}`)), userName: label, userUsername: label.toLowerCase(), isEnabled: true, canReply: true, canRead: true, receivedAt: new Date(now - 20 * DAY) },
      connectedAt: new Date(now - 20 * DAY), modelCanView: i === 0,
    }));
  }
  const [luna, mia, sasha] = accounts as [typeof accounts[0], typeof accounts[0], typeof accounts[0]];

  const camille = await mkUser('teamleader@teledesk.local', 'Camille Durand', 'TEAM_LEADER', [luna._id, mia._id]);
  const yanis = await mkUser('chatter1@teledesk.local', 'Yanis', 'CHATTER', [luna._id]);
  const ines = await mkUser('chatter2@teledesk.local', 'Inès', 'CHATTER', [luna._id, mia._id]);
  const karim = await mkUser('chatter3@teledesk.local', 'Karim', 'CHATTER', [mia._id, sasha._id]);
  const model = await mkUser('model@teledesk.local', 'Luna', 'MODEL');
  luna.modelUserId = model._id; await luna.save();
  const staffFor: Record<string, Array<typeof yanis>> = { [String(luna._id)]: [yanis, ines], [String(mia._id)]: [ines, karim], [String(sasha._id)]: [karim] };
  const speed: Record<string, [number, number]> = { [String(yanis._id)]: [1, 6], [String(ines._id)]: [2, 12], [String(karim._id)]: [4, 25] }; // minutes de délai de réponse

  // Médiathèque : images abstraites générées ici, stockées dans le stockage privé comme n'importe quel dépôt.
  const storage = getStorage();
  const folders: Record<string, InstanceType<typeof Folder>> = {};
  for (const [name, acc] of [['Packs photo', luna], ['Teasers', luna], ['Packs photo', mia], ['Offres', null]] as const) {
    folders[`${name}:${acc ? acc.label : 'common'}`] = await Folder.create({ agencyId: agency._id, name, accountId: acc?._id, createdBy: owner._id });
  }
  const assetsByAccount: Record<string, Array<InstanceType<typeof Asset>>> = {};
  let n = 0;
  for (const acc of accounts) {
    assetsByAccount[String(acc._id)] = [];
    for (const [j, [title, price]] of ([['Pack du jour', 1500], ['Exclu semaine', 2500], ['Pack premium', 5000], ['Teaser', 0]] as const).entries()) {
      n++;
      const buf = await image((n * 47) % 360, j);
      const key = `${crypto.randomBytes(16).toString('hex')}.jpg`; const thumbKey = `${crypto.randomBytes(16).toString('hex')}.webp`;
      const t = await makeThumb(buf);
      await storage.put('private', key, buf); await storage.put('private', thumbKey, t.data);
      const folder = acc === luna ? folders[j === 3 ? 'Teasers:Luna' : 'Packs photo:Luna'] : acc === mia ? folders['Packs photo:Mia'] : undefined;
      assetsByAccount[String(acc._id)]!.push(await Asset.create({ agencyId: agency._id, accountId: acc._id, folderId: folder?._id, name: `${title} · ${acc.label}`, kind: 'IMAGE', mime: 'image/jpeg', size: buf.length, storageKey: key, thumbKey, width: t.width, height: t.height, priceCents: price, tags: [title.split(' ')[0]!.toLowerCase()], uploadedBy: camille._id }));
    }
  }
  await QuickReply.insertMany([
    { agencyId: agency._id, title: 'Accueil', shortcut: 'hello', text: 'Salut ! Merci pour ton message 💜 Dis-moi ce qui t’intéresse, je te réponds tout de suite.', createdBy: camille._id },
    { agencyId: agency._id, title: 'Offre du jour', shortcut: 'offre', text: 'J’ai un pack spécial aujourd’hui, je te l’envoie si tu veux ✨', createdBy: camille._id },
    { agencyId: agency._id, title: 'Merci', shortcut: 'merci', text: 'Merci à toi, c’est vraiment sympa 😊', createdBy: camille._id },
  ]);
  const tags = await Tag.find({ agencyId: agency._id }).lean();
  const tagId = (name: string) => tags.find((t) => t.name === name)?._id;

  // Shifts : 6 h par jour et par chatter sur les 7 derniers jours + un shift en cours.
  const shifts: Array<InstanceType<typeof Shift>> = [];
  for (let d = 7; d >= 0; d--) {
    for (const [u, acc, startHour] of [[yanis, luna, 8], [ines, luna, 14], [ines, mia, 20], [karim, mia, 12], [karim, sasha, 18]] as const) {
      if ((u === ines && acc === mia && d % 2) || (u === ines && acc === luna && !(d % 2) && false)) continue;
      const day0 = new Date(now - d * DAY); day0.setUTCHours(0, 0, 0, 0);
      const startsAt = new Date(day0.getTime() + startHour * HOUR); const endsAt = new Date(startsAt.getTime() + 6 * HOUR);
      if (d === 0 && startsAt.getTime() > now) continue;
      if (shifts.some((s) => String(s.userId) === String(u._id) && s.startsAt < endsAt && s.endsAt > startsAt)) continue;
      shifts.push(await Shift.create({ agencyId: agency._id, userId: u._id, accountId: acc._id, startsAt, endsAt, createdBy: camille._id }));
    }
  }
  if (!shifts.some((x) => String(x.userId) === String(yanis._id) && x.startsAt.getTime() <= now && x.endsAt.getTime() >= now)) await Shift.create({ agencyId: agency._id, userId: yanis._id, accountId: luna._id, startsAt: new Date(now - 2 * HOUR), endsAt: new Date(now + 4 * HOUR), createdBy: camille._id }).catch(() => undefined);

  // Contacts et historique.
  let tgMsg = 5000; let convCount = 0; let msgCount = 0; let saleCount = 0;
  for (const acc of accounts) {
    const accId = String(acc._id); const staff = staffFor[accId]!; const assets = assetsByAccount[accId]!;
    const names = [...FANS].sort(() => rand() - 0.5).slice(0, 9);
    for (const [fi, fan] of names.entries()) {
      const fanId = fakeId(`fan:${acc.label}:${fan}`);
      const waiting = fi < 3; // les 3 premiers : message récent sans réponse (fenêtre de 24 h ouverte)
      const dormant = fi >= 7; // les 2 derniers : plus aucun échange depuis plus de 24 h
      const firstAt = now - (waiting ? between(0.3, 6) * DAY : between(2, 13.5) * DAY);
      const chatter = pick(staff);
      const msgs: any[] = []; let awaitingSince: Date | null = null; let assigned = false; let spent = 0; let sales = 0; let last = firstAt;
      const exchanges = waiting ? 1 + Math.floor(rand() * 3) : 2 + Math.floor(rand() * 4);
      let t = firstAt;
      for (let e = 0; e < exchanges; e++) {
        const isLast = e === exchanges - 1;
        if (e > 0) t += between(0.3, 2.2) * DAY / (dormant ? 1 : 3) * (dormant ? 1 : 1);
        if (t > now - 5 * MIN) t = now - between(10, 90) * MIN;
        if (waiting && isLast) t = now - between(8, 22 * 60) * MIN; // le contact a écrit il y a quelques minutes ou heures
        if (dormant && isLast) t = Math.min(t, now - between(26, 80) * HOUR);
        const tin = Math.max(t, (msgs.at(-1)?.createdAt?.getTime() ?? 0) + MIN);
        msgs.push({ direction: 'IN', source: 'FAN', type: 'TEXT', text: e === 0 ? pick(OPENERS) : pick(FOLLOWUPS), createdAt: new Date(tin), status: 'RECEIVED' });
        last = tin;
        if (waiting && isLast) { awaitingSince = new Date(tin); break; }
        const [lo, hi] = speed[String(chatter._id)]!;
        const delay = between(lo, hi) * MIN; const tout = tin + delay;
        msgs.push({ direction: 'OUT', source: 'CRM', type: 'TEXT', text: pick(REPLIES), createdAt: new Date(tout), status: 'SENT', sentBy: chatter._id, responseMs: Math.round(delay) });
        assigned = true; last = tout;
        if (e >= 1 && rand() < 0.45) {
          const a = pick(assets.filter((x) => x.priceCents > 0));
          const tp = tout + between(2, 9) * MIN;
          msgs.push({ direction: 'OUT', source: 'CRM', type: 'PHOTO', text: pick(PPV), createdAt: new Date(tp), status: 'SENT', sentBy: chatter._id, assetId: a._id, attachment: { kind: 'IMAGE', key: a.storageKey, thumbKey: a.thumbKey, mime: a.mime, size: a.size, name: a.name, width: a.width, height: a.height } });
          if (rand() < 0.7) {
            const ts = tp + between(3, 25) * MIN; spent += a.priceCents; sales++; saleCount++;
            const sh = shifts.find((s) => String(s.userId) === String(chatter._id) && String(s.accountId) === accId && s.startsAt.getTime() <= ts && s.endsAt.getTime() >= ts);
            msgs.at(-1).__sale = { ts, amount: a.priceCents, shiftId: sh?._id, assetId: a._id, note: a.name };
            last = Math.max(last, ts);
          } else last = tp;
        }
      }
      void awaitingSince;
      const lastIn = [...msgs].reverse().find((m) => m.direction === 'IN')!;
      const lastMsg = msgs.at(-1)!;
      const conv = await Conversation.create({
        agencyId: agency._id, accountId: acc._id, chatId: String(fanId), channel: 'BUSINESS', businessConnectionId: acc.business!.connectionId,
        contact: { tgUserId: String(fanId), firstName: fan, username: rand() < 0.5 ? `${fan.toLowerCase()}${Math.floor(rand() * 90 + 10)}` : '', languageCode: 'fr' },
        status: 'OPEN', assignedTo: assigned && !waiting ? chatter._id : waiting && rand() < 0.3 ? chatter._id : null, assignedAt: assigned ? new Date(msgs.find((m) => m.direction === 'OUT')!.createdAt) : undefined,
        lastMessageAt: lastMsg.createdAt, lastMessagePreview: (lastMsg.text || '📷 Photo').slice(0, 120), lastMessageDirection: lastMsg.direction,
        awaitingSince: waiting ? lastIn.createdAt : undefined, unreadCount: waiting ? 1 + Math.floor(rand() * 2) : 0, messagesCount: msgs.length,
        lastIncomingAt: lastIn.createdAt, hasIncoming: true, totalSpentCents: spent, salesCount: sales, firstContactAt: new Date(firstAt), createdAt: new Date(firstAt), updatedAt: lastMsg.createdAt,
        tagIds: [...(spent >= 5000 ? [tagId('Whale')] : []), ...(fi === 0 ? [tagId('Nouveau')] : []), ...(dormant ? [tagId('À relancer')] : []), ...(sales ? [tagId('Acheteur')] : [])].filter(Boolean),
      });
      convCount++;
      // si la conversation est assignée à un chatter qui n'est pas celui qui a répondu (cas « waiting »), on garde la cohérence
      for (const [mi, m] of msgs.entries()) {
        const { __sale, ...doc } = m;
        const created = await Message.create({ ...doc, agencyId: agency._id, conversationId: conv._id, accountId: acc._id, telegramMessageId: tgMsg++, tgDate: doc.createdAt, updatedAt: doc.createdAt });
        msgCount++;
        const day = dayKey(doc.createdAt);
        if (doc.direction === 'IN') {
          await bumpStat(agency._id, acc._id, null, { messagesIn: 1, ...(mi === 0 ? { newConversations: 1 } : {}) }, day);
        } else {
          await bumpStat(agency._id, acc._id, doc.sentBy, { messagesOut: 1, ...(doc.responseMs !== undefined ? { respCount: 1, respMsSum: doc.responseMs } : {}) }, day);
        }
        if (__sale) {
          await Sale.create({ agencyId: agency._id, accountId: acc._id, conversationId: conv._id, recordedBy: doc.sentBy, assetId: __sale.assetId, amountCents: __sale.amount, feeBps: agency.feeBps, ...splitSale(__sale.amount, agency.feeBps), note: __sale.note, shiftId: __sale.shiftId, day: dayKey(new Date(__sale.ts)), createdAt: new Date(__sale.ts), updatedAt: new Date(__sale.ts) });
          await bumpStat(agency._id, acc._id, doc.sentBy, { salesCount: 1, salesCents: __sale.amount, feeCents: splitSale(__sale.amount, agency.feeBps).feeCents }, dayKey(new Date(__sale.ts)));
        }
        void created;
      }
      if (fi % 4 === 0) await Note.create({ agencyId: agency._id, conversationId: conv._id, authorId: chatter._id, text: pick(['Préfère les packs du week-end', 'Répond surtout le soir', 'A demandé un message personnalisé — à relancer jeudi', 'Client régulier, très poli']) });
    }
  }
  const stats = await DailyStat.countDocuments({});

  console.log(`\n✓ Démo créée : 3 comptes Telegram (bac à sable), 6 membres, ${convCount} conversations, ${msgCount} messages, ${saleCount} ventes, ${shifts.length + 1} shifts, ${stats} lignes de métriques.\n`);
  console.log('Comptes de démonstration (mot de passe commun : ' + PASSWORD + ')');
  for (const [email, role] of [['admin@teledesk.local', 'Super admin plateforme (ou SUPERADMIN_EMAIL)'], ['owner@teledesk.local', 'Chef d’agence'], ['teamleader@teledesk.local', 'Team leader (Luna, Mia)'], ['chatter1@teledesk.local', 'Chatter — Yanis (Luna)'], ['chatter2@teledesk.local', 'Chatter — Inès (Luna, Mia)'], ['chatter3@teledesk.local', 'Chatter — Karim (Mia, Sasha)'], ['model@teledesk.local', 'Modèle — Luna (lecture seule)']]) console.log(`  ${email.padEnd(28)} ${role}`);
  console.log(`\nBase : ${env.MONGODB_URI}`);
  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
