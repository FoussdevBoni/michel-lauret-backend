import mongoose, { type ClientSession, type Types } from 'mongoose';
import { HttpError } from '../utils/HttpError';
import { Inscription } from '../models/Inscription';
export async function markNoteBulletinDirty(
  record: {
    inscriptionId: Types.ObjectId;
    periodeId: Types.ObjectId;
    classeId: Types.ObjectId;
  },
  session: ClientSession,
) {
  // Même verrou pour créer, corriger, clôturer ou supprimer une note : il évite
  // deux brouillons concurrents, y compris lors d'une reprise d'anciennes notes.
  const inscription = await Inscription.findOneAndUpdate(
    { _id: record.inscriptionId, isDeleted: false },
    { $inc: { referenceRevision: 1 } },
    { session },
  );
  if (!inscription) throw new HttpError(409, 'Inscription du bulletin indisponible.');
  const collection = mongoose.connection.db!.collection('bulletins');
  const query = { inscriptionId: record.inscriptionId, periodeId: record.periodeId };
  const existing = await collection.findOne(query, { session });
  if (
    existing &&
    (existing.isDeleted ||
      !['brouillon', 'complet', 'incomplet', 'a_finaliser'].includes(existing.status))
  )
    throw new HttpError(409, 'Le bulletin associé est verrouillé ou indisponible.');
  const now = new Date();
  await collection.updateOne(
    query,
    {
      $set: { needsRecalculation: true, updatedAt: now },
      $inc: { __v: 1 },
      $setOnInsert: {
        ...query,
        classeId: record.classeId,
        status: 'brouillon',
        vieScolaire: { absences: 0, retards: 0, conduite: null },
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
