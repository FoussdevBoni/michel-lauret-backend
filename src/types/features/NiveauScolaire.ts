import { z } from 'zod';

export const niveauScolaireInputSchema = z
  .object({
    nom: z.string().trim().min(1, 'Le nom est obligatoire.').max(100),
    notePlafond: z.number().finite().min(0.01).default(20),
  })
  .strict();

export const niveauScolaireUpdateSchema = niveauScolaireInputSchema.extend({
  version: z.number().int().nonnegative(),
});
