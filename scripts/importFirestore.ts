import 'dotenv/config';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { parseArgs } from 'node:util';
import { resolve, dirname, join } from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import {
  prepareFirestoreImport,
  importFirestore,
  verifyFirestoreImport,
} from '../src/services/firestoreImportService';

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      year: { type: 'string' },
      apply: { type: 'boolean', default: false },
      'preserve-unknown-births': { type: 'boolean', default: false },
      'preserve-unknown-sex': { type: 'boolean', default: false },
      'defer-conflicting-assignments': { type: 'boolean', default: false },
    },
  });
  if (
    !values.input ||
    !values.year ||
    !values['preserve-unknown-births'] ||
    !values['preserve-unknown-sex'] ||
    !values['defer-conflicting-assignments']
  )
    throw new Error('Indiquer export, année et décisions explicites de conservation.');
  if (!process.env.MONGO_URI) throw new Error('Configuration MongoDB absente.');
  await mongoose.connect(process.env.MONGO_URI, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
    socketTimeoutMS: 90000,
  });
  try {
    const prepared = await prepareFirestoreImport(resolve(values.input), {
      schoolYear: values.year,
      preserveUnknownBirthDates: true,
      preserveUnknownSex: true,
      deferConflictingAssignments: true,
    });
    const output = await mkdtemp(join(dirname(resolve(values.input)), 'import-'));
    await writeFile(
      join(output, 'migration-plan.json'),
      JSON.stringify({ sha256: prepared.sha256, ...prepared.plan }, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    const result = await importFirestore(prepared, values.apply, (phase) =>
      console.log(JSON.stringify({ phase })),
    );
    await writeFile(
      join(output, 'transaction-result.json'),
      JSON.stringify(result, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    const verification =
      result.status === 'validated_dry_run'
        ? undefined
        : await verifyFirestoreImport(prepared, (phase) =>
            console.log(JSON.stringify({ phase })),
          );
    const report = { ...result, verification, reportDirectory: output };
    await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}
main().catch((error) => {
  // Les erreurs du pilote peuvent contenir l'URI ou des documents personnels.
  console.error(
    'Import interrompu. Aucun écrasement autorisé. Contrôler le dernier plan privé et la configuration.',
  );
  if (error instanceof Error && error.constructor === Error) console.error(error.message);
  if (error instanceof ZodError)
    console.error(
      JSON.stringify(
        error.issues.map((issue) => ({ path: issue.path, code: issue.code })),
      ),
    );
  if (error instanceof Error) console.error('Type : ' + error.name);
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'number'
  )
    console.error('Code : ' + error.code);
  process.exitCode = 1;
});
