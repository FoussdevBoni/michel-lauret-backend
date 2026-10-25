import 'dotenv/config';
import mongoose from 'mongoose';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Aucun modèle applicatif n'est initialisé : pas de création d'index ou de collection.
async function main() {
  if (!process.env.MONGO_URI) throw new Error('URI MongoDB absente.');
  await mongoose.connect(process.env.MONGO_URI, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 15000,
  });
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('Connexion MongoDB indisponible.');
    const names = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map((collection) => collection.name)
      .filter((name) => !name.startsWith('system.'))
      .sort();
    const collections: Record<string, number> = {};
    for (const name of names)
      collections[name] = await db.collection(name).countDocuments({});
    const report = {
      analyzedAt: new Date().toISOString(),
      readOnly: true,
      collections,
      mongoWrites: 0,
    };
    await mkdir(resolve('.local'), { recursive: true });
    const directory = await mkdtemp(resolve('.local/migration-target-'));
    const path = join(directory, 'inventory.json');
    await writeFile(path, JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    console.log(JSON.stringify({ ...report, report: path }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}
main().catch(() => {
  console.error(
    'Inventaire MongoDB non terminé. Vérifier la configuration et les droits de lecture. Aucun import exécuté.',
  );
  process.exitCode = 1;
});
