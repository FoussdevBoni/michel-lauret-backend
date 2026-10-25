import { withTransaction } from '../lib/withTransaction';
import { runBatch } from '../utils/runBatch';
import { deletionService } from './deletionService';
import { isValidObjectId } from 'mongoose';
import { Cycle, type ICycle } from '../models/Cycle';
import { NiveauScolaire } from '../models/NiveauScolaire';
import { cycleInputSchema, cycleUpdateSchema } from '../types/features/Cycle';
import { HttpError } from '../utils/HttpError';

function serialize(cycle: ICycle) {
  return {
    id: String(cycle._id),
    nom: cycle.nom,
    niveauScolaireId: String(cycle.niveauScolaireId),
    isDeleted: cycle.isDeleted,
    version: cycle.__v,
    createdAt: cycle.createdAt.toISOString(),
    updatedAt: cycle.updatedAt.toISOString(),
  };
}

async function requireNiveauScolaire(id: string) {
  const niveau = await NiveauScolaire.exists({ _id: id, isDeleted: false });

  if (!niveau) {
    throw new HttpError(404, 'Niveau scolaire introuvable ou archivé.');
  }
}

export const cycleService = {
  async getById(id: string) {
    if (!isValidObjectId(id)) throw new HttpError(400, 'Identifiant invalide.');
    const record = await Cycle.findOne({ _id: id, isDeleted: false });
    if (!record) throw new HttpError(404, 'Élément introuvable.');
    return serialize(record);
  },
  async getByParent(id: string) {
    if (!isValidObjectId(id)) throw new HttpError(400, 'Identifiant parent invalide.');
    return cycleService.list(id);
  },
  async createMany(items: unknown) {
    return runBatch(items, (item) => cycleService.create(item));
  },
  async list(niveauScolaireId?: string) {
    if (niveauScolaireId && !isValidObjectId(niveauScolaireId)) {
      throw new HttpError(400, 'Identifiant de niveau scolaire invalide.');
    }

    const cycles = await Cycle.find({
      isDeleted: false,
      ...(niveauScolaireId ? { niveauScolaireId } : {}),
    }).sort({ nom: 1 });

    return cycles.map(serialize);
  },

  async create(input: unknown) {
    const data = cycleInputSchema.parse(input);
    return withTransaction(async (session) => {
      const parent = await NiveauScolaire.findOneAndUpdate(
        { _id: data.niveauScolaireId, isDeleted: false },
        { $inc: { referenceRevision: 1 } },
        { new: true, session },
      );
      if (!parent) throw new HttpError(404, 'Niveau scolaire introuvable ou archivé.');
      const [record] = await Cycle.create([data], { session });
      return serialize(record);
    });
  },

  async update(id: string, input: unknown) {
    if (!isValidObjectId(id)) {
      throw new HttpError(400, 'Identifiant de cycle invalide.');
    }

    const { version, ...data } = cycleUpdateSchema.parse(input);
    await requireNiveauScolaire(data.niveauScolaireId);

    // Le rattachement reste fixe pour ne pas déplacer indirectement les classes
    // et leurs historiques. Un transfert nécessitera un traitement métier dédié.
    const existing = await Cycle.findOne({ _id: id, isDeleted: false });

    if (!existing) {
      throw new HttpError(404, 'Cycle introuvable.');
    }

    if (String(existing.niveauScolaireId) !== data.niveauScolaireId) {
      throw new HttpError(
        409,
        "Le niveau scolaire d'un cycle existant ne peut pas être changé.",
      );
    }

    const cycle = await Cycle.findOneAndUpdate(
      {
        _id: id,
        isDeleted: false,
        __v: version,
        niveauScolaireId: data.niveauScolaireId,
      },
      { $set: { nom: data.nom }, $inc: { __v: 1 } },
      { new: true, runValidators: true },
    );

    if (!cycle) {
      throw new HttpError(409, 'Ce cycle a été modifié ailleurs. Rechargez les données.');
    }

    return serialize(cycle);
  },
  async delete(id: string) {
    return deletionService.deleteMany('cycle', [id]);
  },
  async deleteMany(ids: unknown) {
    return deletionService.deleteMany('cycle', ids);
  },
};
