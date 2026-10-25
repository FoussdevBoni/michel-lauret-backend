import { z } from 'zod';

export const cycleInputSchema = z
  .object({
    nom: z.string().trim().min(1, 'Le nom du cycle est obligatoire.').max(100),
    niveauScolaireId: z.string().regex(/^[a-f0-9]{24}$/i, 'Niveau scolaire invalide.'),
  })
  .strict();

export const cycleUpdateSchema = cycleInputSchema.extend({
  version: z.number().int().nonnegative(),
});
