import { z } from 'zod';

const effectifSchema = z
  .number()
  .int('L’effectif doit être un entier.')
  .nonnegative('L’effectif ne peut pas être négatif.')
  .safe();

export const classeInputSchema = z
  .object({
    nom: z.string().trim().min(1, 'Le nom de la classe est obligatoire.').max(100),
    niveauClasseId: z.string().regex(/^[a-f0-9]{24}$/i, 'Niveau de classe invalide.'),
    effectifF: effectifSchema.default(0),
    effectifM: effectifSchema.default(0),
  })
  .strict();

export const classeUpdateSchema = classeInputSchema.extend({
  version: z.number().int().nonnegative(),
});
