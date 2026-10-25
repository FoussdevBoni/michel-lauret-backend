import { createCipheriv, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  legacyHashConfigSchema,
  legacyPasswordSchema,
  type LegacyHashConfig,
  type LegacyPassword,
} from '../types/features/LegacyPassword';
import { HttpError } from '../utils/HttpError';

export const defaultLegacyHashConfigPath = '.local/legacy-password-hash-config.json';

export function legacyConfigId(input: LegacyHashConfig) {
  const config = legacyHashConfigSchema.parse(input);
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

export async function readLegacyHashConfig(path: string) {
  const contents = await readFile(path, 'utf8');
  if (Buffer.byteLength(contents) > 16384) throw new Error('Configuration trop grande.');
  return legacyHashConfigSchema.parse(JSON.parse(contents));
}

// Format Firebase SCRYPT : dérivation scrypt puis AES-256-CTR de la clé du projet.
// Référence et vecteur indépendant : https://github.com/firebase/scrypt
// Aucun SDK, appel réseau ou compte de service nécessaire à la connexion.
export async function verifyLegacyPassword(
  password: string,
  input: LegacyPassword,
  parameters: LegacyHashConfig,
) {
  const credential = legacyPasswordSchema.parse(input);
  const config = legacyHashConfigSchema.parse(parameters);
  if (credential.configId !== legacyConfigId(config)) return false;
  const signerKey = Buffer.from(config.signerKey, 'base64');
  const expected = Buffer.from(credential.hash, 'base64');
  if (expected.length !== signerKey.length) return false;
  const salt = Buffer.concat([
    Buffer.from(credential.salt, 'base64'),
    Buffer.from(config.saltSeparator, 'base64'),
  ]);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      {
        N: 2 ** config.memoryCost,
        r: config.rounds,
        p: 1,
        maxmem: 160 * 1024 * 1024,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
  try {
    const cipher = createCipheriv(
      'aes-256-ctr',
      derived.subarray(0, 32),
      Buffer.alloc(16),
    );
    const actual = Buffer.concat([cipher.update(signerKey), cipher.final()]);
    return timingSafeEqual(actual, expected);
  } finally {
    derived.fill(0);
    signerKey.fill(0);
  }
}

export async function verifyConfiguredLegacyPassword(
  password: string,
  input: LegacyPassword,
) {
  try {
    const path =
      process.env.LEGACY_PASSWORD_HASH_CONFIG_PATH || defaultLegacyHashConfigPath;
    const config = await readLegacyHashConfig(path);
    if (input.configId !== legacyConfigId(config))
      throw new Error('Configuration différente.');
    return await verifyLegacyPassword(password, input, config);
  } catch {
    throw new HttpError(
      503,
      'La reprise de cet accès doit être vérifiée par le responsable.',
    );
  }
}

// Évite la troncature bcrypt à 72 octets pour les anciens mots de passe longs.
export function passwordDigest(password: string) {
  return createHash('sha256').update(password, 'utf8').digest('hex');
}
