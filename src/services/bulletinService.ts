import { withTransaction } from '../lib/withTransaction';
import { type ClientSession } from 'mongoose';
import { z } from 'zod';
import { Bulletin } from '../models/Bulletin';
import { Inscription } from '../models/Inscription';
import { Classe } from '../models/Classe';
import { Periode } from '../models/Periode';
import { Matiere } from '../models/Matiere';
import { Evaluation } from '../models/Evaluation';
import { Note } from '../models/Note';
import { ConfigBulletin } from '../models/ConfigBulletin';
import {
  bulletinIdentitySchema,
  bulletinChangesSchema,
  bulletinConfigSchema,
  defaultBulletinConfig,
} from '../types/features/Bulletin';
import { matchesSchoolYear, schoolYearSchema } from '../types/features/Periode';
import { evaluationAppliesTo } from '../types/features/Evaluation';
import { calculateBulletin } from '../utils/bulletinCalculations';
import { HttpError } from '../utils/HttpError';
import { runBatch } from '../utils/runBatch';
import {
  bulletinQueryService,
  bulletinIdSchema,
  serializeBulletin,
} from './bulletinQueryService';

async function context(input: unknown, session: ClientSession) {
  const data = bulletinIdentitySchema.parse(input);
  const inscription = await Inscription.findOneAndUpdate(
    { _id: data.inscriptionId, isDeleted: false },
    { $inc: { referenceRevision: 1 } },
    { session, new: true },
  );
  if (!inscription) throw new HttpError(404, 'Inscription introuvable.');
  const classe = await Classe.findOneAndUpdate(
    { _id: inscription.classeId, isDeleted: false },
    { $inc: { inscriptionRevision: 1 } },
    { session, new: true },
  );
  const period = await Periode.findOneAndUpdate(
    { _id: data.periodeId, isDeleted: false },
    { $inc: { referenceRevision: 1 } },
    { session, new: true },
  );
  if (
    !classe ||
    !period ||
    !matchesSchoolYear(period, inscription.anneeScolaire) ||
    (period.niveauScolaireId &&
      String(period.niveauScolaireId) !== String(classe.niveauScolaireId))
  ) {
    throw new HttpError(
      409,
      'Classe ou période indisponible ou incompatible avec cette inscription.',
    );
  }
  return { data, inscription, classe, period };
}
async function draft(input: unknown, session: ClientSession) {
  const ctx = await context(input, session);
  let record = await Bulletin.findOne(ctx.data).session(session);
  if (record?.isDeleted)
    throw new HttpError(
      409,
      'Ce bulletin est archivé. Sa recréation nécessite une restauration explicite.',
    );
  if (!record) {
    const life = ctx.inscription.vieScolaire?.find(
      (entry) => String(entry.periodeId) === ctx.data.periodeId,
    )?.score;
    [record] = await Bulletin.create(
      [
        {
          ...ctx.data,
          classeId: ctx.classe._id,
          anneeScolaire: ctx.inscription.anneeScolaire,
          ...(life ? { vieScolaire: life } : {}),
        },
      ],
      { session },
    );
  }
  return { ...ctx, record };
}
export const bulletinService = {
  ...bulletinQueryService,
  async createUnique(input: unknown) {
    return withTransaction(async (session) =>
      serializeBulletin((await draft(input, session)).record),
    );
  },
  async createMultiple(input: unknown) {
    const data = z
      .object({
        periodeId: bulletinIdSchema,
        inscriptionIds: z.array(bulletinIdSchema).min(1).max(100),
      })
      .strict()
      .parse(input);
    return runBatch(data.inscriptionIds, (inscriptionId: string) =>
      bulletinService.createUnique({ inscriptionId, periodeId: data.periodeId }),
    );
  },
  async save(input: unknown) {
    const data = z
      .object({ ...bulletinIdentitySchema.shape, data: bulletinChangesSchema })
      .strict()
      .parse(input);
    return withTransaction(async (session) => {
      const previous = await Bulletin.findOne({
        inscriptionId: data.inscriptionId,
        periodeId: data.periodeId,
      }).session(session);
      if (previous && previous.__v !== data.data.version)
        throw new HttpError(409, 'Rechargez le bulletin avant de le modifier.');
      const { record, inscription } = await draft(
        { inscriptionId: data.inscriptionId, periodeId: data.periodeId },
        session,
      );
      if (!['brouillon', 'incomplet', 'a_finaliser', 'complet'].includes(record.status))
        throw new HttpError(409, 'Bulletin verrouillé.');
      if (data.data.vieScolaire) {
        record.vieScolaire = { ...record.vieScolaire, ...data.data.vieScolaire };
        record.needsRecalculation = true;
        const scores = (inscription.vieScolaire ?? []).filter(
          (item) => String(item.periodeId) !== data.periodeId,
        );
        scores.push({ periodeId: record.periodeId, score: record.vieScolaire });
        inscription.set('vieScolaire', scores);
        inscription.increment();
        await inscription.save({ session });
      }
      if (data.data.commentaires)
        record.commentaires = { ...record.commentaires, ...data.data.commentaires };
      record.increment();
      return serializeBulletin(await record.save({ session }));
    });
  },
  async update(id: string, input: unknown) {
    bulletinIdSchema.parse(id);
    const record = await Bulletin.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!record) throw new HttpError(404, 'Bulletin introuvable.');
    return bulletinService.save({
      inscriptionId: String(record.inscriptionId),
      periodeId: String(record.periodeId),
      data: input,
    });
  },
  async saveMultiple(items: unknown) {
    return runBatch(items, (item) => bulletinService.save(item));
  },
  async generateMultiple(input: unknown) {
    const data = z
      .object({
        periodeId: bulletinIdSchema,
        bulletinIds: z.array(bulletinIdSchema).min(1).max(100),
        config: bulletinConfigSchema.optional(),
      })
      .strict()
      .parse(input);
    return runBatch(data.bulletinIds, async (id: string) => {
      return withTransaction(async (session) => {
        const record = await Bulletin.findOne({
          _id: id,
          isDeleted: { $ne: true },
          periodeId: data.periodeId,
        }).session(session);
        if (!record)
          throw new HttpError(404, 'Bulletin absent ou hors de la période choisie.');
        if (!['brouillon', 'complet', 'incomplet', 'a_finaliser'].includes(record.status))
          throw new HttpError(409, 'Bulletin verrouillé.');
        const { classe, inscription } = await context(
          { inscriptionId: String(record.inscriptionId), periodeId: data.periodeId },
          session,
        );
        const saved = await ConfigBulletin.findOneAndUpdate(
          { key: 'default' },
          {
            $inc: { revision: 1 },
            $setOnInsert: { config: defaultBulletinConfig, __v: 0 },
          },
          { session, new: true, upsert: true },
        );
        const config = data.config ?? saved?.config ?? defaultBulletinConfig;
        const subjects = await Matiere.find({
          niveauClasseId: classe.niveauClasseId,
          isDeleted: false,
        }).session(session);
        // Verrous communs avec les modifications de références, sans modifier leurs versions métier.
        for (const subject of subjects)
          await Matiere.updateOne(
            { _id: subject._id },
            { $inc: { referenceRevision: 1 } },
            { session },
          );
        const evaluations = await Evaluation.find({ isDeleted: false }).session(session);
        const applicable = evaluations.filter((evaluation) =>
          evaluationAppliesTo(
            {
              periodeId: evaluation.periodeId ? String(evaluation.periodeId) : undefined,
              niveauScolaireId: evaluation.niveauScolaireId
                ? String(evaluation.niveauScolaireId)
                : undefined,
            },
            data.periodeId,
            String(classe.niveauScolaireId),
          ),
        );
        for (const evaluation of applicable)
          await Evaluation.updateOne(
            { _id: evaluation._id },
            { $inc: { referenceRevision: 1 } },
            { session },
          );
        const notes = await Note.find({
          inscriptionId: record.inscriptionId,
          periodeId: record.periodeId,
          isDeleted: false,
        }).session(session);
        const calculated = calculateBulletin({
          config,
          conduite: record.vieScolaire.conduite ?? null,
          matieres: subjects.map((item) => ({
            id: String(item._id),
            nom: item.nom,
            coefficient: item.coefficient,
          })),
          evaluations: applicable.map((item) => ({
            id: String(item._id),
            nom: item.nom,
            abreviation: item.abreviation,
            type: item.type,
            obligatoire: item.obligatoire,
          })),
          notes: notes.map((item) => ({
            matiereId: String(item.matiereId),
            evaluationId: String(item.evaluationId),
            note: item.note,
            notePlafond: item.notePlafond,
            coefficient: item.coefficient,
          })),
        });
        record.set({
          ...calculated,
          configCalcul: config,
          needsRecalculation: false,
          calculatedAt: new Date(),
          anneeScolaire: inscription.anneeScolaire,
        });
        record.increment();
        return serializeBulletin(await record.save({ session }));
      });
    });
  },
  async deleteMany(input: unknown) {
    const ids = z
      .array(bulletinIdSchema)
      .min(1)
      .max(100)
      .refine(
        (items) => new Set(items).size === items.length,
        'Un identifiant apparaît plusieurs fois.',
      )
      .parse(input);
    return withTransaction(async (session) => {
      const records = await Bulletin.find({
        _id: { $in: ids },
        isDeleted: { $ne: true },
      }).session(session);
      if (records.length !== ids.length)
        throw new HttpError(404, 'Au moins un bulletin est introuvable.');
      for (const record of records) {
        if (!['brouillon', 'complet', 'incomplet', 'a_finaliser'].includes(record.status))
          throw new HttpError(409, 'Bulletin verrouillé.');
        await context(
          {
            inscriptionId: String(record.inscriptionId),
            periodeId: String(record.periodeId),
          },
          session,
        );
        record.set({ isDeleted: true, deletedAt: new Date() });
        record.increment();
        await record.save({ session });
      }
      return { deletedCount: records.length, ids };
    });
  },
  delete: (id: string) => bulletinService.deleteMany([id]),
  async restore(id: string, input: unknown) {
    bulletinIdSchema.parse(id);
    const { version } = z
      .object({ version: z.number().int().nonnegative() })
      .strict()
      .parse(input);
    return withTransaction(async (session) => {
      const record = await Bulletin.findOne({ _id: id, isDeleted: true }).session(
        session,
      );
      if (!record) throw new HttpError(404, 'Bulletin archivé introuvable.');
      if (record.__v !== version) throw new HttpError(409, 'Ce bulletin a changé.');
      await context(
        {
          inscriptionId: String(record.inscriptionId),
          periodeId: String(record.periodeId),
        },
        session,
      );
      record.set({ isDeleted: false, deletedAt: undefined, needsRecalculation: true });
      record.increment();
      return serializeBulletin(await record.save({ session }));
    });
  },
  async recalculerRangs(input: unknown) {
    const data = z
      .object({
        classeId: bulletinIdSchema,
        periodeId: bulletinIdSchema,
        anneeScolaire: schoolYearSchema,
      })
      .strict()
      .parse(input);
    const bulletins = await bulletinQueryService.list(data);
    // Les rangs et récapitulatifs sont des projections des résultats courants : jamais de cache périmé.
    return {
      updatedCount: bulletins.filter((item) => item.resultatFinal?.rang).length,
      bulletins,
    };
  },
};
