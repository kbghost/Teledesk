import mongoose, { Schema } from 'mongoose';
import { nowDate } from '../utils/clock';

/**
 * Sérialisation JSON globale : `id` au lieu de `_id`, sans `__v`.
 * Ce fichier est importé en premier par models/index.ts, AVANT la compilation des schémas.
 */
mongoose.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});
mongoose.set('strictQuery', true);
/** createdAt/updatedAt suivent l'horloge applicative (réelle en production, simulée dans les tests et le seed). */
export const timestamps = { timestamps: { currentTime: () => nowDate() } } as const;
export const oid = (ref: string, required = false) => ({ type: Schema.Types.ObjectId, ref, required });
/** Blob chiffré (AES-256-GCM) : stocké avec `select: false`, jamais renvoyé par l'API. */
export const encryptedBlob = new Schema({ iv: String, tag: String, data: String }, { _id: false });
