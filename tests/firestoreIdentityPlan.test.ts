import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  planFirestoreIdentities,
  normalizeLegacySex,
} from '../src/services/firestoreIdentityPlanService';
import type {
  ExportedFirestoreDocument,
  ExportValue,
} from '../src/types/features/FirestoreMigration';

function document(
  path: string,
  fields: Record<string, string>,
): ExportedFirestoreDocument {
  return {
    path,
    exists: true,
    fields: {
      type: 'map',
      value: Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [
          key,
          { type: 'string', value } as ExportValue,
        ]),
      ),
    },
  };
}
const student = {
  firstname: ' Élise ',
  lastname: ' Dossou ',
  naissance: '29/02/2012',
  sexe: 'Féminin',
  matricule: ' ml-01 ',
  phone: '001234',
  classe: '6ème',
  photo: 'https://example.invalid/photo',
};
test('Plan identités : adapte les valeurs des vrais formulaires historiques aux types actuels', () => {
  const source = document('students/a', student);
  const before = JSON.stringify(source);
  const plan = planFirestoreIdentities([source]);
  assert.equal(normalizeLegacySex('Masculin'), 'M');
  assert.equal(normalizeLegacySex('Féminin'), 'F');
  assert.equal(plan.rows[0].identityReady, true);
  assert.equal(plan.rows[0].candidate.nom, 'Dossou');
  assert.equal(
    (plan.rows[0].candidate as { dateNaissance: string }).dateNaissance,
    '2012-02-29',
  );
  assert.equal((plan.rows[0].candidate as { contact: string }).contact, '001234');
  assert.deepEqual(plan.rows[0].dependencies, { classe: '6ème', photo: student.photo });
  assert.equal(JSON.stringify(source), before);
  assert.equal(plan.mongoWrites, 0);
});
test('Plan identités : ne fabrique ni naissance, ni sexe, ni matricule manquant', () => {
  const plan = planFirestoreIdentities([
    document('students/a', {
      ...student,
      naissance: '2011-02-29',
      sexe: 'inconnu',
      matricule: '',
    }),
  ]);
  assert.equal(plan.rows[0].identityReady, false);
  assert.ok(plan.rows[0].issues.includes('invalid_dateNaissance'));
  assert.ok(plan.rows[0].issues.includes('invalid_sexe'));
  assert.ok(plan.rows[0].issues.includes('missing_matricule'));
});
test('Plan identités : bloque les deux matricules identiques et conserve les affectations enseignantes à résoudre', () => {
  const plan = planFirestoreIdentities([
    document('students/a', student),
    document('students/b', { ...student, matricule: 'ML-01' }),
    document('teachers/t', {
      firstname: 'Prof',
      lastname: 'Test',
      email: ' PROF@EXAMPLE.INVALID ',
      phone: '0012',
      classes: '6ème',
      matiere: 'Mathématiques',
    }),
  ]);
  assert.equal(plan.rows[0].identityReady, false);
  assert.equal(plan.rows[1].identityReady, false);
  assert.equal(plan.rows[2].identityReady, true);
  assert.deepEqual(plan.rows[2].dependencies, {
    classes: ['6ème'],
    matiere: 'Mathématiques',
  });
  assert.equal(
    (plan.rows[2].candidate as { email: string }).email,
    'prof@example.invalid',
  );
  assert.equal(plan.scope, 'identities-only');
});
test('Plan identités : un statut inconnu et un email invalide restent à corriger', () => {
  const plan = planFirestoreIdentities([
    document('students/a', { ...student, statut: 'redoublant' }),
    document('teachers/t', { firstname: 'Prof', lastname: 'Test', email: 'incorrect' }),
    document('students/a/history/h', student),
  ]);
  assert.equal(plan.rows.length, 2);
  assert.equal(plan.rows[0].identityReady, false);
  assert.equal(plan.rows[1].identityReady, false);
});
