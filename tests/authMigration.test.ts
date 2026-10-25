import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../src/models/User';
import { Enseignant } from '../src/models/Teacher';
import {
  FirestoreArchive,
  FirestoreMigrationRun,
} from '../src/models/FirestoreMigration';
import {
  migrateTeacherAccounts,
  readAuthMigration,
  verifyTeacherAccountMigration,
} from '../src/services/authMigrationService';
import { authenticatePassword } from '../src/services/passwordAuthenticationService';
import { authService } from '../src/services/authService';
import { accountService } from '../src/services/accountService';
import {
  authBundle,
  legacyConfig,
  legacyCredential,
} from './helpers/legacyPasswordFixture';

const databaseName = `auth_migration_test_${randomUUID().replaceAll('-', '')}`;
let replica: MongoMemoryReplSet;
let configPath: string;
const previousEnvironment = {
  config: process.env.LEGACY_PASSWORD_HASH_CONFIG_PATH,
  jwt: process.env.JWT_SECRET,
};

before(
  async () => {
    const systemBinary =
      process.env.MONGOMS_SYSTEM_BINARY ??
      resolve('node_modules/.cache/mongodb-binaries/mongod-7.0.14.exe');
    assert.ok(
      existsSync(systemBinary),
      'Exécutable MongoDB local requis : aucun téléchargement implicite.',
    );
    const directory = await mkdtemp(join(tmpdir(), 'cpeg-auth-test-'));
    configPath = join(directory, 'hash-config.json');
    await writeFile(configPath, JSON.stringify(legacyConfig), { mode: 0o600 });
    replica = await MongoMemoryReplSet.create({
      instanceOpts: [{ launchTimeout: 60000 }],
      binary: { version: '7.0.14', systemBinary },
      replSet: { count: 1, storageEngine: 'wiredTiger', spawn: { windowsHide: true } },
    });
    await mongoose.connect(replica.getUri(databaseName));
    await Promise.all([
      User.init(),
      Enseignant.init(),
      FirestoreArchive.init(),
      FirestoreMigrationRun.init(),
    ]);
  },
  { timeout: 120000 },
);

beforeEach(async () => {
  assert.equal(mongoose.connection.name, databaseName);
  for (const collection of await mongoose.connection.db!.collections())
    await collection.deleteMany({});
  process.env.LEGACY_PASSWORD_HASH_CONFIG_PATH = configPath;
  process.env.JWT_SECRET = 'isolated-test-secret-at-least-thirty-two-characters';
});

