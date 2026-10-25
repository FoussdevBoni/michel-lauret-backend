import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    entity: { type: String, required: true },
    operationId: { type: String, required: true },
    ownerId: { type: String, required: true },
    digest: { type: String, required: true },
    result: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, collection: 'entitySyncReceipts' },
);
schema.index({ entity: 1, operationId: 1 }, { unique: true });

export const EntitySyncReceipt = model('EntitySyncReceipt', schema);
