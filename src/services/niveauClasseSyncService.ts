import { withTransaction } from '../lib/withTransaction';
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { NiveauClasse, type INiveauClasse } from '../models/NiveauClasse';
import { NiveauClasseSyncReceipt } from '../models/NiveauClasseSyncReceipt';
import {
  niveauClasseSyncMutationSchema,
  niveauClasseSyncPageSchema,
} from '../types/features/NiveauClasseSync';
import { requireCycle } from './niveauClasseService';
import { deletionService } from './deletionService';
import { HttpError } from '../utils/HttpError';

function serialize(record: INiveauClasse) {
  return {
    id: String(record._id),
    nom: record.nom,
    cycleId: String(record.cycleId),
    niveauScolaireId: String(record.niveauScolaireId),
    version: record.__v,
    isDeleted: record.isDeleted,
    deletedAt: record.deletedAt?.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export const niveauClasseSyncService = {
  async page(query: unknown) {
    const { after } = niveauClasseSyncPageSchema.parse(query);
    const records = await NiveauClasse.find(
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
    const data = niveauClasseSyncMutationSchema.parse(input);
    const digest = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const replay = (receipt: { ownerId: string; digest: string; result: unknown }) => {
      if (receipt.ownerId !== ownerId || receipt.digest !== digest)
        throw new HttpError(409, 'Cet identifiant d’opération est déjà utilisé.');
      return receipt.result;
    };
    try {
      return await withTransaction(async (session) => {
        const receipt = await NiveauClasseSyncReceipt.findOne({
          operationId: data.operationId,
        }).session(session);
        if (receipt) return replay(receipt);
        const items = [];
        for (const item of data.items) {
          let record: INiveauClasse | null = null;
          if (item.targetId) {
            record = await NiveauClasse.findOneAndUpdate(
              { _id: item.targetId, __v: item.version },
              { $inc: { referenceRevision: 1 } },
              { new: true, session },
            );
            if (!record)
              throw new HttpError(
                409,
                'Ce niveau de classe a changé sur le serveur. Actualisez puis résolvez le conflit.',
              );
          }
          if (item.action === 'delete') {
            if (record) {
              await deletionService.deleteMany(
                'niveauClasse',
                [String(record._id)],
                session,
              );
              record = await NiveauClasse.findById(record._id).session(session);
            }
          } else {
            const parent = await requireCycle(item.data!.cycleId, session);
            if (record) {
              if (record.isDeleted)
                throw new HttpError(
                  409,
                  'Ce niveau de classe est archivé sur le serveur.',
                );
              if (
                String(record.cycleId) !== item.data!.cycleId ||
                String(record.niveauScolaireId) !== String(parent.niveauScolaireId)
              )
                throw new HttpError(
                  409,
                  'Le rattachement d’un niveau de classe existant ne peut pas être changé.',
                );
              record = await NiveauClasse.findOneAndUpdate(
                { _id: record._id, __v: item.version },
                { $set: { nom: item.data!.nom }, $inc: { __v: 1 } },
                { new: true, runValidators: true, session },
              );
            } else {
              [record] = await NiveauClasse.create(
                [{ ...item.data!, niveauScolaireId: parent.niveauScolaireId }],
                { session },
              );
            }
          }
          items.push({
            localId: item.localId,
            record: record ? serialize(record) : null,
          });
        }
        const response = { operationId: data.operationId, items };
        await NiveauClasseSyncReceipt.create(
          [{ operationId: data.operationId, ownerId, digest, result: response }],
          { session },
        );
        return response;
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const receipt = await NiveauClasseSyncReceipt.findOne({
          operationId: data.operationId,
        });
        if (receipt) return replay(receipt);
        throw new HttpError(
          409,
          'Un niveau de classe porte déjà ce nom dans ce cycle, y compris dans les archives.',
        );
      }
      // L'absence d'un parent est un conflit à résoudre, pas une nouvelle cible à créer implicitement.
      if (error instanceof HttpError && error.status === 404)
        throw new HttpError(409, error.message);
      throw error;
    }
  },
};
