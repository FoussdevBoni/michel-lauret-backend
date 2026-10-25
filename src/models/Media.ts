import { Schema, model } from 'mongoose';
const slotSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    entity: { type: String, required: true },
    targetId: { type: String, required: true },
    kind: { type: String, required: true },
    revision: { type: Number, default: 0 },
    objectKey: { type: String, default: null },
    mime: { type: String, default: null },
  },
  { timestamps: true, collection: 'mediaSlots' },
);
export const MediaSlot = model('MediaSlot', slotSchema);
const operationSchema = new Schema(
  {
    operationId: { type: String, required: true, unique: true },
    key: { type: String, required: true },
    ownerId: { type: String, required: true },
    digest: { type: String, required: true },
    state: {
      type: String,
      enum: ['pending', 'committed', 'conflict'],
      default: 'pending',
    },
    revision: Number,
    lease: String,
    leaseUntil: Date,
    objectKey: String,
  },
  { timestamps: true, collection: 'mediaOperations' },
);
export const MediaOperation = model('MediaOperation', operationSchema);
const cleanupSchema = new Schema(
  {
    objectKey: { type: String, required: true, unique: true },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'mediaCleanup' },
);
export const MediaCleanup = model('MediaCleanup', cleanupSchema);
