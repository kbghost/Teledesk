# Architecture

Monorepo npm workspaces :

| Dossier | Contenu |
|---|---|
| `shared/` | Schémas Zod, types, **matrice de permissions** (`PERMISSIONS` / `can()`), offres — source unique pour API et interface |
| `server/` | Express + TypeScript strict, Mongoose, Socket.IO, services Telegram, tests Vitest |
| `client/` | React 18, Vite, Tailwind, TanStack Query, Zustand |

## Serveur

- `routes/index.ts` : toutes les routes `/api`. Ordre des middlewares : `requireAuth` → `requirePerm` → `validate` (un rôle non autorisé reçoit 403 avant toute validation).
- `services/` : logique métier (inbox, ventes, bibliothèque PPV, équipe, analytics, audit).
- `services/telegram/` : `manager` (polling/webhook), `ingest` (messages entrants, dédoublonnage par `dedupeKey` unique), `outbound` (file d'envoi par compte, reprise après redémarrage), `media`, `sandbox` (faux Telegram en mémoire, restauré depuis la base au boot).
- Multi-agence : toutes les données portent un `agencyId`.
- Temps réel : Socket.IO par agence, filtré selon les droits de la conversation.
- Montants en centimes ; compteurs journaliers `DailyStat` pour des métriques rapides ; horloge injectable pour les tests.

## Rôles

| Rôle | Portée |
|---|---|
| Owner (super admin) | Tout : équipe, comptes Telegram, réglages, audit, export |
| Team leader | Supervision, assignation, tags, bibliothèque, shifts, métriques d'équipe |
| Chatter | Conversations non assignées ou à lui, sur ses comptes ; notes, tags, ventes, bibliothèque en lecture ; ses propres stats |
| Modèle (optionnel) | Lecture seule de ses conversations si l'agence l'autorise ; dépôt de médias ; ne voit ni notes ni ventes |

## Client

Pages : inbox (liste, fil, compositeur, sélecteur PPV, panneau contact avec notes/tags), bibliothèque, métriques, ventes, shifts, comptes + guide de connexion, équipe, réglages. Les menus affichés dépendent de `can()`.
