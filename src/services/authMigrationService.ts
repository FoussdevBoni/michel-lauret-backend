import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import User from '../models/User';
import { Enseignant } from '../models/Teacher';
import { FirestoreArchive, FirestoreMigrationRun } from '../models/FirestoreMigration';
import { withTransaction } from '../lib/withTransaction';
import { legacyConfigId, readLegacyHashConfig } from '../lib/legacyPassword';
import {
  authExportSchema,
  legacyPasswordSchema,
  type AuthExport,
  type LegacyHashConfig,
} from '../types/features/LegacyPassword';

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const normalizeEmail = (value: string) => value.trim().toLowerCase();
type MigrationRow = {
  uid: string;
  email: string;
  teacherId?: string;
  status: string;
};

export async function readAuthMigration(
  input: string,
  configPath: string,
  projectId: string,
) {
  const contents = await readFile(input, 'utf8');
  if (Buffer.byteLength(contents) > 32 * 1024 * 1024)
    throw new Error('Export trop grand.');
  const bundle = authExportSchema.parse(JSON.parse(contents));
  const sha256 = createHash('sha256').update(contents).digest('hex');
  const manifest = z
    .object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })
    .parse(
      JSON.parse(await readFile(join(dirname(input), 'export-report.json'), 'utf8')),
    );
  if (manifest.sha256 !== sha256) throw new Error('L’export des comptes a été modifié.');
  const config = await readLegacyHashConfig(configPath);
  if (bundle.projectId !== projectId || bundle.configId !== legacyConfigId(config)) {
    throw new Error('Le projet ou les paramètres ne correspondent pas à cet export.');
  }
  return { bundle, config, sha256 };
}

async function buildPlan(bundle: AuthExport, config: LegacyHashConfig) {
  authExportSchema.parse(bundle);
  if (bundle.configId !== legacyConfigId(config))
    throw new Error('Configuration différente de l’export.');
  const runs = await FirestoreMigrationRun.find({
    projectId: bundle.projectId,
    status: 'complete',
  }).lean();
  if (!runs.length) throw new Error('Aucune migration métier terminée pour ce projet.');
  const archivedTeachers: { teacherId: string; email: string }[] = [];
  for (const run of runs) {
    const mapping = run.sourceToTarget as Record<string, string>;
    for (const [path, teacherId] of Object.entries(mapping)) {
      if (!/^teachers\/[^/]+$/.test(path)) continue;
      const archive = await FirestoreArchive.findOne({
        sourceHash: run._id,
        sourcePath: path,
      }).lean();
      const field =
        archive?.document?.fields?.type === 'map'
          ? archive.document.fields.value.email
          : undefined;
      if (field?.type === 'string' && typeof field.value === 'string') {
        archivedTeachers.push({ teacherId, email: normalizeEmail(field.value) });
      }
    }
  }
  const rows: MigrationRow[] = [];
  const targets = new Set<string>();
  for (const user of bundle.users) {
    const email = normalizeEmail(user.email ?? '');
    const row: MigrationRow = { uid: user.uid, email, status: 'ready' };
    rows.push(row);
    if (
      bundle.users.filter((other) => other.uid === user.uid).length !== 1 ||
      (email &&
        bundle.users.filter((other) => normalizeEmail(other.email ?? '') === email)
          .length !== 1)
    ) {
      row.status = 'ambiguous_source';
      continue;
    }
    if (!emailSchema.safeParse(email).success) {
      row.status = 'missing_or_invalid_email';
      continue;
    }
    const matches = archivedTeachers.filter((item) => item.email === email);
    const uniqueTargets = [...new Set(matches.map((item) => item.teacherId))];
    if (uniqueTargets.length !== 1) {
      row.status = uniqueTargets.length ? 'ambiguous_teacher' : 'no_migrated_teacher';
      continue;
    }
    row.teacherId = uniqueTargets[0];
    const teachers = await Enseignant.find({ email }).lean();
    if (
      teachers.length !== 1 ||
      String(teachers[0]._id) !== row.teacherId ||
      teachers[0].isDeleted
    ) {
      row.status = 'teacher_changed_or_unavailable';
      continue;
    }
    const identity = `${bundle.projectId}/${user.uid}`;
    const existing = await User.findOne({ legacyAuthId: identity }).lean();
    if (existing) {
      row.status =
        existing.role === 'teacher' &&
        existing.email === email &&
        teachers[0].userId === String(existing._id)
          ? 'already_imported'
          : 'existing_identity_conflict';
      continue;
    }
    if (teachers[0].userId || (await User.exists({ email }))) {
      row.status = 'existing_account_preserved';
      continue;
    }
    if (user.hasMfa) {
      row.status = 'mfa_requires_review';
      continue;
    }
    const credential = legacyPasswordSchema.safeParse({
      hash: user.passwordHash,
      salt: user.passwordSalt,
      configId: bundle.configId,
    });
    if (
      !user.providers.includes('password') ||
      !credential.success ||
      Buffer.from(credential.data.hash, 'base64').length !==
        Buffer.from(config.signerKey, 'base64').length
    ) {
      row.status = 'password_reset_required';
      continue;
    }
    if (targets.has(row.teacherId)) throw new Error('Rattachement multiple inattendu.');
    targets.add(row.teacherId);
  }
  return rows;
}

