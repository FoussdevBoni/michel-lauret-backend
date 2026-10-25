import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  legacyConfigId,
  passwordDigest,
  verifyLegacyPassword,
} from '../src/lib/legacyPassword';
import { legacyHashConfigSchema } from '../src/types/features/LegacyPassword';
import { legacyConfig, legacyCredential } from './helpers/legacyPasswordFixture';

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
