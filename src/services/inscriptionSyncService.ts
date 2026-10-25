import { z } from 'zod';
import { Inscription } from '../models/Inscription';
import { inscriptionInputSchema } from '../types/features/Inscription';
import { schoolLifeSchema } from '../types/features/InscriptionSchoolLife';
import { inscriptionService, serializeInscription } from './inscriptionService';
import { inscriptionSchoolLifeService } from './inscriptionSchoolLifeService';
import { createModuleSyncService } from './createModuleSyncService';

const inputSchema = inscriptionInputSchema.extend({
  vieScolaire: schoolLifeSchema.shape.vieScolaire.optional(),
});
function scoreKey(items: { periodeId: string; score: unknown }[]) {
  const scoreSchema = z.object({
    absences: z.number(),
    retards: z.number(),
    conduite: z.number().nullable().default(null),
  });
  return JSON.stringify(
    [...items]
      .sort((a, b) => a.periodeId.localeCompare(b.periodeId))
      .map((item) => [item.periodeId, scoreSchema.parse(item.score)]),
  );
}

export const inscriptionSyncService = createModuleSyncService({
  entity: 'inscription',
  model: Inscription,
  serialize: serializeInscription,
  // Les désactivations d'un transfert précèdent l'activation de sa destination.
  orderItems: (items) =>
    [...items].sort(
      (a, b) =>
        Number(a.action === 'save' && a.data?.isActive === true) -
        Number(b.action === 'save' && b.data?.isActive === true),
    ),
  async save(input, id, version) {
    const { vieScolaire, ...data } = inputSchema.parse(input);
    const record = id
      ? await inscriptionService.update(id, { ...data, version })
      : await inscriptionService.create(data);
    if (vieScolaire && scoreKey(vieScolaire) !== scoreKey(record.vieScolaire))
      await inscriptionSchoolLifeService.update(record.id, {
        vieScolaire,
        version: record.version,
      });
    return { id: record.id };
  },
  remove: (ids) => inscriptionService.deleteMany(ids),
});
