import mongoose, { type ClientSession } from 'mongoose';
import { createHash } from 'node:crypto';
import { Student } from '../models/Student';
import { Enseignant } from '../models/Teacher';
import { Classe } from '../models/Classe';
import { Matiere } from '../models/Matiere';
import { Periode } from '../models/Periode';
import { Evaluation } from '../models/Evaluation';
import { Inscription } from '../models/Inscription';
import { Note } from '../models/Note';
import { NiveauClasse } from '../models/NiveauClasse';
import { Cycle } from '../models/Cycle';
import { NiveauScolaire } from '../models/NiveauScolaire';
import { FirestoreArchive, FirestoreMigrationRun } from '../models/FirestoreMigration';
import { buildFirestoreImportPlan } from './firestoreImportPlanService';
import type { MigrationDecisions } from '../types/features/FirestoreMigration';
import { readVerifiedFirestoreExport } from './firestoreAuditService';
import {
  archiveFirestoreDocuments,
  requireMigrationArchiveScope,
  verifyFirestoreArchives,
} from './firestoreArchiveService';

const entityModels = {
  students: Student,
  teachers: Enseignant,
  classes: Classe,
  subjects: Matiere,
  periods: Periode,
  evaluations: Evaluation,
  inscriptions: Inscription,
  notes: Note,
};

export async function prepareFirestoreImport(
  path: string,
  decisions: MigrationDecisions,
) {
  const verified = await readVerifiedFirestoreExport(path);
  const levels = await NiveauClasse.find({ isDeleted: false }).lean();
  for (const level of levels) {
    const cycle = await Cycle.findOne({ _id: level.cycleId, isDeleted: false }).lean();
    const parent = await NiveauScolaire.findOne({
      _id: level.niveauScolaireId,
      isDeleted: false,
    }).lean();
    if (
      !cycle ||
      !parent ||
      String(cycle.niveauScolaireId) !== String(parent._id) ||
      parent.notePlafond !== 20
    )
      throw new Error('Hiérarchie cible incohérente ou barème différent de 20.');
  }
  const plan = buildFirestoreImportPlan(
    { ...verified.source, sha256: verified.sha256 },
    levels.map((level) => ({
      _id: String(level._id),
      nom: level.nom,
      cycleId: String(level.cycleId),
      niveauScolaireId: String(level.niveauScolaireId),
    })),
    decisions,
  );
  return { ...verified, plan };
}

type PreparedImport = Awaited<ReturnType<typeof prepareFirestoreImport>>;

async function requireEmptyTarget(session?: ClientSession) {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Connexion MongoDB indisponible.');
  const names = [
    ...Object.values(entityModels).map((model) => model.collection.name),
    'bulletins',
    'configBulletins',
  ];
  for (const name of names) {
    if (await db.collection(name).countDocuments({}, { session, limit: 1 }))
      throw new Error(
        'La cible contient déjà des données métier ou une autre migration. Import arrêté sans écrasement.',
      );
  }
}

/** Valide et convertit les références avec les schémas de production avant toute écriture. */
function castEntities(plan: PreparedImport['plan']) {
  return Object.entries(entityModels).map(([key, model]) => {
    const records = plan.entities[key as keyof typeof entityModels].map((record) => {
      const document = new model(record);
      const error = document.validateSync();
      if (error)
        throw new Error(
          `Schéma MongoDB incompatible pour ${key}: ${Object.keys(error.errors).join(', ')}.`,
        );
      return document.toObject() as mongoose.mongo.Document;
    });
    return { collection: model.collection.name, records };
  });
}

async function insertBatches(
  collection: string,
  records: mongoose.mongo.Document[],
  session: ClientSession,
) {
  const db = mongoose.connection.db!;
  // Les petits lots multiplient les allers-retours sur une connexion lente et
  // risquent de dépasser la durée autorisée d'une transaction cloud.
  const batchSize = 1000;
  for (let offset = 0; offset < records.length; offset += batchSize) {
    try {
      await db
        .collection(collection)
        .insertMany(records.slice(offset, offset + batchSize), {
          session,
          ordered: true,
        });
    } catch (error) {
      if (error instanceof mongoose.mongo.MongoBulkWriteError) {
        const errors = error.writeErrors
          ? Array.isArray(error.writeErrors)
            ? error.writeErrors
            : [error.writeErrors]
          : [];
        const codes = errors.map((item) => ({
          code: item.code,
          index: item.index + offset,
        }));
        const reason =
          /transaction.*(?:lifetime|expired|aborted)|transaction.*time limit/i.test(
            error.message,
          )
            ? 'transaction_expired'
            : 'bulk_write_refused';
        const detail = error.message
          .replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[URI masquée]')
          .split('dup key:')[0]
          .slice(0, 300);
        throw new Error(
          `Écriture refusée pour ${collection}: ${JSON.stringify({ codes, reason, code: error.code, detail })}.`,
        );
      }
      throw error;
    }
  }
}

