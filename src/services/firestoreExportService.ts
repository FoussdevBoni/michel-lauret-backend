import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  FirestoreExportReport,
  FirestoreExportSource,
} from '../types/features/FirestoreMigration';

export async function exportFirestore(
  source: FirestoreExportSource,
  outputRoot: string,
  onProgress?: (progress: { collection: string; documents: number }) => void,
) {
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(outputRoot, 'firestore-'));
  const partialPath = join(directory, 'firestore.partial.json');
  const finalPath = join(directory, 'firestore.json');
  const output = await open(partialPath, 'wx', 0o600);
  const hash = createHash('sha256');
  const startedAt = new Date().toISOString();
  const collections: Record<string, number> = Object.create(null);
  let documents = 0;
  let missingParents = 0;
  let first = true;
  async function write(chunk: string) {
    await output.writeFile(chunk, 'utf8');
    hash.update(chunk);
  }
  async function visit(collectionPath: string) {
    if (Object.hasOwn(collections, collectionPath))
      throw new Error('Collection parcourue plusieurs fois.');
    collections[collectionPath] = 0;
    onProgress?.({ collection: collectionPath.split('/')[0], documents });
    for await (const document of source.documents(collectionPath)) {
      if (
        !document.path.startsWith(`${collectionPath}/`) ||
        document.path.split('/').length !== collectionPath.split('/').length + 1
      )
        throw new Error('Chemin de document incohérent.');
      await write(`${first ? '' : ',\n'}${JSON.stringify(document)}`);
      first = false;
      if (document.exists) {
        documents++;
        collections[collectionPath]++;
      } else missingParents++;
      if (documents && documents % 100 === 0)
        onProgress?.({ collection: collectionPath.split('/')[0], documents });
      for (const child of await source.collections(document.path)) await visit(child);
    }
  }
  try {
    const metadata = {
      format: 'cpeg-firestore-export',
      version: 1,
      projectId: source.projectId,
      databaseId: source.databaseId,
      startedAt,
      consistency: 'live-non-atomic',
    } as const;
    await write(`${JSON.stringify(metadata).slice(0, -1)},"documents":[\n`);
    for (const collection of await source.collections()) await visit(collection);
    const completedAt = new Date().toISOString();
    await write(`\n],"completedAt":${JSON.stringify(completedAt)}}\n`);
    await output.sync();
    await output.close();
    await rename(partialPath, finalPath);
    const report: FirestoreExportReport = {
      ...metadata,
      completedAt,
      documents,
      missingParents,
      collections: Object.fromEntries(Object.entries(collections)),
      sha256: hash.digest('hex'),
    };
    await writeFile(
      join(directory, 'report.json'),
      JSON.stringify(report, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    return { directory, file: finalPath, report };
  } catch (cause) {
    await output.close().catch(() => undefined);
    throw cause;
  }
}
