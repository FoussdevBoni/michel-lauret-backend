import { readFile } from 'node:fs/promises';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  authExportSchema,
  legacyHashConfigSchema,
} from '../types/features/LegacyPassword';
import { legacyConfigId } from './legacyPassword';

// Outil de migration uniquement : ce fichier n'est jamais importé par le serveur.
export async function exportFirebaseAuthSource(
  credentialsPath: string,
  projectId: string,
) {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST)
    throw new Error('Export réel refusé en présence d’un émulateur.');
  const credentials = z
    .object({
      type: z.literal('service_account'),
      project_id: z.literal(projectId),
      client_email: z.string().email(),
      private_key: z.string().min(1),
    })
    .parse(JSON.parse(await readFile(credentialsPath, 'utf8')));
  const credential = cert({
    projectId,
    clientEmail: credentials.client_email,
    privateKey: credentials.private_key,
  });
  const app = initializeApp({ credential, projectId }, `auth-export-${randomUUID()}`);
  try {
    const auth = getAuth(app);
    const users = [];
    let pageToken: string | undefined;
    do {
      const page = await auth.listUsers(1000, pageToken);
      users.push(
        ...page.users.map((user) => ({
          uid: user.uid,
          email: user.email,
          disabled: user.disabled,
          emailVerified: user.emailVerified,
          passwordHash: user.passwordHash,
          passwordSalt: user.passwordSalt,
          providers: user.providerData.map((provider) => provider.providerId),
          hasMfa: Boolean(user.multiFactor?.enrolledFactors.length),
        })),
      );
      if (users.length > 100000) throw new Error('Nombre de comptes inattendu.');
      pageToken = page.pageToken;
    } while (pageToken);

    const token = await credential.getAccessToken();
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${encodeURIComponent(projectId)}/config`,
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(30000),
      },
    );
    let config;
    let configStatus = `http_${response.status}`;
    if (response.ok) {
      const body = z
        .object({
          signIn: z.object({ hashConfig: z.record(z.unknown()).optional() }).optional(),
        })
        .parse(await response.json());
      const hashConfig = body.signIn?.hashConfig;
      const parsed = legacyHashConfigSchema.safeParse({
        algorithm: hashConfig?.algorithm,
        signerKey: hashConfig?.signerKey,
        saltSeparator: hashConfig?.saltSeparator ?? '',
        rounds: hashConfig?.rounds,
        memoryCost: hashConfig?.memoryCost,
      });
      config = parsed.success ? parsed.data : undefined;
      configStatus = config ? 'available' : 'missing_or_unsupported';
    }
    const bundle = authExportSchema.parse({
      format: 'cpeg-auth-export',
      version: 1,
      projectId,
      exportedAt: new Date().toISOString(),
      configId: config ? legacyConfigId(config) : undefined,
      users,
    });
    return { bundle, config, configStatus };
  } finally {
    await deleteApp(app);
  }
}
