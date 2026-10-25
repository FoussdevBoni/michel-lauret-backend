import { z } from 'zod';
import { Bulletin } from '../models/Bulletin';
import {
  bulletinChangesSchema,
  bulletinConfigSchema,
  bulletinIdentitySchema,
} from '../types/features/Bulletin';
import { bulletinService } from './bulletinService';
import { serializeBulletin } from './bulletinQueryService';
import { createModuleSyncService } from './createModuleSyncService';
import { HttpError } from '../utils/HttpError';

const life = z
  .object({
    absences: z.number().int().nonnegative(),
    retards: z.number().int().nonnegative(),
    conduite: z.number().min(0).max(20).nullable(),
  })
  .strict();
const comments = bulletinChangesSchema.shape.commentaires.unwrap().required();
const schema = bulletinIdentitySchema
  .extend({
    vieScolaire: life,
    commentaires: comments,
    baseline: z.object({ vieScolaire: life, commentaires: comments }).strict(),
    calculate: z.boolean(),
    config: bulletinConfigSchema.optional(),
    restore: z.boolean(),
  })
  .strict();
const sameLife = (left: unknown, right: unknown) =>
  JSON.stringify(life.parse(left)) === JSON.stringify(life.parse(right));
const sameComments = (left: unknown, right: unknown) =>
  JSON.stringify(comments.parse(left)) === JSON.stringify(comments.parse(right));

export const bulletinSyncService = createModuleSyncService({
  entity: 'bulletin',
  model: Bulletin,
  serialize: serializeBulletin,
  canRestore: (data) => schema.parse(data).restore,
  async resolveTarget(input, id, version) {
    const data = schema.parse(input);
    const current = id
      ? await Bulletin.findById(id)
      : await Bulletin.findOne({
          inscriptionId: data.inscriptionId,
          periodeId: data.periodeId,
        });
    if (!current) {
      if (id) throw new HttpError(409, 'Bulletin introuvable.');
      return { version: 0 };
    }
    if (
      String(current.inscriptionId) !== data.inscriptionId ||
      String(current.periodeId) !== data.periodeId
    )
      throw new HttpError(409, 'Le rattachement du bulletin est immuable.');
    if (
      (!id || current.__v !== version) &&
      (current.isDeleted ||
        data.restore ||
        !sameComments(current.commentaires, data.baseline.commentaires) ||
        (!sameLife(current.vieScolaire, data.baseline.vieScolaire) &&
          !sameLife(current.vieScolaire, data.vieScolaire)))
    )
      throw new HttpError(
        409,
        'Les commentaires ou la vie scolaire du bulletin ont changé.',
      );
    // Les notes et la configuration invalident les calculs sans modifier les
    // saisies du bulletin. Seuls ces changements dérivés peuvent être repris.
    return { id: String(current._id), version: current.__v };
  },
  async save(input, id, version = 0) {
    const data = schema.parse(input);
    let current = id ? await Bulletin.findById(id) : null;
    if (!current) {
      const draft = await bulletinService.createUnique({
        inscriptionId: data.inscriptionId,
        periodeId: data.periodeId,
      });
      current = await Bulletin.findById(draft.id);
    }
    if (current?.isDeleted) {
      await bulletinService.restore(id!, { version });
      current = await Bulletin.findById(id);
    }
    const saved = await bulletinService.save({
      inscriptionId: data.inscriptionId,
      periodeId: data.periodeId,
      data: {
        ...(current ? { version: current.__v } : {}),
        commentaires: data.commentaires,
        ...(!current || !sameLife(current.vieScolaire, data.vieScolaire)
          ? { vieScolaire: data.vieScolaire }
          : {}),
      },
    });
    if (data.calculate) {
      const result = await bulletinService.generateMultiple({
        periodeId: data.periodeId,
        bulletinIds: [saved.id],
        ...(data.config ? { config: data.config } : {}),
      });
      if (result.errors.length) throw new HttpError(409, result.errors[0].message);
    }
    return { id: saved.id };
  },
  remove: (ids) => bulletinService.deleteMany(ids),
});
