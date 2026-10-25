import { Schema, model } from 'mongoose';
import type { BulletinConfig } from '../types/features/Bulletin';

const schema = new Schema(
  {
    key: { type: String, required: true, unique: true, enum: ['default'] },
    config: { type: Schema.Types.Mixed, required: true },
    revision: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'configBulletins' },
);
export const ConfigBulletin = model<{
  __v: number;
  key: string;
  config: BulletinConfig;
  revision: number;
}>('ConfigBulletin', schema);
