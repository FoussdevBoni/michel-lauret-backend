import { withTransaction } from '../lib/withTransaction';
import { retireMediaForParent } from './mediaLifecycleService';
import { z } from 'zod';
import { Etablissement, type IEtablissement } from '../models/Etablissement';
import {
  etablissementSaveSchema,
  etablissementPatchSchema,
  etablissementFields,
  type Etablissement as EtablissementData,
} from '../types/features/Etablissement';
import { HttpError } from '../utils/HttpError';

function fields(record: IEtablissement) {
  const object = record.toObject();
  return etablissementFields.parse(
    Object.fromEntries(
      Object.keys(etablissementFields.shape).map((key) => [key, object[key]]),
    ),
  );
}
export function serializeEtablissement(record: IEtablissement): EtablissementData {
  return {
    ...fields(record),
    id: 'school',
    version: record.__v,
    isDeleted: record.isDeleted,
    deletedAt: record.deletedAt?.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
const versionSchema = z.object({ version: z.number().int().nonnegative() }).strict();
export const etablissementService = {
  async get() {
    const record = await Etablissement.findOne({ key: 'school', isDeleted: false });
    return record ? serializeEtablissement(record) : null;
  },
  async exists() {
    return {
      exists: Boolean(await Etablissement.exists({ key: 'school', isDeleted: false })),
    };
  },
  async save(input: unknown) {
    const { version, ...data } = etablissementSaveSchema.parse(input);
    if (data.logo || data.enTeteCarte)
      throw new HttpError(
        400,
        'Envoyez les images avec le parcours d’upload, séparément des paramètres.',
      );
    return withTransaction(async (session) => {
      const record = await Etablissement.findOne({ key: 'school' }).session(session);
      if (!record) {
        if (version !== 0)
          throw new HttpError(409, 'La fiche a changé. Rechargez les paramètres.');
        const [created] = await Etablissement.create([{ ...data, key: 'school' }], {
          session,
        });
        // Zéro représente une fiche absente. Mongoose initialise lui-même __v à
        // zéro : une seconde sauvegarde transactionnelle réserve la version 1.
        created.increment();
        return serializeEtablissement(await created.save({ session }));
      }
      if (record.__v !== version)
        throw new HttpError(409, 'La fiche a changé. Rechargez les paramètres.');
      record.set({ ...data, isDeleted: false, deletedAt: undefined });
      record.increment();
      return serializeEtablissement(await record.save({ session }));
    });
  },
  async update(input: unknown) {
    const { version, ...patch } = etablissementPatchSchema.parse(input);
    if ('logo' in patch || 'enTeteCarte' in patch)
      throw new HttpError(
        400,
        'Utilisez les actions d’image pour remplacer ou retirer un fichier.',
      );
    return withTransaction(async (session) => {
      const record = await Etablissement.findOne({
        key: 'school',
        isDeleted: false,
      }).session(session);
      if (!record) throw new HttpError(404, 'Configurez d’abord l’établissement.');
      if (record.__v !== version)
        throw new HttpError(409, 'La fiche a changé. Rechargez les paramètres.');
      record.set(etablissementFields.parse({ ...fields(record), ...patch }));
      record.increment();
      return serializeEtablissement(await record.save({ session }));
    });
  },
  async delete(input: unknown) {
    const { version } = versionSchema.parse(input);
    return withTransaction(async (session) => {
      const record = await Etablissement.findOne({
        key: 'school',
        isDeleted: false,
      }).session(session);
      if (!record) throw new HttpError(404, 'Établissement non configuré.');
      if (record.__v !== version)
        throw new HttpError(409, 'La fiche a changé. Rechargez les paramètres.');
      record.set({ isDeleted: true, deletedAt: new Date() });
      await retireMediaForParent('school', 'school', session);
      record.increment();
      await record.save({ session });
      return { deletedCount: 1, version: record.__v };
    });
  },
  async deleteMany(input: unknown) {
    const data = z
      .object({
        ids: z.array(z.literal('school')).length(1),
        version: z.number().int().nonnegative(),
      })
      .strict()
      .parse(input);
    return etablissementService.delete({ version: data.version });
  },
  async getState() {
    const record = await Etablissement.findOne({ key: 'school' });
    return {
      etablissement: record && !record.isDeleted ? serializeEtablissement(record) : null,
      version: record?.__v ?? 0,
    };
  },
};
