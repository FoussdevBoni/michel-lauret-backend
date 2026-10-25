import { z } from 'zod';

export const studentInputSchema = z
  .object({
    nom: z.string().trim().min(1, 'Le nom est obligatoire.').max(100),
    prenom: z.string().trim().min(1, 'Le prénom est obligatoire.').max(100),
    dateNaissance: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date de naissance invalide.')
      .refine((value) => {
        const date = new Date(`${value}T00:00:00Z`);
        return (
          Number.isFinite(date.getTime()) &&
          date.toISOString().slice(0, 10) === value &&
          value <= new Date().toISOString().slice(0, 10)
        );
      }, 'La date de naissance doit être une date réelle, non future.')
      .or(z.literal('')),
    sexe: z.enum(['F', 'M', '']),
    matricule: z.string().trim().toUpperCase().max(64).default(''),
    lieuDeNaissance: z.string().trim().max(150).default(''),
    contact: z.string().trim().max(100).default(''),
    statut: z.enum(['actif', 'inactif', 'exclu']).default('actif'),
  })
  .strict();

export const studentUpdateSchema = studentInputSchema.extend({
  version: z.number().int().nonnegative(),
});
