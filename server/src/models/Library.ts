import { Schema, model } from 'mongoose';
import { ASSET_KINDS } from '@teledesk/shared';
import { oid, timestamps } from './base';

const folder = new Schema(
  {
    agencyId: oid('Agency', true),
    name: { type: String, required: true, trim: true, maxlength: 60 },
    accountId: oid('TelegramAccount'), // absent = dossier commun à toute l'agence
    createdBy: oid('User'),
    deletedAt: Date,
  },
  timestamps,
);
folder.index({ agencyId: 1, accountId: 1 });
export const Folder = model('Folder', folder);

/** Média de la médiathèque (stockage privé). Le prix est le tarif PPV de référence, en centimes. */
const asset = new Schema(
  {
    agencyId: oid('Agency', true),
    folderId: oid('Folder'),
    accountId: oid('TelegramAccount'),
    name: { type: String, required: true, trim: true, maxlength: 100 },
    kind: { type: String, enum: ASSET_KINDS, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    storageKey: { type: String, required: true },
    thumbKey: String,
    width: Number,
    height: Number,
    priceCents: { type: Number, default: 0 },
    tags: [{ type: String, lowercase: true, trim: true }],
    /** file_id Telegram par bot : évite de renvoyer le fichier à chaque envoi (clé = identifiant du compte). */
    tgFileIds: { type: Map, of: String, default: {} },
    uploadedBy: oid('User'),
    usedCount: { type: Number, default: 0 },
    lastUsedAt: Date,
    deletedAt: Date,
  },
  timestamps,
);
asset.index({ agencyId: 1, folderId: 1, _id: -1 });
asset.index({ agencyId: 1, accountId: 1, _id: -1 });
export const Asset = model('Asset', asset);
