import { z } from 'zod';
export const matiereInputSchema = z
  .object({
    nom: z.string().trim().min(1, 'Le nom est obligatoire.').max(100),
    coefficient: z
      .number()
      .finite()
      .positive('Le coefficient doit être supérieur à zéro.'),
    niveauClasseId: z
      .string()
      .regex(/^[a-f0-9]{24}$/i, 'Identifiant de niveau invalide.')
      .transform((value) => value.toLowerCase()),
  })
  .strict();
export const matiereUpdateSchema = matiereInputSchema.extend({
  version: z.number().int().nonnegative(),
});
export type MatiereInput = z.infer<typeof matiereInputSchema>;
export interface Matiere extends MatiereInput {
  id: string;
  cycleId: string;
  niveauScolaireId: string;
  version: number;
  isDeleted: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface MatiereWithParents extends Matiere {
  niveauClasse: string;
  cycle: string;
  niveauScolaire: string;
}
export interface MatiereFilters {
  niveauClasseId?: string;
  cycleId?: string;
  niveauScolaireId?: string;
  recherche?: string;
}
export function normalizeMatiereName(nom: string) {
  return nom.trim().toLowerCase();
}
