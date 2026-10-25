import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { test } from 'node:test';
import {
  auditFirestore,
  auditFirestoreFile,
  isLegacyBirthDate,
} from '../src/services/firestoreAuditService';

function encode(value: unknown): unknown {
  if (value === null) return { type: 'null' };
  if (typeof value === 'string') return { type: 'string', value };
  if (typeof value === 'number') return { type: 'integer', value: String(value) };
  if (Array.isArray(value)) return { type: 'array', value: value.map(encode) };
  return {
    type: 'map',
    value: Object.fromEntries(
      Object.entries(value as object).map(([key, item]) => [key, encode(item)]),
    ),
  };
}
function record(path: string, data: object) {
  return { path, exists: true, fields: encode(data) };
}
const student = {
  firstname: 'Test',
  lastname: 'Recette',
  matricule: 'ML-01',
  naissance: '2012-02-29',
  sexe: 'F',
  classe: '6ème',
};
const note = {
  eleveId: 'a',
  enseignantId: 't',
  note: '0',
  trimestre: 1,
  evaluation: '1er devoir',
  matiere: 'Mathématiques',
  classe: '6ème',
  anneeScolaire: '2025-2026',
};
function fixture(extra: unknown[] = []) {
  return {
    format: 'cpeg-firestore-export',
    version: 1,
    projectId: 'test-project',
    databaseId: '(default)',
    startedAt: '2026-10-17T10:00:00.000Z',
    completedAt: '2026-10-17T10:01:00.000Z',
    consistency: 'live-non-atomic',
    documents: [
      record('students/a', student),
      record('teachers/t', {
        firstname: 'Prof',
        lastname: 'Test',
        email: 'prof@example.invalid',
      }),
      record('notes/n', note),
      ...extra,
    ],
  };
}
test('Audit : zéro reste une note valide, les collections et champs sont comptés sans modifier la source', () => {
  const input = fixture();
  const previous = JSON.stringify(input);
  const result = auditFirestore(input);
  assert.equal(result.documents, 3);
  assert.equal(result.collections.notes.fields.note, 1);
  assert.deepEqual(result.issueCounts, {});
  assert.equal(result.mongoWrites, 0);
  assert.equal(JSON.stringify(input), previous);
});
test('Audit : repère les doublons de matricule, email et contexte de note sans fusionner les documents', () => {
  const result = auditFirestore(
    fixture([
      record('students/b', { ...student, matricule: ' ml-01 ' }),
      record('teachers/u', {
        firstname: 'Autre',
        lastname: 'Prof',
        email: ' PROF@EXAMPLE.INVALID ',
      }),
      record('notes/m', { ...note, note: '12,5' }),
    ]),
  );
  assert.equal(result.documents, 6);
  for (const code of [
    'duplicate_matricule',
    'duplicate_teacher_email',
    'duplicate_grade_context',
  ])
    assert.equal(result.issueCounts[code], 1);
  assert.equal(result.issueCounts.invalid_grade, undefined);
});
test('Audit : distingue références orphelines, année absente, valeur vide et barème à confirmer', () => {
  const result = auditFirestore(
    fixture([
      record('notes/invalid', {
        ...note,
        eleveId: 'missing',
        enseignantId: '',
        anneeScolaire: '',
        note: '',
      }),
      record('notes/high', { ...note, note: '25', evaluation: 'Autre' }),
    ]),
  );
  assert.equal(result.issueCounts.unresolved_student, 1);
  assert.equal(result.issueCounts.unresolved_teacher, 1);
  assert.equal(result.issueCounts.school_year_requires_confirmation, 1);
  assert.equal(result.issueCounts.invalid_grade, 1);
  assert.equal(result.issueCounts.grade_above_20_requires_scale, 1);
});
test('Audit : signale les anciennes classes et conserve les sous-collections inconnues', () => {
  const result = auditFirestore(
    fixture([
      record('notes/old', { ...note, classe: '5ème' }),
      record('students/a/history/one', { matricule: 'ML-01' }),
      { path: 'archive/absent', exists: false },
    ]),
  );
  assert.equal(result.issueCounts.historical_class_differs, 1);
  assert.equal(result.issueCounts.duplicate_matricule, undefined);
  assert.equal(result.collections['students/a/history'].documents, 1);
  assert.equal(result.missingParents, 1);
});
test('Audit : vérifie le projet et la base des références Firestore typées', () => {
  const input = fixture();
  const grade = input.documents[2] as { fields: { value: Record<string, unknown> } };
  grade.fields.value.eleveId = {
    type: 'reference',
    path: 'students/a',
    resource: 'projects/foreign/databases/(default)/documents/students/a',
  };
  assert.equal(auditFirestore(input).issueCounts.unresolved_student, 1);
  grade.fields.value.eleveId = {
    type: 'reference',
    path: 'students/a',
    resource: 'projects/test-project/databases/(default)/documents/students/a',
  };
  assert.equal(auditFirestore(input).issueCounts.unresolved_student, undefined);
});
test('Audit : contrôle strictement les dates calendaires et les années scolaires', () => {
  assert.equal(isLegacyBirthDate('29/02/2012'), true);
  assert.equal(isLegacyBirthDate('2011-02-29'), false);
  assert.equal(isLegacyBirthDate('2030-01-01', new Date('2026-10-17')), false);
  const result = auditFirestore(
    fixture([record('notes/wrong-year', { ...note, anneeScolaire: '2025-2027' })]),
  );
  assert.equal(result.issueCounts.school_year_requires_confirmation, 1);
});
test('Audit : refuse un export partiel ou deux chemins identiques', () => {
  assert.throws(() => auditFirestore({ ...fixture(), completedAt: undefined }));
  assert.throws(
    () => auditFirestore(fixture([record('students/a', student)])),
    /dupliqué/,
  );
});

test('Audit : conserve séparément les dates de création, les commentaires orphelins et les historiques sans identifiant', () => {
  const input = fixture([
    record('observations/a', { eleveId: 'missing', message: 'Commentaire fictif' }),
    record('modificationNotes/a', { ancienneNote: '10', nouvelleNote: '12' }),
  ]);
  Object.assign(input.documents[2], {
    createTime: { type: 'timestamp', seconds: 1700000000, nanoseconds: 0 },
  });
  const result = auditFirestore(input);
  assert.equal(result.issueCounts.unresolved_observation_student, 1);
  assert.equal(result.issueCounts.history_without_stable_note_reference, 1);
  assert.equal(result.gradeCreationDates.earliest, '2023-11-14T22:13:20.000Z');
});
test('Audit : contrôle le SHA-256 et refuse d’écraser un rapport existant', async () => {
  await mkdir(resolve('.local'), { recursive: true });
  const root = await mkdtemp(resolve('.local/firestore-audit-test-'));
  const input = fixture();
  const content = JSON.stringify(input);
  const file = join(root, 'firestore.json');
  await writeFile(file, content);
  const report = {
    projectId: input.projectId,
    databaseId: input.databaseId,
    documents: 3,
    missingParents: 0,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
  await writeFile(join(root, 'report.json'), JSON.stringify(report));
  const result = await auditFirestoreFile(file);
  const saved = await readFile(result.file, 'utf8');
  await assert.rejects(auditFirestoreFile(file), { code: 'EEXIST' });
  assert.equal(await readFile(result.file, 'utf8'), saved);
  await writeFile(file, content + ' ');
  await assert.rejects(auditFirestoreFile(file), /Empreinte/);
});
