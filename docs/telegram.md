# Connecter TeleDesk à Telegram

TeleDesk n'utilise que l'**API Bot officielle** de Telegram. Aucune session, aucun numéro de téléphone, aucun mot de passe Telegram de la modèle n'est demandé ni stocké : on ne manipule qu'un **jeton de bot** (chiffré en AES-256-GCM en base).

## Les trois modes

| Mode | Les fans écrivent à… | Usage |
|---|---|---|
| **BUSINESS** | le compte Telegram de la modèle (un bot Business y est rattaché) | Cas principal des agences : la modèle garde son compte, l'équipe répond via TeleDesk |
| **BOT** | directement un bot | Si la modèle n'a pas Telegram Premium / Business |
| **SANDBOX** | un faux Telegram intégré | Démo et tests sans compte Telegram (désactivé en production) |

## Connexion Business, pas à pas

Prérequis : la modèle a **Telegram Premium** (la fonction Business en dépend).

1. **Créer le bot** (par l'owner de l'agence) : dans Telegram, ouvrir **@BotFather** › `/newbot` › noter le **jeton** (`123456:ABC…`).
2. **Activer le mode Business** du bot : @BotFather › `/mybots` › votre bot › **Bot Settings** › **Business Mode** › activer.
3. **Ajouter le compte dans TeleDesk** : *Comptes › Connecter un compte* › mode **Compte Telegram (bot Business)** › coller le jeton › choisir (option) la modèle liée. Le jeton est vérifié auprès de Telegram (`getMe`) puis chiffré.
4. **La modèle connecte le bot à son compte** : Telegram › **Paramètres › Telegram Business › Chatbots** › saisir le @nom du bot › cocher **Répondre aux messages** (droit `can_reply`) et choisir les discussions concernées.
5. **Confirmer dans TeleDesk** : la connexion apparaît « en attente » sur la fiche du compte ; l'owner la **confirme**. Elle est refusée si le compte Telegram qui se connecte n'est pas celui attendu (garde `DIFFERENT_OWNER`).

Dès lors, les messages entrants arrivent en temps réel dans la boîte de réception, et les réponses des chatters partent au nom de la modèle.

Règles imposées par Telegram (respectées par TeleDesk) :
- on ne peut répondre qu'à un fan qui a **écrit en premier** (pas de prospection à froid) ;
- en Business, la réponse n'est possible que dans les **24 h** suivant son dernier message : l'interface l'indique et bloque l'envoi passé ce délai ;
- les envois sont espacés (`OUTBOUND_MIN_INTERVAL_MS`) pour éviter les limites anti-flood.

## Médias payants (PPV)

Un média de la médiathèque avec un **prix > 0** part **toujours verrouillé** sur Telegram : le contact reçoit uniquement un **aperçu flouté** avec la mention « 🔒 Contenu verrouillé — 25 € ». L'original (et son identifiant Telegram) n'est jamais transmis à ce stade.

1. Le chatter envoie le média depuis la médiathèque : le fil affiche « PPV 25 € — le contact ne voit qu'un aperçu flou ».
2. Le contact paie **hors plateforme** (lien de paiement, crypto… : TeleDesk n'encaisse rien).
3. Le chatter clique **Paiement reçu : débloquer** et confirme : l'original est envoyé et la **vente est enregistrée** au prix du PPV (compteurs du chatter, du shift et total du contact).
4. Garde-fous : un seul déblocage par PPV (même en cas de clics simultanés), la fenêtre de 24 h s'applique, et si l'envoi échoue le PPV reste verrouillé sans vente.

Un média à **0 €** est envoyé en clair. Limite : l'aperçu flou est généré depuis la miniature ; pour une vidéo, un visuel « verrouillé » générique est envoyé.

## Polling ou webhook

- **Polling (défaut)** : le serveur interroge Telegram (long polling). Aucune adresse publique requise → idéal en local et pour tester.
- **Webhook** : Telegram appelle `POST {PUBLIC_URL}/api/telegram/webhook/:id` avec l'en-tête `x-telegram-bot-api-secret-token`. Renseigner `PUBLIC_URL` (HTTPS public) dans `.env`, puis choisir « webhook » sur le compte. Toute requête sans le bon secret reçoit un `403` uniforme.

## Tester sans Telegram (bac à sable)

1. *Comptes › Connecter un compte* › mode **Bac à sable**.
2. Sur la fiche : **1. Simuler la connexion du modèle** (génère une connexion Business en attente) puis **Confirmer**.
3. **Simuler un message entrant** : un fan fictif écrit ; la conversation apparaît en direct. Répondez depuis l'inbox : la réponse est enregistrée par le faux serveur.

Les données d'entraînement `npm run seed` utilisent ce mode.

## Ce qui n'est PAS validé ici

Les tests automatiques et manuels ont été faits contre le faux Telegram intégré, **pas contre l'API réelle** (pas d'accès réseau ni de bot réel dans l'environnement de développement). Premier test réel conseillé : un bot en mode BOT avec polling, vous lui écrivez, la conversation doit apparaître.

## Responsabilités de l'exploitant

- Contenus pour adultes : légalité dans vos juridictions, **majorité (18+)** et consentement écrit de chaque modèle.
- RGPD : base légale, information des fans, durées de conservation, suppression sur demande (export/suppression de contact disponibles pour l'owner).
- Respect des conditions d'utilisation de Telegram. TeleDesk n'automatise aucun compte utilisateur.
