# Connecter les comptes Telegram — que choisir ?

Objectif : que les fans parlent à la **vraie personne** (pas à un « bot »), sans compte Premium obligatoire.

| Mode | Le fan voit | Prérequis | Fiabilité |
|---|---|---|---|
| **Bot** (BOT) | un bot | @BotFather, aucun compte pro | fiable, mais c'est un bot |
| **Telegram Business** (BUSINESS) | le **vrai compte** de la modèle ; le CRM répond à sa place | le compte de la modèle doit avoir **Telegram Premium** (fonction Business → Chatbots) | officiel, recommandé |
| **Compte personnel** (USER, MTProto) | le vrai compte, sans Premium | `TELEGRAM_API_ID/HASH`, connexion téléphone → code → 2FA | **expérimental, non testé sur le vrai Telegram** |

## Recommandation
1. Si au moins un compte peut avoir Premium (≈ quelques € / mois par modèle) : **Business**, c'est la voie officielle et stable.
2. Sans Premium : le mode **compte personnel**. Risques à accepter : zones grises des CGU Telegram, blocage possible du compte si l'activité ressemble à du spam. Garde-fous intégrés : réponse uniquement aux personnes qui ont écrit en premier, plafond horaire (`USER_MAX_SENDS_PER_HOUR`), session chiffrée en base.
   Utiliser un numéro dédié et ne jamais écrire en masse.
3. Dans ce mode les boutons ne sont pas possibles : le lien de paiement est ajouté à la **légende** de l'aperçu flouté.

## Étapes (mode compte personnel)
1. Créer `api_id` / `api_hash` sur https://my.telegram.org → les mettre dans `.env`.
2. *Comptes Telegram › Connecter › Compte personnel* → numéro → code reçu dans Telegram → mot de passe 2FA si demandé.
3. Le chef d'agence confirme le compte ; les messages arrivent dans l'inbox.

⚠ Ce mode n'a été validé qu'avec un faux client (logique CRM) : faites un essai réel avec un compte jetable.
