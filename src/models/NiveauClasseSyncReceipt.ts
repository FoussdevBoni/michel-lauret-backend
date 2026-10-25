import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    operationId: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true },
    digest: { type: String, required: true },
    result: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, collection: 'niveauClasseSyncReceipts' },
);

// Les accusés restent disponibles pour les reprises tardives, sans TTL.
export const NiveauClasseSyncReceipt = model('NiveauClasseSyncReceipt', schema);
