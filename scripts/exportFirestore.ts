import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { exportFirestore } from '../src/services/firestoreExportService';

async function main() {
  const { values } = parseArgs({
    options: {
      credentials: { type: 'string', default: '.local/firebase-service-account.json' },
      project: { type: 'string' },
      database: { type: 'string', default: '(default)' },
      output: { type: 'string', default: '.local/migrations' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(
      'pnpm migration:export --project ID_PROJET [--credentials CHEMIN] [--database ID_BASE] [--output DOSSIER]',
    );
    return;
  }
  if (!values.project)
    throw new Error('Indiquez --project avec l’identifiant du projet Firebase source.');
  const { createFirebaseMigrationSource } = await import(
    '../src/lib/firebaseMigrationSource'
  );
  const source = await createFirebaseMigrationSource(
    resolve(values.credentials),
    values.project,
    values.database,
  );
  try {
    console.log(
      `Lecture seule de Firestore : ${source.projectId} / ${source.databaseId}.`,
    );
    const result = await exportFirestore(source, resolve(values.output), (progress) => {
      console.log(
        `${progress.collection} : ${progress.documents} documents exportés au total.`,
      );
    });
    console.log(
      `${result.report.documents} documents, ${Object.keys(result.report.collections).length} collections.`,
    );
    console.log(`Export : ${result.file}`);
    console.log(`Empreinte SHA-256 : ${result.report.sha256}`);
  } finally {
    await source.close();
  }
}

main().catch((cause: unknown) => {
  const safeMessages = new Set([
    'Type Firestore non pris en charge : export interrompu sans perte silencieuse.',
    'Projet de référence Firestore introuvable.',
    'Collection parcourue plusieurs fois.',
    'Chemin de document incohérent.',
    'Fichier de compte de service absent ou JSON invalide.',
    'Compte de service invalide ou projet différent de --project.',
    'Clé de compte de service invalide.',
  ]);
  if (cause instanceof Error && safeMessages.has(cause.message))
    console.error(cause.message);
  if (cause && typeof cause === 'object' && 'code' in cause) {
    const code = cause.code;
    if (
      typeof code === 'number' ||
      (typeof code === 'string' && /^[A-Z_0-9/-]{1,60}$/.test(code))
    )
      console.error(`Code technique : ${code}`);
  }
  // Ne jamais recopier une erreur SDK, une clé ou un document dans les logs.
  console.error(
    'Export non terminé. Vérifiez les arguments (--help), le fichier privé, le projet et les droits de lecture Firestore. Un fichier .partial.json n’est pas un export validé. Aucune écriture Firestore ou MongoDB n’a été effectuée.',
  );
  process.exitCode = 1;
});
