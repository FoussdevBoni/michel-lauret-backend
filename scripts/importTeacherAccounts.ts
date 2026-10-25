import 'dotenv/config';
import mongoose from 'mongoose';
import { parseArgs } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import {
  migrateTeacherAccounts,
  readAuthMigration,
  verifyTeacherAccountMigration,
} from '../src/services/authMigrationService';
import User from '../src/models/User';
import {
  defaultLegacyHashConfigPath,
  legacyConfigId,
  readLegacyHashConfig,
} from '../src/lib/legacyPassword';

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      config: { type: 'string' },
      project: { type: 'string' },
      apply: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(
      'pnpm migration:auth:import --input FICHIER --config FICHIER --project ID [--apply]',
    );
    return;
  }
  if (!values.input || !values.config || !values.project || !process.env.MONGO_URI)
    throw new Error('Arguments ou configuration absents.');
  const prepared = await readAuthMigration(
    resolve(values.input),
    resolve(values.config),
    values.project,
  );
  // Préparer la configuration locale avant d'importer des comptes qui en dépendent.
  if (values.apply) {
    const path = resolve(
      process.env.LEGACY_PASSWORD_HASH_CONFIG_PATH || defaultLegacyHashConfigPath,
    );
    try {
      const existing = await readLegacyHashConfig(path);
      if (legacyConfigId(existing) !== prepared.bundle.configId) {
        throw new Error('Une autre configuration de mots de passe est déjà utilisée.');
      }
    } catch (error) {
      if (
        !(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        )
      )
        throw error;
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, JSON.stringify(prepared.config, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
    }
    let contents = await readFile('.env', 'utf8');
    const line = `LEGACY_PASSWORD_HASH_CONFIG_PATH=${JSON.stringify(path.replaceAll('\\', '/'))}`;
    contents = /^\s*LEGACY_PASSWORD_HASH_CONFIG_PATH\s*=/m.test(contents)
      ? contents.replace(/^\s*LEGACY_PASSWORD_HASH_CONFIG_PATH\s*=.*$/gm, () => line)
      : `${contents}\n${line}\n`;
    await writeFile('.env', contents, { mode: 0o600 });
  }
  await mongoose.connect(process.env.MONGO_URI, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 15000,
  });
  try {
    if (values.apply) await User.createIndexes();
    const result = await migrateTeacherAccounts(
      prepared.bundle,
      prepared.config,
      values.apply,
    );
    const verification = await verifyTeacherAccountMigration(
      prepared.bundle,
      prepared.config,
    );
    const directory = await mkdtemp(join(dirname(resolve(values.input)), 'import-'));
    await writeFile(
      join(directory, 'result.json'),
      JSON.stringify({ sha256: prepared.sha256, ...result, verification }, null, 2) +
        '\n',
      { flag: 'wx', mode: 0o600 },
    );
    const counts: Record<string, number> = {};
    for (const row of result.rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
    console.log(
      JSON.stringify(
        { applied: result.applied, counts, verification, reportDirectory: directory },
        null,
        2,
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(() => {
  console.error(
    'Reprise des accès interrompue. Contrôlez les arguments, la configuration privée et les correspondances. Aucun écrasement des comptes existants n’est autorisé.',
  );
  process.exitCode = 1;
});
