import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { studentInputSchema } from '../types/features/Student';
import { teacherInputSchema } from '../types/features/Teacher';
import type {
  ExportedFirestoreDocument,
  ExportValue,
} from '../types/features/FirestoreMigration';
import { isLegacyBirthDate, readVerifiedFirestoreExport } from './firestoreAuditService';

function scalar(value: ExportValue | undefined) {
  if (value?.type === 'string' || value?.type === 'number' || value?.type === 'integer')
    return value.value.trim();
  return '';
}
export function normalizeLegacySex(value: string) {
  const key = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  if (['F', 'FEMININ', 'FEMININE', 'FILLE'].includes(key)) return 'F';
  if (['M', 'MASCULIN', 'GARCON'].includes(key)) return 'M';
  return null;
}
function birthDate(value: string) {
  if (!isLegacyBirthDate(value)) return value;
  const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  return parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : value;
}
export function planFirestoreIdentities(documents: ExportedFirestoreDocument[]) {
  const rows = documents
    .filter(
      (document) => document.exists && /^(students|teachers)\/[^/]+$/.test(document.path),
    )
    .map((document) => {
      if (document.fields?.type !== 'map') throw new Error('Identité sans champs typés.');
      const fields = document.fields.value;
      const text = (name: string) => scalar(fields[name]);
      const isStudent = document.path.startsWith('students/');
      const candidate = isStudent
        ? {
            nom: text('lastname'),
            prenom: text('firstname'),
            dateNaissance: birthDate(text('naissance')),
            sexe: text('sexe') ? normalizeLegacySex(text('sexe')) : '',
            matricule: text('matricule').toUpperCase(),
            contact: text('phone'),
            statut: text('statut') || 'actif',
          }
        : {
            nom: text('lastname'),
            prenom: text('firstname'),
            email: text('email').toLowerCase(),
            tel: text('phone'),
            enseignements: [],
          };
      const parsed = isStudent
        ? studentInputSchema.safeParse(candidate)
        : teacherInputSchema.safeParse(candidate);
      const issues = parsed.success
        ? []
        : parsed.error.issues.map((issue) => `invalid_${issue.path.join('_')}`);
      if (isStudent && !text('matricule')) issues.push('missing_matricule');
      const photo = text('photo');
      const classes =
        fields.classes?.type === 'array'
          ? fields.classes.value.map(scalar).filter(Boolean)
          : text('classes')
            ? [text('classes')]
            : [];
      return {
        sourcePath: document.path,
        entity: isStudent ? 'student' : 'teacher',
        identityReady: false,
        candidate: parsed.success ? parsed.data : candidate,
        issues,
        // Ces références sont conservées pour la prochaine étape, pas ignorées.
        dependencies: isStudent
          ? { classe: text('classe'), photo }
          : { classes, matiere: text('matiere') },
      };
    });
  for (const [entity, field] of [
    ['student', 'matricule'],
    ['teacher', 'email'],
  ] as const) {
    const groups = new Map<string, typeof rows>();
    for (const row of rows.filter((row) => row.entity === entity)) {
      const key = String((row.candidate as Record<string, unknown>)[field] ?? '');
      if (key) groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const group of groups.values())
      if (group.length > 1)
        for (const row of group) row.issues.push(`duplicate_${field}`);
  }
  for (const row of rows) row.identityReady = row.issues.length === 0;
  return {
    format: 'cpeg-firestore-identity-plan',
    version: 1,
    scope: 'identities-only',
    mongoWrites: 0,
    summary: Object.fromEntries(
      ['student', 'teacher'].map((entity) => [
        entity,
        {
          total: rows.filter((row) => row.entity === entity).length,
          identityReady: rows.filter((row) => row.entity === entity && row.identityReady)
            .length,
          blocked: rows.filter((row) => row.entity === entity && !row.identityReady)
            .length,
        },
      ]),
    ),
    rows,
  };
}
export async function writeFirestoreIdentityPlan(path: string) {
  const verified = await readVerifiedFirestoreExport(path);
  const plan = {
    ...planFirestoreIdentities(verified.source.documents),
    sourceSha256: verified.sha256,
    projectId: verified.source.projectId,
    generatedAt: new Date().toISOString(),
  };
  const output = join(dirname(path), 'identity-plan.json');
  await writeFile(output, JSON.stringify(plan, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  return { file: output, summary: plan.summary, mongoWrites: 0 };
}
