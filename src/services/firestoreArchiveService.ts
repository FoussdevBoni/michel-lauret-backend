import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { FirestoreArchive, FirestoreMigrationRun } from '../models/FirestoreMigration';
import type {
  ExportedFirestoreDocument,
  FirestoreArchiveRecord,
} from '../types/features/FirestoreMigration';

export async function requireMigrationArchiveScope(sha256: string) {
  if (
    (await FirestoreArchive.exists({ sourceHash: { $ne: sha256 } })) ||
    (await FirestoreMigrationRun.exists({ _id: { $ne: sha256 } }))
  )
    throw new Error('Une autre migration est déjà présente dans la cible.');
}

export async function verifyFirestoreArchives(
  documents: ExportedFirestoreDocument[],
  sha256: string,
  onProgress?: (phase: string) => void,
) {
  const originals = new Map(
    documents.map((document) => [document.path, JSON.stringify(document)]),
  );
  let count = 0;
  const cursor = FirestoreArchive.find({ sourceHash: sha256 })
    .lean()
    .cursor({ batchSize: 250 });
  for await (const row of cursor) {
    if (JSON.stringify(row.document) !== originals.get(row.sourcePath))
      throw new Error('Une archive diffère du document source.');
    count++;
    if (count % 1000 === 0 || count === documents.length)
      onProgress?.(`verified_archives_${count}_of_${documents.length}`);
  }
  if (count !== documents.length) throw new Error('Archive de migration incomplète.');
  return count;
}

/** Archive durable, reprenable et séparée des données utilisées par l'application. */
export async function archiveFirestoreDocuments(
  documents: ExportedFirestoreDocument[],
  sha256: string,
  onProgress?: (phase: string) => void,
) {
  const existing = await FirestoreArchive.find({ sourceHash: sha256 })
    .select('sourcePath')
    .lean();
  const paths = new Set(existing.map((document) => document.sourcePath));
  const missing = documents.filter((document) => !paths.has(document.path));
  const createdAt = new Date();
  for (let offset = 0; offset < missing.length; offset += 1000) {
    const batch = missing.slice(offset, offset + 1000);
    // Accès natif pour garder les métadonnées de l'archive immuables : Mongoose
    // ajouterait un $set updatedAt même à une opération $setOnInsert.
    await mongoose.connection
      .db!.collection<FirestoreArchiveRecord>(FirestoreArchive.collection.name)
      .bulkWrite(
        batch.map((document) => {
          const _id = createHash('sha256')
            .update(JSON.stringify([sha256, document.path]))
            .digest('hex');
          return {
            updateOne: {
              filter: { _id },
              update: {
                $setOnInsert: {
                  _id,
                  sourceHash: sha256,
                  sourcePath: document.path,
                  document,
                  createdAt,
                  updatedAt: createdAt,
                },
              },
              upsert: true,
            },
          };
        }),
        { ordered: true, writeConcern: { w: 'majority' } },
      );
    onProgress?.(
      `archived_${paths.size + Math.min(offset + 1000, missing.length)}_of_${documents.length}`,
    );
  }
  await verifyFirestoreArchives(documents, sha256, onProgress);
  return missing.length;
}
