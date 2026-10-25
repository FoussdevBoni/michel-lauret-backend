import { runBatch } from '../utils/runBatch';
import { deletionService } from './deletionService';
import { isValidObjectId } from 'mongoose';
import { NiveauScolaire, type INiveauScolaire } from '../models/NiveauScolaire';
import {
  niveauScolaireInputSchema,
  niveauScolaireUpdateSchema,
} from '../types/features/NiveauScolaire';

import { HttpError } from '../utils/HttpError';

function serialize(niveau: INiveauScolaire) {
  return {
    id: String(niveau._id),
    nom: niveau.nom,
    notePlafond: niveau.notePlafond ?? 20,
    isDeleted: niveau.isDeleted,
    version: niveau.__v,
    createdAt: niveau.createdAt.toISOString(),
    updatedAt: niveau.updatedAt.toISOString(),
  };
}

export const niveauScolaireService = {
  async getById(id: string) {
    if (!isValidObjectId(id)) throw new HttpError(400, 'Identifiant invalide.');
    const record = await NiveauScolaire.findOne({ _id: id, isDeleted: false });
    if (!record) throw new HttpError(404, 'Élément introuvable.');
    return serialize(record);
  },
  async createMany(items: unknown) {
    return runBatch(items, (item) => niveauScolaireService.create(item));
  },
  async list() {
    const niveaux = await NiveauScolaire.find({ isDeleted: false }).sort({ nom: 1 });
    return niveaux.map(serialize);
  },

  async create(input: unknown) {
    const data = niveauScolaireInputSchema.parse(input);
    return serialize(await NiveauScolaire.create(data));
  },

  async update(id: string, input: unknown) {
    if (!isValidObjectId(id)) {
      throw new HttpError(400, 'Identifiant de niveau scolaire invalide.');
    }

    const { version, ...data } = niveauScolaireUpdateSchema.parse(input);
    const niveau = await NiveauScolaire.findOneAndUpdate(
      { _id: id, isDeleted: false, __v: version },
      { $set: data, $inc: { __v: 1 } },
      { new: true, runValidators: true },
    );

    if (!niveau) {
      const exists = await NiveauScolaire.exists({ _id: id, isDeleted: false });
      throw new HttpError(
        exists ? 409 : 404,
        exists
          ? 'Ce niveau a été modifié ailleurs. Rechargez les données.'
          : 'Niveau scolaire introuvable.',
      );
    }

    return serialize(niveau);
  },
  async delete(id: string) {
    return deletionService.deleteMany('niveauScolaire', [id]);
  },
  async deleteMany(ids: unknown) {
    return deletionService.deleteMany('niveauScolaire', ids);
  },
};
