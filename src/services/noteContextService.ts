import mongoose, { type ClientSession } from 'mongoose';
import { Inscription } from '../models/Inscription';
import { Classe } from '../models/Classe';
import { Student } from '../models/Student';
import { Matiere } from '../models/Matiere';
import { Periode } from '../models/Periode';
import { Evaluation } from '../models/Evaluation';
import { Enseignant } from '../models/Teacher';
import { NiveauScolaire } from '../models/NiveauScolaire';
import { NiveauClasse } from '../models/NiveauClasse';
import { Cycle } from '../models/Cycle';
import { evaluationAppliesTo } from '../types/features/Evaluation';
import { matchesSchoolYear } from '../types/features/Periode';
import type { NoteInput } from '../types/features/Note';
import { HttpError } from '../utils/HttpError';
export async function requireNoteContext(input: NoteInput, session: ClientSession) {
  const inscription = await Inscription.findOneAndUpdate(
    { _id: input.inscriptionId, isDeleted: false },
    { $inc: { referenceRevision: 1 } },
    { session, new: true },
  );
  if (!inscription) throw new HttpError(404, 'Inscription introuvable.');
  const classe = await Classe.findOneAndUpdate(
    { _id: inscription.classeId, isDeleted: false },
    { $inc: { inscriptionRevision: 1 } },
    { session, new: true },
  );
  const matiere = await Matiere.findOneAndUpdate(
    { _id: input.matiereId, isDeleted: false },
    { $inc: { referenceRevision: 1 } },
    { session, new: true },
  );
  const periode = await Periode.findOneAndUpdate(
    { _id: input.periodeId, isDeleted: false },
    { $inc: { referenceRevision: 1 } },
    { session, new: true },
  );
  const evaluation = await Evaluation.findOneAndUpdate(
    { _id: input.evaluationId, isDeleted: false },
    { $inc: { referenceRevision: 1 } },
    { session, new: true },
  );
  if (!classe || !matiere || !periode || !evaluation)
    throw new HttpError(409, 'Référence pédagogique indisponible.');
  const parent = await NiveauScolaire.findOne({
    _id: classe.niveauScolaireId,
    isDeleted: false,
  }).session(session);
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
  const student = await Student.exists({
    _id: inscription.eleveDataId,
    isDeleted: false,
  }).session(session);
  if (!parent || !niveau || !cycle || !student)
    throw new HttpError(409, 'Hiérarchie ou dossier élève indisponible.');
  if (
    String(classe.niveauClasseId) !== String(matiere.niveauClasseId) ||
    String(classe.cycleId) !== String(matiere.cycleId) ||
    String(classe.niveauScolaireId) !== String(matiere.niveauScolaireId)
  )
    throw new HttpError(409, 'Matière incompatible avec la classe.');
  if (
    (periode.niveauScolaireId &&
      String(periode.niveauScolaireId) !== String(classe.niveauScolaireId)) ||
    !matchesSchoolYear(periode, inscription.anneeScolaire)
  )
    throw new HttpError(409, 'Période incompatible avec le niveau ou l’année scolaire.');
  if (
    !evaluationAppliesTo(
      {
        periodeId: evaluation.periodeId ? String(evaluation.periodeId) : undefined,
        niveauScolaireId: evaluation.niveauScolaireId
          ? String(evaluation.niveauScolaireId)
          : undefined,
      },
      input.periodeId,
      String(classe.niveauScolaireId),
    )
  )
    throw new HttpError(
      409,
      'Évaluation incompatible avec cette période et cette matière.',
    );
  const teachers = await Enseignant.find({
    isDeleted: false,
    enseignements: {
      $elemMatch: { classeId: String(classe._id), matiereId: input.matiereId },
    },
  }).session(session);
  if (teachers.length !== 1)
    throw new HttpError(
      409,
      'Une affectation unique d’enseignant est nécessaire pour cette classe et cette matière.',
    );
  const teacher = await Enseignant.findOneAndUpdate(
    { _id: teachers[0]._id, isDeleted: false },
    { $inc: { referenceRevision: 1 } },
    { session, new: true },
  );
  if (!teacher) throw new HttpError(409, 'Enseignant indisponible.');
  return {
    inscriptionId: inscription._id as mongoose.Types.ObjectId,
    classeId: classe._id as mongoose.Types.ObjectId,
    matiereId: matiere._id as mongoose.Types.ObjectId,
    periodeId: periode._id as mongoose.Types.ObjectId,
    evaluationId: evaluation._id as mongoose.Types.ObjectId,
    enseignantId: teacher._id as mongoose.Types.ObjectId,
    anneeScolaire: inscription.anneeScolaire,
    notePlafond: input.notePlafond ?? parent.notePlafond,
    coefficient: input.coefficient ?? evaluation.coefficient,
  };
}
