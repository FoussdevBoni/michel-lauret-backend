import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { Evaluation, type IEvaluation } from '../models/Evaluation';
import { Periode } from '../models/Periode';
import { Matiere } from '../models/Matiere';
import { NiveauScolaire } from '../models/NiveauScolaire';
import { evaluationAppliesTo, evaluationTypes } from '../types/features/Evaluation';
import { HttpError } from '../utils/HttpError';
export function serializeEvaluation(record: IEvaluation) {
  return {
    id: String(record._id),
    nom: record.nom,
    abreviation: record.abreviation ?? '',
    type: record.type,
    coefficient: record.coefficient,
    obligatoire: record.obligatoire ?? true,
    periodeId: record.periodeId ? String(record.periodeId) : undefined,
    niveauScolaireId: record.niveauScolaireId
      ? String(record.niveauScolaireId)
      : undefined,
    version: record.__v,
    isDeleted: record.isDeleted,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
async function enrich(records: IEvaluation[]) {
  const periodes = await Periode.find({
    _id: { $in: records.flatMap((item) => (item.periodeId ? [item.periodeId] : [])) },
  });
  const parents = await NiveauScolaire.find({
    _id: {
      $in: records.flatMap((item) =>
        item.niveauScolaireId ? [item.niveauScolaireId] : [],
      ),
    },
  });
  const p = new Map(periodes.map((item) => [String(item._id), item.nom])),
    n = new Map(parents.map((item) => [String(item._id), item.nom]));
  return records.map((record) => ({
    ...serializeEvaluation(record),
    periode: record.periodeId
      ? (p.get(String(record.periodeId)) ?? 'Période indisponible')
      : 'Toutes les périodes',
    niveauScolaire: record.niveauScolaireId
      ? (n.get(String(record.niveauScolaireId)) ?? 'Niveau indisponible')
      : 'Tous les niveaux',
  }));
}
export const evaluationQueryService = {
  async list(input: unknown = {}) {
    const identifier = z
      .string()
      .regex(/^[a-f0-9]{24}$/i)
      .transform((value) => value.toLowerCase());
    const filters = z
      .object({
        periodeId: z.union([identifier, z.literal('none')]).optional(),
        niveauScolaireId: identifier.optional(),
        matiereId: identifier.optional(),
        type: z.enum(evaluationTypes).optional(),
        recherche: z.string().trim().max(100).optional(),
      })
      .strict()
      .parse(input);
    if (filters.matiereId && (!filters.periodeId || filters.periodeId === 'none'))
      throw new HttpError(
        400,
        'Choisissez une période pour consulter les évaluations applicables à une matière.',
      );
    let records = await enrich(
      await Evaluation.find({
        isDeleted: false,
        ...(filters.type ? { type: filters.type } : {}),
      }).sort({ nom: 1 }),
    );
    if (filters.matiereId) {
      const periode = await Periode.findOne({ _id: filters.periodeId, isDeleted: false }),
        matiere = await Matiere.findOne({ _id: filters.matiereId, isDeleted: false });
      if (!periode || !matiere)
        throw new HttpError(404, 'Période ou matière introuvable.');
      if (
        periode.niveauScolaireId &&
        String(periode.niveauScolaireId) !== String(matiere.niveauScolaireId)
      )
        throw new HttpError(
          409,
          'La période et la matière appartiennent à des niveaux incompatibles.',
        );
      records = records.filter((record) =>
        evaluationAppliesTo(record, filters.periodeId!, String(matiere.niveauScolaireId)),
      );
    } else if (filters.periodeId) {
      records = records.filter((record) =>
        filters.periodeId === 'none'
          ? !record.periodeId
          : record.periodeId === filters.periodeId,
      );
    }
    if (filters.niveauScolaireId)
      records = records.filter(
        (record) =>
          !record.niveauScolaireId ||
          record.niveauScolaireId === filters.niveauScolaireId,
      );
    const normalize = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    return filters.recherche
      ? records.filter((record) =>
          normalize(
            record.nom + ' ' + record.abreviation + ' ' + record.periode,
          ).includes(normalize(filters.recherche!)),
        )
      : records;
  },
  async getById(id: string) {
    if (!isValidObjectId(id))
      throw new HttpError(400, 'Identifiant évaluation invalide.');
    const record = await Evaluation.findOne({ _id: id, isDeleted: false });
    if (!record) throw new HttpError(404, 'Évaluation introuvable.');
    return (await enrich([record]))[0];
  },
  getByPeriode: (id: string) => evaluationQueryService.list({ periodeId: id }),
  getByNiveauScolaire: (id: string) =>
    evaluationQueryService.list({ niveauScolaireId: id }),
  getByPeriodeAndMatiere: (periodeId: string, matiereId: string) =>
    evaluationQueryService.list({ periodeId, matiereId }),
};
