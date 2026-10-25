import { z } from 'zod';

export const inscriptionInputSchema = z
  .object({
    eleveDataId: z.string().regex(/^[a-f0-9]{24}$/i, 'Identifiant élève invalide.'),
    classeId: z.string().regex(/^[a-f0-9]{24}$/i, 'Identifiant classe invalide.'),
    anneeScolaire: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{4}$/, 'Utilisez le format 2026-2027.')
      .refine(
        (value) => Number(value.slice(5)) === Number(value.slice(0, 4)) + 1,
        'L’année scolaire doit couvrir deux années consécutives.',
      ),
    dateInscription: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.')
      .refine((value) => {
        const date = new Date(`${value}T00:00:00Z`);
        return (
          Number.isFinite(date.getTime()) &&
          date.toISOString().slice(0, 10) === value &&
          value <= new Date().toISOString().slice(0, 10)
        );
      }, 'La date d’inscription doit être une date réelle, non future.'),
    statutScolaire: z
      .enum(['nouveau', 'redoublant', 'transfert', 'passant', ''])
      .default('nouveau'),
    isActive: z.boolean().default(true),
  })
  .strict();

export const inscriptionUpdateSchema = inscriptionInputSchema.extend({
  version: z.number().int().nonnegative(),
});
