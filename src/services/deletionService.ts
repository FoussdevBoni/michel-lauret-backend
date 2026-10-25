import { withTransaction } from '../lib/withTransaction';
import { retireMediaForParent } from './mediaLifecycleService';
import { Note } from '../models/Note';
import { markNoteBulletinDirty } from './noteBulletinService';
import { Evaluation } from '../models/Evaluation';
import { Enseignant } from '../models/Teacher';
import { Matiere } from '../models/Matiere';
import mongoose, { Types, type ClientSession } from 'mongoose';
import { z } from 'zod';
import { NiveauScolaire } from '../models/NiveauScolaire';
import { Cycle } from '../models/Cycle';
import { NiveauClasse } from '../models/NiveauClasse';
import { Classe } from '../models/Classe';
import { Student } from '../models/Student';
import { Inscription } from '../models/Inscription';
import { Periode } from '../models/Periode';
import { HttpError } from '../utils/HttpError';

const idsSchema = z
  .array(z.string().regex(/^[a-f0-9]{24}$/i, 'Identifiant invalide.'))
  .min(1, 'Sélectionnez au moins un élément.')
  .max(100, 'Sélectionnez au maximum 100 éléments.')
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]);

const collections = {
  niveauScolaire: NiveauScolaire.collection.name,
  cycle: Cycle.collection.name,
  niveauClasse: NiveauClasse.collection.name,
  classe: Classe.collection.name,
  student: Student.collection.name,
  inscription: Inscription.collection.name,
  periode: Periode.collection.name,
  matiere: Matiere.collection.name,
  teacher: Enseignant.collection.name,
  evaluation: Evaluation.collection.name,
  note: Note.collection.name,
};

type Entity = keyof typeof collections;
type Dependency = {
  collection: string;
  field: string;
  message: string;
  stringId?: boolean;
  mixedId?: boolean;
};

const dependencies: Record<Entity, Dependency[]> = {
  note: [],
  evaluation: [
    {
      collection: 'notes',
      field: 'evaluationId',
      message: 'Cette évaluation possède des notes.',
    },
  ],
  teacher: ['seances', 'enseignements', 'notes'].map((collection) => ({
    collection,
    field: 'enseignantId',
    mixedId: true,
    message: 'Cet enseignant possède des notes ou d’autres données pédagogiques liées.',
  })),
  matiere: [
    ...['notes', 'seances', 'evaluations'].map((collection) => ({
      collection,
      field: 'matiereId',
      message: 'Cette matière possède encore des données pédagogiques.',
    })),
    {
      collection: 'bulletins',
      field: 'moyennesParMatiere.matiereId',
      message: 'Cette matière figure dans des bulletins.',
    },
    {
      collection: 'enseignants',
      field: 'enseignements.matiereId',
      stringId: true,
      message: 'Cette matière est affectée à un enseignant.',
    },
  ],
  periode: [
    ...['evaluations', 'bulletins'].map((collection) => ({
      collection,
      field: 'periodeId',
      message: 'Cette période possède des évaluations ou des bulletins.',
    })),
    {
      collection: 'inscriptions',
      field: 'vieScolaire.periodeId',
      message: 'Cette période possède des données de vie scolaire.',
    },
  ],
  inscription: ['notes', 'bulletins'].map((collection) => ({
    collection,
    field: 'inscriptionId',
    message: 'Cette inscription possède encore des notes ou bulletins.',
  })),
  niveauScolaire: [
    {
      collection: collections.cycle,
      field: 'niveauScolaireId',
      message: 'Ce niveau scolaire contient encore des cycles.',
    },
    {
      collection: collections.niveauClasse,
      field: 'niveauScolaireId',
      message: 'Ce niveau scolaire contient encore des niveaux de classe.',
    },
    {
      collection: collections.classe,
      field: 'niveauScolaireId',
      message: 'Ce niveau scolaire contient encore des classes.',
    },
    ...['matieres', 'periodes', 'evaluations'].map((collection) => ({
      collection,
      field: 'niveauScolaireId',
      message: 'Ce niveau scolaire est encore utilisé dans la configuration pédagogique.',
    })),
  ],
  cycle: [
    {
      collection: collections.niveauClasse,
      field: 'cycleId',
      message: 'Ce cycle contient encore des niveaux de classe.',
    },
    {
      collection: collections.classe,
      field: 'cycleId',
      message: 'Ce cycle contient encore des classes.',
    },
    {
      collection: 'matieres',
      field: 'cycleId',
      message: 'Ce cycle est encore utilisé par des matières.',
    },
  ],
  niveauClasse: [
    {
      collection: collections.classe,
      field: 'niveauClasseId',
      message: 'Ce niveau de classe contient encore des classes.',
    },
    {
      collection: 'matieres',
      field: 'niveauClasseId',
      message: 'Ce niveau de classe est encore utilisé par des matières.',
    },
  ],
  classe: [
    ...['inscriptions', 'notes', 'seances', 'bulletins'].map((collection) => ({
      collection,
      field: 'classeId',
      message:
        'Cette classe possède encore des inscriptions ou des données pédagogiques liées.',
    })),
    {
      collection: 'enseignants',
      field: 'enseignements.classeId',
      stringId: true,
      message: 'Cette classe est encore affectée à un enseignant.',
    },
  ],
  student: [
    {
      collection: 'inscriptions',
      field: 'eleveDataId',
      message: 'Cet élève possède encore des inscriptions liées.',
    },
  ],
};

