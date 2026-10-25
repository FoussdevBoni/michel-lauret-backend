import { withTransaction } from '../lib/withTransaction';
import mongoose, { isValidObjectId } from 'mongoose';
import { Evaluation } from '../models/Evaluation';
import { Periode } from '../models/Periode';
import { NiveauScolaire } from '../models/NiveauScolaire';
import {
  evaluationInputSchema,
  evaluationUpdateSchema,
  normalizeEvaluationName,
} from '../types/features/Evaluation';
import { evaluationQueryService, serializeEvaluation } from './evaluationQueryService';
import { deletionService } from './deletionService';
import { HttpError } from '../utils/HttpError';
import { runBatch } from '../utils/runBatch';
async function save(input: unknown, id?: string) {
  if (id && !isValidObjectId(id))
    throw new HttpError(400, 'Identifiant évaluation invalide.');
  const parsed = id
    ? evaluationUpdateSchema.parse(input)
    : { ...evaluationInputSchema.parse(input), version: undefined };
  const { version, ...data } = parsed;
  return withTransaction(async (session) => {
    const periode = data.periodeId
      ? await Periode.findOneAndUpdate(
          { _id: data.periodeId, isDeleted: false },
          { $inc: { referenceRevision: 1 } },
          { session, new: true },
        )
      : null;
    if (data.periodeId && !periode) throw new HttpError(404, 'Période introuvable.');
    if (
      periode?.niveauScolaireId &&
      data.niveauScolaireId &&
      data.niveauScolaireId !== String(periode.niveauScolaireId)
    )
      throw new HttpError(409, 'Le niveau scolaire ne correspond pas à la période.');
    const niveauScolaireId = periode?.niveauScolaireId
      ? String(periode.niveauScolaireId)
      : data.niveauScolaireId;
    if (
      niveauScolaireId &&
      !(await NiveauScolaire.findOneAndUpdate(
        { _id: niveauScolaireId, isDeleted: false },
        { $inc: { referenceRevision: 1 } },
        { session },
      ))
    )
      throw new HttpError(404, 'Niveau scolaire introuvable.');
    const existing = id
      ? await Evaluation.findOne({ _id: id, isDeleted: false }).session(session)
      : null;
    if (id && !existing) throw new HttpError(404, 'Évaluation introuvable.');
    if (existing && existing.__v !== version)
      throw new HttpError(409, 'Cette évaluation a été modifiée ailleurs.');
    if (
      existing &&
      ((existing.periodeId ? String(existing.periodeId) : undefined) !== data.periodeId ||
        (existing.niveauScolaireId ? String(existing.niveauScolaireId) : undefined) !==
          niveauScolaireId)
    )
      throw new HttpError(
        409,
        'La période et le niveau d’une évaluation existante sont fixes.',
      );
    if (
      existing &&
      (existing.coefficient !== data.coefficient || existing.type !== data.type) &&
      (await mongoose.connection
        .db!.collection('notes')
        .findOne({ evaluationId: existing._id, isDeleted: { $ne: true } }, { session }))
    )
      throw new HttpError(
        409,
        'Une évaluation notée conserve son type et son coefficient.',
      );
    const siblings = await Evaluation.find({
      periodeId: data.periodeId ?? null,
      niveauScolaireId: niveauScolaireId ?? null,
      type: data.type,
      ...(id ? { _id: { $ne: id } } : {}),
    })
      .select('nom')
      .session(session);
    if (
      siblings.some(
        (record) =>
          normalizeEvaluationName(record.nom) === normalizeEvaluationName(data.nom),
      )
    )
      throw new HttpError(
        409,
        'Une évaluation porte déjà ce nom dans ce périmètre et ce type, y compris dans les archives.',
      );
    const values = {
      ...data,
      obligatoire: data.obligatoire ?? existing?.obligatoire ?? true,
      niveauScolaireId: niveauScolaireId ?? null,
      periodeId: data.periodeId ?? null,
      abreviation: data.abreviation || data.nom.slice(0, 3).toUpperCase(),
      nomNormalise: normalizeEvaluationName(data.nom),
    };
    if (existing) {
      existing.set(values);
      existing.increment();
      return serializeEvaluation(await existing.save({ session }));
    }
    const [record] = await Evaluation.create([values], { session });
    return serializeEvaluation(record);
  });
}
export const evaluationService = {
  ...evaluationQueryService,
  create: (input: unknown) => save(input),
  update: (id: string, input: unknown) => save(input, id),
  createMany: (items: unknown) => runBatch(items, (item) => save(item)),
  delete: (id: string) => deletionService.deleteMany('evaluation', [id]),
  deleteMany: (ids: unknown) => deletionService.deleteMany('evaluation', ids),
};
