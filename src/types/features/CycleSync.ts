import { z } from 'zod';
import { cycleInputSchema } from './Cycle';

export const cycleSyncMutationSchema = z
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
            data: cycleInputSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const targets = value.items.flatMap((item) => (item.targetId ? [item.targetId] : []));
    if (
      new Set(value.items.map((item) => item.localId)).size !== value.items.length ||
      new Set(targets).size !== targets.length
    )
      context.addIssue({ code: 'custom', message: 'Cibles répétées dans le lot.' });
    if (value.items.some((item) => item.action === 'save' && !item.data))
      context.addIssue({ code: 'custom', message: 'Données du cycle requises.' });
  });

export const cycleSyncPageSchema = z.object({
  after: z
    .string()
    .regex(/^[a-f0-9]{24}$/i)
    .optional(),
});