export const deletionService = {
  async deleteMany(entity: Entity, input: unknown, existingSession?: ClientSession) {
    const ids = idsSchema.parse(input).map((id) => new Types.ObjectId(id));
    const db = mongoose.connection.db;

    if (!db || mongoose.connection.readyState !== 1) {
      throw new HttpError(503, 'La base de données est indisponible.');
    }

    // MongoDB Atlas fournit les transactions nécessaires pour le lot entier.
    const remove = async (session: ClientSession) => {
      const collection = db.collection(collections[entity]);
      const records = await collection.find({ _id: { $in: ids } }, { session }).toArray();

      if (records.length !== ids.length) {
        throw new HttpError(
          404,
          'Un des éléments à supprimer est introuvable. Aucun élément n’a été supprimé.',
        );
      }

      const activeIds = records
        .filter((record) => !record.isDeleted)
        .map((record) => record._id);

      if (!activeIds.length) return { deletedCount: 0 };

      for (const dependency of dependencies[entity]) {
        const values = dependency.mixedId
          ? [...activeIds, ...activeIds.map(String)]
          : dependency.stringId
            ? activeIds.map(String)
            : activeIds;
        const used = await db.collection(dependency.collection).findOne(
          {
            [dependency.field]: { $in: values },
            isDeleted: { $ne: true },
          },
          { session, projection: { _id: 1 } },
        );

        if (used)
          throw new HttpError(
            409,
            `${dependency.message} Aucun élément du lot n’a été supprimé.`,
          );
      }

      if (entity === 'note') {
        for (const record of records.filter((item) => !item.isDeleted)) {
          if (record.closed)
            throw new HttpError(
              409,
              'Une note clôturée ne peut pas être supprimée. Aucun élément du lot n’a été supprimé.',
            );
          await markNoteBulletinDirty(
            {
              inscriptionId: record.inscriptionId,
              periodeId: record.periodeId,
              classeId: record.classeId,
            },
            session,
          );
        }
      }
      const now = new Date();
      if (entity === 'student') {
        for (const id of activeIds)
          await retireMediaForParent('student', String(id), session);
      }
      const result = await collection.updateMany(
        { _id: { $in: activeIds }, isDeleted: { $ne: true } },
        {
          $set: {
            isDeleted: true,
            deletedAt: now,
            updatedAt: now,
            ...(entity === 'inscription' ? { isActive: false } : {}),
          },
          $inc: { __v: 1 },
        },
        { session },
      );

      return { deletedCount: result.modifiedCount };
    };
    return existingSession ? remove(existingSession) : withTransaction(remove);
  },
};
