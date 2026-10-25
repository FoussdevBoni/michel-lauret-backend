import { withTransaction } from '../lib/withTransaction';
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { Cycle, type ICycle } from '../models/Cycle';
import { NiveauScolaire } from '../models/NiveauScolaire';
import { CycleSyncReceipt } from '../models/CycleSyncReceipt';
import {
  cycleSyncMutationSchema,
  cycleSyncPageSchema,
} from '../types/features/CycleSync';
import { deletionService } from './deletionService';
import { HttpError } from '../utils/HttpError';

function serialize(record: ICycle) {
  return {
    id: String(record._id),
    nom: record.nom,
    niveauScolaireId: String(record.niveauScolaireId),
    version: record.__v,
    isDeleted: record.isDeleted,
    deletedAt: record.deletedAt?.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export const cycleSyncService = {
  async page(query: unknown) {
    const { after } = cycleSyncPageSchema.parse(query);
    const records = await Cycle.find(
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
    const data = cycleSyncMutationSchema.parse(input);
    const digest = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const replay = (receipt: { ownerId: string; digest: string; result: unknown }) => {
      if (receipt.ownerId !== ownerId || receipt.digest !== digest)
        throw new HttpError(409, 'Cet identifiant d’opération est déjà utilisé.');
      return receipt.result;
    };
    try {
      return await withTransaction(async (session) => {
        const receipt = await CycleSyncReceipt.findOne({
          operationId: data.operationId,
        }).session(session);
        if (receipt) return replay(receipt);
        const items = [];
        for (const item of data.items) {
          let record: ICycle | null = null;
          if (item.targetId) {
            record = await Cycle.findOneAndUpdate(
              { _id: item.targetId, __v: item.version },
              { $inc: { referenceRevision: 1 } },
              { new: true, session },
            );
            if (!record)
              throw new HttpError(
                409,
                'Ce cycle a changé sur le serveur. Actualisez puis résolvez le conflit.',
              );
          }
          if (item.action === 'delete') {
            if (record) {
              await deletionService.deleteMany('cycle', [String(record._id)], session);
              record = await Cycle.findById(record._id).session(session);
            }
          } else {
            const parent = await NiveauScolaire.findOneAndUpdate(
              { _id: item.data!.niveauScolaireId, isDeleted: false },
              { $inc: { referenceRevision: 1 } },
              { new: true, session },
            );
            if (!parent)
              throw new HttpError(
                409,
                'Le niveau scolaire parent est introuvable ou archivé sur le serveur.',
              );
            if (record) {
              if (record.isDeleted)
                throw new HttpError(409, 'Ce cycle est archivé sur le serveur.');
              if (String(record.niveauScolaireId) !== item.data!.niveauScolaireId)
                throw new HttpError(
                  409,
                  'Le niveau scolaire d’un cycle existant ne peut pas être changé.',
                );
              record.nom = item.data!.nom;
              record.__v++;
              await record.save({ session });
            } else {
              [record] = await Cycle.create([item.data!], { session });
            }
          }
          items.push({
            localId: item.localId,
            record: record ? serialize(record) : null,
          });
        }
        const response = { operationId: data.operationId, items };
        await CycleSyncReceipt.create(
          [{ operationId: data.operationId, ownerId, digest, result: response }],
          { session },
        );
        return response;
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const receipt = await CycleSyncReceipt.findOne({ operationId: data.operationId });
        if (receipt) return replay(receipt);
        throw new HttpError(
          409,
          'Un cycle porte déjà ce nom dans ce niveau scolaire, y compris dans les archives.',
        );
      }
      throw error;
    }
  },
};