export async function migrateTeacherAccounts(
  bundle: AuthExport,
  config: LegacyHashConfig,
  apply = false,
) {
  if (!apply) return { applied: false, rows: await buildPlan(bundle, config) };
  return withTransaction(async () => {
    const rows = await buildPlan(bundle, config);
    for (const row of rows.filter((item) => item.status === 'ready')) {
      const source = bundle.users.find((user) => user.uid === row.uid)!;
      const teacher = await Enseignant.findOneAndUpdate(
        {
          _id: row.teacherId,
          email: row.email,
          isDeleted: false,
          $or: [{ userId: { $exists: false } }, { userId: null }, { userId: '' }],
        },
        { $inc: { referenceRevision: 1 } },
        { new: true },
      );
      if (!teacher)
        throw new Error('Dossier modifié pendant l’import : transaction annulée.');
      const [account] = await User.create([
        {
          username: `${teacher.prenom} ${teacher.nom}`,
          email: row.email,
          role: 'teacher',
          provider: 'password',
          status: source.disabled ? 'inactive' : 'active',
          // L'accès pédagogique est validé par le dossier historique, comme dans l'ancien logiciel.
          // Cela ne constitue pas une attestation de vérification de l'adresse e-mail.
          isVerified: true,
          legacyAuthId: `${bundle.projectId}/${source.uid}`,
          legacyPassword: legacyPasswordSchema.parse({
            hash: source.passwordHash,
            salt: source.passwordSalt,
            configId: bundle.configId,
          }),
        },
      ]);
      teacher.userId = String(account._id);
      await teacher.save();
      row.status = source.disabled ? 'imported_inactive' : 'imported';
    }
    return { applied: true, rows };
  });
}

export async function verifyTeacherAccountMigration(
  bundle: AuthExport,
  config: LegacyHashConfig,
) {
  const rows = await buildPlan(bundle, config);
  const result = { linked: 0, legacyPasswords: 0, convertedPasswords: 0, issues: 0 };
  for (const row of rows.filter((item) => item.status === 'already_imported')) {
    const account = await User.findOne({
      legacyAuthId: `${bundle.projectId}/${row.uid}`,
    }).select('+password +legacyPassword');
    const links = await Enseignant.countDocuments({
      userId: String(account?._id),
      isDeleted: false,
    });
    if (
      !account ||
      links !== 1 ||
      !account.isVerified ||
      account.provider !== 'password'
    ) {
      result.issues++;
      continue;
    }
    if (
      account.password &&
      !account.legacyPassword &&
      account.passwordFormat === 'bcrypt-sha256'
    ) {
      result.convertedPasswords++;
    } else if (!account.password && account.legacyPassword) {
      const source = bundle.users.find((user) => user.uid === row.uid)!;
      const expected = legacyPasswordSchema.parse({
        hash: source.passwordHash,
        salt: source.passwordSalt,
        configId: bundle.configId,
      });
      if (
        account.legacyPassword.hash !== expected.hash ||
        account.legacyPassword.salt !== expected.salt ||
        account.legacyPassword.configId !== expected.configId
      ) {
        result.issues++;
        continue;
      }
      result.legacyPasswords++;
    } else {
      result.issues++;
      continue;
    }
    result.linked++;
  }
  return result;
}
