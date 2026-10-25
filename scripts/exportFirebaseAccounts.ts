import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { exportFirebaseAuthSource } from '../src/lib/firebaseAuthExportSource';

async function main() {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      credentials: { type: 'string', default: '.local/firebase-service-account.json' },
      output: { type: 'string', default: '.local/auth-migration' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(
      'pnpm migration:auth:export --project ID [--credentials FICHIER] [--output DOSSIER]',
    );
    return;
  }
  if (!values.project || !/^[a-z][a-z0-9-]{4,62}$/.test(values.project))
    throw new Error('Projet requis.');
  const result = await exportFirebaseAuthSource(
    resolve(values.credentials),
    values.project,
  );
  await mkdir(resolve(values.output), { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(resolve(values.output), 'export-'));
  const contents = JSON.stringify(result.bundle, null, 2) + '\n';
  await writeFile(join(directory, 'accounts.json'), contents, {
    flag: 'wx',
    mode: 0o600,
  });
  if (result.config)
    await writeFile(
      join(directory, 'hash-config.json'),
      JSON.stringify(result.config, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  const report = {
    directory,
    accounts: result.bundle.users.length,
    withPasswordHash: result.bundle.users.filter(
      (user) => user.passwordHash && user.passwordSalt,
    ).length,
    configStatus: result.configStatus,
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
  await writeFile(
    join(directory, 'export-report.json'),
    JSON.stringify(report, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch(() => {
  // Les erreurs SDK peuvent contenir des secrets : ne pas les recopier.
  console.error(
    'Export des comptes interrompu. Vérifiez le projet, le compte de service et les droits de lecture Firebase Authentication. Aucune donnée source ou MongoDB modifiée.',
  );
  process.exitCode = 1;
});
