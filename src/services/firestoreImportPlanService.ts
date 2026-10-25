import { createHash } from 'node:crypto';
import { studentInputSchema } from '../types/features/Student';
import { teacherInputSchema } from '../types/features/Teacher';
import { normalizeMatiereName } from '../types/features/Matiere';
import { normalizeEvaluationName } from '../types/features/Evaluation';
import { normalizeLegacySex } from './firestoreIdentityPlanService';
import type {
  ExportedFirestoreDocument,
  ExportValue,
  MigrationLevel,
  MigrationDecisions,
  ImportDocument,
} from '../types/features/FirestoreMigration';

type Fields = Record<string, ExportValue>;
const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[,;]+$/, '');
const fieldsOf = (document: ExportedFirestoreDocument): Fields => {
  if (document.fields?.type !== 'map') throw new Error('Document source sans champs.');
  return document.fields.value;
};
const text = (fields: Fields, key: string) => {
  const value = fields[key];
  return value?.type === 'string' || value?.type === 'integer' || value?.type === 'number'
    ? value.value.trim()
    : '';
};
const numeric = (value: string) =>
  /^\d+(?:[.,]\d+)?$/.test(value) ? Number(value.replace(',', '.')) : NaN;
const subjectName = (value: string) =>
  fold(value) === 'histore-geographie' ? 'Histoire-Géographie' : value;
function identity(fields: Fields) {
  const rawBirth = text(fields, 'naissance');
  const french = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(rawBirth);
  return studentInputSchema.parse({
    nom: text(fields, 'lastname'),
    prenom: text(fields, 'firstname'),
    dateNaissance: french ? `${french[3]}-${french[2]}-${french[1]}` : rawBirth,
    sexe: text(fields, 'sexe') ? normalizeLegacySex(text(fields, 'sexe')) : '',
    matricule: text(fields, 'matricule'),
    contact: text(fields, 'phone'),
    statut: text(fields, 'statut') || 'actif',
  });
}
function timestamp(value: ExportValue | undefined) {
  return value?.type === 'timestamp'
    ? new Date(value.seconds * 1000 + Math.floor(value.nanoseconds / 1000000))
    : undefined;
}

