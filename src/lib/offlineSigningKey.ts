import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export async function offlineSigningKey() {
  let pem = process.env.OFFLINE_AUTH_PRIVATE_KEY;
  if (!pem) {
    const path = resolve(process.env.OFFLINE_AUTH_KEY_FILE ?? '.local/offline-auth.pem');
    try {
      pem = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(dirname(path), { recursive: true });
      const generated = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
        .privateKey.export({ type: 'pkcs8', format: 'pem' })
        .toString();
      try {
        await writeFile(path, generated, { flag: 'wx', mode: 0o600 });
      } catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError;
      }
      pem = await readFile(path, 'utf8');
    }
  }
  const privateKey = createPrivateKey(pem);
  const publicKey = createPublicKey(privateKey).export({ format: 'jwk' });
  return { privateKey, publicKey };
}
