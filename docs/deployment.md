# Déploiement

## Check-list

| Élément | Action |
|---|---|
| Base | MongoDB (Atlas ou géré) → `MONGODB_URI`, sauvegardes |
| Secrets | `JWT_ACCESS_SECRET`, `MEDIA_SIGNING_SECRET`, `TELEGRAM_SECRET_KEY` : ≥ 32 caractères chacun (générés dans `.env` au premier lancement). Le serveur **refuse de démarrer** en production avec un secret faible. **Sauvegardez `TELEGRAM_SECRET_KEY`** : sans elle, les jetons de bot en base sont illisibles. |
| URL | `CLIENT_URL=https://votre-domaine` (CORS) ; `PUBLIC_URL=https://votre-domaine` si mode webhook |
| Bac à sable | `NODE_ENV=production` le désactive (`ALLOW_SANDBOX=false`) |
| Stockage | local (volume persistant) ou S3, voir `storage.md` |
| E-mail | `EMAIL_PROVIDER=smtp` + `npm i nodemailer -w server` + `SMTP_URL` ; `REQUIRE_EMAIL_VERIFICATION=true` |
| Telegram | voir `telegram.md` |

> **Non testés** : S3, SMTP et l'API Telegram réelle (testés seulement via simulations). À essayer en préproduction.
> **Facturation** : aucun prestataire de paiement n'est branché ; les offres (`shared`, `PLANS`) sont des valeurs d'exemple et limitent comptes/sièges uniquement.

## Lancement

```bash
npm ci
npm run build   # client/dist + server/dist
npm start       # API + Socket.IO + client compilé sur PORT (5000)
```

Derrière un reverse proxy HTTPS (Nginx, Caddy) avec WebSockets (`/socket.io`) autorisés et `X-Forwarded-*`. Le cookie de refresh est `Secure` en production.

## Une seule instance

Le temps réel (Socket.IO), la présence et les connexions Telegram (polling) tournent **dans le processus** : n'exécutez qu'**une instance** (sinon doublons de polling). Pour plusieurs instances : adaptateur Redis Socket.IO + webhook + répartition — non fourni.

## Exploitation

Journaux structurés sans secrets, sauvegardes MongoDB + `uploads/`, rotation des secrets (sauf `TELEGRAM_SECRET_KEY`, qui exigerait de reconnecter les comptes).
