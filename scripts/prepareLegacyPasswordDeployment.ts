import 'dotenv/config';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import {
  legacyConfigId,
  readConfiguredLegacyHashConfig,
} from '../src/lib/legacyPassword';
import { env } from '../src/config/env';
import User from '../src/models/User';

// Lecture seule des comptes : aucune connexion ni réinitialisation à leur place.
async function prepare() {
  if (!env.MONGO_URI) throw new Error('Base non configurée.');
  const config = await readConfiguredLegacyHashConfig();
  const configId = legacyConfigId(config);
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    const remaining = await User.countDocuments({
      role: 'teacher',
      legacyPassword: { $exists: true },
    });
    const mismatched = await User.countDocuments({
      role: 'teacher',
      legacyPassword: { $exists: true },
      'legacyPassword.configId': { $ne: configId },
    });
    if (mismatched)
      throw new Error(
        'Les paramètres ne correspondent pas à tous les comptes historiques.',
      );
    const converted = await User.countDocuments({
      role: 'teacher',
      password: { $exists: true },
      legacyPassword: { $exists: false },
    });
    const path = resolve('.local/railway-auth-variables.env');
    // Fichier privé ignoré par Git ; ne jamais afficher sa valeur dans les journaux.
    await writeFile(
      path,
      `LEGACY_PASSWORD_HASH_CONFIG_JSON='${JSON.stringify(config)}'\n`,
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        remaining,
        converted,
        configurationMatches: true,
        privateVariablesFile: path,
      }),
    );
  } finally {
    await mongoose.disconnect();
  }
}

void prepare().catch(() => {
  console.error(
    'Préparation interrompue : vérifiez la base et les paramètres privés de reprise. Aucun compte modifié.',
  );
  process.exitCode = 1;
});
