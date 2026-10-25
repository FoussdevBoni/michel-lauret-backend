import { z } from 'zod';
import { Bulletin, type IBulletin } from '../models/Bulletin';
import { Inscription } from '../models/Inscription';
import { Classe } from '../models/Classe';
import { Student } from '../models/Student';
import { Periode } from '../models/Periode';
import { Matiere } from '../models/Matiere';
import { Evaluation } from '../models/Evaluation';
import { Note } from '../models/Note';
import { evaluationAppliesTo } from '../types/features/Evaluation';
import { matchesSchoolYear, schoolYearSchema } from '../types/features/Periode';
import {
  deriveBulletinResults,
  checkBulletinCalculation,
} from '../utils/bulletinCalculations';
import { HttpError } from '../utils/HttpError';
import type { Bulletin as BulletinData } from '../types/features/Bulletin';

export const bulletinIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/i)
  .transform((value) => value.toLowerCase());
export function serializeBulletin(record: IBulletin): BulletinData {
  return {
    id: String(record._id),
    inscriptionId: String(record.inscriptionId),
    periodeId: String(record.periodeId),
    classeId: String(record.classeId),
    anneeScolaire: record.anneeScolaire,
    version: record.__v ?? 0,
    status: record.status,
    needsRecalculation: record.needsRecalculation,
    vieScolaire: record.vieScolaire,
    commentaires: record.commentaires,
    moyennesParMatiere: record.moyennesParMatiere,
    resultatFinal: record.resultatFinal,
    infosDeClasse: record.infosDeClasse,
    notesManquantes: record.notesManquantes,
    configCalcul: record.configCalcul,
    calculatedAt: record.calculatedAt?.toISOString(),
    isDeleted: record.isDeleted,
    deletedAt: record.deletedAt?.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
export const bulletinQueryService = {
  async list(input: unknown = {}) {
    const filters = z
      .object({
        classeId: bulletinIdSchema.optional(),
        periodeId: bulletinIdSchema.optional(),
        inscriptionId: bulletinIdSchema.optional(),
        anneeScolaire: schoolYearSchema.optional(),
        includeDeleted: z.enum(['true']).optional(),
      })
      .strict()
      .parse(input);
    const [
      records,
      inscriptions,
      classes,
      students,
      periods,
      subjects,
      evaluations,
      notes,
    ] = await Promise.all([
      Bulletin.find().sort({ createdAt: -1 }),
      Inscription.find(),
      Classe.find(),
      Student.find(),
      Periode.find(),
      Matiere.find({ isDeleted: false }),
      Evaluation.find({ isDeleted: false }),
      Note.find({ isDeleted: false }),
    ]);
    const decorated = deriveBulletinResults(
      records.map(serializeBulletin).map((record) => {
        const classe = classes.find((item) => String(item._id) === record.classeId);
        return checkBulletinCalculation(record, {
          matieres: subjects
            .filter(
              (item) => String(item.niveauClasseId) === String(classe?.niveauClasseId),
            )
            .map((item) => ({
              id: String(item._id),
              nom: item.nom,
              coefficient: item.coefficient,
            })),
          evaluations: evaluations
            .filter((item) =>
              evaluationAppliesTo(
                {
                  periodeId: item.periodeId ? String(item.periodeId) : undefined,
                  niveauScolaireId: item.niveauScolaireId
                    ? String(item.niveauScolaireId)
                    : undefined,
                },
                record.periodeId,
                String(classe?.niveauScolaireId),
              ),
            )
            .map((item) => ({
              id: String(item._id),
              nom: item.nom,
              abreviation: item.abreviation,
              type: item.type,
              obligatoire: item.obligatoire,
            })),
          notes: notes
            .filter(
              (item) =>
                String(item.inscriptionId) === record.inscriptionId &&
                String(item.periodeId) === record.periodeId,
            )
            .map((item) => ({
              matiereId: String(item.matiereId),
              evaluationId: String(item.evaluationId),
              note: item.note,
              notePlafond: item.notePlafond,
              coefficient: item.coefficient,
            })),
        });
      }),
      periods.map((item) => ({
        id: String(item._id),
        nom: item.nom,
        ordre: item.ordre,
        coefficient: item.coefficient,
        niveauScolaireId: item.niveauScolaireId
          ? String(item.niveauScolaireId)
          : undefined,
        dateDebut: item.dateDebut,
        dateFin: item.dateFin,
        isDeleted: item.isDeleted,
      })),
      inscriptions.map((item) => ({
        id: String(item._id),
        classeId: String(item.classeId),
        anneeScolaire: item.anneeScolaire,
        isDeleted: item.isDeleted,
      })),
      classes.map((item) => ({
        id: String(item._id),
        niveauScolaireId: String(item.niveauScolaireId),
      })),
      matchesSchoolYear,
    );
    return decorated
      .filter(
        (item) =>
          (filters.includeDeleted || !item.isDeleted) &&
          Object.entries(filters).every(
            ([key, value]) =>
              key === 'includeDeleted' ||
              !value ||
              item[key as keyof BulletinData] === value,
          ),
      )
      .map((item) => {
        const inscription = inscriptions.find(
          (entry) => String(entry._id) === item.inscriptionId,
        );
        const student = students.find(
          (entry) => String(entry._id) === String(inscription?.eleveDataId),
        );
        return {
          ...item,
          eleve: student ? `${student.prenom} ${student.nom}` : 'Élève indisponible',
          matricule: student?.matricule ?? '',
          classe: classes.find((entry) => String(entry._id) === item.classeId)?.nom ?? '',
          periode:
            periods.find((entry) => String(entry._id) === item.periodeId)?.nom ?? '',
        };
      });
  },
  async getById(id: string) {
    const normalizedId = bulletinIdSchema.parse(id);
    const record = (await bulletinQueryService.list()).find(
      (item) => item.id === normalizedId,
    );
    if (!record) throw new HttpError(404, 'Bulletin introuvable.');
    return record;
  },
  getByPeriode: (periodeId: string) => bulletinQueryService.list({ periodeId }),
  getByClasseAndPeriode: (classeId: string, periodeId: string, anneeScolaire: unknown) =>
    bulletinQueryService.list({
      classeId,
      periodeId,
      anneeScolaire: schoolYearSchema.parse(anneeScolaire),
    }),
  async getByPeriodeAndInscription(periodeId: string, inscriptionId: string) {
    return (await bulletinQueryService.list({ periodeId, inscriptionId }))[0] ?? null;
  },
};
