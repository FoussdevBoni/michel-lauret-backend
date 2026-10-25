import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import jwt from 'jsonwebtoken';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { encodeFirestoreValue } from '../src/lib/firestoreExportValue';
import { exportFirestore } from '../src/services/firestoreExportService';
import { buildFirestoreImportPlan } from '../src/services/firestoreImportPlanService';
import {
  prepareFirestoreImport,
  importFirestore,
  verifyFirestoreImport,
} from '../src/services/firestoreImportService';
import { NiveauScolaire } from '../src/models/NiveauScolaire';
import { Cycle } from '../src/models/Cycle';
import { NiveauClasse } from '../src/models/NiveauClasse';
import { Student } from '../src/models/Student';
import { Enseignant } from '../src/models/Teacher';
import { Note } from '../src/models/Note';
import {
  FirestoreArchive,
  FirestoreMigrationRun,
} from '../src/models/FirestoreMigration';
import { studentService } from '../src/services/studentService';
import { archiveFirestoreDocuments } from '../src/services/firestoreArchiveService';
import type { ExportedFirestoreDocument } from '../src/types/features/FirestoreMigration';

const decisions = {
  schoolYear: '2025-2026',
  preserveUnknownBirthDates: true,
  preserveUnknownSex: true,
  deferConflictingAssignments: true,
} as const;
const identity = {
  firstname: 'Prénom',
  lastname: 'Nom',
  sexe: 'Masculin',
  naissance: '2012-02-29',
  matricule: 'A',
  classe: '6ème',
};
function document(
  path: string,
  fields: Record<string, unknown>,
): ExportedFirestoreDocument {
  return {
    path,
    exists: true,
    fields: encodeFirestoreValue(fields),
    createTime: { type: 'timestamp', seconds: 1765200000, nanoseconds: 123000000 },
    updateTime: { type: 'timestamp', seconds: 1765200001, nanoseconds: 0 },
  };
}
function fixture() {
  const grade = {
    ...identity,
    eleveId: 'a',
    enseignantId: 't1',
    trimestre: '1',
    evaluation: '1ère interrogation',
    matiere: 'Anglais',
    note: '0',
  };
  return [
    document('students/a', identity),
    document('students/b', { ...identity, matricule: '', sexe: '', naissance: null }),
    document('teachers/t1', {
      firstname: 'Prof',
      lastname: 'Un',
      matiere: 'Anglais',
      classes: ['6ème'],
    }),
    document('teachers/t2', {
      firstname: 'Prof',
      lastname: 'Deux',
      matiere: 'Anglais',
      classes: ['6ème'],
    }),
    document('notes/n1', grade),
    document('notes/n2', { ...grade, matiere: '' }),
    document('notes/n3', { ...grade, evaluation: '2ème interrogation', note: '' }),
    document('notes/n4', { ...grade, evaluation: '1er devoir', note: '05' }),
    document('notes/n5', { ...grade, evaluation: '1er devoir', note: '' }),
    document('notes/n6', { ...grade, eleveId: 'old-a' }),
    document('notes/n7', {
      ...grade,
      eleveId: 'historical',
      matricule: 'C',
      firstname: 'Ancien',
      note: '12',
    }),
    document('observations/o', { eleveId: 'a', arbitrary: 'Texte original' }),
    document('modificationNotes/h', { previous: '0', next: '05' }),
  ];
}
const level = {
  _id: '000000000000000000000001',
  nom: '6ème,',
  cycleId: '000000000000000000000002',
  niveauScolaireId: '000000000000000000000003',
};
test('Plan : rapproche les identités prouvées, préserve zéro et n’invente ni note vide ni affectation', () => {
  const source = {
    projectId: 'test-import',
    databaseId: '(default)',
    documents: fixture(),
  };
  const initial = JSON.stringify(source);
  const plan = buildFirestoreImportPlan(source, [level], decisions);
  assert.equal(plan.summary.students, 3);
  assert.equal(plan.summary.notes, 3);
  assert.equal(plan.summary.pendingGrades, 1);
  assert.equal(plan.summary.deduplicatedGrades, 3);
  assert.equal(plan.summary.pendingAssignments, 1);
  assert.equal(plan.summary.unknownBirthDates, 1);
  assert.equal(plan.summary.unknownSex, 1);
  assert.equal(plan.summary.missingMatricules, 1);
  assert.equal(plan.sourceToTarget['students/a'], plan.sourceToTarget['students/old-a']);
  assert.equal(
    plan.entities.students.find(
      (row) => row._id === plan.sourceToTarget['students/historical'],
    )?.statut,
    'inactif',
  );
  assert.deepEqual(
    plan.entities.notes.map((row) => row.note).sort((a, b) => Number(a) - Number(b)),
    [0, 5, 12],
  );
  assert.ok(
    plan.entities.teachers.every((row) => (row.enseignements as unknown[]).length === 0),
  );
  assert.equal(JSON.stringify(source), initial);
});
test('Plan : refuse les rapprochements contradictoires et les années non consécutives', () => {
  const documents = fixture();
  documents.push(
    document('notes/conflict', { ...identity, eleveId: 'old-a', firstname: 'Autre' }),
  );
  assert.throws(
    () =>
      buildFirestoreImportPlan(
        { projectId: 'test', databaseId: '(default)', documents },
        [level],
        decisions,
      ),
    /contradictoires/,
  );
  assert.throws(
    () =>
      buildFirestoreImportPlan(
        { projectId: 'test', databaseId: '(default)', documents: [] },
        [level],
        { ...decisions, schoolYear: '2024-2026' },
      ),
    /Décisions/,
  );
});

