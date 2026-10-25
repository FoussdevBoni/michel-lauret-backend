import { withTransaction } from '../lib/withTransaction';
import mongoose, { isValidObjectId, type ClientSession } from 'mongoose';
import { z } from 'zod';
import { Inscription, type IInscription } from '../models/Inscription';
import { Student } from '../models/Student';
import { Classe } from '../models/Classe';
import { NiveauClasse } from '../models/NiveauClasse';
import { Cycle } from '../models/Cycle';
import { NiveauScolaire } from '../models/NiveauScolaire';
import {
  inscriptionInputSchema,
  inscriptionUpdateSchema,
} from '../types/features/Inscription';
import { HttpError } from '../utils/HttpError';
import { deletionService } from './deletionService';

export function serializeInscription(record: IInscription) {
  return {
    id: String(record._id),
    eleveDataId: String(record.eleveDataId),
    classeId: String(record.classeId),
    anneeScolaire: record.anneeScolaire,
    dateInscription: record.dateInscription.toISOString().slice(0, 10),
    dateInscriptionOrigine: record.dateInscriptionOrigine ?? 'saisie',
    statutScolaire: record.statutScolaire,
    isActive: record.isActive,
    isDeleted: record.isDeleted,
    vieScolaire: (record.vieScolaire ?? []).map((entry) => ({
      periodeId: String(entry.periodeId),
      score: entry.score,
    })),
    version: record.__v,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function saveInscription(
  input: unknown,
  id?: string,
  providedSession?: ClientSession,
) {
  if (id && !isValidObjectId(id))
    throw new HttpError(400, 'Identifiant inscription invalide.');
  const parsed = id
    ? inscriptionUpdateSchema.parse(input)
    : { ...inscriptionInputSchema.parse(input), version: undefined };
  const { version, ...data } = parsed;
  if (mongoose.connection.readyState !== 1)
    throw new HttpError(503, 'La base de données est indisponible.');

  const execute = async (session: ClientSession) => {
    // Ces écritures internes sérialisent les inscriptions concurrentes d'un élève
    // et entrent en conflit avec la suppression simultanée de son dossier/classe.
    const student = await Student.findOneAndUpdate(
      {
        _id: data.eleveDataId,
        isDeleted: false,
        ...(data.isActive ? { statut: 'actif' } : {}),
      },
      { $inc: { inscriptionRevision: 1 } },
      { new: true, session },
    );
    if (!student) throw new HttpError(409, 'Dossier élève indisponible ou inactif.');
    if (
      student.dateNaissance &&
      data.dateInscription < student.dateNaissance.toISOString().slice(0, 10)
    )
      throw new HttpError(400, 'L’inscription ne peut pas précéder la naissance.');

    const classe = await Classe.findOneAndUpdate(
      { _id: data.classeId, isDeleted: false },
      { $inc: { inscriptionRevision: 1 } },
      { new: true, session },
    );
    if (!classe) throw new HttpError(404, 'Classe introuvable ou supprimée.');
    const niveau = await NiveauClasse.findOne({
      _id: classe.niveauClasseId,
      isDeleted: false,
    }).session(session);
    const cycle = await Cycle.findOne({ _id: classe.cycleId, isDeleted: false }).session(
      session,
    );
    const parent = await NiveauScolaire.exists({
      _id: classe.niveauScolaireId,
      isDeleted: false,
    }).session(session);
    if (
      !niveau ||
      !cycle ||
      !parent ||
      String(niveau.cycleId) !== String(classe.cycleId) ||
      String(niveau.niveauScolaireId) !== String(classe.niveauScolaireId) ||
      String(cycle.niveauScolaireId) !== String(classe.niveauScolaireId)
    ) {
      throw new HttpError(
        409,
        'La hiérarchie de cette classe est indisponible ou incohérente.',
      );
    }

    const existing = id
      ? await Inscription.findOne({ _id: id, isDeleted: false }).session(session)
      : undefined;
    if (id && !existing) throw new HttpError(404, 'Inscription introuvable.');
    if (
      existing &&
      (String(existing.eleveDataId) !== data.eleveDataId ||
        String(existing.classeId) !== data.classeId ||
        existing.anneeScolaire !== data.anneeScolaire)
    ) {
      throw new HttpError(
        409,
        'L’élève, la classe et l’année sont fixes. Créez une nouvelle inscription.',
      );
    }
    if (existing && existing.__v !== version)
      throw new HttpError(409, 'Cette inscription a été modifiée ailleurs.');

    const duplicate = await Inscription.exists({
      eleveDataId: data.eleveDataId,
      classeId: data.classeId,
      anneeScolaire: data.anneeScolaire,
      isDeleted: false,
      ...(id ? { _id: { $ne: id } } : {}),
    }).session(session);
    if (duplicate)
      throw new HttpError(
        409,
        'Cet élève est déjà inscrit dans cette classe pour cette année.',
      );

    if (data.isActive) {
      const newer = await Inscription.exists({
        eleveDataId: data.eleveDataId,
        isDeleted: false,
        isActive: true,
        anneeScolaire: { $gt: data.anneeScolaire },
        ...(id ? { _id: { $ne: id } } : {}),
      }).session(session);
      if (newer)
        throw new HttpError(
          409,
          'Une inscription plus récente est active. Enregistrez l’historique comme inactif.',
        );
      await Inscription.updateMany(
        {
          eleveDataId: data.eleveDataId,
          isDeleted: false,
          isActive: true,
          ...(id ? { _id: { $ne: id } } : {}),
        },
        { $set: { isActive: false }, $inc: { __v: 1 } },
        { session },
      );
    }

    if (existing) {
      if (existing.dateInscription.toISOString().slice(0, 10) !== data.dateInscription)
        existing.dateInscriptionOrigine = 'saisie';
      existing.set(data);
      existing.increment();
      return serializeInscription(await existing.save({ session }));
    }
    const [created] = await Inscription.create([data], { session });
    return serializeInscription(created);
  };
  return providedSession ? execute(providedSession) : withTransaction(execute);
}

export const inscriptionService = {
  async getById(id: string) {
    if (!isValidObjectId(id)) throw new HttpError(400, 'Identifiant invalide.');
    const record = await Inscription.findOne({ _id: id, isDeleted: false });
    if (!record) throw new HttpError(404, 'Inscription introuvable.');
    return serializeInscription(record);
  },
  async list(input: unknown) {
    const filters = z
      .object({
        anneeScolaire: z
          .string()
          .regex(/^\d{4}-\d{4}$/)
          .optional(),
        classeId: z
          .string()
          .regex(/^[a-f0-9]{24}$/i)
          .optional(),
      })
      .parse(input);
    return (
      await Inscription.find({ ...filters, isDeleted: false }).sort({
        anneeScolaire: -1,
        createdAt: -1,
      })
    ).map(serializeInscription);
  },
  async create(input: unknown) {
    return saveInscription(input);
  },
  async update(id: string, input: unknown) {
    return saveInscription(input, id);
  },
  async delete(id: string) {
    return deletionService.deleteMany('inscription', [id]);
  },
  async deleteMany(ids: unknown) {
    return deletionService.deleteMany('inscription', ids);
  },
};
