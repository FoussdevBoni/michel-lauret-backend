import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  legacyConfigId,
  passwordDigest,
  verifyLegacyPassword,
  readConfiguredLegacyHashConfig,
  verifyConfiguredLegacyPassword,
} from '../src/lib/legacyPassword';
import { legacyHashConfigSchema } from '../src/types/features/LegacyPassword';
import { legacyConfig, legacyCredential } from './helpers/legacyPasswordFixture';

test('le secret Railway permet de vérifier les anciens mots de passe sans fichier local', async () => {
  const previous = process.env.LEGACY_PASSWORD_HASH_CONFIG_JSON;
  const previousPath = process.env.LEGACY_PASSWORD_HASH_CONFIG_PATH;
  try {
    process.env.LEGACY_PASSWORD_HASH_CONFIG_JSON = JSON.stringify(legacyConfig);
    process.env.LEGACY_PASSWORD_HASH_CONFIG_PATH = '/fichier-local-absent.json';
    assert.deepEqual(await readConfiguredLegacyHashConfig(), legacyConfig);
    assert.equal(
      await verifyConfiguredLegacyPassword('user1password', legacyCredential),
      true,
    );
    assert.equal(
      await verifyConfiguredLegacyPassword('incorrect', legacyCredential),
      false,
    );
    await assert.rejects(
      verifyConfiguredLegacyPassword('user1password', {
        ...legacyCredential,
        configId: '0'.repeat(64),
      }),
      (error: any) => error.status === 503,
    );
  } finally {
    if (previous === undefined) delete process.env.LEGACY_PASSWORD_HASH_CONFIG_JSON;
    else process.env.LEGACY_PASSWORD_HASH_CONFIG_JSON = previous;
    if (previousPath === undefined) delete process.env.LEGACY_PASSWORD_HASH_CONFIG_PATH;
    else process.env.LEGACY_PASSWORD_HASH_CONFIG_PATH = previousPath;
  }
});

test('un secret de déploiement invalide ne retombe pas silencieusement sur un fichier', async () => {
  const previous = process.env.LEGACY_PASSWORD_HASH_CONFIG_JSON;
  try {
    for (const value of ['', '{', '{}', 'x'.repeat(16385)]) {
      process.env.LEGACY_PASSWORD_HASH_CONFIG_JSON = value;
      await assert.rejects(
        verifyConfiguredLegacyPassword('user1password', legacyCredential),
        (error: any) => error.status === 503,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.LEGACY_PASSWORD_HASH_CONFIG_JSON;
    else process.env.LEGACY_PASSWORD_HASH_CONFIG_JSON = previous;
  }
});

test('le fichier privé reste utilisable en développement sans secret Railway', async () => {
  const previous = process.env.LEGACY_PASSWORD_HASH_CONFIG_JSON;
  const previousPath = process.env.LEGACY_PASSWORD_HASH_CONFIG_PATH;
  const directory = await mkdtemp(join(tmpdir(), 'legacy-config-test-'));
  try {
    delete process.env.LEGACY_PASSWORD_HASH_CONFIG_JSON;
    const path = join(directory, 'config.json');
    await writeFile(path, JSON.stringify(legacyConfig));
    process.env.LEGACY_PASSWORD_HASH_CONFIG_PATH = path;
    assert.deepEqual(await readConfiguredLegacyHashConfig(), legacyConfig);
  } finally {
    if (previous === undefined) delete process.env.LEGACY_PASSWORD_HASH_CONFIG_JSON;
    else process.env.LEGACY_PASSWORD_HASH_CONFIG_JSON = previous;
    if (previousPath === undefined) delete process.env.LEGACY_PASSWORD_HASH_CONFIG_PATH;
    else process.env.LEGACY_PASSWORD_HASH_CONFIG_PATH = previousPath;
    await rm(join(directory, 'config.json'));
    await rmdir(directory);
  }
});

test('SCRYPT local reconnaît le vecteur officiel Firebase et refuse un mauvais mot de passe', async () => {
  assert.equal(
    await verifyLegacyPassword('user1password', legacyCredential, legacyConfig),
    true,
  );
  assert.equal(
    await verifyLegacyPassword('user1password ', legacyCredential, legacyConfig),
    false,
  );
  assert.equal(
    await verifyLegacyPassword('incorrect', legacyCredential, legacyConfig),
    false,
  );
});

test('une configuration ou une empreinte différente ne peut pas valider la connexion', async () => {
  assert.equal(
    await verifyLegacyPassword(
      'user1password',
      { ...legacyCredential, configId: '0'.repeat(64) },
      legacyConfig,
    ),
    false,
  );
  assert.equal(
    await verifyLegacyPassword(
      'user1password',
      { ...legacyCredential, hash: 'YQ==' },
      legacyConfig,
    ),
    false,
  );
  assert.notEqual(
    legacyConfigId({ ...legacyConfig, rounds: 7 }),
    legacyCredential.configId,
  );
});

test('les empreintes base64url exportées par le SDK sont reconnues sans altération', async () => {
  const urlSafe = (value: string) =>
    value.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  assert.equal(
    await verifyLegacyPassword(
      'user1password',
      {
        ...legacyCredential,
        hash: urlSafe(legacyCredential.hash),
        salt: urlSafe(legacyCredential.salt),
      },
      legacyConfig,
    ),
    true,
  );
});

test('configuration bornée : refuse base64 invalide, algorithme différent et coût excessif', () => {
  for (const change of [
    { signerKey: 'not base64' },
    { algorithm: 'STANDARD_SCRYPT' },
    { memoryCost: 30 },
    { rounds: 0 },
    { memoryCost: 16, rounds: 16, extra: true },
  ])
    assert.equal(
      legacyHashConfigSchema.safeParse({ ...legacyConfig, ...change }).success,
      false,
    );
});

test('préempreinte UTF-8 : conserve les différences après 72 octets et les caractères accentués', () => {
  assert.notEqual(
    passwordDigest('x'.repeat(90) + 'a'),
    passwordDigest('x'.repeat(90) + 'b'),
  );
  assert.notEqual(
    passwordDigest('é'.repeat(50) + 'a'),
    passwordDigest('é'.repeat(50) + 'b'),
  );
  assert.notEqual(passwordDigest(' mot de passe'), passwordDigest('mot de passe'));
  assert.equal(passwordDigest('secret').length, 64);
});
