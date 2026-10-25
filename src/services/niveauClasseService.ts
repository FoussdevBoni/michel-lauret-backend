import { withTransaction } from '../lib/withTransaction';
import { runBatch } from '../utils/runBatch';
import { deletionService } from './deletionService';
import { isValidObjectId, type ClientSession } from 'mongoose';
import { NiveauClasse, type INiveauClasse } from '../models/NiveauClasse';
import { Cycle } from '../models/Cycle';
import { NiveauScolaire } from '../models/NiveauScolaire';
import {
  niveauClasseInputSchema,
  niveauClasseUpdateSchema,
} from '../types/features/NiveauClasse';
import { HttpError } from '../utils/HttpError';

function serialize(niveau: INiveauClasse) {
  return {
    id: String(niveau._id),
    nom: niveau.nom,
    cycleId: String(niveau.cycleId),
    niveauScolaireId: String(niveau.niveauScolaireId),
    isDeleted: niveau.isDeleted,
    version: niveau.__v,
    createdAt: niveau.createdAt.toISOString(),
    updatedAt: niveau.updatedAt.toISOString(),
  };
}

export async function requireCycle(id: string, session?: ClientSession) {
  const cycle = session
    ? await Cycle.findOneAndUpdate(
        { _id: id, isDeleted: false },
        { $inc: { referenceRevision: 1 } },
        { new: true, session },
      )
    : await Cycle.findOne({ _id: id, isDeleted: false });

  if (!cycle) {
    throw new HttpError(404, 'Cycle introuvable ou archivé.');
  }

  const filter = { _id: cycle.niveauScolaireId, isDeleted: false };
  const niveau = session
    ? await NiveauScolaire.findOneAndUpdate(
        filter,
        { $inc: { referenceRevision: 1 } },
        { new: true, session },
      )
    : await NiveauScolaire.exists(filter);

  if (!niveau) {
    throw new HttpError(
      409,
      'Le niveau scolaire de ce cycle est introuvable ou archivé.',
    );
  }

  return cycle;
}

export const niveauClasseService = {
  async getById(id: string) {
    if (!isValidObjectId(id)) throw new HttpError(400, 'Identifiant invalide.');
    const record = await NiveauClasse.findOne({ _id: id, isDeleted: false });
    if (!record) throw new HttpError(404, 'Élément introuvable.');
    return serialize(record);
  },
  async getByParent(id: string) {
    if (!isValidObjectId(id)) throw new HttpError(400, 'Identifiant parent invalide.');
    return niveauClasseService.list(id);
  },
  async createMany(items: unknown) {
    return runBatch(items, (item) => niveauClasseService.create(item));
  },
  async list(cycleId?: string) {
    if (cycleId && !isValidObjectId(cycleId)) {
      throw new HttpError(400, 'Identifiant de cycle invalide.');
    }

    const niveaux = await NiveauClasse.find({
      isDeleted: false,
      ...(cycleId ? { cycleId } : {}),
    }).sort({ nom: 1 });

    return niveaux.map(serialize);
  },

  async create(input: unknown) {
    const data = niveauClasseInputSchema.parse(input);
    return withTransaction(async (session) => {
      const cycle = await requireCycle(data.cycleId, session);
      // Le niveau scolaire est déduit du cycle dans la même transaction.
      const [niveau] = await NiveauClasse.create(
        [
          {
            ...data,
            niveauScolaireId: cycle.niveauScolaireId,
          },
        ],
        { session },
      );
      return serialize(niveau);
    });
  },

  async update(id: string, input: unknown) {
    if (!isValidObjectId(id)) {
      throw new HttpError(400, 'Identifiant de niveau de classe invalide.');
    }

    const { version, ...data } = niveauClasseUpdateSchema.parse(input);
    await requireCycle(data.cycleId);
    const existing = await NiveauClasse.findOne({ _id: id, isDeleted: false });

    if (!existing) {
      throw new HttpError(404, 'Niveau de classe introuvable.');
    }

    // Un transfert doit traiter les classes, matières et inscriptions explicitement.
    if (String(existing.cycleId) !== data.cycleId) {
      throw new HttpError(
        409,
        "Le cycle d'un niveau de classe existant ne peut pas être changé.",
      );
    }

    const niveau = await NiveauClasse.findOneAndUpdate(
      { _id: id, isDeleted: false, __v: version, cycleId: data.cycleId },
      { $set: { nom: data.nom }, $inc: { __v: 1 } },
      { new: true, runValidators: true },
    );

    if (!niveau) {
      throw new HttpError(
        409,
        'Ce niveau de classe a été modifié ailleurs. Rechargez les données.',
      );
    }

    return serialize(niveau);
  },
  async delete(id: string) {
    return deletionService.deleteMany('niveauClasse', [id]);
  },
  async deleteMany(ids: unknown) {
    return deletionService.deleteMany('niveauClasse', ids);
  },
};
