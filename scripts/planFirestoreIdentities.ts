import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { writeFirestoreIdentityPlan } from '../src/services/firestoreIdentityPlanService';

async function main() {
  const { values } = parseArgs({
    options: { input: { type: 'string' }, help: { type: 'boolean', default: false } },
  });
  if (values.help) {
    console.log('pnpm migration:plan-identities --input CHEMIN/firestore.json');
    return;
  }
  if (!values.input) throw new Error('Export complet nécessaire.');
  console.log(
    JSON.stringify(await writeFirestoreIdentityPlan(resolve(values.input)), null, 2),
  );
}
main().catch(() => {
  console.error(
    'Plan non créé : vérifier l’export complet, son rapport et l’absence de identity-plan.json. Aucun import MongoDB exécuté.',
  );
  process.exitCode = 1;
});
