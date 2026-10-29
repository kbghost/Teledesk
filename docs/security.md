# Sécurité

- **Authentification** : mot de passe haché (bcrypt/argon), JWT d'accès 15 min gardé en mémoire côté client, refresh token rotatif en cookie `td_refresh` (HttpOnly, SameSite, chemin `/api/auth`), 2FA TOTP optionnelle, limitation de débit sur login/inscription/reset.
- **Secrets Telegram** : jetons de bot et secrets 2FA chiffrés AES-256-GCM (`TELEGRAM_SECRET_KEY`, contexte lié au compte). Perdre la clé impose de reconnecter les comptes. Jamais renvoyés par l'API.
- **Pas de session Telegram, pas de numéro** : uniquement des jetons de bot officiels.
- **Médias** : URLs signées HMAC valables 5 min, droits revérifiés à chaque lecture.
- **Webhook** : secret comparé en temps constant ; réponse 403 uniforme.
- **Autorisations** : matrice unique dans `shared`, appliquée côté serveur (jamais seulement dans l'UI) ; périmètre par agence, par compte et par conversation.
- **Audit** : actions sensibles journalisées (consultable par l'owner).
- **En-têtes/CORS** : helmet, CORS limité à `CLIENT_URL`, validation Zod de toutes les entrées.
- Production : `NODE_ENV=production` désactive le bac à sable ; servir en HTTPS ; sauvegarder MongoDB et `uploads/`.
