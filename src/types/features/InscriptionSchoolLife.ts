import { z } from 'zod';

export const schoolLifeEntrySchema = z
  .object({
    periodeId: z.string().regex(/^[a-f0-9]{24}$/i, 'Période invalide.'),
    score: z
      .object({
        absences: z.number().int().nonnegative(),
        retards: z.number().int().nonnegative(),
        conduite: z.number().finite().min(0).max(20).nullable(),
      })
      .strict(),
  })
  .strict();
export const schoolLifeSchema = z
  .object({
    vieScolaire: z
      .array(schoolLifeEntrySchema)
      .min(1)
      .max(100)
      .refine(
        (items) => new Set(items.map((item) => item.periodeId)).size === items.length,
        'Une période apparaît plusieurs fois.',
      ),
    version: z.number().int().nonnegative(),
  })
  .strict();
export type SchoolLifeEntry = z.infer<typeof schoolLifeEntrySchema>;
export type SchoolLifeInput = z.infer<typeof schoolLifeSchema>;
