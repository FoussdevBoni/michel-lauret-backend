import { z } from 'zod';
import { inscriptionInputSchema } from './Inscription';

export const inscriptionQuerySchema = z
  .object({
    where: z
      .object({
        id: z
          .string()
          .regex(/^[a-f0-9]{24}$/i)
          .optional(),
        eleveDataId: z
          .string()
          .regex(/^[a-f0-9]{24}$/i)
          .optional(),
        classeId: z
          .string()
          .regex(/^[a-f0-9]{24}$/i)
          .optional(),
        anneeScolaire: inscriptionInputSchema.shape.anneeScolaire.optional(),
        dateInscription: inscriptionInputSchema.shape.dateInscription.optional(),
        isActive: z.boolean().optional(),
        statutScolaire: inscriptionInputSchema.shape.statutScolaire.optional(),
        nom: z.string().max(100).optional(),
        prenom: z.string().max(100).optional(),
        matricule: z.string().max(100).optional(),
        recherche: z.string().max(100).optional(),
      })
      .strict()
      .default({}),
    options: z
      .object({
        orderBy: z
          .enum([
            'dateInscription',
            'createdAt',
            'anneeScolaire',
            'nom',
            'prenom',
            'matricule',
          ])
          .default('createdAt'),
        orderDir: z.enum(['ASC', 'DESC']).default('DESC'),
        limit: z.number().int().min(1).max(100).default(100),
        offset: z.number().int().nonnegative().default(0),
      })
      .strict()
      .default({}),
  })
  .strict();

export type InscriptionQueryInput = z.input<typeof inscriptionQuerySchema>;
