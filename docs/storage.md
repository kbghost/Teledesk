# Stockage des médias

`StorageService` (`server/src/providers/storage`) isole l'application du fournisseur.

| Implémentation | Usage | Réglage |
|---|---|---|
| `LocalStorageService` | Développement, petites installations | `STORAGE_PROVIDER=local`, `UPLOAD_DIR=./uploads` |
| `S3StorageService` | Production | `npm i @aws-sdk/client-s3 -w server`, `STORAGE_PROVIDER=s3`, `S3_BUCKET`, `S3_REGION` + identifiants AWS (**non testé** contre un vrai bucket) |

## Accès

- La bibliothèque PPV et les médias reçus/envoyés sont **privés** : jamais servis en statique.
- Le serveur vérifie les droits (agence, compte, conversation) puis renvoie une **URL signée HMAC de 5 minutes** ; les droits sont revérifiés à chaque lecture, la modification de l'URL l'invalide.
- Un modèle ne voit que ses propres médias selon les droits de l'agence.

## Uploads

- Formats : jpg, png, webp, gif, mp4, mov, pdf ; type détecté par signature binaire, pas par extension.
- Taille maximale : `MAX_UPLOAD_MB` (50). Noms aléatoires.
- Images : orientation corrigée, miniature via `sharp`.
- Envoi Telegram : les médias sont transmis via l'API Bot (photo / vidéo / document selon le type).

En production S3 : bucket **privé**, IAM restreint, chiffrement activé.
