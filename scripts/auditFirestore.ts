import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { auditFirestoreFile } from '../src/services/firestoreAuditService';

async function main() {
  const { values } = parseArgs({
    options: { input: { type: 'string' }, help: { type: 'boolean', default: false } },
  });
  if (values.help) {
    console.log('pnpm migration:audit --input CHEMIN/firestore.json');
    return;
  }
  if (!values.input)
    throw new Error('Indiquez --input avec le chemin de l’export complet.');
  const { result, file } = await auditFirestoreFile(resolve(values.input));
  console.log(
    JSON.stringify(
      {
        documents: result.documents,
        collections: Object.fromEntries(
          Object.entries(result.collections).map(([name, value]) => [
            name,
            value.documents,
          ]),
        ),
        issueCounts: result.issueCounts,
        report: file,
        mongoWrites: 0,
      },
      null,
      2,
    ),
  );
}
main().catch(() => {
  console.error(
    'Analyse interrompue : vérifier le JSON complet, son rapport SHA-256 et l’absence d’un audit.json précédent. Aucun import MongoDB exécuté.',
  );
  process.exitCode = 1;
});
