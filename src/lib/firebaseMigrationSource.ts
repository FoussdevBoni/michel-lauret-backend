import { readFile } from 'node:fs/promises';
import { cert } from 'firebase-admin/app';
import { createFirestoreRestSource } from './firestoreRestSource';
import type { FirestoreExportSource } from '../types/features/FirestoreMigration';

export async function createFirebaseMigrationSource(
  credentialsPath: string,
  expectedProjectId: string,
  databaseId = '(default)',
): Promise<FirestoreExportSource & { close(): Promise<void> }> {
  if (process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error('FIRESTORE_EMULATOR_HOST est défini : export réel refusé.');
  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
  } catch {
    throw new Error('Fichier de compte de service absent ou JSON invalide.');
  }
  if (
    credentials.type !== 'service_account' ||
    credentials.project_id !== expectedProjectId ||
    typeof credentials.client_email !== 'string' ||
    typeof credentials.private_key !== 'string'
  )
    throw new Error('Compte de service invalide ou projet différent de --project.');
  let credential;
  try {
    credential = cert({
      projectId: expectedProjectId,
      clientEmail: credentials.client_email,
      privateKey: credentials.private_key,
    });
  } catch {
    throw new Error('Clé de compte de service invalide.');
  }
  let cached: { token: string; expiresAt: number } | undefined;
  let refreshing: Promise<string> | undefined;
  return createFirestoreRestSource(expectedProjectId, databaseId, async () => {
    if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
    refreshing ??= credential
      .getAccessToken()
      .then((value) => {
        cached = {
          token: value.access_token,
          expiresAt: Date.now() + value.expires_in * 1000,
        };
        return cached.token;
      })
      .finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  });
}
