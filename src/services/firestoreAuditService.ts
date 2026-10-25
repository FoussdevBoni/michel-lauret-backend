import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { ExportValue } from '../types/features/FirestoreMigration';

const valueSchema: z.ZodType<ExportValue> = z.lazy(() => valueUnionSchema);
const valueUnionSchema: z.ZodType<ExportValue> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('null') }),
  z.object({ type: z.literal('boolean'), value: z.boolean() }),
  z.object({ type: z.literal('string'), value: z.string() }),
  z.object({ type: z.literal('integer'), value: z.string().regex(/^-?\d+$/) }),
  z.object({ type: z.literal('number'), value: z.string() }),
  z.object({
    type: z.literal('timestamp'),
    seconds: z.number().int(),
    nanoseconds: z.number().int().min(0).max(999999999),
  }),
  z.object({
    type: z.literal('geopoint'),
    latitude: z.number(),
    longitude: z.number(),
  }),
  z.object({ type: z.literal('reference'), path: z.string(), resource: z.string() }),
  z.object({ type: z.literal('bytes'), base64: z.string() }),
  z.object({ type: z.literal('array'), value: z.array(valueSchema) }),
  z.object({ type: z.literal('map'), value: z.record(valueSchema) }),
]);
const documentSchema = z.object({
  path: z
    .string()
    .refine((path) => path.split('/').length % 2 === 0 && !path.split('/').includes('')),
  exists: z.boolean(),
  fields: valueSchema.optional(),
  createTime: valueSchema.optional(),
  updateTime: valueSchema.optional(),
});
const exportSchema = z.object({
  format: z.literal('cpeg-firestore-export'),
  version: z.literal(1),
  projectId: z.string().min(1),
  databaseId: z.string().min(1),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  consistency: z.literal('live-non-atomic'),
  documents: z.array(documentSchema),
});
type SourceDocument = z.infer<typeof documentSchema>;
type Fields = Record<string, ExportValue>;
export interface MigrationIssue {
  code: string;
  paths: string[];
  field?: string;
}
function fieldsOf(document: SourceDocument): Fields {
  if (document.fields?.type !== 'map')
    throw new Error('Document présent sans champs exportés valides.');
  return document.fields.value;
}
function scalar(fields: Fields, key: string) {
  const value = fields[key];
  return value && ['string', 'integer', 'number'].includes(value.type)
    ? String((value as { value: string }).value).trim()
    : '';
}
function reference(
  fields: Fields,
  key: string,
  collection: string,
  project: string,
  database: string,
) {
  const value = fields[key];
  if (value?.type === 'reference') {
    const expected = `projects/${project}/databases/${database}/documents/`;
    return value.resource === `${expected}${value.path}` &&
      value.path.split('/').length === 2 &&
      value.path.startsWith(`${collection}/`)
      ? value.path
      : '';
  }
  const id = scalar(fields, key);
  return id && !id.includes('/') ? `${collection}/${id}` : '';
}
function addGroup(groups: Map<string, string[]>, key: string, path: string) {
  if (key) groups.set(key, [...(groups.get(key) ?? []), path]);
}
export function isLegacyBirthDate(value: string, now = new Date()) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const french = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!iso && !french) return false;
  const [year, month, day] = iso
    ? iso.slice(1).map(Number)
    : [Number(french![3]), Number(french![2]), Number(french![1])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1900 &&
    date <= now &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function auditFirestore(input: unknown) {
  const data = exportSchema.parse(input);
  const issues: MigrationIssue[] = [];
  const documents = data.documents.filter((document) => document.exists);
  const index = new Map<string, SourceDocument>();
  for (const document of data.documents) {
    if (index.has(document.path))
      throw new Error('Chemin de document dupliqué dans l’export.');
    index.set(document.path, document);
    if (document.exists) fieldsOf(document);
  }
  const collections: Record<
    string,
    { documents: number; fields: Record<string, number> }
  > = Object.create(null);
  const matricules = new Map<string, string[]>();
  const teacherEmails = new Map<string, string[]>();
  const notes = new Map<string, string[]>();
  const classes = new Map<string, number>();
  const subjects = new Map<string, number>();
  const evaluations = new Map<string, number>();
  const periods = new Map<string, number>();
  const years = new Map<string, number>();
  const noteDates: string[] = [];
  const creationDates: string[] = [];
  const noteMonths = new Map<string, number>();
  const issue = (code: string, document: SourceDocument, field?: string) =>
    issues.push({ code, paths: [document.path], ...(field ? { field } : {}) });
  const count = (map: Map<string, number>, value: string) => {
    if (value) map.set(value, (map.get(value) ?? 0) + 1);
  };
  for (const document of documents) {
    const parts = document.path.split('/');
    const collection = parts.slice(0, -1).join('/');
    const fields = fieldsOf(document);
    const stats = (collections[collection] ??= {
      documents: 0,
      fields: Object.create(null),
    });
    stats.documents++;
    for (const name of Object.keys(fields))
      stats.fields[name] = (stats.fields[name] ?? 0) + 1;
    // Les sous-collections sont inventoriées, sans les confondre avec les entités racines.
    if (parts.length !== 2) continue;
    if (collection === 'students' || collection === 'teachers') {
      for (const field of ['firstname', 'lastname'])
        if (!scalar(fields, field)) issue('missing_identity', document, field);
    }
    if (collection === 'students') {
      const matricule = scalar(fields, 'matricule').toUpperCase();
      if (!matricule) issue('missing_matricule', document, 'matricule');
      addGroup(matricules, matricule, document.path);
      if (!isLegacyBirthDate(scalar(fields, 'naissance')))
        issue('invalid_birth_date', document, 'naissance');
      if (!['M', 'F'].includes(scalar(fields, 'sexe').toUpperCase()))
        issue('sex_requires_mapping', document, 'sexe');
      const classe = scalar(fields, 'classe');
      if (!classe) issue('missing_class', document, 'classe');
      count(classes, classe);
      if (scalar(fields, 'photo')) issue('photo_to_transfer', document, 'photo');
    }
    if (collection === 'teachers')
      addGroup(teacherEmails, scalar(fields, 'email').toLowerCase(), document.path);
    if (collection === 'observations') {
      const student = reference(
        fields,
        'eleveId',
        'students',
        data.projectId,
        data.databaseId,
      );
      if (!student || !index.get(student)?.exists)
        issue('unresolved_observation_student', document, 'eleveId');
    }
    if (collection === 'modificationNotes' && !scalar(fields, 'noteId'))
      issue('history_without_stable_note_reference', document, 'noteId');
    if (collection === 'notes') {
      const student = reference(
        fields,
        'eleveId',
        'students',
        data.projectId,
        data.databaseId,
      );
      const teacher = reference(
        fields,
        'enseignantId',
        'teachers',
        data.projectId,
        data.databaseId,
      );
      if (!student || !index.get(student)?.exists)
        issue('unresolved_student', document, 'eleveId');
      if (!teacher || !index.get(teacher)?.exists)
        issue('unresolved_teacher', document, 'enseignantId');
      const raw = scalar(fields, 'note');
      const numeric = /^\d+(?:[.,]\d+)?$/.test(raw) ? Number(raw.replace(',', '.')) : NaN;
      if (!Number.isFinite(numeric) || numeric < 0)
        issue('invalid_grade', document, 'note');
      else if (numeric > 20) issue('grade_above_20_requires_scale', document, 'note');
      const year = scalar(fields, 'anneeScolaire');
      if (
        !/^\d{4}-\d{4}$/.test(year) ||
        Number(year.slice(5)) !== Number(year.slice(0, 4)) + 1
      )
        issue('school_year_requires_confirmation', document, 'anneeScolaire');
      const classe = scalar(fields, 'classe');
      const subject = scalar(fields, 'matiere');
      const period = scalar(fields, 'trimestre');
      const evaluation = scalar(fields, 'evaluation');
      for (const [field, value] of Object.entries({
        classe,
        matiere: subject,
        trimestre: period,
        evaluation,
      }))
        if (!value) issue('missing_grade_context', document, field);
      if (period && !['1', '2', '3'].includes(period))
        issue('period_requires_mapping', document, 'trimestre');
      if (
        student &&
        index.get(student)?.exists &&
        classe &&
        scalar(fieldsOf(index.get(student)!), 'classe') !== classe
      )
        issue('historical_class_differs', document, 'classe');
      if (student && subject && period && evaluation)
        addGroup(
          notes,
          JSON.stringify([
            student,
            year,
            classe,
            subject.trim().toLowerCase(),
            period,
            evaluation.trim().toLowerCase(),
          ]),
          document.path,
        );
      count(classes, classe);
      count(subjects, subject);
      count(evaluations, evaluation);
      count(periods, period);
      count(years, year);
      const date = scalar(fields, 'date');
      if (/^\d{4}-\d{2}-\d{2}T/.test(date) && !Number.isNaN(Date.parse(date))) {
        noteDates.push(date);
        count(noteMonths, new Date(date).toISOString().slice(0, 7));
      }
      if (document.createTime?.type === 'timestamp')
        creationDates.push(new Date(document.createTime.seconds * 1000).toISOString());
    }
  }
  for (const [groups, code] of [
    [matricules, 'duplicate_matricule'],
    [teacherEmails, 'duplicate_teacher_email'],
    [notes, 'duplicate_grade_context'],
  ] as const)
    for (const paths of groups.values())
      if (paths.length > 1) issues.push({ code, paths });
  noteDates.sort((a, b) => Date.parse(a) - Date.parse(b));
  creationDates.sort();
  const counts = Object.fromEntries(
    [...new Set(issues.map((item) => item.code))]
      .sort()
      .map((code) => [code, issues.filter((item) => item.code === code).length]),
  );
  return {
    format: 'cpeg-firestore-audit',
    version: 1,
    projectId: data.projectId,
    databaseId: data.databaseId,
    sourceCompletedAt: data.completedAt,
    analyzedAt: new Date().toISOString(),
    documents: documents.length,
    missingParents: data.documents.length - documents.length,
    collections,
    issueCounts: counts,
    issues,
    distributions: {
      classes: Object.fromEntries(classes),
      subjects: Object.fromEntries(subjects),
      evaluations: Object.fromEntries(evaluations),
      periods: Object.fromEntries(periods),
      explicitSchoolYears: Object.fromEntries(years),
      gradeMonths: Object.fromEntries(
        [...noteMonths].sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
    gradeDates: { earliest: noteDates[0] ?? null, latest: noteDates.at(-1) ?? null },
    gradeCreationDates: {
      earliest: creationDates[0] ?? null,
      latest: creationDates.at(-1) ?? null,
    },
    mongoWrites: 0,
  };
}

export async function readVerifiedFirestoreExport(path: string) {
  const bytes = await readFile(path);
  const report = JSON.parse(await readFile(join(dirname(path), 'report.json'), 'utf8'));
  if (createHash('sha256').update(bytes).digest('hex') !== report.sha256)
    throw new Error('Empreinte de l’export différente du rapport.');
  const source = exportSchema.parse(JSON.parse(bytes.toString('utf8')));
  const result = auditFirestore(source);
  if (
    result.documents !== report.documents ||
    result.missingParents !== report.missingParents ||
    result.projectId !== report.projectId ||
    result.databaseId !== report.databaseId
  )
    throw new Error('Rapport et export incohérents.');
  return { source, audit: result, sha256: String(report.sha256) };
}

export async function auditFirestoreFile(path: string) {
  const { audit: result } = await readVerifiedFirestoreExport(path);
  const output = join(dirname(path), 'audit.json');
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  return { file: output, result };
}
