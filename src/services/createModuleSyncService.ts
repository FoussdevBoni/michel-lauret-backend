import { createHash } from 'node:crypto';
import { Types, type Model } from 'mongoose';
import { z } from 'zod';
import { EntitySyncReceipt } from '../models/EntitySyncReceipt';
import { withTransaction } from '../lib/withTransaction';
import { HttpError } from '../utils/HttpError';

const requestSchema = z
  .object({
    operationId: z.string().uuid(),
    items: z
      .array(
        z
          .object({
            localId: z.string().min(1).max(100),
            targetId: z
              .string()
              .regex(/^(?:[a-f0-9]{24}|school|default)$/i)
              .optional(),
            version: z.number().int().nonnegative(),
            action: z.enum(['save', 'delete']),
            data: z.record(z.unknown()).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((data, context) => {
    const targets = data.items.flatMap((item) => (item.targetId ? [item.targetId] : []));
    if (
      new Set(data.items.map((item) => item.localId)).size !== data.items.length ||
      new Set(targets).size !== targets.length
    )
      context.addIssue({ code: 'custom', message: 'Cibles répétées dans le lot.' });
    if (data.items.some((item) => item.action === 'save' && !item.data))
      context.addIssue({ code: 'custom', message: 'Données de sauvegarde requises.' });
  });

interface ModuleDefinition<Document> {
  entity: string;
  singletonKey?: 'school' | 'default';
  resolveTarget?: (
    data: Record<string, unknown>,
    id: string | undefined,
    version: number,
  ) => Promise<{ id?: string; version: number }>;
  model: Model<Document>;
  serialize: (document: Document) => unknown;
  save: (
    data: Record<string, unknown>,
    id?: string,
    version?: number,
  ) => Promise<{ id: string }>;
  remove: (ids: string[]) => Promise<unknown>;
  canRestore?: (data: Record<string, unknown>) => boolean;
  orderItems?: (
    items: z.infer<typeof requestSchema>['items'],
  ) => z.infer<typeof requestSchema>['items'];
}

export function createModuleSyncService<Document>(
  definition: ModuleDefinition<Document>,
) {
  return {
    async page(query: unknown) {
      const { after } = z
        .object({
          after: z
            .string()
            .regex(/^[a-f0-9]{24}$/i)
            .optional(),
        })
        .parse(query);
      const records = await definition.model
        .find(after ? { _id: { $gt: new Types.ObjectId(after) } } : {})
        .sort({ _id: 1 })
        .limit(101);
      const items = records.slice(0, 100);
      return {
        items: items.map((item) => definition.serialize(item)),
        next: records.length > 100 ? String(items[99]._id) : null,
      };
    },
    async mutate(input: unknown, ownerId: string) {
      const request = requestSchema.parse(input);
      if (definition.singletonKey) {
        if (
          request.items.length !== 1 ||
          request.items.some(
            (item) =>
              item.localId !== definition.singletonKey ||
              (item.targetId !== undefined && item.targetId !== definition.singletonKey),
          )
        )
          throw new HttpError(400, 'Identifiant de configuration invalide.');
      } else if (
        request.items.some(
          (item) => item.targetId && !/^[a-f0-9]{24}$/i.test(item.targetId),
        )
      ) {
        throw new HttpError(400, 'Identifiant métier invalide.');
      }
      const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex');
      const replay = (receipt: { ownerId: string; digest: string; result: unknown }) => {
        if (receipt.ownerId !== ownerId || receipt.digest !== digest)
          throw new HttpError(409, 'Cet identifiant d’opération est déjà utilisé.');
        return receipt.result;
      };
      try {
        return await withTransaction(async (session) => {
          const receipt = await EntitySyncReceipt.findOne({
            entity: definition.entity,
            operationId: request.operationId,
          }).session(session);
          if (receipt) return replay(receipt);
          const items = [];
          const ordered = definition.orderItems?.(request.items) ?? request.items;
          for (const item of ordered) {
            let targetId = item.targetId;
            let version = item.version;
            if (item.action === 'save' && definition.resolveTarget) {
              const resolved = await definition.resolveTarget(
                item.data!,
                targetId,
                version,
              );
              targetId = resolved.id;
              version = resolved.version;
            }
            if (targetId) {
              // La collection brute ajoute uniquement un verrou interne. Les champs
              // métier passent toujours par les validations des services du module.
              const locked = await definition.model.collection.findOneAndUpdate(
                {
                  ...(definition.singletonKey
                    ? { key: definition.singletonKey }
                    : { _id: new Types.ObjectId(targetId) }),
                  __v: version,
                },
                { $inc: { syncRevision: 1 } },
                { session, returnDocument: 'after' },
              );
              if (!locked)
                throw new HttpError(
                  409,
                  'Cette fiche a changé sur le serveur. Résolvez le conflit avant de reprendre.',
                );
              if (
                item.action === 'save' &&
                locked.isDeleted &&
                !definition.canRestore?.(item.data!)
              )
                throw new HttpError(409, 'Cette fiche est archivée sur le serveur.');
            }
            if (item.action === 'delete') {
              if (targetId) await definition.remove([targetId]);
            } else {
              const result = await definition.save(item.data!, targetId, version);
              targetId = result.id;
            }
            const document = targetId
              ? await definition.model
                  .findOne(
                    definition.singletonKey
                      ? { key: definition.singletonKey }
                      : { _id: targetId },
                  )
                  .session(session)
              : null;
            items.push({
              localId: item.localId,
              record: document ? definition.serialize(document) : null,
            });
          }
          const result = { operationId: request.operationId, items };
          await EntitySyncReceipt.create(
            [
              {
                entity: definition.entity,
                operationId: request.operationId,
                ownerId,
                digest,
                result,
              },
            ],
            { session },
          );
          return result;
        });
      } catch (error) {
        if ((error as { code?: number }).code === 11000) {
          const receipt = await EntitySyncReceipt.findOne({
            entity: definition.entity,
            operationId: request.operationId,
          });
          if (receipt) return replay(receipt);
          throw new HttpError(
            409,
            'Une fiche correspondante existe déjà, y compris dans les archives.',
          );
        }
        if (error instanceof HttpError && error.status === 404)
          throw new HttpError(409, error.message);
        throw error;
      }
    },
  };
}
