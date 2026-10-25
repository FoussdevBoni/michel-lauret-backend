import { withTransaction } from '../lib/withTransaction';
import { runBatch } from '../utils/runBatch';
import { deletionService } from './deletionService';
import { isValidObjectId, type ClientSession } from 'mongoose';
import { Classe, type IClasse } from '../models/Classe';
import { NiveauClasse } from '../models/NiveauClasse';
import { Cycle } from '../models/Cycle';
import { NiveauScolaire } from '../models/NiveauScolaire';
import { classeInputSchema, classeUpdateSchema } from '../types/features/Classe';
import { HttpError } from '../utils/HttpError';
import { Inscription } from '../models/Inscription';
import { Student } from '../models/Student';

export function serializeClasse(classe: IClasse) {
  return {
    id: String(classe._id),
    nom: classe.nom,
    niveauClasseId: String(classe.niveauClasseId),
    cycleId: String(classe.cycleId),
    niveauScolaireId: String(classe.niveauScolaireId),
    effectifF: classe.effectifF ?? 0,
    effectifM: classe.effectifM ?? 0,
    effectifTotal: (classe.effectifF ?? 0) + (classe.effectifM ?? 0),
    isDeleted: classe.isDeleted,
    version: classe.__v,
    createdAt: classe.createdAt.toISOString(),
    updatedAt: classe.updatedAt.toISOString(),
  };
}

async function requireNiveauClasse(id: string, session?: ClientSession) {
  const niveau = session
    ? await NiveauClasse.findOneAndUpdate(
        { _id: id, isDeleted: false },
        { $inc: { referenceRevision: 1 } },
        { new: true, session },
      )
    : await NiveauClasse.findOne({ _id: id, isDeleted: false });

  if (!niveau) {
    throw new HttpError(404, 'Niveau de classe introuvable ou archivé.');
  }

  const cycle = await Cycle.findOne({ _id: niveau.cycleId, isDeleted: false });

  if (!cycle || String(cycle.niveauScolaireId) !== String(niveau.niveauScolaireId)) {
    throw new HttpError(
      409,
      'La hiérarchie du niveau de classe est indisponible ou incohérente.',
    );
  }

  const parent = await NiveauScolaire.exists({
    _id: cycle.niveauScolaireId,
    isDeleted: false,
  });

  if (!parent) {
    throw new HttpError(409, 'Le niveau scolaire est introuvable ou archivé.');
  }

  return { cycleId: cycle._id, niveauScolaireId: cycle.niveauScolaireId };
}

export const classeService = {
  async getById(id: string) {
    if (!isValidObjectId(id)) throw new HttpError(400, 'Identifiant invalide.');
    const record = await Classe.findOne({ _id: id, isDeleted: false });
    if (!record) throw new HttpError(404, 'Élément introuvable.');
    return serializeClasse(record);
  },
  async getByParent(id: string) {
    if (!isValidObjectId(id)) throw new HttpError(400, 'Identifiant parent invalide.');
    return classeService.list(id);
  },
  async createMany(items: unknown) {
    return runBatch(items, (item) => classeService.create(item));
  },
  async list(niveauClasseId?: string) {
    if (niveauClasseId && !isValidObjectId(niveauClasseId)) {
      throw new HttpError(400, 'Identifiant de niveau de classe invalide.');
    }

    const classes = await Classe.find({
      isDeleted: false,
      ...(niveauClasseId ? { niveauClasseId } : {}),
    }).sort({ nom: 1 });

    const records = await Inscription.find({
      classeId: { $in: classes.map((classe) => classe._id) },
      isDeleted: false,
      isActive: true,
    })
      .select('classeId eleveDataId')
      .lean();
    const students = await Student.find({
      _id: { $in: records.map((record) => record.eleveDataId) },
    })
      .select('sexe')
      .lean();
    const sexes = new Map(students.map((student) => [String(student._id), student.sexe]));
    const counts = new Map<string, { filles: number; garcons: number; total: number }>();
    for (const record of records) {
      const key = String(record.classeId);
      const count = counts.get(key) ?? { filles: 0, garcons: 0, total: 0 };
      count.total += 1;
      if (sexes.get(String(record.eleveDataId)) === 'F') count.filles += 1;
      if (sexes.get(String(record.eleveDataId)) === 'M') count.garcons += 1;
      counts.set(key, count);
    }
    return classes.map((classe) => ({
      ...serializeClasse(classe),
      effectifFInscrits: counts.get(String(classe._id))?.filles ?? 0,
      effectifMInscrits: counts.get(String(classe._id))?.garcons ?? 0,
      effectifTotalInscrits: counts.get(String(classe._id))?.total ?? 0,
    }));
  },

  async create(input: unknown) {
    const data = classeInputSchema.parse(input);
    return withTransaction(async (session) => {
      const parents = await requireNiveauClasse(data.niveauClasseId, session);
      const [record] = await Classe.create([{ ...data, ...parents }], { session });
      return serializeClasse(record);
    });
  },

  async update(id: string, input: unknown) {
    if (!isValidObjectId(id)) {
      throw new HttpError(400, 'Identifiant de classe invalide.');
    }

    const { version, ...data } = classeUpdateSchema.parse(input);
    await requireNiveauClasse(data.niveauClasseId);
    const existing = await Classe.findOne({ _id: id, isDeleted: false });

    if (!existing) {
      throw new HttpError(404, 'Classe introuvable.');
    }

    if (String(existing.niveauClasseId) !== data.niveauClasseId) {
      throw new HttpError(
        409,
        "Le niveau d'une classe existante ne peut pas être changé.",
      );
    }

    const classe = await Classe.findOneAndUpdate(
      { _id: id, isDeleted: false, __v: version, niveauClasseId: data.niveauClasseId },
      {
        $set: { nom: data.nom, effectifF: data.effectifF, effectifM: data.effectifM },
        $inc: { __v: 1 },
      },
      { new: true, runValidators: true },
    );

    if (!classe) {
      throw new HttpError(
        409,
        'Cette classe a été modifiée ailleurs. Rechargez les données.',
      );
    }

    return serializeClasse(classe);
  },
  async delete(id: string) {
    return deletionService.deleteMany('classe', [id]);
  },
  async deleteMany(ids: unknown) {
    return deletionService.deleteMany('classe', ids);
  },
};
