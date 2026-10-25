import { z } from 'zod';
const identifier = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, 'Identifiant invalide.')
  .transform((value) => value.toLowerCase());
export const enseignementSchema = z
  .object({ classeId: identifier, matiereId: identifier })
  .strict();
export const teacherInputSchema = z
  .object({
    nom: z.string().trim().min(1, 'Le nom est obligatoire.').max(100),
    prenom: z.string().trim().min(1, 'Le prénom est obligatoire.').max(100),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .refine(
        (value) => value === '' || z.string().email().safeParse(value).success,
        'Adresse email invalide.',
      )
      .default(''),
    tel: z.string().trim().max(50).default(''),
    enseignements: z
      .array(enseignementSchema)
      .max(100)
      .refine(
        (items) =>
          new Set(items.map((item) => item.classeId + ':' + item.matiereId)).size ===
          items.length,
        'Une affectation apparaît plusieurs fois.',
      )
      .default([]),
  })
  .strict();
export const teacherUpdateSchema = teacherInputSchema.extend({
  version: z.number().int().nonnegative(),
});
export type Enseignement = z.infer<typeof enseignementSchema>;
export type TeacherInput = z.infer<typeof teacherInputSchema>;
export interface Teacher extends TeacherInput {
  id: string;
  version: number;
  isDeleted: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface EnseignementData extends Enseignement {
  classe: string;
  matiere: string;
  niveauClasse: string;
  cycle: string;
  niveauScolaire: string;
}
export interface TeacherWithAssignments extends Teacher {
  enseignementsData: EnseignementData[];
}
export interface TeacherFilters {
  niveauScolaireId?: string;
  cycleId?: string;
  niveauClasseId?: string;
  classeId?: string;
  matiereId?: string;
  recherche?: string;
}
