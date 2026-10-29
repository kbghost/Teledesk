# TeleDesk

CRM **Telegram multi-opérateurs pour agences OFM** : boîte de réception temps réel partagée, notes internes, tags,
bibliothèque PPV envoyée en un clic (média payant = aperçu flouté + prix, original envoyé au déblocage), assignation des conversations, shifts, ventes et métriques par chatter.
Les comptes Telegram se connectent par **bot**, **Telegram Business** (le fan parle à la vraie modèle, sans compte Premium côté agence si le mode est disponible) ou **compte personnel MTProto** (expérimental) — voir [docs/telegram-comptes.md](docs/telegram-comptes.md).

## Hiérarchie

| Rôle | Peut… |
|---|---|
| **Super admin plateforme** (vous) | console dédiée : évolution de la plateforme (volume, commission, agences), **bannir/réactiver une agence**, **valider les retraits**, « Voir les messages » (lecture seule, journalisée) |
| **Chef d'agence** (s'inscrit seul) | crée **plusieurs agences** (sélecteur en haut de la barre latérale) ; chacune a ses comptes Telegram, médias, scripts, équipe. Écran d'accueil = rendement des chatters, net/brut, portefeuille |
| Manager / sous-chef | voit **toutes** les conversations de l'agence, gère l'équipe selon ses permissions |
| Team leader | superviser, assigner, tags, bibliothèque, shifts, métriques d'équipe |
| Chatter | répond aux conversations non assignées ou à lui, notes, tags, ventes, ses stats |
| Modèle (optionnel) | lecture seule de ses conversations, dépôt de médias |

Permissions par rôle + exceptions par membre (accorder / retirer) dans *Équipe*.

## Argent : 15 % pour la plateforme

Chaque vente est stockée en **brut** (prix payé), **commission** (15 % par défaut, réglable par agence côté super admin) et **net** (reste à l'agence). Portefeuille agence = Σ net − retraits versés − retraits en cours. Retrait minimum 20 €. Le super admin valide (PENDING → APPROVED → PAID) ou refuse.

## Médias payants (PPV) et page de paiement

Le fan reçoit l'image **floutée avec un grand cadenas** et un bouton/lien vers `PUBLIC_URL/pay/<jeton>`. Page de paiement **simulée** (mention « Mode simulation », carte de test) ou **Stripe Checkout réel** (`PAYMENT_PROVIDER=stripe`, webhook signé `/api/pay/webhook`). Après paiement, l'original est envoyé et la vente créditée automatiquement. `PUBLIC_URL` doit être une URL HTTPS publique (ngrok / cloudflared en local).

## Démarrage rapide

Prérequis : **Node.js ≥ 20** et **MongoDB** local (`mongodb://127.0.0.1:27017`).

```bash
npm install
npm run seed     # agence de démonstration
npm run dev      # interface http://localhost:5173 · API http://localhost:5000
```

`.env` est créé automatiquement avec des secrets aléatoires. Si MongoDB n'est pas installé, tout serveur compatible
(ex. FerretDB) fonctionne via `MONGODB_URI`.

### Comptes de démonstration (mot de passe : `Demo!2024secure`)

| E-mail | Rôle |
|---|---|
| `admin@teledesk.local` | **Super admin plateforme** (ou `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` dans `.env`) |
| `owner@teledesk.local` | Chef d'agence |
| `teamleader@teledesk.local` | Team leader (Luna, Mia) |
| `chatter1@teledesk.local` | Chatter Yanis (Luna) |
| `chatter2@teledesk.local` | Chatter Inès (Luna, Mia) |
| `chatter3@teledesk.local` | Chatter Karim (Mia, Sasha) |
| `model@teledesk.local` | Modèle Luna (lecture seule) |

Les comptes Telegram de la démo sont en **bac à sable** (faux Telegram intégré) : tout fonctionne sans Telegram.

## Brancher un vrai Telegram

Voir **[docs/telegram.md](docs/telegram.md)** (bot @BotFather, mode Business, confirmation par l'owner, polling/webhook).
Pour essayer sans Telegram : *Comptes › Connecter un compte › Bac à sable › Simuler la connexion › Confirmer › Simuler un message*.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Interface (Vite) + API (tsx watch) |
| `npm run seed` / `npm run seed -- --reset` | Données de démo (le `--reset` **efface** la base ciblée) |
| `npm test` | Tests serveur (Vitest + Supertest) |
| `npm run lint` | TypeScript strict serveur + client |
| `npm run build` / `npm start` | Compilation ; le serveur sert aussi le client sur le port 5000 |

## Documentation

[comptes Telegram](docs/telegram-comptes.md) · [telegram](docs/telegram.md) · [architecture](docs/architecture.md) · [sécurité](docs/security.md) · [stockage](docs/storage.md) · [déploiement](docs/deployment.md)

## Limites connues (honnêteté)

- **API Telegram réelle non testée** : validé contre le faux Telegram intégré uniquement. Faites un premier essai réel (bot BOT + polling) avant de l'utiliser en production.
- **Paiement** : la page simulée n'encaisse rien ; Stripe réel et ses webhooks sont testés avec une signature locale, pas contre Stripe. Les retraits sont validés manuellement (le virement réel se fait hors plateforme).
- **Mode compte personnel (MTProto)** : jamais testé sur le vrai réseau Telegram, contraire aux CGU possibles → risque de blocage du compte.
- S3 et SMTP implémentés mais non testés sur de vrais services.
- Une seule instance serveur (temps réel et polling en mémoire).
- Responsabilités de l'exploitant (légalité du contenu adulte, 18+, consentement, RGPD, CGU Telegram) : voir `docs/telegram.md`.