export async function importFirestore(
  prepared: PreparedImport,
  apply = false,
  onProgress?: (phase: string) => void,
) {
  const { plan, source, sha256 } = prepared;
  const decisionsHash = createHash('sha256')
    .update(JSON.stringify(plan.decisions))
    .digest('hex');
  const previous = await FirestoreMigrationRun.findById(sha256).lean();
  if (previous) {
    if (previous.decisionsHash !== decisionsHash)
      throw new Error('Cet export a déjà été importé avec d’autres décisions.');
    if (previous.completedAt)
      return {
        status: 'already_imported',
        sha256,
        summary: previous.summary,
        mongoWrites: 0,
      };
  }
  await requireEmptyTarget();
  await requireMigrationArchiveScope(sha256);
  const batches = castEntities(plan);
  if (!apply)
    return { status: 'validated_dry_run', sha256, summary: plan.summary, mongoWrites: 0 };

  // Les collections et index doivent exister avant la transaction, y compris sur une base neuve.
  for (const model of [
    ...Object.values(entityModels),
    FirestoreArchive,
    FirestoreMigrationRun,
  ]) {
    await model.createCollection();
    await model.createIndexes();
  }
  if (!previous)
    await FirestoreMigrationRun.create({
      _id: sha256,
      projectId: source.projectId,
      databaseId: source.databaseId,
      schoolYear: plan.decisions.schoolYear,
      decisionsHash,
      summary: plan.summary,
      sourceToTarget: plan.sourceToTarget,
      pending: plan.pending,
      status: 'archiving',
    });
  const newlyArchived = await archiveFirestoreDocuments(
    source.documents,
    sha256,
    onProgress,
  );
  await FirestoreMigrationRun.updateOne(
    { _id: sha256, decisionsHash, status: { $ne: 'complete' } },
    { $set: { status: 'ready' } },
  );
  const session = await mongoose.startSession();
  const completedAt = new Date();
  try {
    await session.withTransaction(
      async () => {
        onProgress?.('transaction_started');
        await requireEmptyTarget(session);
        for (const batch of batches) {
          onProgress?.('inserting_' + batch.collection);
          await insertBatches(batch.collection, batch.records, session);
        }
        onProgress?.('writing_completion_record');
        const completion = await FirestoreMigrationRun.updateOne(
          { _id: sha256, decisionsHash, status: 'ready' },
          { $set: { status: 'complete', completedAt } },
          { session, runValidators: true },
        );
        if (completion.modifiedCount !== 1)
          throw new Error('Journal de migration indisponible ou modifié.');
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    );
    onProgress?.('transaction_committed');
  } finally {
    await session.endSession();
  }
  return {
    status: 'imported',
    sha256,
    summary: plan.summary,
    mongoWrites:
      batches.reduce((sum, batch) => sum + batch.records.length, 0) + newlyArchived + 1,
  };
}

export async function verifyFirestoreImport(
  prepared: PreparedImport,
  onProgress?: (phase: string) => void,
) {
  const db = mongoose.connection.db!;
  const counts: Record<string, number> = {};
  const normalize = (value: unknown): unknown => {
    if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, normalize(child)]),
      );
    return value;
  };
  const contains = (actual: unknown, expected: unknown): boolean => {
    if (Array.isArray(expected))
      return (
        Array.isArray(actual) &&
        actual.length === expected.length &&
        expected.every((item, index) => contains(actual[index], item))
      );
    if (expected && typeof expected === 'object')
      return (
        !!actual &&
        typeof actual === 'object' &&
        Object.entries(expected).every(([key, value]) =>
          contains((actual as Record<string, unknown>)[key], value),
        )
      );
    return actual === expected;
  };
  for (const [key, model] of Object.entries(entityModels)) {
    const expected = prepared.plan.entities[key as keyof typeof entityModels];
    const ids = expected.map((record) => new mongoose.Types.ObjectId(record._id));
    counts[key] = await db
      .collection(model.collection.name)
      .countDocuments({ _id: { $in: ids } });
    if (counts[key] !== expected.length)
      throw new Error('Vérification des documents importés incomplète.');
    const cursor = db
      .collection(model.collection.name)
      .find({ _id: { $in: ids } })
      .batchSize(500);
    const byId = new Map<string, unknown>();
    for await (const row of cursor) {
      byId.set(String(row._id), normalize(row));
      if (byId.size % 1000 === 0)
        onProgress?.(`read_${key}_${byId.size}_of_${expected.length}`);
    }
    for (const record of expected) {
      // Les dates générées du référentiel varient lors d'une nouvelle simulation ;
      // toutes les valeurs métier et les références doivent rester identiques.
      const business = Object.fromEntries(
        Object.entries(record).filter(
          ([field]) => !['createdAt', 'updatedAt'].includes(field),
        ),
      );
      if (!contains(byId.get(record._id), normalize(business)))
        throw new Error('Valeurs métier importées différentes du plan.');
    }
    onProgress?.('verified_' + key);
  }
  const archivedDocuments = await verifyFirestoreArchives(
    prepared.source.documents,
    prepared.sha256,
    onProgress,
  );
  if (
    archivedDocuments !== prepared.source.documents.length ||
    !(await FirestoreMigrationRun.exists({
      _id: prepared.sha256,
      status: 'complete',
      completedAt: { $exists: true },
    }))
  )
    throw new Error('Archive ou journal de migration incomplet.');
  return {
    counts,
    archivedDocuments,
    businessValuesChecked: true,
    archiveValuesChecked: true,
    verifiedAt: new Date().toISOString(),
  };
}
