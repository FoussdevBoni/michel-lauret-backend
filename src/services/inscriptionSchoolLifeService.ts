import { withTransaction } from '../lib/withTransaction';
import { matchesSchoolYear } from '../types/features/Periode';
import mongoose, { Types, isValidObjectId } from 'mongoose';
import { Inscription } from '../models/Inscription';
import { Classe } from '../models/Classe';
import { Periode } from '../models/Periode';
import { schoolLifeSchema } from '../types/features/InscriptionSchoolLife';
import { HttpError } from '../utils/HttpError';

export const inscriptionSchoolLifeService = {
  async update(id: string, input: unknown) {
    if (!isValidObjectId(id)) throw new HttpError(400, 'Identifiant invalide.');
    const data = schoolLifeSchema.parse(input);
    if (!mongoose.connection.db || mongoose.connection.readyState !== 1)
      throw new HttpError(503, 'La base est indisponible.');
    const db = mongoose.connection.db;
    return withTransaction(async (session) => {
      const record = await Inscription.findOne({ _id: id, isDeleted: false }).session(
        session,
      );
      if (!record) throw new HttpError(404, 'Inscription introuvable.');
      if (record.__v !== data.version)
        throw new HttpError(409, 'Cette inscription a été modifiée ailleurs.');
      const classe = await Classe.findOne({
        _id: record.classeId,
        isDeleted: false,
      }).session(session);
      if (!classe) throw new HttpError(409, 'Classe indisponible.');
      const scores = new Map(
        (record.vieScolaire ?? []).map((entry) => [
          String(entry.periodeId),
          { periodeId: entry.periodeId, score: entry.score },
        ]),
      );
      const now = new Date();
      for (const entry of data.vieScolaire) {
        const periode = await Periode.findOneAndUpdate(
          {
            _id: entry.periodeId,
            isDeleted: false,
          },
          { $inc: { referenceRevision: 1 } },
          { session, new: true },
        );
        if (
          !periode ||
          !matchesSchoolYear(periode, record.anneeScolaire) ||
          (periode.niveauScolaireId &&
            String(periode.niveauScolaireId) !== String(classe.niveauScolaireId))
        )
          throw new HttpError(409, 'Période absente ou incompatible.');
        const periodeId = new Types.ObjectId(entry.periodeId);
        const existing = await db
          .collection('bulletins')
          .findOne({ inscriptionId: record._id, periodeId }, { session });
        if (
          existing &&
          (existing.isDeleted ||
            !['brouillon', 'complet', 'incomplet', 'a_finaliser'].includes(
              existing.status,
            ))
        )
          throw new HttpError(409, 'Le bulletin associé est verrouillé ou indisponible.');
        scores.set(entry.periodeId, { periodeId, score: entry.score });
        await db.collection('bulletins').updateOne(
          { inscriptionId: record._id, periodeId },
          {
            $set: { vieScolaire: entry.score, needsRecalculation: true, updatedAt: now },
            $inc: { __v: 1 },
            $setOnInsert: {
              inscriptionId: record._id,
              periodeId,
              classeId: record.classeId,
              status: 'brouillon',
              moyennesParMatiere: [],
              resultatFinal: null,
              infosDeClasse: { effectif: 0 },
              commentaires: { decisionConseil: '', observations: '' },
              notesManquantes: [],
              createdAt: now,
            },
          },
          { session, upsert: true },
        );
      }
      const result = await Inscription.updateOne(
        { _id: id, __v: data.version },
        { $set: { vieScolaire: [...scores.values()] }, $inc: { __v: 1 } },
        { session },
      );
      if (result.modifiedCount !== 1)
        throw new HttpError(409, 'Cette inscription a été modifiée ailleurs.');
      return {
        id,
        vieScolaire: [...scores.values()].map((entry) => ({
          periodeId: String(entry.periodeId),
          score: entry.score,
        })),
        version: data.version + 1,
      };
    });
  },
};
