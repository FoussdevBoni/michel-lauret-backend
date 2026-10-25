import { z } from 'zod';

export const niveauClasseInputSchema = z
  .object({
    nom: z.string().trim().min(1, 'Le nom du niveau de classe est obligatoire.').max(100),
    cycleId: z.string().regex(/^[a-f0-9]{24}$/i, 'Cycle invalide.'),
  })
  .strict();

export const niveauClasseUpdateSchema = niveauClasseInputSchema.extend({
  version: z.number().int().nonnegative(),
});
