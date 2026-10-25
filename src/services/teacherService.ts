import { withTransaction } from '../lib/withTransaction';
import { NiveauClasse } from '../models/NiveauClasse';
import { Cycle } from '../models/Cycle';
import { NiveauScolaire } from '../models/NiveauScolaire';
import mongoose, { isValidObjectId } from 'mongoose';
import { Enseignant } from '../models/Teacher';
import { Classe } from '../models/Classe';
import { Matiere } from '../models/Matiere';
import { teacherInputSchema, teacherUpdateSchema } from '../types/features/Teacher';
import { serializeTeacher, teacherQueryService } from './teacherQueryService';
import { deletionService } from './deletionService';
import { runBatch } from '../utils/runBatch';
import { HttpError } from '../utils/HttpError';
async function save(input: unknown, id?: string) {
  if (id && !isValidObjectId(id))
    throw new HttpError(400, 'Identifiant enseignant invalide.');
  const parsed = id
    ? teacherUpdateSchema.parse(input)
    : { ...teacherInputSchema.parse(input), version: undefined };
  const { version, ...data } = parsed;
  return withTransaction(async (session) => {
    const existing = id
      ? await Enseignant.findOne({ _id: id, isDeleted: false }).session(session)
      : null;
    if (id && !existing) throw new HttpError(404, 'Enseignant introuvable.');
    if (existing && existing.__v !== version)
      throw new HttpError(409, 'Ce dossier enseignant a été modifié ailleurs.');
    if (
      data.email &&
      (await Enseignant.exists({
        email: data.email,
        ...(id ? { _id: { $ne: id } } : {}),
      }).session(session))
    )
      throw new HttpError(
        409,
        'Cette adresse email est déjà utilisée, y compris dans les archives.',
      );
    for (const assignment of [...data.enseignements].sort((a, b) =>
      (a.classeId + a.matiereId).localeCompare(b.classeId + b.matiereId),
    )) {
      const classe = await Classe.findOneAndUpdate(
        { _id: assignment.classeId, isDeleted: false },
        { $inc: { inscriptionRevision: 1 } },
        { session, new: true },
      );
      const matiere = await Matiere.findOneAndUpdate(
        { _id: assignment.matiereId, isDeleted: false },
        { $inc: { referenceRevision: 1 } },
        { session, new: true },
      );
      if (!classe || !matiere)
        throw new HttpError(409, 'Classe ou matière indisponible.');
      if (
        String(classe.niveauClasseId) !== String(matiere.niveauClasseId) ||
        String(classe.cycleId) !== String(matiere.cycleId) ||
        String(classe.niveauScolaireId) !== String(matiere.niveauScolaireId)
      )
        throw new HttpError(
          409,
          'La matière ne correspond pas au niveau de cette classe.',
        );
      const niveau = await NiveauClasse.exists({
        _id: classe.niveauClasseId,
        cycleId: classe.cycleId,
        niveauScolaireId: classe.niveauScolaireId,
        isDeleted: false,
      }).session(session);
      const cycle = await Cycle.exists({
        _id: classe.cycleId,
        niveauScolaireId: classe.niveauScolaireId,
        isDeleted: false,
      }).session(session);
      const parent = await NiveauScolaire.exists({
        _id: classe.niveauScolaireId,
        isDeleted: false,
      }).session(session);
      if (!niveau || !cycle || !parent)
        throw new HttpError(409, 'Hiérarchie scolaire indisponible ou incohérente.');
      const duplicate = await Enseignant.exists({
        isDeleted: false,
        ...(id ? { _id: { $ne: id } } : {}),
        enseignements: { $elemMatch: assignment },
      }).session(session);
      if (duplicate)
        throw new HttpError(
          409,
          'Cette matière est déjà attribuée à un autre enseignant dans cette classe.',
        );
    }
    if (existing) {
      for (const previous of existing.enseignements) {
        if (
          data.enseignements.some(
            (item) =>
              item.classeId === previous.classeId &&
              item.matiereId === previous.matiereId,
          )
        )
          continue;
        const used = await mongoose.connection.db!.collection('seances').findOne(
          {
            enseignantId: { $in: [existing._id, String(existing._id)] },
            classeId: {
              $in: [new mongoose.Types.ObjectId(previous.classeId), previous.classeId],
            },
            matiereId: {
              $in: [new mongoose.Types.ObjectId(previous.matiereId), previous.matiereId],
            },
            isDeleted: { $ne: true },
          },
          { session },
        );
        const noted = await mongoose.connection.db!.collection('notes').findOne(
          {
            enseignantId: existing._id,
            classeId: new mongoose.Types.ObjectId(previous.classeId),
            matiereId: new mongoose.Types.ObjectId(previous.matiereId),
            isDeleted: { $ne: true },
          },
          { session },
        );
        if (used || noted)
          throw new HttpError(
            409,
            'Une affectation possédant des notes ou des séances ne peut pas être retirée.',
          );
      }
      existing.set(data);
      existing.increment();
      return serializeTeacher(await existing.save({ session }));
    }
    const [record] = await Enseignant.create([data], { session });
    return serializeTeacher(record);
  });
}
export const teacherService = {
  ...teacherQueryService,
  create: (input: unknown) => save(input),
  update: (id: string, input: unknown) => save(input, id),
  createMany: (items: unknown) => runBatch(items, (item) => save(item)),
  delete: (id: string) => deletionService.deleteMany('teacher', [id]),
  deleteMany: (ids: unknown) => deletionService.deleteMany('teacher', ids),
};
