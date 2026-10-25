import { withTransaction } from '../lib/withTransaction';
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { NiveauScolaire, type INiveauScolaire } from '../models/NiveauScolaire';
import { NiveauSyncReceipt } from '../models/NiveauSyncReceipt';
import {
  niveauSyncMutationSchema,
  niveauSyncPageSchema,
} from '../types/features/NiveauScolaireSync';
import { deletionService } from './deletionService';
import { HttpError } from '../utils/HttpError';

function serialize(record: INiveauScolaire) {
  return {
    id: String(record._id),
    nom: record.nom,
    notePlafond: record.notePlafond,
    version: record.__v,
    isDeleted: record.isDeleted,
    deletedAt: record.deletedAt?.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export const niveauScolaireSyncService = {
  async page(query: unknown) {
    const { after } = niveauSyncPageSchema.parse(query);
    const records = await NiveauScolaire.find(
      after ? { _id: { $gt: new Types.ObjectId(after) } } : {},
    )
      .sort({ _id: 1 })
      .limit(101);
    const items = records.slice(0, 100);
    return {
      items: items.map(serialize),
      next: records.length > 100 ? String(items[99]._id) : null,
    };
  },
  async mutate(input: unknown, ownerId: string) {
    const data = niveauSyncMutationSchema.parse(input);
    const digest = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const replay = (receipt: { ownerId: string; digest: string; result: unknown }) => {
      if (receipt.ownerId !== ownerId || receipt.digest !== digest)
        throw new HttpError(409, 'Cet identifiant d’opération est déjà utilisé.');
      return receipt.result;
    };
    try {
      return await withTransaction(async (session) => {
        const receipt = await NiveauSyncReceipt.findOne({
          operationId: data.operationId,
        }).session(session);
        if (receipt) return replay(receipt);
        const result = [];
        for (const item of data.items) {
          let record: INiveauScolaire | null = null;
          if (item.targetId) {
            // La prise d'écriture sérialise suppression et création de dépendances.
            record = await NiveauScolaire.findOneAndUpdate(
              { _id: item.targetId, __v: item.version },
              { $inc: { referenceRevision: 1 } },
              { new: true, session },
            );
            if (!record)
              throw new HttpError(
                409,
                'Ce niveau a changé sur le serveur. Actualisez puis résolvez le conflit.',
              );
          }
          if (item.action === 'delete') {
            if (record) {
              await deletionService.deleteMany(
                'niveauScolaire',
                [String(record._id)],
                session,
              );
              record = await NiveauScolaire.findById(record._id).session(session);
            }
          } else if (!item.targetId) {
            [record] = await NiveauScolaire.create([item.data!], { session });
          } else {
            if (record!.isDeleted)
              throw new HttpError(409, 'Ce niveau est archivé sur le serveur.');
            record!.nom = item.data!.nom;
            record!.notePlafond = item.data!.notePlafond;
            record!.__v++;
            await record!.save({ session });
          }
          result.push({
            localId: item.localId,
            record: record ? serialize(record) : null,
          });
        }
        const response = { operationId: data.operationId, items: result };
        await NiveauSyncReceipt.create(
          [{ operationId: data.operationId, ownerId, digest, result: response }],
          { session },
        );
        return response;
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const receipt = await NiveauSyncReceipt.findOne({
          operationId: data.operationId,
        });
        if (receipt) return replay(receipt);
        throw new HttpError(
          409,
          'Un niveau scolaire porte déjà ce nom sur le serveur, y compris dans les archives.',
        );
      }
      throw error;
    }
  },
};
