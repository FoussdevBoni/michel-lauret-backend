import { withTransaction } from '../lib/withTransaction';
import mongoose, { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { Periode, type IPeriode } from '../models/Periode';
import { NiveauScolaire } from '../models/NiveauScolaire';
import {
  periodeInputSchema,
  periodeUpdateSchema,
  schoolYearSchema,
  matchesSchoolYear,
} from '../types/features/Periode';
import { HttpError } from '../utils/HttpError';
import { runBatch } from '../utils/runBatch';
import { deletionService } from './deletionService';
export function serializePeriode(record: IPeriode) {
  return {
    id: String(record._id),
    nom: record.nom,
    ordre: record.ordre,
    coefficient: record.coefficient,
    niveauScolaireId: record.niveauScolaireId
      ? String(record.niveauScolaireId)
      : undefined,
    dateDebut: record.dateDebut,
    dateFin: record.dateFin,
    version: record.__v,
    isDeleted: record.isDeleted,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
function validId(id: string) {
  if (!isValidObjectId(id)) throw new HttpError(400, 'Identifiant de période invalide.');
}
async function save(input: unknown, id?: string) {
  if (id) validId(id);
  const parsed = id
    ? periodeUpdateSchema.parse(input)
    : { ...periodeInputSchema.parse(input), version: undefined };
  const { version, ...data } = parsed;
  return withTransaction(async (session) => {
    if (data.niveauScolaireId) {
      const parent = await NiveauScolaire.findOneAndUpdate(
        { _id: data.niveauScolaireId, isDeleted: false },
        { $inc: { referenceRevision: 1 } },
        { session },
      );
      if (!parent) throw new HttpError(404, 'Niveau scolaire introuvable.');
    }
    const existing = id
      ? await Periode.findOne({ _id: id, isDeleted: false }).session(session)
      : null;
    if (id && !existing) throw new HttpError(404, 'Période introuvable.');
    if (existing && existing.__v !== version)
      throw new HttpError(409, 'Cette période a été modifiée ailleurs.');
    if (
      existing &&
      (existing.niveauScolaireId ? String(existing.niveauScolaireId) : undefined) !==
        data.niveauScolaireId
    )
      throw new HttpError(409, 'Le rattachement de la période ne peut pas être changé.');
    if (existing) {
      const db = mongoose.connection.db!;
      const used =
        (await db
          .collection('bulletins')
          .findOne({ periodeId: existing._id, isDeleted: { $ne: true } }, { session })) ||
        (await db
          .collection('evaluations')
          .findOne({ periodeId: existing._id, isDeleted: { $ne: true } }, { session })) ||
        (await db
          .collection('inscriptions')
          .findOne(
            { 'vieScolaire.periodeId': existing._id, isDeleted: { $ne: true } },
            { session },
          ));
      if (
        used &&
        (existing.ordre !== data.ordre ||
          existing.coefficient !== data.coefficient ||
          existing.dateDebut !== data.dateDebut ||
          existing.dateFin !== data.dateFin)
      )
        throw new HttpError(
          409,
          'Une période utilisée conserve son ordre, son coefficient et ses dates.',
        );
    }
    const duplicate = await Periode.exists({
      niveauScolaireId: data.niveauScolaireId ?? null,
      ordre: data.ordre,
      ...(id ? { _id: { $ne: id } } : {}),
    }).session(session);
    if (duplicate)
      throw new HttpError(409, 'Une période possède déjà cet ordre pour ce niveau.');
    if (existing) {
      existing.set({ ...data, dateDebut: data.dateDebut, dateFin: data.dateFin });
      existing.increment();
      return serializePeriode(await existing.save({ session }));
    }
    const [record] = await Periode.create(
      [{ ...data, niveauScolaireId: data.niveauScolaireId ?? null }],
      { session },
    );
    return serializePeriode(record);
  });
}
export const periodeService = {
  async list(input: unknown = {}) {
    const filters = z
      .object({
        niveauScolaireId: z
          .string()
          .regex(/^[a-f0-9]{24}$/i)
          .optional(),
        anneeScolaire: schoolYearSchema.optional(),
      })
      .strict()
      .parse(input);
    const records = await Periode.find({
      isDeleted: false,
      ...(filters.niveauScolaireId
        ? {
            $or: [
              { niveauScolaireId: filters.niveauScolaireId },
              { niveauScolaireId: null },
            ],
          }
        : {}),
    }).sort({ ordre: 1, nom: 1 });
    const niveaux = await NiveauScolaire.find({ isDeleted: false });
    const names = new Map(niveaux.map((niveau) => [String(niveau._id), niveau.nom]));
    return records
      .map(serializePeriode)
      .filter(
        (record) =>
          !filters.anneeScolaire || matchesSchoolYear(record, filters.anneeScolaire),
      )
      .map((record) => ({
        ...record,
        niveauScolaire: record.niveauScolaireId
          ? (names.get(record.niveauScolaireId) ?? 'Niveau indisponible')
          : 'Tous les niveaux',
      }));
  },
  async getById(id: string) {
    validId(id);
    const record = await Periode.findOne({ _id: id, isDeleted: false });
    if (!record) throw new HttpError(404, 'Période introuvable.');
    return serializePeriode(record);
  },
  async getByNiveauScolaire(id: string) {
    validId(id);
    return periodeService.list({ niveauScolaireId: id });
  },
  async getByAnneeScolaire(year: string) {
    return periodeService.list({ anneeScolaire: year });
  },
  create: (input: unknown) => save(input),
  update: (id: string, input: unknown) => save(input, id),
  createMany: (items: unknown) => runBatch(items, (item) => save(item)),
  delete: (id: string) => deletionService.deleteMany('periode', [id]),
  deleteMany: (ids: unknown) => deletionService.deleteMany('periode', ids),
};
