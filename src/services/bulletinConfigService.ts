import { withTransaction } from '../lib/withTransaction';
import { z } from 'zod';
import { ConfigBulletin } from '../models/ConfigBulletin';
import { Bulletin } from '../models/Bulletin';
import { bulletinConfigSchema, defaultBulletinConfig } from '../types/features/Bulletin';
import { HttpError } from '../utils/HttpError';

export const bulletinConfigService = {
  async getConfig() {
    const record = await ConfigBulletin.findOne({ key: 'default' });
    return { config: record?.config ?? defaultBulletinConfig, version: record?.__v ?? 0 };
  },
  async saveConfig(input: unknown) {
    const data = z
      .object({ config: bulletinConfigSchema, version: z.number().int().nonnegative() })
      .strict()
      .parse(input);
    return withTransaction(async (session) => {
      const current = await ConfigBulletin.findOne({ key: 'default' }).session(session);
      if ((current?.__v ?? 0) !== data.version)
        throw new HttpError(409, 'La configuration a changé. Rechargez-la.');
      const record = await ConfigBulletin.findOneAndUpdate(
        { key: 'default' },
        { $set: { config: data.config }, $inc: { __v: 1, revision: 1 } },
        { session, upsert: true, new: true, setDefaultsOnInsert: false },
      );
      await Bulletin.updateMany(
        { isDeleted: { $ne: true } },
        { $set: { needsRecalculation: true }, $inc: { __v: 1 } },
        { session },
      );
      return { config: record!.config, version: record!.__v };
    });
  },
  async deleteConfig(input: unknown) {
    const { version } = z
      .object({ version: z.number().int().nonnegative() })
      .strict()
      .parse(input);
    return bulletinConfigService.saveConfig({ version, config: defaultBulletinConfig });
  },
};
