import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { GeoPoint, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { encodeFirestoreValue } from '../src/lib/firestoreExportValue';
import { createFirebaseMigrationSource } from '../src/lib/firebaseMigrationSource';
import { exportFirestore } from '../src/services/firestoreExportService';
import type { FirestoreExportSource } from '../src/types/features/FirestoreMigration';

await mkdir(resolve('.local'), { recursive: true });
const root = await mkdtemp(resolve('.local/firestore-export-test-'));
function source(): FirestoreExportSource {
  return {
    projectId: 'cpeg-test',
    databaseId: '(default)',
    async collections(parent) {
      return parent === undefined
        ? ['students', 'extra']
        : parent === 'students/missing'
          ? ['students/missing/history']
          : [];
    },
    async *documents(collection) {
      if (collection === 'students') {
        yield {
          path: 'students/a',
          exists: true,
          fields: encodeFirestoreValue({ lastname: 'Test' }),
        };
        yield { path: 'students/missing', exists: false };
      } else if (collection === 'extra') {
        yield {
          path: 'extra/unknown',
          exists: true,
          fields: encodeFirestoreValue({ arbitrary: true }),
        };
      } else {
        yield {
          path: `${collection}/one`,
          exists: true,
          fields: encodeFirestoreValue({ old: 'value' }),
        };
      }
    },
  };
}

test('Export Firestore : découvre les collections inconnues et les descendants des parents absents', async () => {
  const result = await exportFirestore(source(), root);
  const content = await readFile(result.file, 'utf8');
  const data = JSON.parse(content);
  assert.equal(data.format, 'cpeg-firestore-export');
  assert.equal(data.consistency, 'live-non-atomic');
  assert.deepEqual(
    data.documents.map((item: { path: string }) => item.path),
    ['students/a', 'students/missing', 'students/missing/history/one', 'extra/unknown'],
  );
  assert.equal(result.report.documents, 3);
  assert.equal(result.report.missingParents, 1);
  assert.equal(result.report.collections['students/missing/history'], 1);
  assert.equal(result.report.sha256, createHash('sha256').update(content).digest('hex'));
  assert.deepEqual(
    JSON.parse(await readFile(join(result.directory, 'report.json'), 'utf8')),
    result.report,
  );
  assert.deepEqual((await readdir(result.directory)).sort(), [
    'firestore.json',
    'report.json',
  ]);
});

test('Export Firestore : une erreur conserve seulement un fichier partiel, sans rapport de succès', async () => {
  const output = await mkdtemp(join(root, 'failure-'));
  const input = source();
  input.documents = async function* () {
    yield { path: 'students/a', exists: true, fields: encodeFirestoreValue({ note: 0 }) };
    throw new Error('Coupure réseau simulée');
  };
  await assert.rejects(exportFirestore(input, output), /Coupure réseau/);
  const [folder] = await readdir(output);
  assert.deepEqual(await readdir(join(output, folder)), ['firestore.partial.json']);
});

test('Export Firestore : relancer crée un nouvel export sans écraser le précédent', async () => {
  const first = await exportFirestore(source(), root);
  const content = await readFile(first.file, 'utf8');
  const second = await exportFirestore(source(), root);
  assert.notEqual(first.directory, second.directory);
  assert.equal(await readFile(first.file, 'utf8'), content);
});

test('Export Firestore : conserve entiers 64 bits, nanosecondes, coordonnées, octets et références', async () => {
  const app = initializeApp({ projectId: 'cpeg-test' }, 'export-codec-test');
  const firestore = getFirestore(app);
  try {
    const encoded = encodeFirestoreValue({
      integer: 9223372036854775807n,
      timestamp: new Timestamp(1700000000, 123456789),
      point: new GeoPoint(6.5, 2.6),
      bytes: Buffer.from([0, 255]),
      reference: firestore.doc('students/a'),
      numbers: [0, -0, NaN, Infinity, -Infinity],
      nested: { type: 'timestamp', seconds: 'vrai champ métier' },
    });
    assert.equal(encoded.type, 'map');
    if (encoded.type !== 'map') return;
    assert.deepEqual(encoded.value.integer, {
      type: 'integer',
      value: '9223372036854775807',
    });
    assert.deepEqual(encoded.value.timestamp, {
      type: 'timestamp',
      seconds: 1700000000,
      nanoseconds: 123456789,
    });
    assert.deepEqual(encoded.value.point, {
      type: 'geopoint',
      latitude: 6.5,
      longitude: 2.6,
    });
    assert.deepEqual(encoded.value.bytes, { type: 'bytes', base64: 'AP8=' });
    assert.deepEqual(encoded.value.reference, {
      type: 'reference',
      path: 'students/a',
      resource: 'projects/cpeg-test/databases/(default)/documents/students/a',
    });
    assert.deepEqual(encoded.value.numbers, {
      type: 'array',
      value: ['0', '-0', 'NaN', 'Infinity', '-Infinity'].map((value) => ({
        type: 'number',
        value,
      })),
    });
    assert.equal(encoded.value.nested.type, 'map');
    assert.deepEqual(JSON.parse(JSON.stringify(encoded)), encoded);
  } finally {
    await firestore.terminate();
    await deleteApp(app);
  }
});

test('Export Firestore : refuse un type inconnu au lieu de le supprimer silencieusement', () => {
  assert.throws(() => encodeFirestoreValue(undefined), /non pris en charge/);
  assert.throws(() => encodeFirestoreValue(new Map()), /non pris en charge/);
});

test('Export Firestore : refuse un document dont le chemin ne correspond pas à la collection', async () => {
  const input = source();
  input.documents = async function* () {
    yield { path: 'teachers/a', exists: false };
  };
  await assert.rejects(exportFirestore(input, root), /Chemin de document/);
});

test('Export Firestore : refuse un compte de service d’un autre projet avant toute connexion', async () => {
  const path = join(root, 'fake-credentials.json');
  await writeFile(
    path,
    JSON.stringify({
      type: 'service_account',
      project_id: 'other-project',
      client_email: 'test@example.invalid',
      private_key: 'fake',
    }),
  );
  await assert.rejects(
    createFirebaseMigrationSource(path, 'cpeg-test'),
    /projet différent/,
  );
});