let replica: MongoMemoryReplSet;
let input: string;
const databaseName = 'cpeg_migration_test_' + randomUUID().replaceAll('-', '');
before(
  async () => {
    replica = await MongoMemoryReplSet.create({
      instanceOpts: [{ launchTimeout: 60000 }],
      binary: {
        version: '7.0.14',
        systemBinary: resolve('node_modules/.cache/mongodb-binaries/mongod-7.0.14.exe'),
      },
      replSet: { count: 1, storageEngine: 'wiredTiger', spawn: { windowsHide: true } },
    });
    await mongoose.connect(replica.getUri(databaseName));
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    await mkdir(resolve('.local'), { recursive: true });
    const root = await mkdtemp(resolve('.local/import-test-'));
    const documents = fixture();
    const exported = await exportFirestore(
      {
        projectId: 'test-import',
        databaseId: '(default)',
        async collections(parent) {
          return parent
            ? []
            : ['students', 'teachers', 'notes', 'observations', 'modificationNotes'];
        },
        async *documents(collection) {
          yield* documents.filter((document) =>
            document.path.startsWith(collection + '/'),
          );
        },
      },
      root,
    );
    input = exported.file;
  },
  { timeout: 120000 },
);
beforeEach(async () => {
  assert.equal(mongoose.connection.name, databaseName);
  for (const collection of await mongoose.connection.db!.collections())
    await collection.deleteMany({});
  await mongoose.connection.db!.collection('periodes').createIndex(
    { niveauScolaireId: 1, ordre: 1 },
    {
      name: 'unique_period_order_per_level',
      unique: true,
      partialFilterExpression: { isDeleted: false },
    },
  );
  const parent = await NiveauScolaire.create({ nom: 'Secondaire', notePlafond: 20 });
  const cycle = await Cycle.create({ nom: 'Secondaire', niveauScolaireId: parent._id });
  await NiveauClasse.insertMany(
    ['6ème,', '5ème,', '4ème,', '3ème'].map((nom) => ({
      nom,
      cycleId: cycle._id,
      niveauScolaireId: parent._id,
    })),
  );
});
after(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

test('MongoDB : simulation sans écritures, transaction, archive exhaustive et relance sans doublon', async () => {
  const prepared = await prepareFirestoreImport(input, decisions);
  const originalHierarchy = await NiveauClasse.find().lean();
  assert.equal((await importFirestore(prepared)).status, 'validated_dry_run');
  assert.equal(await Student.countDocuments(), 0);
  assert.equal(await FirestoreArchive.countDocuments(), 0);
  assert.equal((await importFirestore(prepared, true)).status, 'imported');
  const verified = await verifyFirestoreImport(prepared);
  assert.equal(verified.archivedDocuments, fixture().length);
  assert.equal(await Note.countDocuments(), 3);
  assert.equal(await Enseignant.countDocuments(), 2);
  const incomplete = await Student.findOne({ sexe: '' });
  assert.equal(incomplete?.dateNaissance, null);
  assert.equal(incomplete?.matricule, undefined);
  const serialized = await studentService.getById(String(incomplete!._id));
  assert.equal(serialized.dateNaissance, '');
  assert.equal(serialized.sexe, '');
  assert.ok(serialized.createdAt);
  assert.equal((await importFirestore(prepared, true)).status, 'already_imported');
  assert.equal(await FirestoreMigrationRun.countDocuments(), 1);
  const periodIndexes = await mongoose.connection.db!.collection('periodes').indexes();
  assert.ok(
    periodIndexes.some(
      (index) =>
        index.name === 'unique_period_order_per_level' && index.partialFilterExpression,
    ),
  );
  assert.ok(
    periodIndexes.some(
      (index) =>
        index.name === 'unique_period_order_per_level_all' &&
        !index.partialFilterExpression,
    ),
  );
  assert.deepEqual(await NiveauClasse.find().lean(), originalHierarchy);
  process.env.JWT_SECRET = randomUUID();
  const { default: app } = await import('../src/app');
  const { default: User } = await import('../src/models/User');
  const admin = await User.create({
    username: 'Migration Test',
    email: 'migration@example.invalid',
    password: 'test-password-only',
    role: 'admin',
    status: 'active',
    isVerified: true,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const result = await promisify(execFile)(
      process.execPath,
      [
        resolve('node_modules/tsx/dist/cli.mjs'),
        '--tsconfig',
        resolve('../frontend/tsconfig.json'),
        resolve('../frontend/tests/helpers/migratedSyncScenario.ts'),
      ],
      {
        env: {
          ...process.env,
          SYNC_TEST_URL: `http://127.0.0.1:${address.port}/api/v1`,
          SYNC_TEST_TOKEN: jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET!, {
            expiresIn: '5m',
          }),
          SYNC_TEST_USER: String(admin._id),
        },
        timeout: 90000,
      },
    );
    assert.ok(result.stdout.includes('validées'), result.stdout + result.stderr);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test('MongoDB : une cible occupée est refusée sans toucher au dossier existant', async () => {
  await Student.create({ nom: 'Existant', prenom: 'Test', sexe: 'F' });
  await assert.rejects(
    importFirestore(await prepareFirestoreImport(input, decisions), true),
    /déjà des données/,
  );
  assert.equal(await Student.countDocuments(), 1);
  assert.equal(await FirestoreArchive.countDocuments(), 0);
});
test('MongoDB : une erreur tardive annule les données métier puis reprend depuis les archives intactes', async () => {
  const prepared = await prepareFirestoreImport(input, decisions);
  prepared.plan.entities.notes.push(prepared.plan.entities.notes[0]);
  await assert.rejects(importFirestore(prepared, true));
  assert.equal(await Student.countDocuments(), 0);
  assert.equal(await Note.countDocuments(), 0);
  assert.equal(await FirestoreArchive.countDocuments(), fixture().length);
  assert.equal(
    await FirestoreMigrationRun.countDocuments({ completedAt: { $exists: true } }),
    0,
  );
  prepared.plan.entities.notes.pop();
  assert.equal((await importFirestore(prepared, true)).status, 'imported');
  assert.equal(await Student.countDocuments(), 3);
  assert.equal(await Note.countDocuments(), 3);
  assert.equal(await FirestoreArchive.countDocuments(), fixture().length);
  assert.equal(await FirestoreMigrationRun.countDocuments({ status: 'complete' }), 1);
});
test('MongoDB : reprend un archivage interrompu sans réécrire les documents déjà conservés', async () => {
  const prepared = await prepareFirestoreImport(input, decisions);
  await archiveFirestoreDocuments(prepared.source.documents.slice(0, 4), prepared.sha256);
  const first = await FirestoreArchive.findOne().lean();
  assert.equal(await Student.countDocuments(), 0);
  assert.equal((await importFirestore(prepared, true)).status, 'imported');
  assert.deepEqual(await FirestoreArchive.findById(first!._id).lean(), first);
  assert.equal(
    (await verifyFirestoreImport(prepared)).archivedDocuments,
    fixture().length,
  );
});
test(
  'Répétition privée : export complet sur MongoDB isolé',
  { skip: !process.env.MIGRATION_REHEARSAL_SOURCE, timeout: 180000 },
  async () => {
    const prepared = await prepareFirestoreImport(
      resolve(process.env.MIGRATION_REHEARSAL_SOURCE!),
      decisions,
    );
    assert.equal((await importFirestore(prepared)).status, 'validated_dry_run');
    assert.equal((await importFirestore(prepared, true)).status, 'imported');
    const verified = await verifyFirestoreImport(prepared);
    assert.equal(verified.archivedDocuments, prepared.source.documents.length);
    assert.equal((await importFirestore(prepared, true)).status, 'already_imported');
    console.log(
      JSON.stringify({ rehearsal: prepared.plan.summary, verification: verified }),
    );
  },
);
