import { Schema, model } from 'mongoose';

// Pas de TTL : une reprise tardive doit retrouver le même accusé de réception.
const schema = new Schema(
  {
    operationId: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true },
    digest: { type: String, required: true },
    result: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, collection: 'niveauSyncReceipts' },
);

export const NiveauSyncReceipt = model('NiveauSyncReceipt', schema);
