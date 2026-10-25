import { z } from 'zod';
import { niveauScolaireInputSchema } from './NiveauScolaire';

export const niveauSyncMutationSchema = z
  .object({
    operationId: z.string().uuid(),
    items: z
      .array(
        z
          .object({
            localId: z.string().min(1).max(100),
            targetId: z
              .string()
              .regex(/^[a-f0-9]{24}$/i)
              .optional(),
            version: z.number().int().nonnegative(),
            action: z.enum(['save', 'delete']),
            data: niveauScolaireInputSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.items.map((item) => item.localId)).size !== value.items.length ||
      new Set(value.items.flatMap((item) => (item.targetId ? [item.targetId] : [])))
        .size !== value.items.filter((item) => item.targetId).length
    ) {
      context.addIssue({ code: 'custom', message: 'Cibles répétées dans le lot.' });
    }
    for (const item of value.items) {
      if (item.action === 'save' && !item.data)
        context.addIssue({ code: 'custom', message: 'Données du niveau requises.' });
    }
  });

export const niveauSyncPageSchema = z.object({
  after: z
    .string()
    .regex(/^[a-f0-9]{24}$/i)
    .optional(),
});