export function buildFirestoreImportPlan(
  source: {
    projectId: string;
    databaseId: string;
    sha256?: string;
    documents: ExportedFirestoreDocument[];
  },
  levels: MigrationLevel[],
  decisions: MigrationDecisions,
) {
  if (
    !/^\d{4}-\d{4}$/.test(decisions.schoolYear) ||
    Number(decisions.schoolYear.slice(5)) !==
      Number(decisions.schoolYear.slice(0, 4)) + 1 ||
    decisions.preserveUnknownBirthDates !== true ||
    decisions.preserveUnknownSex !== true ||
    decisions.deferConflictingAssignments !== true
  )
    throw new Error('Décisions de migration invalides.');
  const id = (kind: string, key: string) =>
    createHash('sha256')
      .update(JSON.stringify([source.projectId, source.databaseId, kind, key]))
      .digest('hex')
      .slice(0, 24);
  const plannedAt = new Date();
  const base = (
    kind: string,
    key: string,
    document?: ExportedFirestoreDocument,
  ): ImportDocument => ({
    _id: id(kind, key),
    __v: 0,
    isDeleted: false,
    createdAt: timestamp(document?.createTime) ?? plannedAt,
    updatedAt: timestamp(document?.updateTime) ?? plannedAt,
  });
  const sourceDocuments = source.documents.filter(
    (document) => document.exists && document.path.split('/').length === 2,
  );
  const studentSources = sourceDocuments.filter((document) =>
    document.path.startsWith('students/'),
  );
  const teacherSources = sourceDocuments.filter((document) =>
    document.path.startsWith('teachers/'),
  );
  const gradeSources = sourceDocuments.filter((document) =>
    document.path.startsWith('notes/'),
  );
  const teacherIndex = new Map(
    teacherSources.map((document) => [document.path.slice(9), document]),
  );
  const students: ImportDocument[] = [];
  const classes = new Map<string, ImportDocument>();
  const subjects = new Map<string, ImportDocument>();
  const evaluations = new Map<string, ImportDocument>();
  const inscriptions = new Map<string, ImportDocument>();
  const studentFields = new Map<string, Fields>();
  const sourceToTarget: Record<string, string> = Object.create(null);
  const studentOrigins = new Map<string, ExportedFirestoreDocument>();
  const pending = {
    incompleteStudents: [] as {
      studentId: string;
      sourcePath: string;
      missing: string[];
    }[],
    assignments: [] as { classe: string; matiere: string; teacherPaths: string[] }[],
    grades: [] as { sourcePaths: string[]; reason: string }[],
    recoveredStudents: [] as {
      sourcePath: string;
      fromNotes: string[];
      matchedExisting: boolean;
    }[],
    registrationDates: 'premiere_trace_source' as const,
  };
  const getClass = (name: string) => {
    const key = fold(name);
    if (classes.has(key)) return classes.get(key)!;
    const matches = levels.filter((level) => fold(level.nom) === key);
    if (matches.length !== 1) throw new Error('Niveau de classe cible absent ou ambigu.');
    const level = matches[0];
    const document = {
      ...base('classe', level._id),
      nom: name,
      niveauClasseId: level._id,
      cycleId: level.cycleId,
      niveauScolaireId: level.niveauScolaireId,
      effectifF: 0,
      effectifM: 0,
      inscriptionRevision: 0,
    };
    classes.set(key, document);
    return document;
  };
  const getSubject = (classe: ImportDocument, raw: string) => {
    const name = subjectName(raw);
    const key = `${classe.niveauClasseId}:${normalizeMatiereName(name)}`;
    if (subjects.has(key)) return subjects.get(key)!;
    const advanced = ['4eme', '3eme'].includes(fold(String(classe.nom)));
    const coefficient = advanced
      ? fold(name) === 'mathematiques'
        ? 3
        : fold(name) === 'eps' || fold(name) === 'conduite'
          ? 1
          : 2
      : 1;
    const document = {
      ...base('matiere', key),
      nom: name,
      nomNormalise: normalizeMatiereName(name),
      coefficient,
      niveauClasseId: classe.niveauClasseId,
      cycleId: classe.cycleId,
      niveauScolaireId: classe.niveauScolaireId,
      referenceRevision: 0,
    };
    subjects.set(key, document);
    return document;
  };
  const putStudent = (document: ExportedFirestoreDocument, historical = false) => {
    const fields = fieldsOf(document);
    const data = identity(fields);
    const record = {
      ...base('student', document.path, document),
      ...data,
      dateNaissance: data.dateNaissance
        ? new Date(data.dateNaissance + 'T00:00:00Z')
        : null,
      statut: historical ? 'inactif' : data.statut,
      inscriptionRevision: 0,
    };
    if (!data.matricule) delete (record as { matricule?: string }).matricule;
    if (
      data.matricule &&
      students.some((student) => student.matricule === data.matricule)
    )
      throw new Error('Matricule source ambigu.');
    students.push(record);
    const missing = ['dateNaissance', 'sexe', 'matricule'].filter(
      (field) => !record[field as keyof typeof record],
    );
    if (missing.length)
      pending.incompleteStudents.push({
        studentId: record._id,
        sourcePath: document.path,
        missing,
      });
    sourceToTarget[document.path] = record._id;
    studentFields.set(record._id, fields);
    studentOrigins.set(record._id, document);
    return record;
  };
  for (const document of studentSources) putStudent(document);
  const orphanGroups = new Map<string, ExportedFirestoreDocument[]>();
  for (const document of gradeSources) {
    const key = `students/${text(fieldsOf(document), 'eleveId')}`;
    if (!sourceToTarget[key])
      orphanGroups.set(key, [...(orphanGroups.get(key) ?? []), document]);
  }
  for (const [key, documents] of orphanGroups) {
    if (key === 'students/') throw new Error('Note sans identifiant élève.');
    const candidate = identity(fieldsOf(documents[0]));
    for (const document of documents) {
      const other = identity(fieldsOf(document));
      if (
        ['nom', 'prenom', 'matricule', 'dateNaissance', 'sexe'].some(
          (field) =>
            fold(String(candidate[field as keyof typeof candidate])) !==
            fold(String(other[field as keyof typeof other])),
        )
      )
        throw new Error('Copies historiques d’identité contradictoires.');
    }
    const matches = candidate.matricule
      ? students.filter((student) => student.matricule === candidate.matricule)
      : [];
    if (matches.length === 1) {
      const target = matches[0];
      const birth =
        target.dateNaissance instanceof Date
          ? target.dateNaissance.toISOString().slice(0, 10)
          : '';
      if (
        fold(String(target.nom)) !== fold(candidate.nom) ||
        fold(String(target.prenom)) !== fold(candidate.prenom) ||
        target.sexe !== candidate.sexe ||
        (birth && candidate.dateNaissance && birth !== candidate.dateNaissance)
      )
        throw new Error('Rapprochement historique d’identité incertain.');
      sourceToTarget[key] = target._id;
    } else if (matches.length === 0) {
      const recovered: ExportedFirestoreDocument = { ...documents[0], path: key };
      putStudent(recovered, true);
    } else throw new Error('Rapprochement historique non unique.');
    pending.recoveredStudents.push({
      sourcePath: key,
      fromNotes: documents.map((document) => document.path),
      matchedExisting: matches.length === 1,
    });
  }
  const periodLevels = new Set<string>();
  const periodId = (level: string, period: string) => id('periode', `${level}:${period}`);
  const getInscription = (studentId: string, className: string) => {
    const classe = getClass(className);
    const key = `${studentId}:${classe._id}:${decisions.schoolYear}`;
    if (inscriptions.has(key)) return inscriptions.get(key)!;
    periodLevels.add(String(classe.niveauScolaireId));
    const origin = studentOrigins.get(studentId)!;
    const related = gradeSources.filter(
      (document) =>
        sourceToTarget[`students/${text(fieldsOf(document), 'eleveId')}`] === studentId,
    );
    const dates = [
      timestamp(origin.createTime),
      ...related.map((document) => timestamp(document.createTime)),
    ]
      .filter((date): date is Date => !!date)
      .sort((a, b) => a.getTime() - b.getTime());
    if (!dates.length) throw new Error('Date de première trace source absente.');
    const currentFields = studentFields.get(studentId)!;
    const scores =
      currentFields.conduites?.type === 'map' ? currentFields.conduites.value : {};
    const vieScolaire = Object.entries(scores)
      .filter(
        ([period, value]) =>
          ['1', '2', '3'].includes(period) &&
          ['string', 'integer', 'number'].includes(value.type),
      )
      .map(([period, value]) => {
        const conduite = numeric(text({ value }, 'value'));
        if (!Number.isFinite(conduite) || conduite > 20)
          throw new Error('Conduite historique invalide.');
        return {
          periodeId: periodId(String(classe.niveauScolaireId), period),
          score: { absences: 0, retards: 0, conduite },
        };
      });
    const student = students.find((student) => student._id === studentId)!;
    const isActive =
      student.statut === 'actif' &&
      fold(text(currentFields, 'classe')) === fold(className);
    const record = {
      ...base('inscription', key),
      eleveDataId: studentId,
      classeId: classe._id,
      anneeScolaire: decisions.schoolYear,
      dateInscription: new Date(dates[0].toISOString().slice(0, 10) + 'T00:00:00Z'),
      dateInscriptionOrigine: 'premiere_trace_source',
      statutScolaire: '',
      isActive,
      vieScolaire,
      referenceRevision: 0,
    };
    inscriptions.set(key, record);
    return record;
  };
  for (const student of students)
    getInscription(student._id, text(studentFields.get(student._id)!, 'classe'));
  const assignmentGroups = new Map<
    string,
    { classe: ImportDocument; subject: ImportDocument; teacherPaths: string[] }
  >();
  for (const teacher of teacherSources) {
    const fields = fieldsOf(teacher);
    const names =
      fields.classes?.type === 'array'
        ? fields.classes.value.map((value) => text({ value }, 'value'))
        : [text(fields, 'classes')];
    for (const name of [...new Set(names.filter(Boolean))]) {
      const rawSubject = text(fields, 'matiere');
      if (!rawSubject) continue;
      const classe = getClass(name);
      const subject = getSubject(classe, rawSubject);
      const key = `${classe._id}:${subject._id}`;
      const group = assignmentGroups.get(key) ?? {
        classe,
        subject,
        teacherPaths: [] as string[],
      };
      group.teacherPaths.push(teacher.path);
      assignmentGroups.set(key, group);
    }
  }
  const teachers = teacherSources.map((document) => {
    const fields = fieldsOf(document);
    const assignments = [...assignmentGroups.values()]
      .filter(
        (group) =>
          group.teacherPaths.length === 1 && group.teacherPaths[0] === document.path,
      )
      .map((group) => ({ classeId: group.classe._id, matiereId: group.subject._id }));
    const data = teacherInputSchema.parse({
      nom: text(fields, 'lastname'),
      prenom: text(fields, 'firstname'),
      email: text(fields, 'email'),
      tel: text(fields, 'phone'),
      enseignements: assignments,
    });
    const record = {
      ...base('teacher', document.path, document),
      ...data,
      referenceRevision: 0,
    };
    sourceToTarget[document.path] = record._id;
    return record;
  });
  for (const group of assignmentGroups.values())
    if (group.teacherPaths.length > 1)
      pending.assignments.push({
        classe: String(group.classe.nom),
        matiere: String(group.subject.nom),
        teacherPaths: group.teacherPaths,
      });
  const gradeGroups = new Map<
    string,
    {
      document: ExportedFirestoreDocument;
      context: ImportDocument;
      note: number;
      explicitSubject: boolean;
    }[]
  >();
  let subjectRecoveries = 0;
  for (const document of gradeSources) {
    const fields = fieldsOf(document);
    const teacher = teacherIndex.get(text(fields, 'enseignantId'));
    if (!teacher) throw new Error('Enseignant historique introuvable.');
    let name = text(fields, 'matiere');
    const explicitSubject = !!name;
    if (!name) {
      name = text(fieldsOf(teacher), 'matiere');
      const observed = new Set(
        gradeSources
          .filter(
            (other) =>
              text(fieldsOf(other), 'enseignantId') === text(fields, 'enseignantId'),
          )
          .map((other) => subjectName(text(fieldsOf(other), 'matiere')))
          .filter(Boolean),
      );
      if (!name || observed.size !== 1 || !observed.has(subjectName(name)))
        throw new Error('Matière historique non déductible.');
      subjectRecoveries++;
    }
    const studentId = sourceToTarget[`students/${text(fields, 'eleveId')}`];
    const inscription = getInscription(studentId, text(fields, 'classe'));
    const classe = getClass(text(fields, 'classe'));
    const subject = getSubject(classe, name);
    const period = text(fields, 'trimestre');
    if (!['1', '2', '3'].includes(period))
      throw new Error('Trimestre historique invalide.');
    const evaluationName = text(fields, 'evaluation');
    const type = fold(evaluationName).includes('interrogation')
      ? 'interrogation'
      : fold(evaluationName).includes('devoir')
        ? 'devoir'
        : undefined;
    if (!type) throw new Error('Type d’évaluation historique inconnu.');
    const evaluationKey = `${classe.niveauScolaireId}:${normalizeEvaluationName(evaluationName)}`;
    if (!evaluations.has(evaluationKey))
      evaluations.set(evaluationKey, {
        ...base('evaluation', evaluationKey),
        nom: evaluationName,
        nomNormalise: normalizeEvaluationName(evaluationName),
        abreviation: '',
        type,
        coefficient: 1,
        periodeId: null,
        niveauScolaireId: classe.niveauScolaireId,
        referenceRevision: 0,
      });
    const context: ImportDocument = {
      ...base('note', document.path, document),
      inscriptionId: inscription._id,
      classeId: classe._id,
      anneeScolaire: decisions.schoolYear,
      matiereId: subject._id,
      periodeId: periodId(String(classe.niveauScolaireId), period),
      evaluationId: evaluations.get(evaluationKey)!._id,
      enseignantId: sourceToTarget[teacher.path],
      notePlafond: 20,
      coefficient: 1,
      closed: false,
      ...(source.sha256 ? { migrationSourceHash: source.sha256 } : {}),
    };
    const key = JSON.stringify([
      context.inscriptionId,
      context.matiereId,
      context.periodeId,
      context.evaluationId,
    ]);
    gradeGroups.set(key, [
      ...(gradeGroups.get(key) ?? []),
      { document, context, note: numeric(text(fields, 'note')), explicitSubject },
    ]);
  }
  const notes: ImportDocument[] = [];
  let deduplicatedGrades = 0;
  for (const group of gradeGroups.values()) {
    const valid = group.filter(
      (item) => Number.isFinite(item.note) && item.note >= 0 && item.note <= 20,
    );
    if (!valid.length || new Set(valid.map((item) => item.note)).size !== 1) {
      pending.grades.push({
        sourcePaths: group.map((item) => item.document.path),
        reason: valid.length ? 'conflicting_values' : 'empty_or_invalid_grade',
      });
      continue;
    }
    valid.sort(
      (a, b) =>
        Number(b.explicitSubject) - Number(a.explicitSubject) ||
        a.document.path.localeCompare(b.document.path),
    );
    const canonical = valid[0];
    notes.push({ ...canonical.context, note: canonical.note });
    for (const item of group) sourceToTarget[item.document.path] = canonical.context._id;
    deduplicatedGrades += group.length - 1;
  }
  const periods = [...periodLevels].flatMap((level) =>
    [1, 2, 3].map((order) => ({
      ...base('periode', `${level}:${order}`),
      nom: `${order === 1 ? '1er' : order + 'ème'} Trimestre`,
      ordre: order,
      coefficient: 1,
      niveauScolaireId: level,
      referenceRevision: 0,
    })),
  );
  return {
    decisions,
    sourceToTarget,
    pending,
    entities: {
      students,
      teachers,
      classes: [...classes.values()],
      subjects: [...subjects.values()],
      periods,
      evaluations: [...evaluations.values()],
      inscriptions: [...inscriptions.values()],
      notes,
    },
    summary: {
      sourceDocuments: source.documents.length,
      students: students.length,
      teachers: teachers.length,
      classes: classes.size,
      subjects: subjects.size,
      periods: periods.length,
      evaluations: evaluations.size,
      inscriptions: inscriptions.size,
      notes: notes.length,
      unknownBirthDates: students.filter((student) => !student.dateNaissance).length,
      unknownSex: students.filter((student) => !student.sexe).length,
      missingMatricules: students.filter((student) => !student.matricule).length,
      subjectRecoveries,
      deduplicatedGrades,
      pendingGrades: pending.grades.length,
      pendingAssignments: pending.assignments.length,
      recoveredStudentLinks: pending.recoveredStudents.filter(
        (student) => student.matchedExisting,
      ).length,
      recoveredHistoricalStudents: pending.recoveredStudents.filter(
        (student) => !student.matchedExisting,
      ).length,
    },
  };
}
