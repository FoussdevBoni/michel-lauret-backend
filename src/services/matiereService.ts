import { withTransaction } from '../lib/withTransaction';
import mongoose, { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { Matiere, type IMatiere } from '../models/Matiere';
import { NiveauClasse } from '../models/NiveauClasse';
import { Cycle } from '../models/Cycle';
import { NiveauScolaire } from '../models/NiveauScolaire';
import {
  matiereInputSchema,
  matiereUpdateSchema,
  normalizeMatiereName,
} from '../types/features/Matiere';
import { HttpError } from '../utils/HttpError';
import { runBatch } from '../utils/runBatch';
import { deletionService } from './deletionService';
import { hasMatiereDependencies } from './matiereDependencyService';
function validId(id: string) {
  if (!isValidObjectId(id)) throw new HttpError(400, 'Identifiant de matière invalide.');
}
export function serializeMatiere(record: IMatiere) {
  return {
    id: String(record._id),
    nom: record.nom,
    coefficient: record.coefficient,
    niveauClasseId: String(record.niveauClasseId),
    cycleId: String(record.cycleId),
    niveauScolaireId: String(record.niveauScolaireId),
    version: record.__v,
    isDeleted: record.isDeleted,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
async function enrich(records: IMatiere[]) {
  const niveaux = await NiveauClasse.find({
    _id: { $in: records.map((item) => item.niveauClasseId) },
  });
  const cycles = await Cycle.find({ _id: { $in: records.map((item) => item.cycleId) } });
  const parents = await NiveauScolaire.find({
    _id: { $in: records.map((item) => item.niveauScolaireId) },
  });
  const names = (items: { _id: unknown; nom: string }[]) =>
    new Map(items.map((item) => [String(item._id), item.nom]));
  const n = names(niveaux),
    c = names(cycles),
    p = names(parents);
  return records.map((record) => ({
    ...serializeMatiere(record),
    niveauClasse: n.get(String(record.niveauClasseId)) ?? 'Niveau indisponible',
    cycle: c.get(String(record.cycleId)) ?? 'Cycle indisponible',
    niveauScolaire: p.get(String(record.niveauScolaireId)) ?? 'Niveau indisponible',
  }));
}
async function save(input: unknown, id?: string) {
  if (id) validId(id);
  const parsed = id
    ? matiereUpdateSchema.parse(input)
    : { ...matiereInputSchema.parse(input), version: undefined };
  const { version, ...data } = parsed;
  return withTransaction(async (session) => {
    const niveau = await NiveauClasse.findOneAndUpdate(
      { _id: data.niveauClasseId, isDeleted: false },
      { $inc: { referenceRevision: 1 } },
      { session, new: true },
    );
    if (!niveau) throw new HttpError(404, 'Niveau de classe introuvable.');
    const cycle = await Cycle.findOneAndUpdate(
      { _id: niveau.cycleId, isDeleted: false },
      { $inc: { referenceRevision: 1 } },
      { session, new: true },
    );
    const parent = await NiveauScolaire.findOneAndUpdate(
      { _id: niveau.niveauScolaireId, isDeleted: false },
      { $inc: { referenceRevision: 1 } },
      { session, new: true },
    );
    if (
      !cycle ||
      !parent ||
      String(cycle.niveauScolaireId) !== String(niveau.niveauScolaireId)
    )
      throw new HttpError(409, 'Hiérarchie scolaire indisponible ou incohérente.');
    const existing = id
      ? await Matiere.findOne({ _id: id, isDeleted: false }).session(session)
      : undefined;
    if (id && !existing) throw new HttpError(404, 'Matière introuvable.');
    if (existing && existing.__v !== version)
      throw new HttpError(409, 'Cette matière a été modifiée ailleurs.');
    if (existing && String(existing.niveauClasseId) !== data.niveauClasseId)
      throw new HttpError(
        409,
        'Le niveau de classe de la matière ne peut pas être changé.',
      );
    if (
      existing &&
      existing.coefficient !== data.coefficient &&
      (await hasMatiereDependencies(existing._id as mongoose.Types.ObjectId, session))
    )
      throw new HttpError(
        409,
        'Une matière utilisée conserve son coefficient pour préserver les résultats.',
      );
    // Vérifie aussi les anciens documents ne possédant pas encore nomNormalise.
    const siblings = await Matiere.find({
      niveauClasseId: data.niveauClasseId,
      ...(id ? { _id: { $ne: id } } : {}),
    })
      .select('nom')
      .session(session);
    if (
      siblings.some(
        (item) => normalizeMatiereName(item.nom) === normalizeMatiereName(data.nom),
      )
    )
      throw new HttpError(
        409,
        'Une matière porte déjà ce nom dans ce niveau, y compris dans les archives.',
      );
    const values = {
      ...data,
      nomNormalise: normalizeMatiereName(data.nom),
      cycleId: niveau.cycleId,
      niveauScolaireId: niveau.niveauScolaireId,
    };
    if (existing) {
      existing.set(values);
      existing.increment();
      return serializeMatiere(await existing.save({ session }));
    }
    const [record] = await Matiere.create([values], { session });
    return serializeMatiere(record);
  });
}
export const matiereService = {
  async list(input: unknown = {}) {
    const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
    const filters = z
      .object({
        niveauClasseId: objectId.optional(),
        cycleId: objectId.optional(),
        niveauScolaireId: objectId.optional(),
        recherche: z.string().trim().max(100).optional(),
      })
      .strict()
      .parse(input);
    const { recherche, ...where } = filters;
    const records = await enrich(
      await Matiere.find({ ...where, isDeleted: false }).sort({ nom: 1 }),
    );
    const normalize = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    return recherche
      ? records.filter((item) =>
          normalize(item.nom + ' ' + item.niveauClasse).includes(normalize(recherche)),
        )
      : records;
  },
  async getById(id: string) {
    validId(id);
    const record = await Matiere.findOne({ _id: id, isDeleted: false });
    if (!record) throw new HttpError(404, 'Matière introuvable.');
    return (await enrich([record]))[0];
  },
  async getByNiveauClasse(id: string) {
    validId(id);
    return matiereService.list({ niveauClasseId: id });
  },
  create: (input: unknown) => save(input),
  createMany: (items: unknown) => runBatch(items, (item) => save(item)),
  update: (id: string, input: unknown) => save(input, id),
  delete: (id: string) => deletionService.deleteMany('matiere', [id]),
  deleteMany: (ids: unknown) => deletionService.deleteMany('matiere', ids),
};
