import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { Note, type INote } from '../models/Note';
import { Inscription } from '../models/Inscription';
import { Student } from '../models/Student';
import { Matiere } from '../models/Matiere';
import { Periode } from '../models/Periode';
import { Evaluation } from '../models/Evaluation';
import { Classe } from '../models/Classe';
import { Enseignant } from '../models/Teacher';
import { HttpError } from '../utils/HttpError';
import { schoolYearSchema } from '../types/features/Periode';
export function serializeNote(record: INote) {
  return {
    id: String(record._id),
    inscriptionId: String(record.inscriptionId),
    matiereId: String(record.matiereId),
    periodeId: String(record.periodeId),
    evaluationId: String(record.evaluationId),
    classeId: String(record.classeId),
    enseignantId: String(record.enseignantId),
    anneeScolaire: record.anneeScolaire,
    note: record.note,
    notePlafond: record.notePlafond,
    coefficient: record.coefficient,
    closed: record.closed,
    ...(record.migrationSourceHash
      ? { migrationSourceHash: record.migrationSourceHash }
      : {}),
    closedAt: record.closedAt?.toISOString(),
    version: record.__v,
    isDeleted: record.isDeleted,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
async function enrich(records: INote[]) {
  const inscriptions = await Inscription.find({
    _id: { $in: records.map((item) => item.inscriptionId) },
  });
  const students = await Student.find({
    _id: { $in: inscriptions.map((item) => item.eleveDataId) },
  });
  const matieres = await Matiere.find({
    _id: { $in: records.map((item) => item.matiereId) },
  });
  const periodes = await Periode.find({
    _id: { $in: records.map((item) => item.periodeId) },
  });
  const evaluations = await Evaluation.find({
    _id: { $in: records.map((item) => item.evaluationId) },
  });
  const classes = await Classe.find({
    _id: { $in: records.map((item) => item.classeId) },
  });
  const teachers = await Enseignant.find({
    _id: { $in: records.map((item) => item.enseignantId) },
  });
  const byId = <T extends { _id: unknown }>(items: T[]) =>
    new Map(items.map((item) => [String(item._id), item]));
  const ins = byId(inscriptions),
    s = byId(students),
    m = byId(matieres),
    p = byId(periodes),
    e = byId(evaluations),
    c = byId(classes),
    t = byId(teachers);
  return records.map((record) => {
    const student = s.get(String(ins.get(String(record.inscriptionId))?.eleveDataId)),
      teacher = t.get(String(record.enseignantId));
    return {
      ...serializeNote(record),
      eleve: student ? student.prenom + ' ' + student.nom : 'Élève indisponible',
      matricule: student?.matricule ?? '',
      matiere: m.get(String(record.matiereId))?.nom ?? 'Matière indisponible',
      periode: p.get(String(record.periodeId))?.nom ?? 'Période indisponible',
      evaluation: e.get(String(record.evaluationId))?.nom ?? 'Évaluation indisponible',
      classe: c.get(String(record.classeId))?.nom ?? 'Classe indisponible',
      enseignant: teacher
        ? teacher.prenom + ' ' + teacher.nom
        : 'Enseignant indisponible',
    };
  });
}
export const noteQueryService = {
  async list(input: unknown = {}) {
    const id = z
      .string()
      .regex(/^[a-f0-9]{24}$/i)
      .transform((value) => value.toLowerCase());
    const filters = z
      .object({
        inscriptionId: id.optional(),
        matiereId: id.optional(),
        periodeId: id.optional(),
        evaluationId: id.optional(),
        classeId: id.optional(),
        eleveDataId: id.optional(),
        anneeScolaire: schoolYearSchema.optional(),
        closed: z
          .enum(['true', 'false'])
          .transform((value) => value === 'true')
          .optional(),
        recherche: z.string().trim().max(100).optional(),
      })
      .strict()
      .parse(input);
    const { eleveDataId, recherche, ...where } = filters;
    const inscriptionIds = eleveDataId
      ? (await Inscription.find({ eleveDataId, isDeleted: false }).select('_id')).map(
          (item) => item._id,
        )
      : undefined;
    const records = await enrich(
      await Note.find({
        ...where,
        isDeleted: false,
        ...(inscriptionIds ? { $and: [{ inscriptionId: { $in: inscriptionIds } }] } : {}),
      }).sort({ createdAt: -1 }),
    );
    const normalize = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    return recherche
      ? records.filter((item) =>
          normalize(item.eleve + ' ' + item.matricule + ' ' + item.evaluation).includes(
            normalize(recherche),
          ),
        )
      : records;
  },
  async getById(id: string) {
    if (!isValidObjectId(id)) throw new HttpError(400, 'Identifiant note invalide.');
    const record = await Note.findOne({ _id: id, isDeleted: false });
    if (!record) throw new HttpError(404, 'Note introuvable.');
    return (await enrich([record]))[0];
  },
  getByInscription: (id: string) => noteQueryService.list({ inscriptionId: id }),
  getByMatiere: (id: string) => noteQueryService.list({ matiereId: id }),
  getByPeriode: (id: string) => noteQueryService.list({ periodeId: id }),
  getByClasse: (id: string) => noteQueryService.list({ classeId: id }),
  getByEleve: (id: string) => noteQueryService.list({ eleveDataId: id }),
};