after(async () => {
  await mongoose.disconnect();
  await replica?.stop();
  for (const [key, value] of Object.entries({
    LEGACY_PASSWORD_HASH_CONFIG_PATH: previousEnvironment.config,
    JWT_SECRET: previousEnvironment.jwt,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function seed() {
  const teacher = await Enseignant.create({
    nom: 'Exemple',
    prenom: 'Professeur',
    email: 'teacher@example.test',
  });
  await FirestoreMigrationRun.create({
    _id: 'a'.repeat(64),
    projectId: 'test-school',
    databaseId: '(default)',
    schoolYear: '2025-2026',
    decisionsHash: 'decisions',
    summary: {},
    pending: {},
    status: 'complete',
    sourceToTarget: { 'teachers/legacy-dossier': String(teacher._id) },
  });
  await FirestoreArchive.create({
    _id: 'archive-teacher',
    sourceHash: 'a'.repeat(64),
    sourcePath: 'teachers/legacy-dossier',
    document: {
      fields: { type: 'map', value: { email: { type: 'string', value: teacher.email } } },
    },
  });
  return teacher;
}

async function imported() {
  const teacher = await seed();
  await migrateTeacherAccounts(authBundle(), legacyConfig, true);
  const user = await User.findOne({ email: teacher.email }).select(
    '+password +legacyPassword +legacyAuthId',
  );
  assert.ok(user);
  return { teacher, user };
}

test('simulation sans écriture puis import transactionnel au bon dossier, au rôle enseignant seulement', async () => {
  const teacher = await seed();
  const bundle = authBundle();
  bundle.users.push({
    ...bundle.users[0],
    uid: 'administrator',
    email: 'admin@example.test',
  });
  const preview = await migrateTeacherAccounts(bundle, legacyConfig);
  assert.deepEqual(
    preview.rows.map((row) => row.status),
    ['ready', 'no_migrated_teacher'],
  );
  assert.equal(await User.countDocuments(), 0);
  assert.equal((await Enseignant.findById(teacher._id))?.userId, undefined);
  const result = await migrateTeacherAccounts(bundle, legacyConfig, true);
  assert.deepEqual(
    result.rows.map((row) => row.status),
    ['imported', 'no_migrated_teacher'],
  );
  const account = await User.findOne({ email: teacher.email }).select(
    '+password +legacyPassword',
  );
  assert.equal(account?.role, 'teacher');
  assert.equal(account?.password, undefined);
  assert.equal(account?.legacyPassword?.hash, legacyCredential.hash);
  assert.equal((await Enseignant.findById(teacher._id))?.userId, String(account?._id));
  assert.equal(await Enseignant.countDocuments(), 1);
  assert.deepEqual(await verifyTeacherAccountMigration(bundle, legacyConfig), {
    linked: 1,
    legacyPasswords: 1,
    convertedPasswords: 0,
    issues: 0,
  });
});

test('connexion avec le mot de passe officiel, sans Firebase, puis conversion et suppression de l’ancienne empreinte', async () => {
  const { user } = await imported();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Tout appel Firebase ou HTTP est interdit.');
  };
  try {
    await assert.rejects(
      authService.login({ email: user.email, password: 'incorrect' }),
      { status: 401 },
    );
    assert.ok((await User.findById(user._id).select('+legacyPassword'))?.legacyPassword);
    const session = await authService.login({
      email: user.email,
      password: 'user1password',
    });
    assert.equal(session.user.role, 'teacher');
    assert.ok(session.token);
    const converted = await User.findById(user._id).select('+password +legacyPassword');
    assert.equal(converted?.legacyPassword, undefined);
    assert.equal(converted?.passwordFormat, 'bcrypt-sha256');
    assert.equal(await converted?.comparePassword('user1password'), true);
    assert.deepEqual(await verifyTeacherAccountMigration(authBundle(), legacyConfig), {
      linked: 1,
      legacyPasswords: 0,
      convertedPasswords: 1,
      issues: 0,
    });
    delete process.env.LEGACY_PASSWORD_HASH_CONFIG_PATH;
    assert.ok(
      (await authService.login({ email: user.email, password: 'user1password' })).token,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reprise idempotente après conversion ou changement du mot de passe : aucun écrasement', async () => {
  const { user } = await imported();
  const account = await User.findById(user._id);
  account!.password = 'new-personal-password';
  await account!.save();
  const result = await migrateTeacherAccounts(authBundle(), legacyConfig, true);
  assert.equal(result.rows[0].status, 'already_imported');
  assert.equal(await User.countDocuments(), 1);
  assert.equal(
    (await User.findById(user._id).select('+legacyPassword'))?.legacyPassword,
    undefined,
  );
  await assert.rejects(
    authService.login({ email: user.email, password: 'user1password' }),
    { status: 401 },
  );
  assert.ok(
    (await authService.login({ email: user.email, password: 'new-personal-password' }))
      .token,
  );
});

test('un compte préexistant, même administrateur, n’est ni remplacé ni rattaché par son email', async () => {
  const teacher = await seed();
  await User.create({
    email: teacher.email,
    username: 'Direction',
    role: 'admin',
    password: 'existing-password',
    isVerified: true,
  });
  const result = await migrateTeacherAccounts(authBundle(), legacyConfig, true);
  assert.equal(result.rows[0].status, 'existing_account_preserved');
  assert.equal((await Enseignant.findById(teacher._id))?.userId, undefined);
  assert.equal((await User.findOne({ email: teacher.email }))?.role, 'admin');
});

test('email historique modifié, source ambiguë, empreinte absente ou MFA : dossiers laissés en attente', async () => {
  const teacher = await seed();
  const duplicate = authBundle();
  duplicate.users.push({ ...duplicate.users[0], uid: 'another-identity' });
  assert.ok(
    (await migrateTeacherAccounts(duplicate, legacyConfig, true)).rows.every(
      (row) => row.status === 'ambiguous_source',
    ),
  );
  for (const change of [{ passwordHash: '' }, { hasMfa: true }]) {
    const bundle = authBundle();
    Object.assign(bundle.users[0], change);
    const result = await migrateTeacherAccounts(bundle, legacyConfig, true);
    assert.equal(
      result.rows[0].status,
      'hasMfa' in change ? 'mfa_requires_review' : 'password_reset_required',
    );
  }
  await Enseignant.updateOne(
    { _id: teacher._id },
    { $set: { email: 'changed@example.test' } },
  );
  assert.equal(
    (await migrateTeacherAccounts(authBundle(), legacyConfig, true)).rows[0].status,
    'teacher_changed_or_unavailable',
  );
  assert.equal(await User.countDocuments(), 0);
});

test('un compte Firebase désactivé reste inactif et son empreinte n’est pas convertie', async () => {
  await seed();
  const bundle = authBundle();
  bundle.users[0].disabled = true;
  assert.equal(
    (await migrateTeacherAccounts(bundle, legacyConfig, true)).rows[0].status,
    'imported_inactive',
  );
  const account = await User.findOne({ email: bundle.users[0].email }).select(
    '+legacyPassword +password',
  );
  assert.equal(await authenticatePassword(account!, 'user1password'), false);
  assert.ok(
    (await User.findById(account!._id).select('+legacyPassword'))?.legacyPassword,
  );
});

test('configuration absente ou différente : échec explicite sans modifier le mot de passe', async () => {
  const { user } = await imported();
  delete process.env.LEGACY_PASSWORD_HASH_CONFIG_PATH;
  await assert.rejects(
    authService.login({ email: user.email, password: 'user1password' }),
    { status: 503 },
  );
  assert.ok((await User.findById(user._id).select('+legacyPassword'))?.legacyPassword);
  await assert.rejects(
    migrateTeacherAccounts(authBundle(), { ...legacyConfig, rounds: 7 }, true),
  );
  const otherProject = authBundle();
  otherProject.projectId = 'other-school';
  await assert.rejects(migrateTeacherAccounts(otherProject, legacyConfig, true));
});

test('deux connexions simultanées convertissent une seule fois et restent valides', async () => {
  const { user } = await imported();
  const sessions = await Promise.all(
    [1, 2].map(() => authService.login({ email: user.email, password: 'user1password' })),
  );
  assert.ok(sessions.every((session) => session.user.id === String(user._id)));
  assert.equal(await User.countDocuments(), 1);
  assert.equal(
    (await User.findById(user._id).select('+legacyPassword'))?.legacyPassword,
    undefined,
  );
});

test('une réinitialisation ou suspension concurrente l’emporte sur une ancienne vérification', async () => {
  const { user } = await imported();
  const current = await User.findById(user._id);
  current!.password = 'reset-password-new';
  await current!.save();
  assert.equal(await authenticatePassword(user, 'user1password'), false);
  const restored = await User.findById(user._id).select('+password');
  assert.equal(await restored?.comparePassword('reset-password-new'), true);
  // Réutiliser un ancien document chargé avant une suspension ne doit jamais réussir.
  await User.updateOne({ _id: user._id }, { $set: { status: 'inactive' } });
  assert.equal(await authenticatePassword(user, 'user1password'), false);
});

test('secrets exclus des réponses et compatibilité des comptes bcrypt précédents', async () => {
  const { user } = await imported();
  const publicRead = await User.findById(user._id);
  assert.equal(publicRead?.legacyPassword, undefined);
  assert.equal(publicRead?.legacyAuthId, undefined);
  const serialized = JSON.stringify(user);
  assert.ok(!serialized.includes(legacyCredential.hash));
  assert.ok(!serialized.includes('legacyPassword'));
  const oldHash = await bcrypt.hash('old-native-password', 10);
  await User.collection.insertOne({
    email: 'native@example.test',
    username: 'Ancien compte local',
    provider: 'password',
    password: oldHash,
    role: 'admin',
    status: 'active',
    isVerified: true,
  });
  assert.ok(
    (
      await authService.login({
        email: 'native@example.test',
        password: 'old-native-password',
      })
    ).token,
  );
  const longPassword = 'é'.repeat(55) + 'a';
  const fresh = await User.create({
    email: 'long@example.test',
    username: 'Long',
    password: longPassword,
    role: 'teacher',
    isVerified: true,
  });
  assert.equal(await fresh.comparePassword(longPassword), true);
  assert.equal(await fresh.comparePassword('é'.repeat(55) + 'b'), false);
});

test('export modifié ou autre projet : refus avant toute écriture MongoDB', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cpeg-auth-integrity-'));
  const path = join(directory, 'accounts.json');
  const contents = JSON.stringify(authBundle());
  await writeFile(path, contents);
  await writeFile(
    join(directory, 'export-report.json'),
    JSON.stringify({ sha256: createHash('sha256').update(contents).digest('hex') }),
  );
  assert.equal(
    (await readAuthMigration(path, configPath, 'test-school')).bundle.users.length,
    1,
  );
  await assert.rejects(readAuthMigration(path, configPath, 'other-school'));
  await writeFile(path, contents + ' ');
  await assert.rejects(readAuthMigration(path, configPath, 'test-school'), /modifié/);
  assert.equal(await User.countDocuments(), 0);
});

test('vérification après import : détecte une empreinte altérée et un compte partagé entre deux dossiers', async () => {
  const { user } = await imported();
  await User.updateOne({ _id: user._id }, { $set: { 'legacyPassword.hash': 'YQ==' } });
  assert.equal(
    (await verifyTeacherAccountMigration(authBundle(), legacyConfig)).issues,
    1,
  );
  await User.updateOne(
    { _id: user._id },
    { $set: { 'legacyPassword.hash': legacyCredential.hash } },
  );
  await Enseignant.create({
    nom: 'Autre',
    prenom: 'Professeur',
    email: 'other@example.test',
    userId: String(user._id),
  });
  assert.equal(
    (await verifyTeacherAccountMigration(authBundle(), legacyConfig)).issues,
    1,
  );
});

test('profil : changement personnel vérifié, ancien mot de passe refusé, autres comptes préservés', async () => {
  const { user } = await imported();
  const other = await User.create({
    email: 'other@example.test',
    username: 'Autre',
    role: 'teacher',
    password: 'other-password',
    isVerified: true,
  });
  await assert.rejects(
    accountService.changePassword(String(user._id), {
      currentPassword: 'wrong',
      newPassword: 'new-password-personal',
    }),
    { status: 400 },
  );
  await assert.rejects(
    accountService.changePassword(String(user._id), {
      currentPassword: 'user1password',
      newPassword: 'new-password-personal',
      ownerId: String(other._id),
    }),
  );
  await accountService.changePassword(String(user._id), {
    currentPassword: 'user1password',
    newPassword: 'new-password-personal',
  });
  await assert.rejects(
    authService.login({ email: user.email, password: 'user1password' }),
    { status: 401 },
  );
  assert.ok(
    (await authService.login({ email: user.email, password: 'new-password-personal' }))
      .token,
  );
  assert.equal(
    (await User.findById(user._id).select('+legacyPassword'))?.legacyPassword,
    undefined,
  );
  assert.ok(
    (await authService.login({ email: other.email, password: 'other-password' })).token,
  );
});
